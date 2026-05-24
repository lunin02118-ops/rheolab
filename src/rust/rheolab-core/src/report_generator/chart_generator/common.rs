//! Chart types, helpers, and math utilities.
use super::super::types::ChartLineSettings;
use plotters::prelude::*;
/// Chart data point
#[derive(Debug, Clone)]
pub struct ChartPoint {
    pub time_min: f64,
    pub viscosity_cp: f64,
    pub temperature_c: Option<f64>,
    pub shear_rate: Option<f64>,
    pub pressure_bar: Option<f64>,
    pub bath_temperature_c: Option<f64>,
}

/// Individual line style for chart rendering
#[derive(Debug, Clone)]
pub struct ChartLineStyle {
    pub color: RGBColor,
    pub width: u32,
    pub style: String, // "solid", "dashed", "dotted"
}

impl Default for ChartLineStyle {
    fn default() -> Self {
        Self {
            color: RGBColor(59, 130, 246), // Blue
            width: 2,
            style: "solid".to_string(),
        }
    }
}

/// Chart configuration
#[derive(Debug, Clone)]
pub struct ChartConfig {
    pub show_temperature: bool,
    pub show_shear_rate: bool,
    pub show_pressure: bool,
    pub show_bath_temperature: bool,
    pub shear_rate_axis: String,
    pub pressure_axis: String,
    /// Axis layout mode: "individual" or "shared"
    pub axis_mode: String,
    pub width: u32,
    pub height: u32,

    // Predetermined labels to simplify generator logic
    pub label_left: String,
    pub label_right: String,
    pub label_bottom: String,

    // Series names for legend
    pub name_viscosity: String,
    pub name_temperature: String,
    pub name_shear_rate: String,
    pub name_pressure: String,
    pub name_bath_temperature: String,

    // Touch points for vertical lines
    pub touch_points: Vec<ChartTouchPoint>,

    /// Viscosity threshold for horizontal dashed line (cP)
    pub viscosity_threshold: Option<f64>,

    // Line styles from user settings
    pub line_styles: Option<ChartLineStyles>,

    /// When true, skip LTTB downsampling (use for PDF reports that need full precision)
    pub skip_downsample: bool,

    /// X-axis time-rendering mode: `"minutes"` (default), `"seconds"`, or
    /// `"hh:mm:ss"`.  Mirrors `ReportSettings.rheology_units.time_format`
    /// and controls the `label_bottom` unit suffix + tick-label rendering
    /// in the Typst chart-page overlay.  Empty string is treated as
    /// `"minutes"` so older call-sites that don't set this field keep
    /// byte-for-byte compatible output.
    pub time_format: String,
}

/// All line styles for chart
#[derive(Debug, Clone)]
pub struct ChartLineStyles {
    pub viscosity: ChartLineStyle,
    pub temperature: ChartLineStyle,
    pub shear_rate: ChartLineStyle,
    pub pressure: ChartLineStyle,
    pub bath_temperature: ChartLineStyle,
}

impl Default for ChartLineStyles {
    fn default() -> Self {
        Self {
            viscosity: ChartLineStyle {
                color: RGBColor(59, 130, 246), // #3b82f6 Blue
                width: 2,
                style: "solid".to_string(),
            },
            temperature: ChartLineStyle {
                color: RGBColor(220, 38, 38), // #dc2626 Red
                width: 2,
                style: "solid".to_string(),
            },
            shear_rate: ChartLineStyle {
                color: RGBColor(168, 85, 247), // #a855f7 Purple
                width: 2,
                style: "solid".to_string(),
            },
            pressure: ChartLineStyle {
                color: RGBColor(34, 197, 94), // #22C55E Green
                width: 2,
                style: "solid".to_string(),
            },
            bath_temperature: ChartLineStyle {
                color: RGBColor(234, 88, 12), // #ea580c Orange
                width: 2,
                style: "dashed".to_string(),
            },
        }
    }
}

/// Convert ChartLineSettings from types.rs to ChartLineStyles
impl From<&ChartLineSettings> for ChartLineStyles {
    fn from(settings: &ChartLineSettings) -> Self {
        Self {
            viscosity: parse_line_style(&settings.viscosity),
            temperature: parse_line_style(&settings.temperature),
            shear_rate: parse_line_style(&settings.shear_rate),
            pressure: parse_line_style(&settings.pressure),
            bath_temperature: settings
                .bath_temperature
                .as_ref()
                .map(|s| parse_line_style(s))
                .unwrap_or(ChartLineStyle {
                    color: RGBColor(234, 88, 12),
                    width: 2,
                    style: "dashed".to_string(),
                }),
        }
    }
}

/// Parse hex color string to RGBColor
pub(crate) fn parse_hex_color(hex: &str) -> RGBColor {
    let hex = hex.trim_start_matches('#');
    if hex.len() >= 6 {
        let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(59);
        let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(130);
        let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(246);
        RGBColor(r, g, b)
    } else {
        RGBColor(59, 130, 246) // Default blue
    }
}

/// Parse LineSettings to ChartLineStyle
fn parse_line_style(settings: &super::super::types::LineSettings) -> ChartLineStyle {
    ChartLineStyle {
        color: parse_hex_color(&settings.color),
        width: settings.width as u32,
        style: settings.style.clone(),
    }
}

/// Touch point for vertical line on chart
#[derive(Debug, Clone)]
pub struct ChartTouchPoint {
    pub time: f64,
    pub viscosity: f64,
    pub label: String,
    pub color: RGBColor,
}

// Grid color constant
pub(crate) const C_GRID: RGBColor = RGBColor(200, 200, 200); // Light Gray

/// Info for one independent metric axis (used in individual axis mode)
#[derive(Debug, Clone)]
pub struct IndividualAxisInfo {
    /// Data range and tick spacing
    pub min: f64,
    pub max: f64,
    pub step: f64,
    pub minor_step: f64,
    /// "viscosity" | "temperature" | "shear_rate" | "pressure"
    pub metric: String,
    /// "left" | "right"
    pub side: String,
    /// 0 = innermost (touching chart border), 1 = next outward, etc.
    pub side_idx: usize,
    /// SVG hex colour, e.g. "#3b82f6"
    pub color_hex: String,
}

/// Ranges for axis labels (since we can't render text in Plotters WASM)
#[derive(Debug, Clone)]
pub struct ChartRanges {
    pub x_min: f64,
    pub x_max: f64,
    pub x_step: f64,
    pub x_minor_step: f64,
    pub y_left_min: f64,
    pub y_left_max: f64,
    pub y_left_step: f64,
    pub y_left_minor_step: f64,
    pub y_right_min: f64,
    pub y_right_max: f64,
    pub y_right_step: f64,
    pub y_right_minor_step: f64,
    /// Populated only in "individual" axis mode.  Each entry describes one
    /// per-metric independent Y axis so that Typst can render tick labels.
    pub individual_axes: Vec<IndividualAxisInfo>,
}

// Helper: Raw Min/Max
pub(crate) fn get_raw_min_max(vals: &[f64], default_min: f64, default_max: f64) -> (f64, f64) {
    if vals.is_empty() {
        return (default_min, default_max);
    }
    let min = vals.iter().fold(f64::INFINITY, |a, &b| a.min(b));
    let max = vals.iter().fold(f64::NEG_INFINITY, |a, &b| a.max(b));
    if min.is_infinite() || max.is_infinite() {
        return (default_min, default_max);
    }
    // Add tiny padding to prevent hitting edges exactly if data is flat
    if min == max {
        (min - 1.0, max + 1.0)
    } else {
        (min, max)
    }
}

/// Calculate major step size — ported from chart-ticks.tsx calculateMajorStep()
/// Picks from standard "nice" values: 1, 2, 5, 10, 20, 50, ...
fn calculate_major_step(range: f64, target_ticks: usize) -> f64 {
    if range <= 0.0 {
        return 1.0;
    }
    let raw_step = range / (target_ticks.max(2) - 1) as f64;
    let magnitude = 10f64.powf(raw_step.log10().floor());
    let normalized = raw_step / magnitude;
    let nice = if normalized <= 1.5 {
        1.0
    } else if normalized <= 3.0 {
        2.0
    } else if normalized <= 7.0 {
        5.0
    } else {
        10.0
    };
    nice * magnitude
}

/// Minor divisions based on major step — ported from chart-ticks.tsx getMinorDivisions()
/// Scientific convention: steps of 2/20/200 → 4 divisions, others → 5.
fn get_minor_divisions(major_step: f64) -> usize {
    if major_step <= 0.0 {
        return 5;
    }
    let normalized = major_step / 10f64.powf(major_step.log10().floor());
    if (normalized - 2.0).abs() < 0.01 {
        4
    } else {
        5
    }
}

/// Calculate nice scale with major and minor steps.
/// `padding`: when true, adds one extra step of breathing room at top AND bottom
/// so chart lines never touch the axis borders (used for Y axes).
/// For X (time) axis use padding=false so the first/last data points reach the axis.
/// Returns (nice_min, nice_max, major_step, minor_step)
pub(crate) fn calculate_nice_scale(
    min: f64,
    max: f64,
    target_major_ticks: usize,
    padding: bool,
) -> (f64, f64, f64, f64) {
    let range = max - min;
    if range < 1e-10 {
        return (min - 1.0, max + 1.0, 1.0, 0.2);
    }
    let major_step = calculate_major_step(range, target_major_ticks);
    let minor_divisions = get_minor_divisions(major_step);
    let minor_step = major_step / minor_divisions as f64;
    let nice_min_base = (min / major_step).floor() * major_step;
    let nice_max_base = (max / major_step).ceil() * major_step;
    let (nice_min, nice_max) = if padding {
        // Add one extra step when data is within 15% of a tick from the edge
        // so chart lines never touch the top or bottom border.
        let nmin = if min - nice_min_base < major_step * 0.15 {
            nice_min_base - major_step
        } else {
            nice_min_base
        };
        let nmax = if nice_max_base - max < major_step * 0.15 {
            nice_max_base + major_step
        } else {
            nice_max_base
        };
        (nmin, nmax)
    } else {
        (nice_min_base, nice_max_base)
    };
    (nice_min, nice_max, major_step, minor_step)
}

/// LTTB (Largest-Triangle-Three-Buckets) downsampling for chart rendering.
///
/// Multi-channel variant: normalises all available numeric channels (viscosity,
/// temperature, shear_rate, pressure, bath_temperature) to [0, 1] and sums
/// their triangle areas so that significant events in *any* channel are
/// preserved — not just the viscosity channel.  This matches the multi-channel
/// LTTB used on the frontend (`downsampleRheoPointsMultiChannel`).
pub(crate) fn lttb_downsample_chart(data: &[ChartPoint], threshold: usize) -> Vec<ChartPoint> {
    let n = data.len();
    if n <= threshold {
        return data.to_vec();
    }

    // ── Per-channel normalisers ────────────────────────────────────────────
    let v_min = data
        .iter()
        .map(|p| p.viscosity_cp)
        .fold(f64::INFINITY, f64::min);
    let v_rng = (data
        .iter()
        .map(|p| p.viscosity_cp)
        .fold(f64::NEG_INFINITY, f64::max)
        - v_min)
        .max(f64::EPSILON);

    macro_rules! opt_norm_range {
        ($field:ident) => {{
            let mn = data
                .iter()
                .filter_map(|p| p.$field)
                .fold(f64::INFINITY, f64::min);
            let mx = data
                .iter()
                .filter_map(|p| p.$field)
                .fold(f64::NEG_INFINITY, f64::max);
            if mx > mn + f64::EPSILON {
                Some((mn, (mx - mn).max(f64::EPSILON)))
            } else {
                None
            }
        }};
    }

    let t_norm = opt_norm_range!(temperature_c);
    let sr_norm = opt_norm_range!(shear_rate);
    let p_norm = opt_norm_range!(pressure_bar);
    let b_norm = opt_norm_range!(bath_temperature_c);

    /// Normalise `v` to [0,1] using precomputed min and range.
    #[inline]
    fn nv(v: f64, min: f64, rng: f64) -> f64 {
        (v - min) / rng
    }

    // Collect all-channel normalised Y values for a point into a fixed-size array.
    let yn = |p: &ChartPoint| -> [f64; 5] {
        [
            nv(p.viscosity_cp, v_min, v_rng),
            t_norm.map_or(0.0, |(mn, rng)| {
                p.temperature_c.map_or(0.0, |v| nv(v, mn, rng))
            }),
            sr_norm.map_or(0.0, |(mn, rng)| {
                p.shear_rate.map_or(0.0, |v| nv(v, mn, rng))
            }),
            p_norm.map_or(0.0, |(mn, rng)| {
                p.pressure_bar.map_or(0.0, |v| nv(v, mn, rng))
            }),
            b_norm.map_or(0.0, |(mn, rng)| {
                p.bath_temperature_c.map_or(0.0, |v| nv(v, mn, rng))
            }),
        ]
    };

    // ── LTTB loop ─────────────────────────────────────────────────────────
    let mut sampled = Vec::with_capacity(threshold);
    sampled.push(data[0].clone());

    let bucket_size = (n - 2) as f64 / (threshold - 2) as f64;
    let mut a = 0usize;

    for i in 0..(threshold - 2) {
        let bucket_start = ((i as f64 + 1.0) * bucket_size) as usize + 1;
        let bucket_end = (((i as f64 + 2.0) * bucket_size) as usize + 1).min(n - 1);

        let next_start = bucket_end;
        let next_end = (((i as f64 + 3.0) * bucket_size) as usize + 1).min(n);
        let next_count = (next_end - next_start).max(1) as f64;

        // Next-bucket centroid (normalised coords)
        let mut avg_x = 0.0;
        let mut avg_y = [0.0f64; 5];
        for j in next_start..next_end {
            avg_x += data[j].time_min;
            let yj = yn(&data[j]);
            for ch in 0..5 {
                avg_y[ch] += yj[ch];
            }
        }
        avg_x /= next_count;
        for ch in 0..5 {
            avg_y[ch] /= next_count;
        }

        let ax = data[a].time_min;
        let ay = yn(&data[a]);

        let mut max_score = -1.0f64;
        let mut max_idx = bucket_start;

        for j in bucket_start..bucket_end {
            let jx = data[j].time_min;
            let jy = yn(&data[j]);

            // Sum of triangle areas across all active channels
            let score: f64 = (0..5)
                .map(|ch| {
                    ((ax - avg_x) * (jy[ch] - ay[ch]) - (ax - jx) * (avg_y[ch] - ay[ch])).abs()
                })
                .sum();

            if score > max_score {
                max_score = score;
                max_idx = j;
            }
        }

        sampled.push(data[max_idx].clone());
        a = max_idx;
    }

    sampled.push(data[n - 1].clone());
    sampled
}
