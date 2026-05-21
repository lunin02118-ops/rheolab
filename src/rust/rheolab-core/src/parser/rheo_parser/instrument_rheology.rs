use std::collections::BTreeMap;

use super::super::types::RheologyParameterRow;

const LBF_PER_100FT2_TO_PA: f64 = 0.478_802_589_8;
const LBF_PER_FT2_TO_PA: f64 = 47.880_258_98;
const PSI_TO_BAR: f64 = 0.068_947_572_9;

#[derive(Debug, Clone, Default)]
struct HeaderSpec {
    cycle_col: Option<usize>,
    time_col: Option<usize>,
    temp_col: Option<usize>,
    pressure_col: Option<usize>,
    n_col: Option<usize>,
    kv_col: Option<usize>,
    k_prime_col: Option<usize>,
    k_slot_col: Option<usize>,
    k_pipe_col: Option<usize>,
    r2_col: Option<usize>,
    bingham_pv_col: Option<usize>,
    bingham_yp_col: Option<usize>,
    bingham_r2_col: Option<usize>,
    viscosity_cols: Vec<(usize, String)>,
}

pub(super) fn sheet_priority(sheet_name: &str) -> i32 {
    let name = normalize_text(sheet_name);
    if name.contains("степ") {
        0
    } else if name.contains("power law data") {
        1
    } else if name.contains("formatted") {
        2
    } else {
        3
    }
}

pub(super) fn extract_from_sheet(
    rows: &[Vec<String>],
    sheet_name: &str,
) -> Vec<RheologyParameterRow> {
    let mut out = Vec::new();
    for header_idx in 0..rows.len() {
        let Some(spec) = detect_header(rows, header_idx, sheet_name) else {
            continue;
        };
        let mut local_rows = parse_rows_after_header(rows, header_idx, sheet_name, &spec);
        out.append(&mut local_rows);
    }
    dedupe_rows(out)
}

fn dedupe_rows(rows: Vec<RheologyParameterRow>) -> Vec<RheologyParameterRow> {
    let mut seen = BTreeMap::<String, RheologyParameterRow>::new();
    for row in rows {
        let key = format!(
            "{}:{:.4}:{:.6}:{:.6}",
            row.cycle_no,
            row.time_min.unwrap_or(-1.0),
            row.n_prime.unwrap_or(-1.0),
            row.r2.unwrap_or(-1.0)
        );
        seen.entry(key).or_insert(row);
    }
    seen.into_values().collect()
}

fn detect_header(
    rows: &[Vec<String>],
    header_idx: usize,
    sheet_name: &str,
) -> Option<HeaderSpec> {
    let row = rows.get(header_idx)?;
    let prev = header_idx.checked_sub(1).and_then(|idx| rows.get(idx));
    let next = rows.get(header_idx + 1);
    let sheet_norm = normalize_text(sheet_name);
    let mut spec = HeaderSpec::default();
    let mut r2_candidates = Vec::new();

    for col in 0..row.len() {
        let text = normalize_text(row.get(col).map(String::as_str).unwrap_or_default());
        let context = normalize_text(&column_context(prev, row, next, col));

        if is_cycle_header(&text) {
            spec.cycle_col = Some(col);
        } else if is_time_header(&text) {
            spec.time_col = Some(col);
        } else if is_temperature_header(&text) {
            spec.temp_col = Some(col);
        } else if is_pressure_header(&text) {
            spec.pressure_col = Some(col);
        } else if is_n_header(&text) {
            spec.n_col = Some(col);
        } else if is_kv_header(&text) {
            spec.kv_col = Some(col);
        } else if is_k_slot_header(&text) {
            spec.k_slot_col = Some(col);
        } else if is_k_pipe_header(&text) {
            spec.k_pipe_col = Some(col);
        } else if is_k_prime_header(&text, &sheet_norm) {
            spec.k_prime_col = Some(col);
        } else if is_pv_header(&text, &context) {
            spec.bingham_pv_col = Some(col);
        } else if is_yp_header(&text, &context) {
            spec.bingham_yp_col = Some(col);
        } else if is_r2_header(&text) {
            r2_candidates.push((col, is_bingham_context(&context)));
        }

        if let Some(rate) = viscosity_rate_for_header(&text, &context, next, col) {
            if !spec
                .viscosity_cols
                .iter()
                .any(|(existing_col, _)| *existing_col == col)
            {
                spec.viscosity_cols.push((col, rate));
            }
        }
    }

    if !r2_candidates.is_empty() {
        let mut bingham_r2 = None;
        let mut power_r2 = None;
        for (col, bingham) in r2_candidates {
            if bingham {
                bingham_r2 = Some(col);
            } else if power_r2.is_none() {
                power_r2 = Some(col);
            } else {
                bingham_r2 = Some(col);
            }
        }
        spec.r2_col = power_r2.or(bingham_r2);
        spec.bingham_r2_col = bingham_r2.filter(|col| Some(*col) != spec.r2_col);
    }

    if let Some(r2_col) = spec.r2_col {
        for col in (r2_col + 1)..row.len() {
            if spec.viscosity_cols.iter().any(|(idx, _)| *idx == col) {
                continue;
            }
            let text = normalize_text(row.get(col).map(String::as_str).unwrap_or_default());
            let context = normalize_text(&column_context(prev, row, next, col));
            if let Some(rate) = numeric_viscosity_header(&text, &context) {
                spec.viscosity_cols.push((col, rate));
            }
        }
    }

    let has_model = spec.n_col.is_some()
        && (spec.kv_col.is_some()
            || spec.k_prime_col.is_some()
            || spec.k_slot_col.is_some()
            || spec.r2_col.is_some()
            || !spec.viscosity_cols.is_empty());
    if has_model {
        Some(spec)
    } else {
        None
    }
}

fn parse_rows_after_header(
    rows: &[Vec<String>],
    header_idx: usize,
    sheet_name: &str,
    spec: &HeaderSpec,
) -> Vec<RheologyParameterRow> {
    let mut out = Vec::new();
    let mut blank_run = 0usize;
    let start = header_idx + 1;
    for row_idx in start..rows.len() {
        let row = &rows[row_idx];
        let Some(raw_n) = cell_number(row, spec.n_col) else {
            if row_idx > start {
                blank_run += 1;
                if blank_run >= 6 {
                    break;
                }
            }
            continue;
        };
        let n_prime = normalize_fraction(raw_n);
        if !(0.0..=5.0).contains(&n_prime) || n_prime == 0.0 {
            continue;
        }
        blank_run = 0;

        let cycle_no = cell_number(row, spec.cycle_col)
            .map(|v| normalize_fraction(v).round() as i32)
            .filter(|v| *v > 0)
            .unwrap_or_else(|| out.len() as i32 + 1);

        let mut units = BTreeMap::new();
        let time_min = parse_time_minutes(row, rows, header_idx, spec.time_col);
        let pressure_bar = parse_pressure_bar(row, rows, header_idx, spec.pressure_col);
        let temp_c = cell_number(row, spec.temp_col).map(normalize_temperature);

        let kv = parse_consistency(row, rows, header_idx, spec.kv_col, sheet_name, "kv", &mut units);
        let k_prime = parse_consistency(
            row,
            rows,
            header_idx,
            spec.k_prime_col,
            sheet_name,
            "kPrime",
            &mut units,
        );
        let k_slot = parse_consistency(
            row,
            rows,
            header_idx,
            spec.k_slot_col,
            sheet_name,
            "kSlot",
            &mut units,
        );
        let k_pipe = parse_consistency(
            row,
            rows,
            header_idx,
            spec.k_pipe_col,
            sheet_name,
            "kPipe",
            &mut units,
        );

        let mut viscosities = BTreeMap::new();
        for (col, rate) in &spec.viscosity_cols {
            if let Some(value) = cell_number(row, Some(*col)) {
                let value = normalize_viscosity(value);
                if value.is_finite() && value > 0.0 {
                    viscosities.insert(rate.clone(), value);
                }
            }
        }
        if !viscosities.is_empty() {
            units.insert("viscosity".into(), "cP".into());
        }

        let r2 = cell_number(row, spec.r2_col).map(normalize_r2);
        let bingham_pv = parse_bingham_pv(row, rows, header_idx, spec.bingham_pv_col, &mut units);
        let bingham_yp = parse_bingham_yp(row, rows, header_idx, spec.bingham_yp_col, &mut units);
        let bingham_r2 = cell_number(row, spec.bingham_r2_col).map(normalize_r2);

        out.push(RheologyParameterRow {
            cycle_no,
            time_min,
            end_time_min: time_min,
            temp_c,
            pressure_bar,
            n_prime: Some(n_prime),
            kv_pasn: kv,
            k_prime_pasn: k_prime.or(kv),
            k_slot_pasn: k_slot,
            k_pipe_pasn: k_pipe,
            r2,
            viscosities,
            bingham_pv_pas: bingham_pv,
            bingham_yp_pa: bingham_yp,
            bingham_r2,
            calc_points: None,
            source_sheet: Some(sheet_name.to_string()),
            source_row: Some((row_idx + 1) as i32),
            units,
        });
    }
    out
}

fn column_context(
    prev: Option<&Vec<String>>,
    row: &[String],
    next: Option<&Vec<String>>,
    col: usize,
) -> String {
    let mut parts = Vec::new();
    if let Some(source) = prev {
        let start = col.saturating_sub(1);
        let end = (col + 2).min(source.len());
        for cell in &source[start..end] {
            parts.push(cell.as_str());
        }
    }
    let start = col.saturating_sub(1);
    let end = (col + 2).min(row.len());
    for cell in &row[start..end] {
        parts.push(cell.as_str());
    }
    if let Some(source) = next {
        let start = col.saturating_sub(1);
        let end = (col + 2).min(source.len());
        for cell in &source[start..end] {
            parts.push(cell.as_str());
        }
    }
    parts.join(" ")
}

fn normalize_text(value: &str) -> String {
    value
        .replace('\u{00A0}', " ")
        .replace('²', "2")
        .replace('³', "3")
        .replace('′', "'")
        .replace('’', "'")
        .to_lowercase()
}

fn is_cycle_header(text: &str) -> bool {
    let trimmed = text.trim();
    trimmed == "№" || trimmed == "#" || trimmed.contains("cycle no") || trimmed == "cycle"
}

fn is_time_header(text: &str) -> bool {
    text.contains("time") || text.contains("время")
}

fn is_temperature_header(text: &str) -> bool {
    (text.contains("temp") || text.contains("температ")) && !text.contains("setpoint")
}

fn is_pressure_header(text: &str) -> bool {
    text.contains("press") || text.contains("давлен")
}

fn is_n_header(text: &str) -> bool {
    let t = text.trim().trim_start_matches('|').trim();
    t == "n"
        || t == "n'"
        || t.starts_with("n' ")
        || t.starts_with("n'(")
        || t.starts_with("n (")
        || t.starts_with("n(")
}

fn is_kv_header(text: &str) -> bool {
    let t = text.trim();
    t == "kv" || t.starts_with("kv ") || t.contains("kv (")
}

fn is_k_prime_header(text: &str, sheet_name: &str) -> bool {
    let t = text.trim();
    t == "k'" || t.starts_with("k' ") || t.contains("kind") || t == "ki" || sheet_name.contains("power law data") && t == "k"
}

fn is_k_slot_header(text: &str) -> bool {
    text.contains("slot") || text.contains("kslot")
}

fn is_k_pipe_header(text: &str) -> bool {
    let t = text.trim();
    t == "kp" || t.contains("pipe")
}

fn is_r2_header(text: &str) -> bool {
    let t = text.trim();
    t == "r2" || t == "r^2" || t.contains("correlation") || t.contains("coef detn")
}

fn is_pv_header(text: &str, context: &str) -> bool {
    let t = text.trim();
    t == "pv" || t.contains("plastic viscosity") || (context.contains("bingham") && t.contains("pv"))
}

fn is_yp_header(text: &str, context: &str) -> bool {
    let t = text.trim();
    t == "yp" || t.contains("yield") || (context.contains("bingham") && t.contains("yp"))
}

fn is_bingham_context(context: &str) -> bool {
    context.contains("bingham") || context.contains("plastic values") || context.contains(" pv ")
}

fn viscosity_rate_for_header(
    text: &str,
    context: &str,
    next: Option<&Vec<String>>,
    col: usize,
) -> Option<String> {
    if !(text.contains("visc") || text.contains("вязк")) {
        return None;
    }
    extract_rate(text)
        .or_else(|| extract_rate(context))
        .or_else(|| next.and_then(|row| row.get(col)).and_then(|cell| extract_rate(cell)))
}

fn numeric_viscosity_header(text: &str, context: &str) -> Option<String> {
    if !(context.contains("viscosity") || context.contains("вязк")) {
        return None;
    }
    parse_number(text).and_then(|value| {
        if value > 0.0 && value <= 10_000.0 {
            Some(format_rate(value))
        } else {
            None
        }
    })
}

fn extract_rate(text: &str) -> Option<String> {
    let mut current = String::new();
    for ch in text.chars() {
        if ch.is_ascii_digit() || ch == '.' || ch == ',' {
            current.push(if ch == ',' { '.' } else { ch });
        } else if !current.is_empty() {
            if let Ok(v) = current.parse::<f64>() {
                if v > 0.0 && v <= 10_000.0 {
                    return Some(format_rate(v));
                }
            }
            current.clear();
        }
    }
    if !current.is_empty() {
        if let Ok(v) = current.parse::<f64>() {
            if v > 0.0 && v <= 10_000.0 {
                return Some(format_rate(v));
            }
        }
    }
    None
}

fn format_rate(value: f64) -> String {
    if (value.round() - value).abs() < 1e-9 {
        format!("{}", value.round() as i64)
    } else {
        format!("{value}")
    }
}

fn cell_number(row: &[String], col: Option<usize>) -> Option<f64> {
    col.and_then(|idx| row.get(idx)).and_then(|cell| parse_number(cell))
}

fn parse_number(value: &str) -> Option<f64> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.contains("---") || trimmed.eq_ignore_ascii_case("n/a") {
        return None;
    }
    let cleaned = trimmed
        .replace('\u{00A0}', "")
        .replace(' ', "")
        .replace(',', ".");
    cleaned.parse::<f64>().ok().filter(|v| v.is_finite())
}

fn normalize_fraction(value: f64) -> f64 {
    if value.abs() > 10.0 {
        value / 100_000.0
    } else {
        value
    }
}

fn normalize_r2(value: f64) -> f64 {
    let value = normalize_fraction(value);
    if value > 1.0 && value <= 100.0 {
        value / 100.0
    } else {
        value
    }
}

fn normalize_viscosity(value: f64) -> f64 {
    if value > 1_000_000.0 {
        value / 100.0
    } else {
        value
    }
}

fn normalize_temperature(value: f64) -> f64 {
    value
}

fn parse_time_minutes(
    row: &[String],
    rows: &[Vec<String>],
    header_idx: usize,
    col: Option<usize>,
) -> Option<f64> {
    let idx = col?;
    let cell = row.get(idx)?.trim();
    if let Some(minutes) = parse_hms_minutes(cell) {
        return Some(minutes);
    }
    let value = parse_number(cell)?;
    let context = normalize_text(&column_context(
        header_idx.checked_sub(1).and_then(|i| rows.get(i)),
        rows.get(header_idx)?,
        rows.get(header_idx + 1),
        idx,
    ));
    if context.contains("min") {
        Some(value)
    } else if value > 0.0 && value < 1.0 {
        Some(value * 24.0 * 60.0)
    } else if context.contains("hour") || context.contains("час") {
        Some(value * 60.0)
    } else {
        Some(value / 60.0)
    }
}

fn parse_hms_minutes(value: &str) -> Option<f64> {
    let parts = value.split(':').collect::<Vec<_>>();
    if parts.len() != 3 {
        return None;
    }
    let h = parts[0].trim().parse::<f64>().ok()?;
    let m = parts[1].trim().parse::<f64>().ok()?;
    let s = parts[2].trim().parse::<f64>().ok()?;
    Some(h * 60.0 + m + s / 60.0)
}

fn parse_pressure_bar(
    row: &[String],
    rows: &[Vec<String>],
    header_idx: usize,
    col: Option<usize>,
) -> Option<f64> {
    let idx = col?;
    let value = cell_number(row, col)?;
    let context = normalize_text(&column_context(
        header_idx.checked_sub(1).and_then(|i| rows.get(i)),
        rows.get(header_idx)?,
        rows.get(header_idx + 1),
        idx,
    ));
    if context.contains("psi") {
        Some(value * PSI_TO_BAR)
    } else {
        Some(value)
    }
}

fn parse_consistency(
    row: &[String],
    rows: &[Vec<String>],
    header_idx: usize,
    col: Option<usize>,
    sheet_name: &str,
    unit_key: &str,
    units: &mut BTreeMap<String, String>,
) -> Option<f64> {
    let idx = col?;
    let mut value = cell_number(row, col)?;
    if value.abs() > 10_000.0 {
        value /= 100_000.0;
    }
    let context = normalize_text(&column_context(
        header_idx.checked_sub(1).and_then(|i| rows.get(i)),
        rows.get(header_idx)?,
        rows.get(header_idx + 1),
        idx,
    ));
    let (factor, unit) = consistency_factor(&context, sheet_name)?;
    units.insert(unit_key.into(), unit);
    Some(value * factor)
}

fn consistency_factor(context: &str, sheet_name: &str) -> Option<(f64, String)> {
    let sheet = normalize_text(sheet_name);
    if context.contains("па") || context.contains("pa") {
        Some((1.0, "Pa*s^n".into()))
    } else if context.contains("poise") || context.contains("puase") || sheet.contains("power law data") {
        Some((0.1, "P".into()))
    } else if context.contains("100") && context.contains("ft") {
        Some((LBF_PER_100FT2_TO_PA, "lbf/100ft2".into()))
    } else if context.contains("ft") {
        Some((LBF_PER_FT2_TO_PA, "lbf/ft2".into()))
    } else {
        None
    }
}

fn parse_bingham_pv(
    row: &[String],
    rows: &[Vec<String>],
    header_idx: usize,
    col: Option<usize>,
    units: &mut BTreeMap<String, String>,
) -> Option<f64> {
    let idx = col?;
    let mut value = cell_number(row, col)?;
    if value.abs() > 10_000.0 {
        value /= 100_000.0;
    }
    let context = normalize_text(&column_context(
        header_idx.checked_sub(1).and_then(|i| rows.get(i)),
        rows.get(header_idx)?,
        rows.get(header_idx + 1),
        idx,
    ));
    let (factor, unit) = bingham_factor(&context);
    units.insert("binghamPv".into(), unit);
    Some(value * factor)
}

fn parse_bingham_yp(
    row: &[String],
    rows: &[Vec<String>],
    header_idx: usize,
    col: Option<usize>,
    units: &mut BTreeMap<String, String>,
) -> Option<f64> {
    let idx = col?;
    let mut value = cell_number(row, col)?;
    if value.abs() > 10_000.0 {
        value /= 100_000.0;
    }
    let context = normalize_text(&column_context(
        header_idx.checked_sub(1).and_then(|i| rows.get(i)),
        rows.get(header_idx)?,
        rows.get(header_idx + 1),
        idx,
    ));
    let (factor, unit) = bingham_factor(&context);
    units.insert("binghamYp".into(), unit);
    Some(value * factor)
}

fn bingham_factor(context: &str) -> (f64, String) {
    if context.contains("100") && context.contains("ft") {
        (LBF_PER_100FT2_TO_PA, "lbf/100ft2".into())
    } else if context.contains("ft") {
        (LBF_PER_FT2_TO_PA, "lbf/ft2".into())
    } else {
        (1.0, "SI".into())
    }
}
