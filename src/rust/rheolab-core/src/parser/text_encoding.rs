//! Text decoding and mojibake repair for instrument exports.
//!
//! Some Russian Windows tools open UTF-8 text as Windows-1251 and then save the
//! already-corrupted strings into CSV/XLS files. The parser should recover those
//! headers before detector logic sees them, otherwise Russian columns such as
//! "Время" / "Вязкость" become "Р’СЂРµРјСЏ" / "Р’СЏР·РєРѕСЃС‚СЊ".

use encoding_rs::{UTF_16BE, UTF_16LE, WINDOWS_1251};

pub(crate) fn decode_text(data: &[u8]) -> String {
    if data.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(&data[3..]).into_owned();
    }
    if data.starts_with(&[0xFF, 0xFE]) {
        let (decoded, _, _) = UTF_16LE.decode(&data[2..]);
        return decoded.into_owned();
    }
    if data.starts_with(&[0xFE, 0xFF]) {
        let (decoded, _, _) = UTF_16BE.decode(&data[2..]);
        return decoded.into_owned();
    }
    if let Ok(text) = std::str::from_utf8(data) {
        return text.to_string();
    }

    let (decoded, _, _) = WINDOWS_1251.decode(data);
    decoded.into_owned()
}

pub(crate) fn normalize_cell(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    repair_utf8_as_cp1251_mojibake(trimmed).unwrap_or_else(|| trimmed.to_string())
}

pub(crate) fn normalize_rows(rows: Vec<Vec<String>>) -> Vec<Vec<String>> {
    rows.into_iter()
        .map(|row| row.into_iter().map(|cell| normalize_cell(&cell)).collect())
        .collect()
}

fn repair_utf8_as_cp1251_mojibake(value: &str) -> Option<String> {
    if !looks_like_utf8_as_cp1251_mojibake(value) {
        return None;
    }

    let (bytes, _, had_errors) = WINDOWS_1251.encode(value);
    if had_errors {
        return None;
    }
    let recovered = std::str::from_utf8(bytes.as_ref()).ok()?.trim().to_string();
    if recovered.is_empty() || recovered == value || recovered.contains('\u{FFFD}') {
        return None;
    }

    let before_markers = mojibake_marker_count(value);
    let after_markers = mojibake_marker_count(&recovered);
    let after_cyrillic = recovered.chars().filter(|ch| is_cyrillic(*ch)).count();

    if before_markers > after_markers && (after_cyrillic > 0 || recovered.contains('°')) {
        Some(recovered)
    } else {
        None
    }
}

fn looks_like_utf8_as_cp1251_mojibake(value: &str) -> bool {
    const MARKERS: [&str; 24] = [
        "Р°", "Р±", "РІ", "Рі", "Рґ", "Рµ", "Рё", "Р№", "Рє", "Р»", "Рј", "РЅ", "Рѕ", "Рї", "СЂ",
        "СЃ", "С‚", "Сѓ", "С‹", "СЊ", "С‡", "С€", "В°", "Вµ",
    ];
    MARKERS.iter().any(|marker| value.contains(marker))
}

fn mojibake_marker_count(value: &str) -> usize {
    value
        .chars()
        .filter(|ch| matches!(ch, 'Р' | 'С' | 'В' | 'Ð' | 'Ñ'))
        .count()
}

fn is_cyrillic(ch: char) -> bool {
    ('\u{0400}'..='\u{04FF}').contains(&ch)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repairs_utf8_saved_as_cp1251_mojibake() {
        assert_eq!(normalize_cell("Р’СЂРµРјСЏ"), "Время");
        assert_eq!(normalize_cell("Р’СЏР·РєРѕСЃС‚СЊ"), "Вязкость");
        assert_eq!(normalize_cell("РўРµРјРїРµСЂР°С‚СѓСЂР°"), "Температура");
        assert_eq!(normalize_cell("В°C"), "°C");
    }

    #[test]
    fn keeps_normal_russian_and_ascii_unchanged() {
        assert_eq!(normalize_cell("Реология"), "Реология");
        assert_eq!(normalize_cell("SORTAMENT"), "SORTAMENT");
    }

    #[test]
    fn decodes_windows_1251_text_when_utf8_is_invalid() {
        let (bytes, _, had_errors) = WINDOWS_1251.encode("Время;Вязкость\n0;100");
        assert!(!had_errors);
        assert_eq!(decode_text(bytes.as_ref()), "Время;Вязкость\n0;100");
    }
}
