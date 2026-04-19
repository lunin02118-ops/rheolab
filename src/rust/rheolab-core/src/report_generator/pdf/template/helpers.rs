//! Small text-formatting helpers shared by all template sub-modules.

/// Escapes a string so it can be embedded inside a Typst `[ … ]` content block
/// without accidental markup interpretation.
///
/// Typst interprets a number of characters as markup (`#`, `@`, `_`, `*`, `$`,
/// `<`, `>`, `` ` ``, `[`, `]`, `{`, `}`) or as string delimiters (`\`, `"`).
/// We backslash-escape every one of them — the order matters: the `\\` rule
/// must run first, otherwise later rules would double-escape their own slash.
pub(super) fn escape_typst(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('{', "\\{")
        .replace('}', "\\}")
        .replace('[', "\\[")
        .replace(']', "\\]")
        .replace('#', "\\#")
        .replace('"', "\\\"")
        .replace('*', "\\*")
        .replace('_', "\\_")
        .replace('`', "\\`")
        .replace('$', "\\$")
        .replace('<', "\\<")
        .replace('>', "\\>")
        .replace('@', "\\@")
}

/// Converts an SVG-style `#RRGGBB` hex colour to a Typst `rgb(r, g, b)` literal.
///
/// Returns a neutral grey when the input is malformed so the caller does not
/// need to worry about error propagation — a visible but non-disruptive
/// fallback is preferred to breaking PDF compilation.
pub(super) fn hex_to_typst(hex: &str) -> String {
    let h = hex.trim_start_matches('#');
    if h.len() >= 6 {
        let r = u8::from_str_radix(&h[0..2], 16).unwrap_or(128);
        let g = u8::from_str_radix(&h[2..4], 16).unwrap_or(128);
        let b = u8::from_str_radix(&h[4..6], 16).unwrap_or(128);
        format!("rgb({}, {}, {})", r, g, b)
    } else {
        "rgb(128, 128, 128)".to_string()
    }
}
