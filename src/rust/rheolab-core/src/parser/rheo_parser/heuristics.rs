//! Small classifiers and delimited-file splitting used by AI-context candidate
//! extraction. None of these touch Calamine; they operate on raw `Vec<Vec<String>>`.

pub(super) fn parse_delimited_rows(data: &[u8]) -> Result<Vec<Vec<String>>, String> {
    let text = super::super::text_encoding::decode_text(data);
    let lines: Vec<&str> = text.lines().collect();

    if lines.is_empty() {
        return Err("CSV file is empty".to_string());
    }

    let delimiter: char = {
        let mut detected = ',';
        for line in lines.iter().take(50) {
            if line.contains('\t') {
                detected = '\t';
                break;
            }
            if line.contains(';') && !line.contains(',') {
                detected = ';';
                break;
            }
        }
        detected
    };

    let byte_delim = delimiter as u8;
    Ok(lines
        .iter()
        .map(|line| {
            let mut rdr = csv::ReaderBuilder::new()
                .delimiter(byte_delim)
                .has_headers(false)
                .flexible(true)
                .from_reader(line.as_bytes());
            rdr.records()
                .next()
                .and_then(|r| r.ok())
                .map(|rec| {
                    rec.iter()
                        .map(super::super::text_encoding::normalize_cell)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_else(|| vec!["".to_string()])
        })
        .collect())
}

pub(super) fn is_chart_sheet(sheet_name: &str) -> bool {
    let lower = sheet_name.to_lowercase();
    ["chart", "graph", "график", "formatted"]
        .iter()
        .any(|k| lower.contains(k))
}

pub(super) fn candidate_sheet_bonus(sheet_name: Option<&str>) -> usize {
    let Some(sheet_name) = sheet_name else {
        return 0;
    };
    let lower = sheet_name.to_lowercase();
    if ["raw", "сырые", "unformatted", "data"]
        .iter()
        .any(|k| lower.contains(k))
    {
        200
    } else {
        0
    }
}

pub(super) fn cell_looks_numeric(cell: &str) -> bool {
    let trimmed = cell.trim();
    if trimmed.is_empty() {
        return false;
    }

    let normalized = trimmed.replace(',', ".");
    if normalized.parse::<f64>().is_ok() {
        return true;
    }

    let parts: Vec<&str> = trimmed.split(':').collect();
    if parts.len() >= 2 && parts.len() <= 3 {
        return parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()));
    }

    false
}

pub(super) fn looks_like_unit_row(row: &[String]) -> bool {
    let non_empty: Vec<&String> = row.iter().filter(|cell| !cell.trim().is_empty()).collect();
    if non_empty.len() < 2 {
        return false;
    }

    let text_like = non_empty
        .iter()
        .filter(|cell| {
            let value = cell.trim();
            value.contains('/')
                || value.contains('°')
                || value.contains('µ')
                || value.contains('₁')
                || value.contains('²')
                || value.contains('³')
                || value.contains('⁻')
                || value.contains('%')
                || value.chars().any(char::is_alphabetic)
        })
        .count();
    let numeric_like = non_empty
        .iter()
        .filter(|cell| cell_looks_numeric(cell))
        .count();

    text_like >= 2 && text_like >= numeric_like
}
