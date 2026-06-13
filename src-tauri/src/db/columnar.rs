#![cfg_attr(
    not(test),
    warn(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]
//! Columnar binary encoding + zstd compression for raw experiment points.
//!
//! ## Format v2 (uncompressed)
//!
//! ```text
//! [4]  Magic:         b"RHLC"
//! [4]  Version:       2u32 LE
//! [4]  point_count:   u32 LE
//! [4]  channel_count: u32 LE
//!
//! For each channel  (channel_count entries):
//!   [2]       name_len: u16 LE
//!   [name_len] name:    UTF-8
//!
//! For each channel  (same order):
//!   [⌈point_count/8⌉]  null_bitmap: bit-packed (MSB-first), 1 = present, 0 = null
//!   [8 * point_count]   values:      f64 LE (0.0 at null positions)
//! ```
//!
//! ## Format v1 (legacy, decode-only)
//!
//! Same as v2 but WITHOUT the null_bitmap section: every value is treated as
//! present (no distinction between genuine 0.0 and missing data).
//!
//! The raw bytes above are then **zstd-compressed** (level 3) before storage.

use crate::error::Result;
use byteorder::{LittleEndian, ReadBytesExt, WriteBytesExt};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{Cursor, Read, Write};

const MAGIC: &[u8; 4] = b"RHLC";
const VERSION: u32 = 2;
/// zstd compression level — level 3 balances speed vs size well for repeating float data.
const ZSTD_LEVEL: i32 = 3;

/// Encode `raw_points` (array-of-structs) into compressed columnar bytes (v2 with null bitmap).
///
/// Returns an empty `Vec` if `raw_points` is empty.
pub fn encode(raw_points: &[Value]) -> Result<Vec<u8>> {
    if raw_points.is_empty() {
        return Ok(Vec::new());
    }

    // Collect channel names in deterministic order, preserving first-seen insertion order.
    let mut channel_names: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for point in raw_points {
        if let Value::Object(map) = point {
            for key in map.keys() {
                if seen.insert(key.clone()) {
                    channel_names.push(key.clone());
                }
            }
        }
    }

    let point_count = raw_points.len() as u32;
    let channel_count = channel_names.len() as u32;
    let bitmap_bytes = (point_count as usize).div_ceil(8);

    // Build: values[ch_idx] = Vec<f64>, null_bitmaps[ch_idx] = Vec<u8>
    let mut channel_values: Vec<Vec<f64>> =
        vec![Vec::with_capacity(raw_points.len()); channel_names.len()];
    let mut channel_bitmaps: Vec<Vec<u8>> = vec![vec![0u8; bitmap_bytes]; channel_names.len()];

    for (pt_idx, point) in raw_points.iter().enumerate() {
        for (ch_idx, ch_name) in channel_names.iter().enumerate() {
            match point.get(ch_name).and_then(|v| v.as_f64()) {
                Some(val) => {
                    channel_values[ch_idx].push(val);
                    // Set bit: MSB-first within each byte
                    channel_bitmaps[ch_idx][pt_idx / 8] |= 1 << (7 - (pt_idx % 8));
                }
                None => {
                    channel_values[ch_idx].push(0.0_f64);
                    // bit stays 0 = null
                }
            }
        }
    }

    // Serialize to binary.
    let capacity = 16
        + channel_names.iter().map(|n| 2 + n.len()).sum::<usize>()
        + channel_names.len() * (bitmap_bytes + raw_points.len() * 8);
    let mut buf: Vec<u8> = Vec::with_capacity(capacity);

    buf.write_all(MAGIC).map_err(|e| e.to_string())?;
    buf.write_u32::<LittleEndian>(VERSION)
        .map_err(|e| e.to_string())?;
    buf.write_u32::<LittleEndian>(point_count)
        .map_err(|e| e.to_string())?;
    buf.write_u32::<LittleEndian>(channel_count)
        .map_err(|e| e.to_string())?;

    for name in &channel_names {
        let bytes = name.as_bytes();
        buf.write_u16::<LittleEndian>(bytes.len() as u16)
            .map_err(|e| e.to_string())?;
        buf.write_all(bytes).map_err(|e| e.to_string())?;
    }

    for ch_idx in 0..channel_names.len() {
        // Write null bitmap first
        buf.write_all(&channel_bitmaps[ch_idx])
            .map_err(|e| e.to_string())?;
        // Then f64 values
        for &v in &channel_values[ch_idx] {
            buf.write_f64::<LittleEndian>(v)
                .map_err(|e| e.to_string())?;
        }
    }

    // Compress.
    let compressed = zstd::encode_all(buf.as_slice(), ZSTD_LEVEL)
        .map_err(|e| format!("zstd encode error: {}", e))?;

    Ok(compressed)
}

/// Reject implausible header counts before any `Vec::with_capacity`.
///
/// A corrupted or maliciously-crafted blob could otherwise declare billions of
/// points/channels and drive `with_capacity` into a multi-GB allocation (OOM)
/// long before `read_exact` would hit the end of the buffer. The decoded
/// payload can never contain more `f64` values than the decompressed buffer can
/// physically hold (8 bytes each), nor more channels than it has bytes.
fn validate_header_counts(
    total_len: usize,
    point_count: usize,
    channel_count: usize,
) -> Result<()> {
    // Each channel's name section consumes at least a 2-byte length prefix.
    if channel_count > total_len {
        return Err(format!(
            "Columnar blob declares {channel_count} channels but is only {total_len} bytes"
        )
        .into());
    }
    // Each declared value occupies 8 bytes (f64) in the buffer.
    if channel_count.saturating_mul(point_count) > total_len / 8 {
        return Err(format!(
            "Columnar blob declares {channel_count}x{point_count} values, exceeding {total_len}-byte buffer"
        )
        .into());
    }
    Ok(())
}

/// Decode compressed columnar bytes back to array-of-structs `Vec<Value>`.
///
/// Supports both:
/// - **v1** (legacy): no null bitmap — all values treated as present.
/// - **v2** (current): per-channel null bitmap — null positions become `Value::Null`.
///
/// Returns an empty `Vec` if `bytes` is empty.
pub fn decode(bytes: &[u8]) -> Result<Vec<Value>> {
    if bytes.is_empty() {
        return Ok(Vec::new());
    }

    // Decompress.
    let decompressed = zstd::decode_all(bytes).map_err(|e| format!("zstd decode error: {}", e))?;

    let mut cur = Cursor::new(decompressed);

    // Magic.
    let mut magic = [0u8; 4];
    cur.read_exact(&mut magic).map_err(|e| e.to_string())?;
    if &magic != MAGIC {
        return Err(format!("Invalid magic bytes: {:?}", magic).into());
    }

    // Version.
    let version = cur.read_u32::<LittleEndian>().map_err(|e| e.to_string())?;
    if version != 1 && version != 2 {
        return Err(format!("Unsupported columnar version: {}", version).into());
    }

    let point_count = cur.read_u32::<LittleEndian>().map_err(|e| e.to_string())?;
    let channel_count = cur.read_u32::<LittleEndian>().map_err(|e| e.to_string())?;

    validate_header_counts(
        cur.get_ref().len(),
        point_count as usize,
        channel_count as usize,
    )?;

    // Channel names.
    let mut channel_names: Vec<String> = Vec::with_capacity(channel_count as usize);
    for _ in 0..channel_count {
        let name_len = cur.read_u16::<LittleEndian>().map_err(|e| e.to_string())? as usize;
        let mut name_bytes = vec![0u8; name_len];
        cur.read_exact(&mut name_bytes).map_err(|e| e.to_string())?;
        let name = String::from_utf8(name_bytes).map_err(|e| e.to_string())?;
        channel_names.push(name);
    }

    let bitmap_bytes = (point_count as usize).div_ceil(8);

    // Channel values + optional bitmaps: [ch][pt]
    let mut channel_values: Vec<Vec<f64>> = Vec::with_capacity(channel_count as usize);
    let mut channel_bitmaps: Vec<Option<Vec<u8>>> = Vec::with_capacity(channel_count as usize);

    for _ in 0..channel_count {
        // v2: read null bitmap before values
        let bitmap = if version >= 2 {
            let mut bm = vec![0u8; bitmap_bytes];
            cur.read_exact(&mut bm).map_err(|e| e.to_string())?;
            Some(bm)
        } else {
            None
        };

        let mut values = Vec::with_capacity(point_count as usize);
        for _ in 0..point_count {
            let v = cur.read_f64::<LittleEndian>().map_err(|e| e.to_string())?;
            values.push(v);
        }
        channel_values.push(values);
        channel_bitmaps.push(bitmap);
    }

    // Reconstruct AoS.
    let mut result: Vec<Value> = Vec::with_capacity(point_count as usize);
    for pt_idx in 0..point_count as usize {
        let mut obj = serde_json::Map::new();
        for (ch_idx, ch_name) in channel_names.iter().enumerate() {
            let is_present = match &channel_bitmaps[ch_idx] {
                Some(bm) => (bm[pt_idx / 8] >> (7 - (pt_idx % 8))) & 1 == 1,
                None => true, // v1: all values are present
            };
            if is_present {
                let v = channel_values[ch_idx][pt_idx];
                obj.insert(ch_name.clone(), Value::from(v));
            }
            // null values: simply omit the key (same as missing in original JSON)
        }
        result.push(Value::Object(obj));
    }

    Ok(result)
}

/// Decode compressed columnar bytes into struct-of-arrays (SoA) form.
///
/// Returns `HashMap<channel_name, Vec<Option<f64>>>` where `None` indicates a
/// null value (absent in the original data).  This avoids materialising
/// `serde_json::Value` objects on the hot path — callers that process each
/// channel independently (e.g. statistics workers) should prefer this over
/// [`decode`].
///
/// Supports both v1 (no null bitmap) and v2 (per-channel null bitmap).
/// Returns an empty map if `bytes` is empty.
pub fn decode_typed(bytes: &[u8]) -> Result<HashMap<String, Vec<Option<f64>>>> {
    if bytes.is_empty() {
        return Ok(HashMap::new());
    }

    // Decompress.
    let decompressed = zstd::decode_all(bytes).map_err(|e| format!("zstd decode error: {}", e))?;

    let mut cur = Cursor::new(decompressed);

    // Magic.
    let mut magic = [0u8; 4];
    cur.read_exact(&mut magic).map_err(|e| e.to_string())?;
    if &magic != MAGIC {
        return Err(format!("Invalid magic bytes: {:?}", magic).into());
    }

    // Version.
    let version = cur.read_u32::<LittleEndian>().map_err(|e| e.to_string())?;
    if version != 1 && version != 2 {
        return Err(format!("Unsupported columnar version: {}", version).into());
    }

    let point_count = cur.read_u32::<LittleEndian>().map_err(|e| e.to_string())? as usize;
    let channel_count = cur.read_u32::<LittleEndian>().map_err(|e| e.to_string())? as usize;

    validate_header_counts(cur.get_ref().len(), point_count, channel_count)?;

    // Channel names.
    let mut channel_names: Vec<String> = Vec::with_capacity(channel_count);
    for _ in 0..channel_count {
        let name_len = cur.read_u16::<LittleEndian>().map_err(|e| e.to_string())? as usize;
        let mut name_bytes = vec![0u8; name_len];
        cur.read_exact(&mut name_bytes).map_err(|e| e.to_string())?;
        let name = String::from_utf8(name_bytes).map_err(|e| e.to_string())?;
        channel_names.push(name);
    }

    let bitmap_bytes = point_count.div_ceil(8);
    let mut result: HashMap<String, Vec<Option<f64>>> = HashMap::with_capacity(channel_count);

    for ch_name in channel_names {
        // v2: read null bitmap before values.
        let bitmap: Option<Vec<u8>> = if version >= 2 {
            let mut bm = vec![0u8; bitmap_bytes];
            cur.read_exact(&mut bm).map_err(|e| e.to_string())?;
            Some(bm)
        } else {
            None
        };

        let mut values: Vec<Option<f64>> = Vec::with_capacity(point_count);
        for pt_idx in 0..point_count {
            let raw = cur.read_f64::<LittleEndian>().map_err(|e| e.to_string())?;
            let is_present = match &bitmap {
                Some(bm) => (bm[pt_idx / 8] >> (7 - (pt_idx % 8))) & 1 == 1,
                None => true, // v1: every slot is present
            };
            values.push(if is_present { Some(raw) } else { None });
        }

        result.insert(ch_name, values);
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make_points(n: usize) -> Vec<Value> {
        (0..n)
            .map(|i| {
                json!({
                    "time_sec": i as f64 * 0.5,
                    "viscosity_cp": 100.0 + i as f64,
                    "temperature_c": 20.0 + (i as f64 * 0.01),
                    "shear_rate": 10.0 * i as f64,
                    "pressure_bar": 1.0
                })
            })
            .collect()
    }

    #[test]
    fn roundtrip_empty() {
        let encoded = encode(&[]).unwrap();
        assert!(encoded.is_empty());
        let decoded = decode(&encoded).unwrap();
        assert!(decoded.is_empty());
    }

    #[test]
    fn roundtrip_small() {
        let points = make_points(10);
        let encoded = encode(&points).unwrap();
        let decoded = decode(&encoded).unwrap();
        assert_eq!(decoded.len(), 10);
        let eps = 1e-9;
        for (orig, got) in points.iter().zip(decoded.iter()) {
            for key in [
                "time_sec",
                "viscosity_cp",
                "temperature_c",
                "shear_rate",
                "pressure_bar",
            ] {
                let a = orig.get(key).and_then(|v| v.as_f64()).unwrap_or(0.0);
                let b = got.get(key).and_then(|v| v.as_f64()).unwrap_or(0.0);
                assert!((a - b).abs() < eps, "{key}: {a} vs {b}");
            }
        }
    }

    #[test]
    fn compression_ratio_25k() {
        let points = make_points(25_000);
        let json_size = serde_json::to_string(&points).unwrap().len();
        let compressed_size = encode(&points).unwrap().len();
        let ratio = json_size as f64 / compressed_size as f64;
        tracing::info!(
            "25K points: JSON={} bytes, columnar+zstd={} bytes, ratio={:.1}x",
            json_size,
            compressed_size,
            ratio
        );
        // Columnar+zstd should be at least 5x smaller than JSON for numeric data.
        assert!(ratio > 5.0, "Expected >5x compression, got {:.1}x", ratio);
    }

    #[test]
    fn roundtrip_with_nulls() {
        // Point 0: has all channels. Point 1: missing viscosity. Point 2: missing temperature.
        let points = vec![
            json!({"time_sec": 0.0, "viscosity_cp": 100.0, "temperature_c": 20.0}),
            json!({"time_sec": 0.5, "temperature_c": 20.1}),
            json!({"time_sec": 1.0, "viscosity_cp": 102.0}),
        ];
        let encoded = encode(&points).unwrap();
        let decoded = decode(&encoded).unwrap();
        assert_eq!(decoded.len(), 3);

        // Point 0: all present
        assert_eq!(
            decoded[0].get("time_sec").and_then(|v| v.as_f64()),
            Some(0.0)
        );
        assert_eq!(
            decoded[0].get("viscosity_cp").and_then(|v| v.as_f64()),
            Some(100.0)
        );
        assert_eq!(
            decoded[0].get("temperature_c").and_then(|v| v.as_f64()),
            Some(20.0)
        );

        // Point 1: viscosity missing (key absent), rest present
        assert_eq!(
            decoded[1].get("time_sec").and_then(|v| v.as_f64()),
            Some(0.5)
        );
        assert!(
            decoded[1].get("viscosity_cp").is_none(),
            "viscosity should be absent for point 1"
        );
        assert_eq!(
            decoded[1].get("temperature_c").and_then(|v| v.as_f64()),
            Some(20.1)
        );

        // Point 2: temperature missing (key absent), rest present
        assert_eq!(
            decoded[2].get("time_sec").and_then(|v| v.as_f64()),
            Some(1.0)
        );
        assert_eq!(
            decoded[2].get("viscosity_cp").and_then(|v| v.as_f64()),
            Some(102.0)
        );
        assert!(
            decoded[2].get("temperature_c").is_none(),
            "temperature should be absent for point 2"
        );
    }

    #[test]
    fn roundtrip_typed() {
        // Encode via AoS path, decode via decode_typed — values must agree.
        let points = make_points(20);
        let encoded = encode(&points).unwrap();

        let typed = decode_typed(&encoded).unwrap();

        // channel count and point count per channel must match.
        for key in [
            "time_sec",
            "viscosity_cp",
            "temperature_c",
            "shear_rate",
            "pressure_bar",
        ] {
            let col = typed
                .get(key)
                .unwrap_or_else(|| panic!("missing channel {key}"));
            assert_eq!(col.len(), 20, "channel {key}: length mismatch");
        }

        // All values should be present (no nulls in make_points) and match original.
        let eps = 1e-9;
        let vis_col = typed.get("viscosity_cp").unwrap();
        for (i, pt) in points.iter().enumerate() {
            let expected = pt.get("viscosity_cp").and_then(|v| v.as_f64()).unwrap();
            let got = vis_col[i].expect("unexpected null");
            assert!(
                (expected - got).abs() < eps,
                "viscosity_cp[{i}]: {expected} vs {got}"
            );
        }

        // decode_typed on empty bytes should return empty map.
        let empty = decode_typed(&[]).unwrap();
        assert!(empty.is_empty());
    }

    #[test]
    fn roundtrip_typed_with_nulls() {
        let points = vec![
            json!({"time_sec": 0.0, "viscosity_cp": 100.0, "temperature_c": 20.0}),
            json!({"time_sec": 0.5, "temperature_c": 20.1}),
            json!({"time_sec": 1.0, "viscosity_cp": 102.0}),
        ];
        let encoded = encode(&points).unwrap();
        let typed = decode_typed(&encoded).unwrap();

        let vis = typed.get("viscosity_cp").unwrap();
        assert_eq!(vis[0], Some(100.0));
        assert_eq!(vis[1], None); // absent in point 1
        assert_eq!(vis[2], Some(102.0));

        let temp = typed.get("temperature_c").unwrap();
        assert_eq!(temp[0], Some(20.0));
        assert_eq!(temp[1], Some(20.1));
        assert_eq!(temp[2], None); // absent in point 2
    }

    /// Performance budget: encode + decode of 25 K points must complete within
    /// 1 000 ms in release mode (actual is typically ~20–50 ms; the generous
    /// threshold guards against catastrophic regressions on slow CI runners).
    #[test]
    fn perf_budget_encode_decode_25k() {
        let points = make_points(25_000);
        let start = std::time::Instant::now();
        let encoded = encode(&points).unwrap();
        let _decoded = decode(&encoded).unwrap();
        let elapsed = start.elapsed();
        assert!(
            elapsed.as_millis() < 1_000,
            "encode+decode 25K points took {}ms, budget is 1000ms",
            elapsed.as_millis()
        );
    }

    /// Performance budget: decode_typed on 25 K points must complete within
    /// 500 ms in release mode (actual is typically ~10–30 ms).
    #[test]
    fn perf_budget_decode_typed_25k() {
        let points = make_points(25_000);
        let encoded = encode(&points).unwrap();
        let start = std::time::Instant::now();
        let _typed = decode_typed(&encoded).unwrap();
        let elapsed = start.elapsed();
        assert!(
            elapsed.as_millis() < 500,
            "decode_typed 25K points took {}ms, budget is 500ms",
            elapsed.as_millis()
        );
    }
}
