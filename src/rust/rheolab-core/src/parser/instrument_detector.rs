pub fn detect_instrument(rows: &[Vec<String>], sheet_name: Option<&str>) -> Option<String> {
    // Scan first 50 rows for instrument names
    // To match TS logic which scans multiple sheets, we rely on the caller to provide relevant rows.
    // In rheo_parser.rs we process one sheet at a time, but usually metadata is in the first sheet.

    // Check sheet name first
    if let Some(name) = sheet_name {
        let lower_name = name.to_lowercase();
        if lower_name.contains("bsl") || lower_name.contains("бсл") {
            return Some("BSL Model R1".to_string());
        }
    }

    let scan_limit = std::cmp::min(rows.len(), 200);
    let full_text = rows
        .iter()
        .take(scan_limit)
        .map(|r| r.join(" ").to_lowercase())
        .collect::<Vec<_>>()
        .join(" ");

    // Explicit instrument names
    // BSL (Prioritize over Chandler/Grace as it might contain similar keywords)
    // BSL (Prioritize over Chandler/Grace as it might contain similar keywords)
    if full_text.contains("bsl")
        || full_text.contains("rheometer model r1")
        || full_text.contains("реометр модель: r1")
        || full_text.contains("model r1")
        || full_text.contains("бсл")
    {
        return Some("BSL Model R1".to_string());
    }

    // Explicit instrument names
    if full_text.contains("grace") || full_text.contains("m5600") {
        return Some("Grace M5600 HPHT Rheometer".to_string());
    }
    if full_text.contains("chandler") || (full_text.contains("model") && full_text.contains("5550"))
    {
        return Some("Chandler Engineering Model 5550 Rheometer".to_string());
    }
    if full_text.contains("brookfield")
        || full_text.contains("dv")
        || full_text.contains("% torque")
        || full_text.contains("torque multiplier")
        || full_text.contains("beavis")
    {
        return Some("Brookfield PVS".to_string());
    }
    if full_text.contains("ofite") {
        return Some("Ofite 1100 Rheometer".to_string());
    }
    if full_text.contains("fann") {
        return Some("Fann 50 Viscometer".to_string());
    }

    // Ofite detection by document structure: Sweep Data + Log Data
    let has_sweep_data = full_text.contains("sweep data");
    let has_log_data = full_text.contains("log data");
    if has_sweep_data && has_log_data {
        return Some("Ofite 1100 Rheometer".to_string());
    }

    // BSL detection by column structure (fallback)
    // BSL files often have: Time, Temperature, Pressure, Viscosity (English or Russian)
    let has_time = full_text.contains("time") || full_text.contains("время");
    let has_temp = full_text.contains("temperature") || full_text.contains("температура");
    let has_press = full_text.contains("pressure") || full_text.contains("давление");
    let has_visc = full_text.contains("viscosity") || full_text.contains("вязкость");

    if has_time && has_temp && has_press && has_visc {
        // Check if it's NOT Chandler/Grace/Ofite/Fann/Brookfield to avoid false positives
        // (Though they might have similar columns, usually they have their own keywords)
        return Some("BSL Model R1".to_string());
    }

    None
}
