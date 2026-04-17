use chrono::{Datelike, NaiveDate};
use super::types::{
    FilenameMetadataResponse, ParseSummary, ParsedPoint, RecipeComponentResponse, SummaryRange,
    SummaryRangeWithAvg, TimeRange,
};

pub(crate) fn normalize_optional_date(value: Option<&str>) -> Option<String> {
    value
        .map(|raw| raw.trim())
        .filter(|raw| !raw.is_empty())
        .map(normalize_date_string)
}

pub(crate) fn normalize_date_string(raw: &str) -> String {
    let value = raw.trim();
    if value.is_empty() {
        return value.to_string();
    }

    // ISO date — already canonic.
    if let Ok(date) = NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        return date.format("%Y-%m-%d").to_string();
    }

    // dd.mm.YYYY — only accept when the year component is clearly 4 digits (≥ 1000).
    // chrono's %Y parses any digit count including 2-digit (year 23 CE), so we guard
    // with a year >= 1000 check to avoid treating "05.07.23" as year 0023.
    if let Ok(date) = NaiveDate::parse_from_str(value, "%d.%m.%Y") {
        if date.year() >= 1000 {
            return date.format("%Y-%m-%d").to_string();
        }
    }

    // dd.mm.yy — 2-digit year; shift to current century (2000–2099).
    if let Ok(date) = NaiveDate::parse_from_str(value, "%d.%m.%y") {
        let year = date.year();
        let four_digit = if year < 100 { year + 2000 } else { year };
        if let Some(corrected) = NaiveDate::from_ymd_opt(four_digit, date.month(), date.day()) {
            return corrected.format("%Y-%m-%d").to_string();
        }
    }

    value.to_string()
}

pub(crate) fn map_filename_metadata(
    metadata: &rheolab_core::parser::filename_parser::FilenameMetadata,
) -> Option<FilenameMetadataResponse> {
    let recipe = if metadata.recipe.is_empty() {
        None
    } else {
        Some(
            metadata
                .recipe
                .iter()
                .map(|item| RecipeComponentResponse {
                    abbreviation: item.abbreviation.clone(),
                    concentration: item.concentration,
                    unit: item.unit.replace("³", "3"),
                    category: item.category.clone(),
                    reagent_id: item.reagent_id.clone(),
                    reagent_name: item.reagent_name.clone(),
                })
                .collect(),
        )
    };

    let water_source = metadata.destination.clone();
    let response = FilenameMetadataResponse {
        test_id: metadata.test_id.clone(),
        test_type: metadata.test_type.clone(),
        test_type_full: metadata.test_type_full.clone(),
        field_name: metadata.field_name.clone(),
        destination: metadata.destination.clone(),
        water_source,
        temperature: metadata.temperature,
        recipe,
    };

    if response.test_id.is_some()
        || response.test_type.is_some()
        || response.test_type_full.is_some()
        || response.field_name.is_some()
        || response.destination.is_some()
        || response.water_source.is_some()
        || response.temperature.is_some()
        || response
            .recipe
            .as_ref()
            .is_some_and(|items| !items.is_empty())
    {
        return Some(response);
    }

    None
}

pub(crate) fn build_summary(data: &[ParsedPoint]) -> ParseSummary {
    let point_count = data.len();
    if point_count == 0 {
        return ParseSummary {
            point_count,
            time_range: None,
            viscosity_range: None,
            temperature_range: None,
            pressure_range: None,
        };
    }

    // Single-pass accumulator — avoids 4 intermediate Vec allocations and ~12
    // sequential passes (collect + min + max + avg for each field).
    let mut time_min = f64::INFINITY;
    let mut time_max = f64::NEG_INFINITY;
    let mut visc_min = f64::INFINITY;
    let mut visc_max = f64::NEG_INFINITY;
    let mut visc_sum = 0f64;
    let mut temp_min = f64::INFINITY;
    let mut temp_max = f64::NEG_INFINITY;
    let mut temp_sum = 0f64;
    let mut pres_min = f64::INFINITY;
    let mut pres_max = f64::NEG_INFINITY;
    let mut pres_count = 0usize;

    for point in data {
        let t = point.time_sec;
        let v = point.viscosity_cp;
        let c = point.temperature_c;
        let p = point.pressure_bar;

        if t < time_min { time_min = t; }
        if t > time_max { time_max = t; }

        if v < visc_min { visc_min = v; }
        if v > visc_max { visc_max = v; }
        visc_sum += v;

        if c < temp_min { temp_min = c; }
        if c > temp_max { temp_max = c; }
        temp_sum += c;

        if p > 0.0 {
            if p < pres_min { pres_min = p; }
            if p > pres_max { pres_max = p; }
            pres_count += 1;
        }
    }

    let n = point_count as f64;
    ParseSummary {
        point_count,
        time_range: Some(TimeRange {
            start: time_min,
            end: time_max,
            duration_minutes: round2((time_max - time_min) / 60.0),
        }),
        viscosity_range: Some(SummaryRangeWithAvg {
            min: round2(visc_min),
            max: round2(visc_max),
            avg: round2(visc_sum / n),
        }),
        temperature_range: Some(SummaryRangeWithAvg {
            min: round2(temp_min),
            max: round2(temp_max),
            avg: round2(temp_sum / n),
        }),
        pressure_range: if pres_count == 0 {
            None
        } else {
            Some(SummaryRange {
                min: round2(pres_min),
                max: round2(pres_max),
            })
        },
    }
}

pub(crate) fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}
