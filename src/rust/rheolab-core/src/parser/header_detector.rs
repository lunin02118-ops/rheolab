use super::types::{HeaderCandidate, ColumnMapping};

// Scoring constants
const VISCOSITY_KEYWORD: f64 = 10.0;
const RPM_KEYWORD: f64 = 10.0;
const STRESS_KEYWORD: f64 = 15.0;
const RATE_KEYWORD: f64 = 15.0;
const SHEAR_KEYWORD: f64 = 10.0;
const TEMP_KEYWORD: f64 = 5.0;
const TIME_KEYWORD: f64 = 15.0;
const HEADER_KEYWORD: f64 = 10.0;

const HAS_TIME_BONUS: f64 = 20.0;
const NO_TIME_PENALTY: f64 = -50.0;
const HAS_TIME_SNAPSHOT_BONUS: f64 = 5.0;

const MODEL_KEYWORD_PENALTY: f64 = -100.0;
const AVG_KEYWORD_PENALTY: f64 = -50.0;
const METADATA_ROW_PENALTY: f64 = -30.0;
const UNIT_ROW_PENALTY: f64 = -50.0;
const TEMP_UNIT_ONLY_PENALTY: f64 = -20.0;

const MERGE_THRESHOLD: f64 = 15.0;
const DETAIL_ROW_BONUS: f64 = 100.0;
const RAW_DATA_MARKER_BONUS: f64 = 50.0;

const STRICT_THRESHOLD: f64 = 20.0;
const SNAPSHOT_THRESHOLD: f64 = 15.0;

pub fn detect_header(rows: &[Vec<String>], require_time: bool) -> Option<HeaderCandidate> {
    let mut best_header_idx = -1;
    let mut max_score = f64::NEG_INFINITY;
    let mut headers_to_merge = 1;
    let scan_limit = std::cmp::min(rows.len(), 1000);

    for i in 0..scan_limit {
        let row1 = rows[i].join(" ").to_lowercase();
        let row2 = if i + 1 < rows.len() {
            rows[i + 1].join(" ").to_lowercase()
        } else {
            String::new()
        };

        let score1 = calculate_row_score(&row1, require_time);
        let score_merged = calculate_row_score(&format!("{} {}", row1, row2), require_time);

        let mut current_score = score1;
        let mut current_merge = 1;

        if score_merged > score1 + MERGE_THRESHOLD {
            current_score = score_merged;
            current_merge = 2;
        }

        if i > 0 {
            let prev_row = rows[i - 1].join(" ").to_lowercase();
            if prev_row.contains("detail:") {
                current_score += DETAIL_ROW_BONUS;
            }
        }

        // Raw data markers
        let markers = ["raw data", "сырые данные", "test data", "measurement data", "реология", "detail", "detail:", "detailed data", "raw", "unformatted", "исходные"];
        if markers.iter().any(|m| row1.contains(m)) {
            current_score += RAW_DATA_MARKER_BONUS;
        }

        let threshold = if require_time { STRICT_THRESHOLD } else { SNAPSHOT_THRESHOLD };
        
        if current_score > max_score && current_score > threshold {
            max_score = current_score;
            best_header_idx = i as i32;
            headers_to_merge = current_merge;
        }
    }

    if best_header_idx == -1 {
        return None;
    }

    let idx = best_header_idx as usize;
    let r1 = &rows[idx];
    let empty_vec = Vec::new();
    let r2 = if headers_to_merge == 2 && idx + 1 < rows.len() {
        &rows[idx + 1]
    } else {
        &empty_vec
    };

    let mut merged_header = Vec::new();
    let max_len = std::cmp::max(r1.len(), r2.len());
    for k in 0..max_len {
        let s1 = if k < r1.len() { &r1[k] } else { "" };
        let s2 = if k < r2.len() { &r2[k] } else { "" };
        merged_header.push(format!("{} {}", s1, s2).trim().to_string());
    }

    let mapping = map_columns(&merged_header, require_time);

    Some(HeaderCandidate {
        row_index: idx + headers_to_merge - 1,
        score: max_score,
        mapping,
    })
}

/// BSL fast-path: O(rows × 4 keywords) instead of O(rows × 50 keywords).
///
/// BSL Rheometer Model R1 files have a predictable column layout:
///   Time | Temperature | Pressure | Viscosity  (EN or RU)
///
/// Call this **only** when [`detect_instrument`] already identified BSL.
/// Falls through to [`detect_header`] when the fast-path cannot find
/// a confident match (e.g. unusual BSL export variant).
pub fn detect_header_bsl_fast(rows: &[Vec<String>]) -> Option<HeaderCandidate> {
    let scan_limit = std::cmp::min(rows.len(), 100); // BSL headers are always in first 50 rows

    for i in 0..scan_limit {
        let row = &rows[i];
        if row.len() < 3 { continue; }

        let lower: Vec<String> = row.iter().map(|c| c.to_lowercase()).collect();
        let joined = lower.join(" ");

        // Must have time + viscosity (the two mandatory columns for BSL)
        let has_time = lower.iter().any(|c|
            c.contains("время") || c.contains("time") || c.contains("мин") || c.contains("min")
        );
        let has_visc = lower.iter().any(|c|
            c.contains("вязкость") || c.contains("viscosity") || c.contains("visc") ||
            c.contains("сп") || c.contains("cp") || c.contains("mpas") || c.contains("mpa.s")
        );
        if !has_time || !has_visc { continue; }

        // Reject model/summary/unit-only rows
        if joined.contains("avg") || joined.contains("summary") || joined.contains("итого") {
            continue;
        }

        // Check for merge with next row (BSL sometimes splits header across 2 rows)
        let merged = if i + 1 < rows.len() {
            let r2 = &rows[i + 1];
            let max_len = std::cmp::max(row.len(), r2.len());
            let mut m = Vec::with_capacity(max_len);
            for k in 0..max_len {
                let s1 = if k < row.len() { &row[k] } else { "" };
                let s2 = if k < r2.len() { &r2[k] } else { "" };
                m.push(format!("{} {}", s1, s2).trim().to_string());
            }
            m
        } else {
            row.clone()
        };

        // Try mapping on merged header first — if it finds more columns, use merge
        let mapping_single = map_columns(&lower.iter().map(|s| s.to_string()).collect::<Vec<_>>(), true);
        let mapping_merged = map_columns(&merged, true);

        let score_single = [mapping_single.time_col, mapping_single.viscosity_col,
                           mapping_single.temperature_col, mapping_single.pressure_col]
            .iter().filter(|c| c.is_some()).count();
        let score_merged = [mapping_merged.time_col, mapping_merged.viscosity_col,
                           mapping_merged.temperature_col, mapping_merged.pressure_col]
            .iter().filter(|c| c.is_some()).count();

        if score_merged > score_single && i + 1 < rows.len() {
            return Some(HeaderCandidate {
                row_index: i + 1,
                score: 200.0, // high confidence — instrument already confirmed
                mapping: mapping_merged,
            });
        }

        return Some(HeaderCandidate {
            row_index: i,
            score: 200.0,
            mapping: mapping_single,
        });
    }

    None // fall through to generic detect_header
}

fn calculate_row_score(row_str: &str, require_time: bool) -> f64 {
    let mut score = 0.0;

    if ["visc", "вязкость", "сп", "reading", "вязк"].iter().any(|w| row_str.contains(w)) { score += VISCOSITY_KEYWORD; }
    if ["rpm", "ротор", "speed", "n,", "скорость", "об/мин"].iter().any(|w| row_str.contains(w)) { score += RPM_KEYWORD; }

    if ["stress", "напряжение", "dyne", "pa "].iter().any(|w| row_str.contains(w)) { score += STRESS_KEYWORD; }
    if ["rate", "скорость сдвига", "sec-1", "s-1", "1/s"].iter().any(|w| row_str.contains(w)) { score += RATE_KEYWORD; }
    if ["shear", "сдвиг"].iter().any(|w| row_str.contains(w)) { score += SHEAR_KEYWORD; }
    if ["temp", "температур"].iter().any(|w| row_str.contains(w)) { score += TEMP_KEYWORD; }

    if ["time", "время", "elapsed"].iter().any(|w| row_str.contains(w)) { score += TIME_KEYWORD; }
    if ["temperature", "температура"].iter().any(|w| row_str.contains(w)) { score += HEADER_KEYWORD; }
    if ["viscosity", "вязкость"].iter().any(|w| row_str.contains(w)) { score += HEADER_KEYWORD; }

    let has_time = ["time", "время", "elapsed", "sec", "min "].iter().any(|w| row_str.contains(w));
    if require_time {
        if has_time { score += HAS_TIME_BONUS; } else { score += NO_TIME_PENALTY; }
    } else if has_time {
        score += HAS_TIME_SNAPSHOT_BONUS;
    }

    let model_keywords = ["n'", "k'", "r²", "r^2", "slope", "intercept", "kv", "yield point", "coef detn", "power law", "correlation", "regression", "summary", "итого", "среднее"];
    if model_keywords.iter().any(|kw| row_str.contains(kw)) { score += MODEL_KEYWORD_PENALTY; }
    if row_str.contains("avg ") { score += AVG_KEYWORD_PENALTY; }

    // Colon count penalty (metadata)
    let colon_count = row_str.matches(':').count();
    if colon_count >= 1 && row_str.split_whitespace().count() < 6 {
        score += METADATA_ROW_PENALTY;
    }

    // Unit row penalty
    if ["dyne/cm", "sec^-1", "sec-1", "/cm^2", "/cm2", "lbf*s", "ft^2", "ft²"].iter().any(|u| row_str.contains(u)) {
        score += UNIT_ROW_PENALTY;
    }
    if (row_str.contains("°c") || row_str.contains("°f")) && !row_str.contains("temp") {
        score += TEMP_UNIT_ONLY_PENALTY;
    }

    score
}

fn map_columns(header: &[String], _require_time: bool) -> ColumnMapping {
    let mut mapping = ColumnMapping::default();

    // Helper to find best column
    let find_col = |matches: &[&str], priority: &[&str], exclude: &[&str]| -> Option<usize> {
        let mut best_idx = None;
        let mut best_score = -999;

        for (idx, col_str) in header.iter().enumerate() {
            let col_lower = col_str.to_lowercase();
            let mut score = 0;

            if matches.iter().any(|t| col_lower.contains(t)) { score += 10; } else { continue; }
            if exclude.iter().any(|t| col_lower.contains(t)) { score -= 100; }
            if priority.iter().any(|t| col_lower.contains(t)) { score += 50; }

            if score > best_score {
                best_score = score;
                best_idx = Some(idx);
            }
        }
        best_idx
    };

    // Time is always mapped if found, but optional in snapshot mode
    mapping.time_col = find_col(
        &["time", "duration", "elapsed", "время", "сек", "t (min)", "t,", "мин", "sec", "min", "час", "hour", "длительность", "продолжительность", "test time", "e.t."],
        &["e.t.", "test time", "время", "duration"],
        &["step", "interval", "clock", "date", "timestamp"]
    );

    mapping.viscosity_col = find_col(
        &["viscosity", "visc", "dial", "reading", "вязкость", "показания", "сп", "cp", "вязк", "mpa.s", "mpas", "η", "eta", "dynamic visc", "динамическая", "apparent", "кажущаяся", "пластическая", "plastic", "eff visc", "эфф"],
        &["sample", "meas", "измеренная", "apparent", "кажущаяся"],
        &["set", "уставка", "index", "idx", "avg", "plastic", "yield", "visc@", "target"]
    );

    mapping.temperature_col = find_col(
        &["temp", "deg", "температура", "t°", "t(c)", "град", "t,", "¡c", "sample temp", "fluid temp", "образец", "°c", "°f", "celsius", "fahrenheit", "kelvin", "°k", "термо", "thermo"],
        &["sample", "fluid", "test", "образец", "жидкость", "замер"],
        &["bath", "heater", "set", "output", "нагреватель", "нагр", "баня", "уставка", "avg", "target", "целев", "задан"]
    );

    mapping.shear_rate_col = find_col(
        &["shear rate", "s-1", "1/s", "1/c", "1/с", "1/сек", "1/ceк", "gamma", "rate", "скорость сдвига", "γ̇", "gamma dot", "гамма", "sr", "shearrate", "скор сдв"],
        &["calc", "fact", "actual", "измеренная"],
        &["stress", "visc", "напряжение", "torque", "момент"]
    );

    mapping.shear_stress_col = find_col(
        &["shear stress", "tau", "ss", "напряжение", "напряж", "pa", "па", "dyne", "d/cm", "d/см", "τ", "касательное", "lb/100ft", "lb/100", "fann reading", "мн/м2", "mn/m2"],
        &["measured", "calc", "измеренное"],
        &["rate", "скорость", "pressure", "psi", "давлен"]
    );

    mapping.rpm_col = find_col(
        &["rpm", "speed", "rotor", "обороты", "ротор", "об/мин", "n,", "rev", "угловая", "angular", "вращен", "rotation", "скорость", "r/min", "r/мин"],
        &["actual", "measured", "факт"],
        &["shear", "сдвига", "rate", "avg", "set", "target"]
    );

    mapping.pressure_col = find_col(
        &["pressure", "давлени", "psi", "bar", "бар", "атм", "atm", "kpa", "mpa", "кпа", "мпа", "press", "дав"],
        &["sample", "test", "cell", "ячейка"],
        &["diff", "delta", "перепад"]
    );

    mapping.bath_temp_col = find_col(
        &["bath", "heater", "нагреватель", "нагрев", "нагр", "баня", "bath temp", "heater temp", "jacket", "рубашка", "jacket temp"],
        &["bath", "heater", "нагреватель", "нагрев", "нагр", "баня"],
        &["set", "output", "уставка", "power", "мощность", "setpoint", "задан"]
    );

    mapping
}

pub fn find_raw_data_sections(rows: &[Vec<String>]) -> Vec<usize> {
    let priority_markers = ["log data:", "log data"];
    let fallback_markers = ["sweep data:", "sweep data", "detail:"];
    let mut priority_sections = Vec::new();
    let mut fallback_sections = Vec::new();

    for (i, row) in rows.iter().enumerate() {
        // Count non-empty cells
        let non_empty_cells = row.iter()
            .filter(|c| !c.trim().is_empty())
            .count();
        
        if non_empty_cells > 5 { continue; }

        let row_str = row.join(" ").to_lowercase();
        let trimmed_len = row_str.trim().len();
        
        if trimmed_len == 0 { continue; }
        if trimmed_len > 100 { continue; }

        if priority_markers.iter().any(|m| row_str.contains(m)) {
            priority_sections.push(i + 1);
        } else if fallback_markers.iter().any(|m| row_str.contains(m)) {
            fallback_sections.push(i + 1);
        }
    }
    
    // Use priority sections if available, otherwise fall back
    let mut sections = if !priority_sections.is_empty() {
        priority_sections
    } else {
        fallback_sections
    };

    sections.sort();
    sections.dedup();
    sections
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_header_simple() {
        let rows = vec![
            vec!["Some Metadata".to_string()],
            vec!["Time".to_string(), "Viscosity".to_string(), "Temperature".to_string()],
            vec!["0".to_string(), "100".to_string(), "25".to_string()],
        ];
        let result = detect_header(&rows, true).unwrap();
        assert_eq!(result.row_index, 1);
        assert!(result.mapping.time_col.is_some());
        assert!(result.mapping.viscosity_col.is_some());
        assert!(result.mapping.temperature_col.is_some());
    }

    #[test]
    fn test_detect_header_merged() {
        let rows = vec![
            vec!["Time".to_string(), "Shear".to_string(), "Shear".to_string()],
            vec!["(sec)".to_string(), "Rate".to_string(), "Stress".to_string()],
            vec!["0".to_string(), "100".to_string(), "50".to_string()],
        ];
        // Should merge rows 0 and 1
        let result = detect_header(&rows, true).unwrap();
        // Row index should point to the last header row (1) or start? 
        // In TS: return bestHeaderIdx + headersToMerge - 1
        // If best=0, merge=2 -> return 0 + 2 - 1 = 1.
        assert_eq!(result.row_index, 1);
        assert!(result.mapping.shear_rate_col.is_some()); // "Shear Rate"
        assert!(result.mapping.shear_stress_col.is_some()); // "Shear Stress"
    }

    // ── find_raw_data_sections --------------------------------------------------
    //
    // These tests pin down the current contract so that any future refactor
    // that accidentally flips the priority-vs-fallback logic (which was the
    // root cause of the Ofite 1100 report being silently truncated in
    // pre-refactor builds) will light up loudly.

    fn marker_row(s: &str) -> Vec<String> {
        vec![s.to_string()]
    }

    fn bulk_row(values: &[&str]) -> Vec<String> {
        values.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn find_sections_picks_priority_when_log_data_header_present() {
        // "Log Data:" wins — "Sweep Data:" is treated as a pre-computed
        // summary dupe and intentionally skipped. This matches the
        // current (pre-fix) behaviour that higher-layer tests assume.
        let rows = vec![
            marker_row("Experiment: foo"),
            marker_row("Sweep Data:"),                           // index 1
            bulk_row(&["E.T.", "Rate", "Stress", "Visc"]),       // 2
            marker_row("Log Data:"),                             // 3
            bulk_row(&["E.T.", "Rate", "Stress", "Visc"]),       // 4
        ];
        let sections = find_raw_data_sections(&rows);
        assert_eq!(sections, vec![4], "Log Data should be the only chosen start");
    }

    #[test]
    fn find_sections_falls_back_to_sweep_data_when_no_log_data() {
        // This is the real Ofite 1100 layout: "Analyzed Data:" is a
        // computed summary (NOT a raw-data section and NOT a marker we
        // recognise), and "Sweep Data:" is where the raw rows live.
        let rows = vec![
            marker_row("Experiment: foo"),
            marker_row("Analyzed Data:"),                         // ignored — not a marker
            bulk_row(&["E.T.", "n", "Kv", "K"]),
            marker_row("Sweep Data:"),                            // index 3, chosen via fallback
            bulk_row(&["E.T.", "Rate", "Stress", "Visc"]),
        ];
        let sections = find_raw_data_sections(&rows);
        assert_eq!(sections, vec![4], "Sweep Data fallback must kick in when Log Data is absent");
    }

    #[test]
    fn find_sections_returns_empty_when_no_markers() {
        let rows = vec![
            marker_row("Experiment: foo"),
            bulk_row(&["Time", "Visc", "Temp"]),
            bulk_row(&["0", "100", "25"]),
        ];
        assert!(find_raw_data_sections(&rows).is_empty());
    }

    #[test]
    fn find_sections_merges_multiple_log_data_headers() {
        // Defensive: two "Log Data:" sections in one file (seen in some
        // multi-test-run Grace exports) — both should be returned.
        let rows = vec![
            marker_row("Log Data:"),                  // 0
            bulk_row(&["E.T.", "Rate"]),
            bulk_row(&["1", "100"]),
            marker_row("Log Data:"),                  // 3
            bulk_row(&["E.T.", "Rate"]),
        ];
        let sections = find_raw_data_sections(&rows);
        assert_eq!(sections, vec![1, 4]);
    }

    #[test]
    fn find_sections_ignores_marker_lines_with_data_payload() {
        // Protect against false positives: a row with > 5 non-empty
        // cells isn't a section marker even if one cell literally says
        // "Log Data" (e.g. log metadata inside a header row).
        let rows = vec![
            bulk_row(&["Log Data", "a", "b", "c", "d", "e", "f"]),
            marker_row("Sweep Data:"),
            bulk_row(&["E.T.", "Rate"]),
        ];
        let sections = find_raw_data_sections(&rows);
        assert_eq!(sections, vec![2], "only the real Sweep Data: marker counts");
    }
}
