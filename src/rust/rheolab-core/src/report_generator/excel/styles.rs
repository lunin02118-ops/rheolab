//! Cell/number format definitions shared across every Excel section.
//!
//! Centralising the `Format::new()` calls here keeps the orchestrator in
//! [`super::mod`] lean and means the individual section writers never need
//! to know which `excel_formats::*` string-constant to pass.

use rust_xlsxwriter::{Format, FormatAlign, FormatBorder, Color};
use super::super::formatters::excel_formats;

/// All cell formats used by the Excel report.
///
/// Constructed once by [`Styles::new`] at the start of every report and
/// passed by reference to each section writer.
///
/// Visibility is `pub(crate)` so the comparison assembler
/// (`report_generator::comparison`) can build a shared style cache for
/// multi-sheet workbooks; field visibility stays `pub(super)` because
/// section writers in sibling modules inside `excel/` are the only
/// legitimate consumers.
pub(crate) struct Styles {
    pub(super) header:             Format,
    pub(super) section_title:      Format,
    pub(super) cell:               Format,
    pub(super) unit:               Format,
    pub(super) number:             Format,
    pub(super) fmt_time:           Format,
    pub(super) fmt_temperature:    Format,
    pub(super) fmt_pressure:       Format,
    pub(super) fmt_n_prime:        Format,
    pub(super) fmt_k_prime:        Format,
    pub(super) fmt_r_squared:      Format,
    pub(super) fmt_viscosity_fixed:Format,
    pub(super) fmt_viscosity_pas:  Format,
    pub(super) fmt_pv:             Format,
    pub(super) fmt_yp:             Format,
    pub(super) fmt_bingham_r2:     Format,
}

impl Styles {
    pub(crate) fn new() -> Self {
        let header = Format::new()
            .set_bold()
            .set_background_color(Color::RGB(0xF1F5F9))
            .set_border(FormatBorder::Thin)
            .set_align(FormatAlign::Center)
            .set_align(FormatAlign::VerticalCenter)
            // Wrap long table headers onto multiple lines.  Headers like
            // `η@40\n(mPa·s)` or `Время\n(чч:мм:сс)` are emitted by the
            // section writers with an explicit `\n`; without `text_wrap`
            // Excel would render them as a single line with a literal
            // newline character stripped.
            .set_text_wrap();

        let section_title = Format::new()
            .set_bold()
            .set_font_size(11)
            .set_font_color(Color::RGB(0x1E293B));

        let cell = Format::new()
            .set_border(FormatBorder::Thin)
            .set_align(FormatAlign::Left)
            .set_align(FormatAlign::VerticalCenter)
            .set_text_wrap();

        let unit = Format::new()
            .set_font_color(Color::RGB(0x64748B))
            .set_align(FormatAlign::Center)
            .set_border(FormatBorder::Thin);

        // All statistics formats share: thin border + centre alignment;
        // only the `set_num_format` differs.
        let stat = |fmt: &str| -> Format {
            Format::new()
                .set_num_format(fmt)
                .set_border(FormatBorder::Thin)
                .set_align(FormatAlign::Center)
        };

        let fmt_time            = stat(excel_formats::TIME);
        let fmt_temperature     = stat(excel_formats::TEMPERATURE);
        let fmt_pressure        = stat(excel_formats::PRESSURE);
        let fmt_n_prime         = stat(excel_formats::N_PRIME);
        let fmt_k_prime         = stat(excel_formats::K_PRIME);
        let fmt_r_squared       = stat(excel_formats::R_SQUARED);
        let fmt_viscosity_fixed = stat(excel_formats::VISCOSITY_FIXED);
        let fmt_viscosity_pas   = stat(excel_formats::VISCOSITY_PAS);
        let fmt_pv              = stat(excel_formats::PV);
        let fmt_yp              = stat(excel_formats::YP);
        let fmt_bingham_r2      = stat(excel_formats::BINGHAM_R2);

        let number = Format::new()
            .set_num_format(excel_formats::DEFAULT)
            .set_border(FormatBorder::Thin)
            .set_align(FormatAlign::Center)
            .set_align(FormatAlign::VerticalCenter);

        Styles {
            header, section_title, cell, unit, number,
            fmt_time, fmt_temperature, fmt_pressure,
            fmt_n_prime, fmt_k_prime, fmt_r_squared,
            fmt_viscosity_fixed, fmt_viscosity_pas, fmt_pv, fmt_yp, fmt_bingham_r2,
        }
    }
}
