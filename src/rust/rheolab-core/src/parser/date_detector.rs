use chrono::{Datelike, NaiveDate};
use regex::Regex;
use std::sync::LazyLock;

// Static compiled regexes — compiled once, reused on every row (#8 fix).
// `.expect()` fires once on first LazyLock access; guarded by static pattern.
static NUMERIC_DATE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4})|(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})")
        .expect("NUMERIC_DATE_RE pattern is static and valid")
});
static ALPHA_DATE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(\d{1,2})[\s-]([A-Za-zА-Яа-я]{3})[\s-](\d{2,4})")
        .expect("ALPHA_DATE_RE pattern is static and valid")
});
static CONCAT_DATE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"([A-Za-z]{3,9})(\d{1,2})(\d{4})")
        .expect("CONCAT_DATE_RE pattern is static and valid")
});

const SCAN_LIMIT: usize = 100;
const KEYWORDS: &[&str] = &[
    "date",
    "дата",
    "test date",
    "дата теста",
    "time",
    "время",
    "test time",
    "start time",
    "log number",
];

pub fn detect_date(rows: &[Vec<String>]) -> Option<String> {
    let limit = std::cmp::min(rows.len(), SCAN_LIMIT);

    for r in 0..limit {
        let row = &rows[r];
        if row.is_empty() {
            continue;
        }

        for c in 0..row.len() {
            let cell_str = row[c].trim().to_lowercase();

            if KEYWORDS.iter().any(|kw| cell_str.contains(kw)) {
                // 1. Check inside the same cell
                if let Some(date) = extract_date_from_string(&row[c]) {
                    return Some(format!(
                        "{}-{:02}-{:02}",
                        date.year(),
                        date.month(),
                        date.day()
                    ));
                }

                // 2. Check right neighbor (c+1)
                if c + 1 < row.len() {
                    if let Some(date) = parse_value(&row[c + 1]) {
                        return Some(format!(
                            "{}-{:02}-{:02}",
                            date.year(),
                            date.month(),
                            date.day()
                        ));
                    }
                }

                // 3. Check right neighbor + 1 (c+2)
                if c + 2 < row.len() {
                    if let Some(date) = parse_value(&row[c + 2]) {
                        return Some(format!(
                            "{}-{:02}-{:02}",
                            date.year(),
                            date.month(),
                            date.day()
                        ));
                    }
                }

                // 4. Check bottom neighbor (r+1)
                if r + 1 < rows.len() && c < rows[r + 1].len() {
                    if let Some(date) = parse_value(&rows[r + 1][c]) {
                        return Some(format!(
                            "{}-{:02}-{:02}",
                            date.year(),
                            date.month(),
                            date.day()
                        ));
                    }
                }
            }
        }
    }

    None
}

fn parse_value(value: &str) -> Option<NaiveDate> {
    // Check if numeric (Excel serial date)
    if let Ok(num) = value.parse::<f64>() {
        if num > 40000.0 && num < 48000.0 {
            // Excel date: days since 1899-12-30
            let days = num.round() as i64;
            // 25569 is offset for 1970-01-01.
            // Chrono NaiveDate::from_num_days_from_ce?
            // Easier: 1899-12-30 + days
            let base = NaiveDate::from_ymd_opt(1899, 12, 30)?;
            return base.checked_add_days(chrono::Days::new(days as u64));
        }
    }

    extract_date_from_string(value)
}

fn extract_date_from_string(s: &str) -> Option<NaiveDate> {
    let clean = s.trim();

    // 1. Numeric formats: DD.MM.YYYY, DD-MM-YYYY, DD/MM/YYYY, YYYY.MM.DD
    if let Some(mat) = NUMERIC_DATE_RE.find(clean) {
        if let Some(date) = parse_flexible_date(mat.as_str()) {
            return Some(date);
        }
    }

    // 2. Alphanumeric formats: 10 Jan 2023
    if let Some(caps) = ALPHA_DATE_RE.captures(clean) {
        let day = caps[1].parse::<u32>().ok()?;
        let month_str = &caps[2];
        let mut year = caps[3].parse::<i32>().ok()?;
        if year < 100 {
            year += 2000;
        }

        if let Some(month) = parse_month(month_str) {
            return NaiveDate::from_ymd_opt(year, month, day);
        }
    }

    // 3. Concatenated MonthDayYear: November102008
    if let Some(caps) = CONCAT_DATE_RE.captures(clean) {
        let month_str = &caps[1];
        let day = caps[2].parse::<u32>().ok()?;
        let year = caps[3].parse::<i32>().ok()?;

        if let Some(month) = parse_month(month_str) {
            return NaiveDate::from_ymd_opt(year, month, day);
        }
    }

    None
}

fn parse_flexible_date(date_str: &str) -> Option<NaiveDate> {
    let normalized = date_str.replace(['/', '-'], ".");
    let parts: Vec<&str> = normalized.split('.').collect();

    if parts.len() != 3 {
        return None;
    }

    let p1 = parts[0].parse::<u32>().ok()?;
    let p2 = parts[1].parse::<u32>().ok()?;
    let p3 = parts[2].parse::<u32>().ok()?;

    // Case 1: YYYY.MM.DD
    if p1 > 31 {
        return NaiveDate::from_ymd_opt(p1 as i32, p2, p3);
    }

    // Case 2: DD.MM.YYYY or DD.MM.YY
    let mut year = p3 as i32;
    if year < 100 {
        year += 2000;
    }

    // Try DD.MM.YYYY
    if let Some(d) = NaiveDate::from_ymd_opt(year, p2, p1) {
        return Some(d);
    }

    // Try MM.DD.YYYY (US)
    if let Some(d) = NaiveDate::from_ymd_opt(year, p1, p2) {
        return Some(d);
    }

    None
}

fn parse_month(month_str: &str) -> Option<u32> {
    let m = month_str.to_lowercase();
    let prefix: String = m.chars().take(3).collect();

    match prefix.as_str() {
        "jan" | "янв" => Some(1),
        "feb" | "фев" => Some(2),
        "mar" | "мар" => Some(3),
        "apr" | "апр" => Some(4),
        "may" | "май" => Some(5),
        "jun" | "июн" => Some(6),
        "jul" | "июл" => Some(7),
        "aug" | "авг" => Some(8),
        "sep" | "сен" => Some(9),
        "oct" | "окт" => Some(10),
        "nov" | "ноя" => Some(11),
        "dec" | "дек" => Some(12),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Datelike;

    #[test]
    fn test_extract_numeric() {
        let d = extract_date_from_string("Test Date: 23.04.2024").unwrap();
        assert_eq!((d.year(), d.month(), d.day()), (2024, 4, 23));

        let d = extract_date_from_string("2024-04-23").unwrap();
        assert_eq!((d.year(), d.month(), d.day()), (2024, 4, 23));

        // US format MM/DD/YYYY check (if ambiguous, DD.MM preferred in logic, but let's check unambiguous)
        // 04/23/2024 -> 23rd April
        let d = extract_date_from_string("04/23/2024").unwrap();
        assert_eq!((d.year(), d.month(), d.day()), (2024, 4, 23));
    }

    #[test]
    fn test_extract_alpha() {
        let d = extract_date_from_string("10 Jan 2023").unwrap();
        assert_eq!((d.year(), d.month(), d.day()), (2023, 1, 10));

        let d = extract_date_from_string("10-Jan-23").unwrap();
        assert_eq!((d.year(), d.month(), d.day()), (2023, 1, 10));

        // Russian
        let d = extract_date_from_string("10 Янв 2023").unwrap();
        assert_eq!((d.year(), d.month(), d.day()), (2023, 1, 10));
    }

    #[test]
    fn test_extract_concat() {
        let d = extract_date_from_string("November102008").unwrap();
        assert_eq!((d.year(), d.month(), d.day()), (2008, 11, 10));
    }

    #[test]
    fn test_detect_from_rows() {
        let rows = vec![
            vec!["Metadata".to_string(), "".to_string()],
            vec!["Date:".to_string(), "23.04.2024".to_string()],
            vec!["Time".to_string(), "12:00".to_string()],
        ];
        let date = detect_date(&rows).unwrap();
        assert_eq!(date, "2024-04-23");
    }

    #[test]
    fn test_excel_serial() {
        // 45000 -> 2023-03-13 (approx)
        // 45000 days after 1899-12-30
        let d = parse_value("45000").unwrap();
        assert_eq!(d.year(), 2023);
    }
}
