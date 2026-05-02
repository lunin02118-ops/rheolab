//! Binary rheology series IPC for chart hot paths.
//!
//! Sprint 6 keeps the persisted data model unchanged: experiment points still
//! live in `ExperimentData.dataBlob` as compressed columnar data.  This module
//! exposes viewport-sized, binary-encoded series windows so the frontend can
//! render charts without first materialising the full `rawPoints` JSON object
//! graph.

use crate::db::DbPool;
use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::utils::validation::validate_hash_id;
use byteorder::{LittleEndian, WriteBytesExt};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::collections::{BTreeSet, HashMap};
use std::io::Write;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::State;

const SERIES_MAGIC: &[u8; 8] = b"RHEOSR1\0";
const SERIES_VERSION: u16 = 1;
const SERIES_HEADER_BYTES: usize = 20;
const SERIES_DESCRIPTOR_BYTES: usize = 8;
const MIN_MAX_POINTS: u32 = 100;
const MAX_MAX_POINTS: u32 = 20_000;
const SERIES_DECODE_CACHE_TTL: Duration = Duration::from_secs(5 * 60);
const SERIES_DECODE_CACHE_MAX_BYTES: usize = 128 * 1024 * 1024;
const SERIES_DECODE_CACHE_MAX_ENTRIES: usize = 16;

static SERIES_DECODE_CACHE: LazyLock<Mutex<SeriesDecodeCache>> =
    LazyLock::new(|| Mutex::new(SeriesDecodeCache::default()));

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum SeriesMetric {
    TimeSec,
    ViscosityCp,
    TemperatureC,
    ShearRate,
    ShearStressPa,
    SpeedRpm,
    PressureBar,
    BathTemperatureC,
}

impl SeriesMetric {
    fn id(self) -> u16 {
        match self {
            Self::TimeSec => 1,
            Self::ViscosityCp => 2,
            Self::TemperatureC => 3,
            Self::ShearRate => 4,
            Self::ShearStressPa => 5,
            Self::SpeedRpm => 6,
            Self::PressureBar => 7,
            Self::BathTemperatureC => 8,
        }
    }

    fn key(self) -> &'static str {
        match self {
            Self::TimeSec => "timeSec",
            Self::ViscosityCp => "viscosityCp",
            Self::TemperatureC => "temperatureC",
            Self::ShearRate => "shearRate",
            Self::ShearStressPa => "shearStressPa",
            Self::SpeedRpm => "speedRpm",
            Self::PressureBar => "pressureBar",
            Self::BathTemperatureC => "bathTemperatureC",
        }
    }

    fn aliases(self) -> &'static [&'static str] {
        match self {
            Self::TimeSec => &["time_sec", "timeSec", "time"],
            Self::ViscosityCp => &["viscosity_cp", "viscosityCp", "viscosity"],
            Self::TemperatureC => &["temperature_c", "temperatureC", "temperature"],
            Self::ShearRate => &["shear_rate_s1", "shearRateS1", "shear_rate", "shearRate"],
            Self::ShearStressPa => &[
                "shear_stress_pa",
                "shearStressPa",
                "shear_stress",
                "shearStress",
            ],
            Self::SpeedRpm => &["speed_rpm", "speedRpm", "rpm"],
            Self::PressureBar => &["pressure_bar", "pressureBar", "pressure"],
            Self::BathTemperatureC => &["bath_temperature_c", "bathTemperatureC"],
        }
    }

    fn from_request(value: &str) -> Option<Self> {
        let normalized = value
            .trim()
            .replace(['_', '-', ' '], "")
            .to_ascii_lowercase();
        match normalized.as_str() {
            "timesec" | "time" => Some(Self::TimeSec),
            "viscositycp" | "viscosity" => Some(Self::ViscosityCp),
            "temperaturec" | "temperature" => Some(Self::TemperatureC),
            "shearrate" | "shearrates1" => Some(Self::ShearRate),
            "shearstress" | "shearstresspa" => Some(Self::ShearStressPa),
            "speedrpm" | "rpm" => Some(Self::SpeedRpm),
            "pressurebar" | "pressure" => Some(Self::PressureBar),
            "bathtemperaturec" | "bathtemperature" => Some(Self::BathTemperatureC),
            _ => None,
        }
    }
}

const DEFAULT_SERIES_METRICS: &[SeriesMetric] = &[
    SeriesMetric::ViscosityCp,
    SeriesMetric::TemperatureC,
    SeriesMetric::ShearRate,
    SeriesMetric::PressureBar,
    SeriesMetric::SpeedRpm,
    SeriesMetric::BathTemperatureC,
];

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SeriesMetricDescriptor {
    pub id: u16,
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SeriesMetaResponse {
    pub experiment_id: String,
    pub point_count: u32,
    pub time_min_sec: Option<f64>,
    pub time_max_sec: Option<f64>,
    pub available_metrics: Vec<SeriesMetricDescriptor>,
    pub data_hash: String,
}

struct LoadedSeries {
    point_count: usize,
    data_hash: String,
    columns: HashMap<String, Vec<Option<f64>>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SeriesDecodeCacheStats {
    entries: usize,
    byte_size: usize,
    hits: u64,
    misses: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SeriesDecodeCacheStatsResponse {
    pub entries: usize,
    pub byte_size: usize,
    pub max_entries: usize,
    pub max_bytes: usize,
    pub ttl_seconds: u64,
    pub hits: u64,
    pub misses: u64,
}

struct SeriesDecodeCacheEntry {
    experiment_id: String,
    series: Arc<LoadedSeries>,
    byte_size: usize,
    created_at: Instant,
    last_accessed_at: Instant,
}

struct SeriesDecodeCache {
    entries: HashMap<String, SeriesDecodeCacheEntry>,
    ttl: Duration,
    max_bytes: usize,
    max_entries: usize,
    byte_size: usize,
    hits: u64,
    misses: u64,
}

impl Default for SeriesDecodeCache {
    fn default() -> Self {
        Self::new(
            SERIES_DECODE_CACHE_TTL,
            SERIES_DECODE_CACHE_MAX_BYTES,
            SERIES_DECODE_CACHE_MAX_ENTRIES,
        )
    }
}

impl SeriesDecodeCache {
    fn new(ttl: Duration, max_bytes: usize, max_entries: usize) -> Self {
        Self {
            entries: HashMap::new(),
            ttl,
            max_bytes,
            max_entries,
            byte_size: 0,
            hits: 0,
            misses: 0,
        }
    }

    fn get(&mut self, experiment_id: &str, data_hash: &str) -> Option<Arc<LoadedSeries>> {
        self.prune();
        let key = series_decode_cache_key(experiment_id, data_hash);
        let Some(entry) = self.entries.get_mut(&key) else {
            self.misses += 1;
            return None;
        };
        let now = Instant::now();
        if now.duration_since(entry.created_at) > self.ttl {
            self.delete_key(&key);
            self.misses += 1;
            return None;
        }
        entry.last_accessed_at = now;
        self.hits += 1;
        Some(Arc::clone(&entry.series))
    }

    fn insert(&mut self, experiment_id: String, data_hash: String, series: Arc<LoadedSeries>) {
        let key = series_decode_cache_key(&experiment_id, &data_hash);
        self.delete_key(&key);
        let byte_size = estimate_loaded_series_bytes(&series);
        let now = Instant::now();
        self.entries.insert(
            key,
            SeriesDecodeCacheEntry {
                experiment_id,
                series,
                byte_size,
                created_at: now,
                last_accessed_at: now,
            },
        );
        self.byte_size += byte_size;
        self.prune();
    }

    fn release_experiment(&mut self, experiment_id: &str) {
        let keys: Vec<String> = self
            .entries
            .iter()
            .filter_map(|(key, entry)| {
                if entry.experiment_id == experiment_id {
                    Some(key.clone())
                } else {
                    None
                }
            })
            .collect();
        for key in keys {
            self.delete_key(&key);
        }
    }

    #[cfg(test)]
    fn clear(&mut self) {
        self.entries.clear();
        self.byte_size = 0;
        self.hits = 0;
        self.misses = 0;
    }

    fn stats(&mut self) -> SeriesDecodeCacheStats {
        self.prune();
        SeriesDecodeCacheStats {
            entries: self.entries.len(),
            byte_size: self.byte_size,
            hits: self.hits,
            misses: self.misses,
        }
    }

    fn prune(&mut self) {
        let now = Instant::now();
        let expired: Vec<String> = self
            .entries
            .iter()
            .filter_map(|(key, entry)| {
                if now.duration_since(entry.created_at) > self.ttl {
                    Some(key.clone())
                } else {
                    None
                }
            })
            .collect();
        for key in expired {
            self.delete_key(&key);
        }

        while self.entries.len() > self.max_entries || self.byte_size > self.max_bytes {
            let Some(key) = self.oldest_entry_key() else {
                break;
            };
            self.delete_key(&key);
        }
    }

    fn oldest_entry_key(&self) -> Option<String> {
        self.entries
            .iter()
            .min_by_key(|(_, entry)| entry.last_accessed_at)
            .map(|(key, _)| key.clone())
    }

    fn delete_key(&mut self, key: &str) {
        if let Some(entry) = self.entries.remove(key) {
            self.byte_size = self.byte_size.saturating_sub(entry.byte_size);
        }
    }
}

fn series_decode_cache_key(experiment_id: &str, data_hash: &str) -> String {
    format!("{experiment_id}:{data_hash}")
}

fn estimate_loaded_series_bytes(series: &LoadedSeries) -> usize {
    series.data_hash.len()
        + series
            .columns
            .iter()
            .map(|(key, values)| key.len() + values.len() * std::mem::size_of::<Option<f64>>())
            .sum::<usize>()
}

impl LoadedSeries {
    fn time_values(&self) -> Result<Vec<f64>> {
        let raw = first_present_column(&self.columns, SeriesMetric::TimeSec.aliases())
            .ok_or_else(|| AppError::Parse("series data has no time_sec channel".into()))?;
        let mut out = Vec::with_capacity(raw.len());
        for value in raw {
            match value {
                Some(v) if v.is_finite() => out.push(*v),
                _ => {
                    return Err(AppError::Parse(
                        "series data has non-finite time value".into(),
                    ))
                }
            }
        }
        Ok(out)
    }

    fn metric_values(&self, metric: SeriesMetric) -> Vec<f64> {
        first_present_column(&self.columns, metric.aliases())
            .map(|values| {
                values
                    .iter()
                    .map(|value| match value {
                        Some(v) if v.is_finite() => *v,
                        _ => f64::NAN,
                    })
                    .collect()
            })
            .unwrap_or_else(|| vec![f64::NAN; self.point_count])
    }
}

fn first_present_column<'a>(
    columns: &'a HashMap<String, Vec<Option<f64>>>,
    aliases: &[&str],
) -> Option<&'a Vec<Option<f64>>> {
    aliases.iter().find_map(|alias| columns.get(*alias))
}

fn parse_requested_metrics(values: &[String]) -> Result<Vec<SeriesMetric>> {
    let requested: Vec<SeriesMetric> = if values.is_empty() {
        DEFAULT_SERIES_METRICS.to_vec()
    } else {
        values
            .iter()
            .map(|value| {
                SeriesMetric::from_request(value).ok_or_else(|| {
                    AppError::BadRequest(format!("Unsupported series metric: {value}"))
                })
            })
            .collect::<Result<Vec<_>>>()?
    };

    let mut out = Vec::with_capacity(requested.len());
    for metric in requested {
        if metric == SeriesMetric::TimeSec {
            continue;
        }
        if !out.contains(&metric) {
            out.push(metric);
        }
    }
    if out.is_empty() {
        return Err(AppError::BadRequest(
            "At least one non-time series metric is required".into(),
        ));
    }
    Ok(out)
}

fn validate_max_points(max_points: u32) -> Result<usize> {
    if !(MIN_MAX_POINTS..=MAX_MAX_POINTS).contains(&max_points) {
        return Err(AppError::BadRequest(format!(
            "maxPoints must be between {MIN_MAX_POINTS} and {MAX_MAX_POINTS}"
        )));
    }
    Ok(max_points as usize)
}

fn validate_window(x_min_sec: f64, x_max_sec: f64) -> Result<()> {
    if !x_min_sec.is_finite() || !x_max_sec.is_finite() {
        return Err(AppError::BadRequest(
            "xMinSec and xMaxSec must be finite".into(),
        ));
    }
    if x_min_sec >= x_max_sec {
        return Err(AppError::BadRequest(
            "xMinSec must be lower than xMaxSec".into(),
        ));
    }
    Ok(())
}

fn load_series_by_id(pool: &DbPool, experiment_id: &str) -> Result<Arc<LoadedSeries>> {
    let conn = pool.get()?;
    let row: Option<(Vec<u8>, i64)> = conn
        .query_row(
            "SELECT dataBlob, pointCount FROM ExperimentData WHERE experimentId = ?1",
            [experiment_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let (blob, point_count) = row.ok_or_else(|| {
        AppError::BadRequest(format!(
            "ExperimentData not found for experimentId={experiment_id}"
        ))
    })?;
    let data_hash = hex::encode(Sha256::digest(&blob));
    drop(conn);

    if let Ok(mut cache) = SERIES_DECODE_CACHE.lock() {
        if let Some(series) = cache.get(experiment_id, &data_hash) {
            return Ok(series);
        }
    }

    let columns = crate::db::columnar::decode_typed(&blob)?;
    let series = Arc::new(LoadedSeries {
        point_count: if point_count > 0 {
            point_count as usize
        } else {
            columns.values().next().map(|col| col.len()).unwrap_or(0)
        },
        data_hash: data_hash.clone(),
        columns,
    });
    if let Ok(mut cache) = SERIES_DECODE_CACHE.lock() {
        cache.insert(experiment_id.to_string(), data_hash, Arc::clone(&series));
    }
    Ok(series)
}

pub(crate) fn release_series_decode_cache_for_experiment(experiment_id: &str) {
    if let Ok(mut cache) = SERIES_DECODE_CACHE.lock() {
        cache.release_experiment(experiment_id);
    }
}

#[tauri::command]
pub async fn series_decode_cache_stats() -> Result<SeriesDecodeCacheStatsResponse> {
    let mut cache = SERIES_DECODE_CACHE
        .lock()
        .map_err(|_| AppError::Other("series decode cache lock poisoned".into()))?;
    let stats = cache.stats();
    Ok(SeriesDecodeCacheStatsResponse {
        entries: stats.entries,
        byte_size: stats.byte_size,
        max_entries: cache.max_entries,
        max_bytes: cache.max_bytes,
        ttl_seconds: cache.ttl.as_secs(),
        hits: stats.hits,
        misses: stats.misses,
    })
}

fn available_metrics(series: &LoadedSeries) -> Vec<SeriesMetricDescriptor> {
    let mut metrics = Vec::new();
    for metric in [
        SeriesMetric::TimeSec,
        SeriesMetric::ViscosityCp,
        SeriesMetric::TemperatureC,
        SeriesMetric::ShearRate,
        SeriesMetric::ShearStressPa,
        SeriesMetric::SpeedRpm,
        SeriesMetric::PressureBar,
        SeriesMetric::BathTemperatureC,
    ] {
        if first_present_column(&series.columns, metric.aliases()).is_some() {
            metrics.push(SeriesMetricDescriptor {
                id: metric.id(),
                key: metric.key().to_string(),
            });
        }
    }
    metrics
}

fn exact_window_indices(times: &[f64], x_min_sec: f64, x_max_sec: f64) -> Vec<usize> {
    times
        .iter()
        .enumerate()
        .filter_map(|(idx, time)| {
            if *time >= x_min_sec && *time <= x_max_sec {
                Some(idx)
            } else {
                None
            }
        })
        .collect()
}

fn overview_indices(times: &[f64]) -> Vec<usize> {
    (0..times.len()).collect()
}

fn sort_indices_by_time(times: &[f64], indices: &mut [usize]) {
    indices.sort_by(|a, b| {
        times[*a]
            .partial_cmp(&times[*b])
            .unwrap_or(Ordering::Equal)
            .then_with(|| a.cmp(b))
    });
}

fn downsample_min_max_by_time(
    times: &[f64],
    candidate_indices: &[usize],
    primary_values: &[f64],
    max_points: usize,
) -> Vec<usize> {
    if candidate_indices.len() <= max_points {
        return candidate_indices.to_vec();
    }
    if max_points < 4 || candidate_indices.is_empty() {
        return candidate_indices.iter().copied().take(max_points).collect();
    }

    let first_idx = candidate_indices[0];
    let last_idx = *candidate_indices.last().unwrap_or(&first_idx);
    let first_time = times[first_idx];
    let last_time = times[last_idx];
    if !first_time.is_finite() || !last_time.is_finite() || first_time >= last_time {
        return candidate_indices.iter().copied().take(max_points).collect();
    }

    let bucket_count = ((max_points - 2) / 2).max(1);
    let bucket_width = (last_time - first_time) / bucket_count as f64;
    let mut selected = BTreeSet::new();
    selected.insert(first_idx);
    selected.insert(last_idx);

    let mut cursor = 0usize;
    for bucket in 0..bucket_count {
        let bucket_start = first_time + bucket_width * bucket as f64;
        let bucket_end = if bucket == bucket_count - 1 {
            last_time + f64::EPSILON
        } else {
            bucket_start + bucket_width
        };

        while cursor < candidate_indices.len() && times[candidate_indices[cursor]] < bucket_start {
            cursor += 1;
        }

        let mut scan = cursor;
        let mut min_idx: Option<usize> = None;
        let mut max_idx: Option<usize> = None;
        let mut min_value = f64::INFINITY;
        let mut max_value = f64::NEG_INFINITY;

        while scan < candidate_indices.len() {
            let idx = candidate_indices[scan];
            let time = times[idx];
            if time >= bucket_end {
                break;
            }
            let value = primary_values.get(idx).copied().unwrap_or(f64::NAN);
            if value.is_finite() {
                if value < min_value {
                    min_value = value;
                    min_idx = Some(idx);
                }
                if value > max_value {
                    max_value = value;
                    max_idx = Some(idx);
                }
            }
            scan += 1;
        }

        match (min_idx, max_idx) {
            (Some(a), Some(b)) if times[a] <= times[b] => {
                selected.insert(a);
                selected.insert(b);
            }
            (Some(a), Some(b)) => {
                selected.insert(b);
                selected.insert(a);
            }
            (Some(a), None) | (None, Some(a)) => {
                selected.insert(a);
            }
            (None, None) => {}
        }
    }

    let mut out: Vec<usize> = selected.into_iter().collect();
    sort_indices_by_time(times, &mut out);
    if out.len() > max_points {
        out.truncate(max_points);
    }
    out
}

fn select_indices(
    times: &[f64],
    x_min_sec: Option<f64>,
    x_max_sec: Option<f64>,
    primary_values: &[f64],
    max_points: usize,
) -> Vec<usize> {
    let mut candidates = match (x_min_sec, x_max_sec) {
        (Some(min), Some(max)) => exact_window_indices(times, min, max),
        _ => overview_indices(times),
    };
    sort_indices_by_time(times, &mut candidates);
    downsample_min_max_by_time(times, &candidates, primary_values, max_points)
}

fn encode_series_binary(
    series: &LoadedSeries,
    metrics: &[SeriesMetric],
    indices: &[usize],
) -> Result<Vec<u8>> {
    let mut columns: Vec<(SeriesMetric, Vec<f64>, bool)> = Vec::with_capacity(metrics.len() + 1);
    let times = series.time_values()?;
    columns.push((
        SeriesMetric::TimeSec,
        indices.iter().map(|idx| times[*idx]).collect(),
        false,
    ));
    for metric in metrics {
        let values = series.metric_values(*metric);
        let projected: Vec<f64> = indices.iter().map(|idx| values[*idx]).collect();
        let nullable = projected.iter().any(|value| value.is_nan());
        columns.push((*metric, projected, nullable));
    }

    let point_count = indices.len();
    let column_count = columns.len();
    let descriptor_start = SERIES_HEADER_BYTES;
    let payload_start = align_to_8(descriptor_start + column_count * SERIES_DESCRIPTOR_BYTES);
    let total_bytes = payload_start + column_count * point_count * std::mem::size_of::<f64>();
    let mut out = Vec::with_capacity(total_bytes);

    out.write_all(SERIES_MAGIC).map_err(|e| e.to_string())?;
    out.write_u16::<LittleEndian>(SERIES_VERSION)
        .map_err(|e| e.to_string())?;
    out.write_u16::<LittleEndian>(0)
        .map_err(|e| e.to_string())?;
    out.write_u32::<LittleEndian>(point_count as u32)
        .map_err(|e| e.to_string())?;
    out.write_u16::<LittleEndian>(column_count as u16)
        .map_err(|e| e.to_string())?;
    out.write_u16::<LittleEndian>(0)
        .map_err(|e| e.to_string())?;

    let mut offset = payload_start;
    for (metric, _values, nullable) in &columns {
        out.write_u16::<LittleEndian>(metric.id())
            .map_err(|e| e.to_string())?;
        out.write_u8(1).map_err(|e| e.to_string())?; // dtype: f64
        out.write_u8(if *nullable { 1 } else { 0 })
            .map_err(|e| e.to_string())?;
        out.write_u32::<LittleEndian>(offset as u32)
            .map_err(|e| e.to_string())?;
        offset += point_count * std::mem::size_of::<f64>();
    }

    while out.len() < payload_start {
        out.write_u8(0).map_err(|e| e.to_string())?;
    }

    for (_metric, values, _nullable) in columns {
        for value in values {
            out.write_f64::<LittleEndian>(value)
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(out)
}

fn align_to_8(value: usize) -> usize {
    (value + 7) & !7
}

fn build_series_response(
    pool: DbPool,
    experiment_id: String,
    metrics: Vec<String>,
    max_points: u32,
    x_min_sec: Option<f64>,
    x_max_sec: Option<f64>,
) -> Result<Vec<u8>> {
    validate_hash_id(&experiment_id, "experimentId")?;
    let max_points = validate_max_points(max_points)?;
    if let (Some(min), Some(max)) = (x_min_sec, x_max_sec) {
        validate_window(min, max)?;
    }
    let metrics = parse_requested_metrics(&metrics)?;
    let series = load_series_by_id(&pool, &experiment_id)?;
    let times = series.time_values()?;
    let primary_metric = if metrics.contains(&SeriesMetric::ViscosityCp) {
        SeriesMetric::ViscosityCp
    } else {
        metrics[0]
    };
    let primary_values = series.metric_values(primary_metric);
    let indices = select_indices(&times, x_min_sec, x_max_sec, &primary_values, max_points);
    encode_series_binary(&series, &metrics, &indices)
}

#[tauri::command]
pub async fn experiments_series_meta(
    state: State<'_, AppState>,
    experiment_id: String,
) -> Result<SeriesMetaResponse> {
    validate_hash_id(&experiment_id, "experimentId")?;
    let pool = state.db_pool.clone();
    tokio::task::spawn_blocking(move || {
        let series = load_series_by_id(&pool, &experiment_id)?;
        let times = series.time_values()?;
        let time_min_sec = times.iter().copied().reduce(f64::min);
        let time_max_sec = times.iter().copied().reduce(f64::max);
        Ok(SeriesMetaResponse {
            experiment_id,
            point_count: series.point_count as u32,
            time_min_sec,
            time_max_sec,
            available_metrics: available_metrics(&series),
            data_hash: series.data_hash.clone(),
        })
    })
    .await?
}

#[tauri::command]
pub async fn experiments_series_overview(
    state: State<'_, AppState>,
    experiment_id: String,
    metrics: Vec<String>,
    max_points: u32,
) -> Result<tauri::ipc::Response> {
    let pool = state.db_pool.clone();
    let bytes = tokio::task::spawn_blocking(move || {
        build_series_response(pool, experiment_id, metrics, max_points, None, None)
    })
    .await??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn experiments_series_window(
    state: State<'_, AppState>,
    experiment_id: String,
    x_min_sec: f64,
    x_max_sec: f64,
    metrics: Vec<String>,
    max_points: u32,
    downsample_mode: Option<String>,
) -> Result<tauri::ipc::Response> {
    if let Some(mode) = downsample_mode.as_deref() {
        let normalized = mode.trim().to_ascii_lowercase();
        if normalized != "minmax" && normalized != "min_max" && normalized != "bucket_min_max" {
            return Err(AppError::BadRequest(format!(
                "Unsupported downsampleMode: {mode}"
            )));
        }
    }
    let pool = state.db_pool.clone();
    let bytes = tokio::task::spawn_blocking(move || {
        build_series_response(
            pool,
            experiment_id,
            metrics,
            max_points,
            Some(x_min_sec),
            Some(x_max_sec),
        )
    })
    .await??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migration::run_migrations;
    use rusqlite::Connection;
    use serde_json::json;

    fn make_blob(n: usize) -> Vec<u8> {
        let points = (0..n)
            .map(|i| {
                let peak = if i == n / 2 { 10_000.0 } else { 100.0 + i as f64 };
                json!({
                    "time_sec": i as f64,
                    "viscosity_cp": peak,
                    "temperature_c": 20.0 + i as f64 * 0.1,
                    "shear_rate_s1": 10.0,
                    "pressure_bar": if i % 3 == 0 { serde_json::Value::Null } else { json!(1.0 + i as f64) },
                    "speed_rpm": 30.0,
                })
            })
            .collect::<Vec<_>>();
        crate::db::columnar::encode(&points).unwrap()
    }

    fn insert_blob(conn: &Connection, id: &str, n: usize) {
        conn.execute(
            "INSERT OR IGNORE INTO User (id, name, email, createdAt, updatedAt) \
             VALUES ('default-user', 'Default User', NULL, '2026-04-29T00:00:00Z', \
                     '2026-04-29T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO Experiment \
             (id, originalFilename, testDate, instrumentType, name, waterSource, fluidType, \
              testGroup, metrics, rawPoints, userId) \
             VALUES (?1, 'series.xlsx', '2026-04-29', 'Grace', 'Series', 'Water', \
                     'Linear', 'Rheology', '{}', '[]', 'default-user')",
            [id],
        )
        .unwrap();
        let blob = make_blob(n);
        conn.execute(
            "INSERT INTO ExperimentData \
             (experimentId, dataBlob, encoding, pointCount, createdAt, updatedAt) \
             VALUES (?1, ?2, 'columnar-v1-zstd', ?3, '2026-04-29T00:00:00Z', \
                     '2026-04-29T00:00:00Z')",
            rusqlite::params![id, blob, n as i64],
        )
        .unwrap();
    }

    fn decode_header(bytes: &[u8]) -> (u32, u16) {
        assert_eq!(&bytes[..8], SERIES_MAGIC);
        let point_count = u32::from_le_bytes(bytes[12..16].try_into().unwrap());
        let column_count = u16::from_le_bytes(bytes[16..18].try_into().unwrap());
        (point_count, column_count)
    }

    fn make_loaded_series_for_cache(hash: &str, n: usize) -> Arc<LoadedSeries> {
        let mut columns = HashMap::new();
        columns.insert(
            "time_sec".to_string(),
            (0..n).map(|idx| Some(idx as f64)).collect(),
        );
        columns.insert(
            "viscosity_cp".to_string(),
            (0..n).map(|idx| Some(100.0 + idx as f64)).collect(),
        );
        Arc::new(LoadedSeries {
            point_count: n,
            data_hash: hash.to_string(),
            columns,
        })
    }

    fn clear_global_decode_cache() {
        SERIES_DECODE_CACHE.lock().unwrap().clear();
    }

    #[test]
    fn decoded_series_cache_tracks_hits_misses_and_release() {
        let mut cache = SeriesDecodeCache::new(Duration::from_secs(60), usize::MAX, 16);
        let series = make_loaded_series_for_cache("hash-a", 8);

        cache.insert(
            "exp-1".to_string(),
            "hash-a".to_string(),
            Arc::clone(&series),
        );

        let hit = cache.get("exp-1", "hash-a").unwrap();
        assert!(Arc::ptr_eq(&hit, &series));
        assert!(cache.get("exp-1", "hash-b").is_none());

        let stats = cache.stats();
        assert_eq!(stats.entries, 1);
        assert_eq!(stats.hits, 1);
        assert_eq!(stats.misses, 1);

        cache.release_experiment("exp-1");
        assert_eq!(cache.stats().entries, 0);
    }

    #[test]
    fn decoded_series_cache_prunes_by_byte_budget() {
        let mut cache = SeriesDecodeCache::new(Duration::from_secs(60), 1, 16);
        cache.insert(
            "exp-1".to_string(),
            "hash-a".to_string(),
            make_loaded_series_for_cache("hash-a", 8),
        );
        assert_eq!(cache.stats().entries, 0);
        assert_eq!(cache.stats().byte_size, 0);
    }

    #[tokio::test]
    async fn series_decode_cache_stats_reports_budgets_without_payloads() {
        clear_global_decode_cache();
        {
            let mut cache = SERIES_DECODE_CACHE.lock().unwrap();
            cache.insert(
                "exp-stats".to_string(),
                "hash-a".to_string(),
                make_loaded_series_for_cache("hash-a", 8),
            );
        }

        let stats = series_decode_cache_stats().await.unwrap();

        assert_eq!(stats.entries, 1);
        assert!(stats.byte_size > 0);
        assert_eq!(stats.max_entries, SERIES_DECODE_CACHE_MAX_ENTRIES);
        assert_eq!(stats.max_bytes, SERIES_DECODE_CACHE_MAX_BYTES);
        assert_eq!(stats.ttl_seconds, SERIES_DECODE_CACHE_TTL.as_secs());
    }

    #[test]
    fn load_series_by_id_reuses_cache_and_misses_when_data_hash_changes() {
        clear_global_decode_cache();
        let pool_path = tempfile::NamedTempFile::new().unwrap();
        let pool = crate::db::create_pool(pool_path.path()).unwrap();
        {
            let pooled = pool.get().unwrap();
            run_migrations(&pooled).unwrap();
            insert_blob(&pooled, "series_cache_reuse", 16);
        }

        let first = load_series_by_id(&pool, "series_cache_reuse").unwrap();
        let second = load_series_by_id(&pool, "series_cache_reuse").unwrap();

        assert!(Arc::ptr_eq(&first, &second));
        let stats = SERIES_DECODE_CACHE.lock().unwrap().stats();
        assert!(stats.entries >= 1);
        assert!(stats.hits >= 1);

        {
            let pooled = pool.get().unwrap();
            let blob = make_blob(24);
            pooled
                .execute(
                    "UPDATE ExperimentData SET dataBlob = ?1, pointCount = 24 \
                     WHERE experimentId = 'series_cache_reuse'",
                    rusqlite::params![blob],
                )
                .unwrap();
        }

        let changed = load_series_by_id(&pool, "series_cache_reuse").unwrap();

        assert!(!Arc::ptr_eq(&first, &changed));
        assert_ne!(first.data_hash, changed.data_hash);
    }

    #[test]
    fn parse_requested_metrics_rejects_unknown_metric() {
        let err = parse_requested_metrics(&["watts".to_string()]).unwrap_err();
        assert!(format!("{err}").contains("Unsupported series metric"));
    }

    #[test]
    fn binary_codec_header_and_payload_shape_are_stable() {
        let pool_path = tempfile::NamedTempFile::new().unwrap();
        let pool = crate::db::create_pool(pool_path.path()).unwrap();
        {
            let pooled = pool.get().unwrap();
            run_migrations(&pooled).unwrap();
            insert_blob(&pooled, "series_codec", 10);
        }
        let series = load_series_by_id(&pool, "series_codec").unwrap();
        let metrics = vec![SeriesMetric::ViscosityCp, SeriesMetric::TemperatureC];
        let indices: Vec<usize> = (0..10).collect();
        let bytes = encode_series_binary(&series, &metrics, &indices).unwrap();
        let (point_count, column_count) = decode_header(&bytes);
        assert_eq!(point_count, 10);
        assert_eq!(column_count, 3, "time + 2 requested metrics");
        assert_eq!(
            bytes.len(),
            align_to_8(SERIES_HEADER_BYTES + 3 * SERIES_DESCRIPTOR_BYTES) + 3 * 10 * 8
        );
    }

    #[test]
    fn downsample_preserves_first_last_and_peak() {
        let times: Vec<f64> = (0..1000).map(|i| i as f64).collect();
        let mut values: Vec<f64> = (0..1000).map(|i| i as f64).collect();
        values[500] = 100_000.0;
        let candidates: Vec<usize> = (0..1000).collect();
        let selected = downsample_min_max_by_time(&times, &candidates, &values, 100);
        assert!(selected.len() <= 100);
        assert_eq!(selected.first().copied(), Some(0));
        assert_eq!(selected.last().copied(), Some(999));
        assert!(selected.contains(&500), "primary metric peak must survive");
        assert!(selected.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn downsample_returns_indices_in_time_order_even_when_source_is_not() {
        let mut times: Vec<f64> = (0..120).map(|i| i as f64).collect();
        times.swap(10, 90);
        let values: Vec<f64> = (0..120).map(|i| i as f64).collect();
        let mut candidates: Vec<usize> = (0..120).collect();
        sort_indices_by_time(&times, &mut candidates);

        let selected = downsample_min_max_by_time(&times, &candidates, &values, 20);

        assert!(
            selected
                .windows(2)
                .all(|pair| times[pair[0]] <= times[pair[1]]),
            "selected indices must be monotonic by time"
        );
    }

    #[test]
    fn window_indices_respect_bounds() {
        let times: Vec<f64> = (0..10).map(|i| i as f64).collect();
        let indices = exact_window_indices(&times, 2.0, 5.0);
        assert_eq!(indices, vec![2, 3, 4, 5]);
    }
}
