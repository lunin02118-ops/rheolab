//! SVG post-processor: inject `stroke-dasharray` onto specific data series
//! polylines / paths without leaking onto siblings that share a colour.
//!
//! See the file-level docs of `multi_experiment/mod.rs` for the rationale —
//! the comparison chart deliberately reuses one palette colour across all
//! metrics of a single experiment, distinguishing them by *dash style*.
//! The legacy post-processor used `String::replace` keyed on
//! `(stroke, stroke-width)` and therefore flipped every polyline of a given
//! colour to dashed when only one was supposed to change (user bug report
//! 2026-04-24).

// ── SVG dash-style injector ────────────────────────────────────────────────
//
// Plotters writes each `LineSeries` as a self-closing `<polyline
// ... stroke="#RRGGBB" stroke-width="N" opacity="1"/>`, and each
// `PathElement` as a self-closing `<path ... stroke="#RRGGBB"
// stroke-width="N" .../>`.  Both forms appear in the order the caller
// invoked the draw calls.  The legacy post-processor appended
// `stroke-dasharray="8,4"` via plain `String::replace` of
// `stroke="#RGB" stroke-width="N"` — which **fails in the comparison
// chart** because every metric of a single experiment deliberately
// shares one palette colour (the comparison UI distinguishes metrics
// by dash style, not hue).  Setting `bath_temperature.style = "dashed"`
// therefore leaked dash attributes onto the viscosity and temperature
// strokes of the same experiment (user bug report 2026-04-24).
//
// This helper fixes the leak by:
//   1. Walking `<polyline>` **and** `<path>` opening tags in their SVG
//      order (shared-axis mode uses LineSeries → polylines; individual-
//      axis mode uses PathElement → paths — both must be handled).
//   2. Counting only those whose `stroke="#..."` matches an experiment
//      palette colour, skipping grid (`#C8C8C8`), axis frames
//      (`#3B82F6` / `#F97316` / `#475569`), and threshold overlays
//      (`#000000`) that plotters emits in its own fixed hues.
//   3. Injecting the dash attribute onto the specific counted index the
//      caller requested via `dash_targets`.
//
// `dash_targets: &[(data_series_idx, style)]` — `data_series_idx`
// references the **data-stroke order** the caller produced
// (`viscosity[exp_0]`, `temperature[exp_0]`, `bath_temp[exp_0]`,
// `viscosity[exp_1]`, ...), **not** the raw SVG element index.  This
// keeps the caller's bookkeeping local and free of SVG parsing.
pub(super) fn inject_series_dasharray(
    svg: String,
    experiment_colors_hex: &[String],
    dash_targets: &[(usize, String)],
) -> String {
    if dash_targets.is_empty() {
        return svg;
    }

    // Build a `data_series_idx → style` map for O(1) lookup.
    let target_map: std::collections::HashMap<usize, &str> = dash_targets
        .iter()
        .map(|(idx, style)| (*idx, style.as_str()))
        .collect();

    // Pre-compute the exact `stroke="#RGB"` needles once so the hot
    // inner loop doesn't re-`format!()` per polyline.
    let needles: Vec<String> = experiment_colors_hex
        .iter()
        .map(|hex| format!(r#"stroke="{}""#, hex))
        .collect();

    let mut result = String::with_capacity(svg.len() + dash_targets.len() * 48);
    let bytes = svg.as_bytes();
    let mut cursor: usize = 0;
    let mut data_counter: usize = 0;

    while cursor < bytes.len() {
        // Find the next `<polyline` or `<path` opening tag — whichever
        // comes first.  Everything before it is copied verbatim.
        let next_poly = svg[cursor..]
            .find("<polyline")
            .map(|i| (cursor + i, "<polyline".len()));
        let next_path = svg[cursor..]
            .find("<path")
            .map(|i| (cursor + i, "<path".len()));
        let (tag_start, tag_name_len) = match (next_poly, next_path) {
            (Some(p), Some(q)) => {
                if p.0 <= q.0 {
                    p
                } else {
                    q
                }
            }
            (Some(p), None) => p,
            (None, Some(q)) => q,
            (None, None) => {
                result.push_str(&svg[cursor..]);
                break;
            }
        };

        // Copy the prefix up to (but not including) the tag opener.
        result.push_str(&svg[cursor..tag_start]);

        // Locate this tag's closing `>` so we can inspect its attributes.
        // Both polyline and path emitted by plotters are self-closing,
        // i.e. end in `/>`; we fall back to `>` defensively.
        let attr_start = tag_start + tag_name_len;
        let close_rel = svg[attr_start..]
            .find('>')
            .unwrap_or(svg.len() - attr_start - 1);
        let close_pos = attr_start + close_rel; // index of '>' in svg

        // `attrs` covers everything between the tag name and the closing
        // `>` — this is what we scan for `stroke="..."`.
        let attrs = &svg[attr_start..close_pos];

        let is_data_series = needles.iter().any(|n| attrs.contains(n));
        let mut dash_inject: Option<String> = None;
        if is_data_series {
            if let Some(&style) = target_map.get(&data_counter) {
                let dasharray = match style {
                    "dashed" => Some("8,4"),
                    "dotted" => Some("0.1,6"),
                    _ => None,
                };
                if let Some(d) = dasharray {
                    dash_inject = Some(if style == "dotted" {
                        format!(r#" stroke-dasharray="{}" stroke-linecap="round""#, d)
                    } else {
                        format!(r#" stroke-dasharray="{}""#, d)
                    });
                }
            }
            data_counter += 1;
        }

        // Copy the tag name + attrs, inject dasharray (if flagged) just
        // before the self-closing `/>` (or `>` fallback).
        result.push_str(&svg[tag_start..close_pos]);
        if let Some(extra) = dash_inject {
            // `svg[close_pos - 1]` is `/` for self-closing tags — put
            // the new attribute before it so the result stays a valid
            // self-closing element (`... stroke-dasharray="8,4"/>`).
            let is_self_closing = svg[..close_pos].ends_with('/');
            if is_self_closing {
                // Pop the trailing `/` we already pushed, inject, then
                // restore `/` + `>` from the input at close_pos.
                result.pop();
                result.push_str(&extra);
                result.push('/');
            } else {
                result.push_str(&extra);
            }
        }
        // Push the closing `>` itself.
        result.push('>');
        cursor = close_pos + 1;
    }

    result
}
