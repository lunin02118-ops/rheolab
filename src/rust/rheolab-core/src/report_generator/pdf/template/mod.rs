//! Typst template generation and helpers for PDF reports.
//!
//! The PDF template was historically a single 1100-line function; it is now
//! split by page/section into self-contained builders.
//!
//! Layout:
//! - [`helpers`]      — `escape_typst`, `hex_to_typst`
//! - [`stats`]        — rheological stats table fragments
//! - [`chart_page`]   — chart page (SVG + Typst overlay)
//! - [`raw_data`]     — optional raw-data page
//!
//! The top-level `generate_typst_template` composes these fragments and
//! then emits the final `#grid(...)` page-1 layout + supporting `#let` rules.
pub(crate) mod helpers;
mod stats;
mod chart_page;
mod raw_data;
mod touch_points;

#[cfg(test)]
mod tests;

use super::super::types::*;
use super::super::formatters::{format_date, format_number, build_ramp_string};
use super::super::chart_generator::{ChartConfig, ChartRanges};
use std::collections::HashMap;

use helpers::escape_typst;

// Re-export the chart touch-point helper for the parent `pdf` module
// (`pdf/mod.rs` calls `template::calculate_touch_points_for_chart`).
pub(super) use touch_points::calculate_touch_points_for_chart;

pub(super) fn generate_typst_template(
    input: &ReportInput,
    _files: &HashMap<String, Vec<u8>>,
    has_chart: bool,
    chart_config: Option<&ChartConfig>,
    chart_ranges: Option<&ChartRanges>,
) -> String {
    // Byte-identical wrapper: delegate to the two pub(crate) helpers used
    // by the comparison assembler (Phase 1.E) so both paths share the same
    // Typst output.  A `generate_typst_template_is_stable` test pins this.
    let is_ru = input.settings.language == "ru";
    let total_pages = if has_chart { 2 } else { 1 };
    let globals = build_typst_globals(input, total_pages);
    let body = build_single_experiment_body(input, has_chart, chart_config, chart_ranges, is_ru);
    format!("{}{}", globals, body)
}

/// Build the document-wide Typst prelude: `#set page`/`#set text`,
/// `#let section_header`/`#let label`/… helpers, `#let report_header`,
/// `#let report_footer`, and the final `#set page(... header, footer)`.
///
/// Emits **everything that must appear once per Typst document**.  For the
/// comparison report (Phase 1.E), the assembler calls this with the first
/// experiment's metadata to drive the document-wide header (company name,
/// date, page counter).  Per-experiment bodies are then concatenated with
/// `#pagebreak()` separators — they must NOT re-emit this prelude.
///
/// `total_pages` is inlined into the footer's `"Page N / TOTAL"` counter.
pub(crate) fn build_typst_globals(
    input: &ReportInput,
    total_pages: usize,
) -> String {
    let is_ru = input.settings.language == "ru";
    let date_str = format_date(&input.metadata.test_date, &input.settings.language);

    let company_name = input.metadata.company_name.as_deref().unwrap_or("RheoLab");
    let report_title_right = if is_ru { "Отчет о тестировании жидкости ГРП" } else { "Frac Fluid Test Report" };
    let test_id = input.metadata.test_id.as_deref().unwrap_or(input.metadata.filename.as_str());

    let f_generated = if is_ru { "Сгенерировано:" } else { "Generated:" };
    let f_page = if is_ru { "Страница" } else { "Page" };

    let logo_block = if input.metadata.company_logo_base64.is_some() {
        r#"image("logo.png", width: 40pt)"#.to_string()
    } else {
        "none".to_string()
    };

    format!(r##"
#set page(paper: "a4", margin: (x: 28pt, y: 30pt))
#set text(font: "Roboto", size: 7pt, fill: rgb("#334155"))

// --- Styles ---
#let section_header(title) = block(
  fill: rgb("#F1F5F9"),
  width: 100%,
  inset: 6pt,
  radius: 2pt,
  text(weight: "bold", fill: rgb("#1E293B"), size: 9pt)[#title]
)

#let label(content) = text(fill: rgb("#64748B"), size: 8pt)[#content]
#let val(content) = text(fill: rgb("#0F172A"), size: 8pt, weight: "medium")[#content]

#let header_cell(content) = block(
  width: 100%,
  inset: (x: 4pt, y: 8pt),
  align(center + horizon)[
    #text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[#content]
  ]
)

// Smaller muted text for unit labels inside header cells
#let unit_text(u) = text(size: 6pt, weight: "regular", fill: rgb("#64748B"))[#u]

#let cell(content) = block(
  inset: 4pt,
  align(left + horizon)[
    #text(size: 7.5pt, weight: "regular", fill: rgb("#334155"))[#content]
  ]
)

// --- Global Layout & Definitions ---
#let report_header = {{
  v(15pt)
  grid(
    columns: (1fr, auto),
    align: (left, right),
    stack(dir: ltr, spacing: 10pt,
      {logo_block},
      align(horizon)[#text(size: 18pt, weight: "bold", fill: rgb("#0F172A"))[{company_name}]]
    ),
    align(right)[
      #text(size: 8pt, fill: rgb("#64748B"))[{report_title_right}]\
      #text(size: 8pt, fill: rgb("#64748B"))[ID: {test_id}]
    ]
  )
  v(8pt)
  line(length: 100%, stroke: 1pt + rgb("#CBD5E1"))
  v(7pt)
}}

#let report_footer = grid(
  columns: (1fr, 1fr, 1fr),
  align: (left, center, right),
  text(size: 7pt, fill: rgb("#94a3b8"))[{company_name}],
  text(size: 7pt, fill: rgb("#94a3b8"))[{f_generated} {date_str}],
  text(size: 7pt, fill: rgb("#94a3b8"))[{f_page} #counter(page).display() / {total_pages}]
)

#set page(
  paper: "a4",
  margin: (top: 3.5cm, bottom: 2cm, x: 1cm),
  header: report_header,
  footer: report_footer
)
"##,
        company_name = escape_typst(company_name),
        report_title_right = report_title_right,
        test_id = escape_typst(test_id),
        logo_block = logo_block,
        f_generated = f_generated,
        f_page = f_page,
        date_str = date_str,
        total_pages = total_pages,
    )
}

/// Build the per-experiment content body: passport + recipe + water +
/// touch-points + stats + chart page + optional raw-data page.
///
/// Does **not** emit a page-break at the start; callers in the comparison
/// assembler must prepend `#pagebreak()` between experiments.
///
/// Does **not** emit any `#set page`, `#let`, or header/footer — those come
/// from [`build_typst_globals`] once per document.
pub(crate) fn build_single_experiment_body(
    input: &ReportInput,
    has_chart: bool,
    chart_config: Option<&ChartConfig>,
    chart_ranges: Option<&ChartRanges>,
    is_ru: bool,
) -> String {
    let date_str = format_date(&input.metadata.test_date, &input.settings.language);

    // ── Translations ─────────────────────────────────────────────────────
    let t_passport = if is_ru { "Паспорт теста" } else { "Test Passport" };
    let t_recipe = if is_ru { "Рецептура жидкости" } else { "Fluid Recipe" };
    let t_cal = if is_ru { "Калибровка" } else { "Calibration" };
    let t_water = if is_ru { "Анализ воды" } else { "Water Analysis" };
    let t_stats = if is_ru { "Реологическая статистика" } else { "Rheological Statistics" };

    let l_file = if is_ru { "ID / Файл:" } else { "ID / File:" };
    let l_date = if is_ru { "Дата:" } else { "Date:" };
    let l_oper = if is_ru { "Оператор:" } else { "Operator:" };
    let l_lab = if is_ru { "Лаборатория:" } else { "Laboratory:" };
    let l_field = if is_ru { "Месторождение:" } else { "Field:" };
    let l_well = if is_ru { "Скважина:" } else { "Well:" };
    let l_inst = if is_ru { "Прибор:" } else { "Instrument:" };
    let l_source = if is_ru { "Источник воды:" } else { "Water Source:" };

    // Calibration labels
    let l_c_date = if is_ru { "Дата калибровки:" } else { "Cal. Date:" };
    let l_c_r2 = "R²:";
    let l_c_slope = "Slope / Intercept:";
    let l_c_hyst = "Hyst / STDEV:";
    let l_c_status = if is_ru { "Статус:" } else { "Status:" };

    // Recipe headers
    let h_name = if is_ru { "Наименование" } else { "Name" };
    let h_lot = if is_ru { "Лот.номер" } else { "Lot No" };
    let h_type = if is_ru { "Тип\\ реагента" } else { "Type" };
    let h_unit = if is_ru { "ЕИ" } else { "Unit" };
    let h_conc = if is_ru { "Конц." } else { "Conc." };

    // ── 1. Passport Data ─────────────────────────────────────────────────
    let p_file = &input.metadata.filename;
    let p_oper = input.metadata.operator_name.as_deref().unwrap_or("-");
    let p_lab = input.metadata.laboratory_name.as_deref().unwrap_or("-");
    let p_field = input.metadata.field_name.as_deref().unwrap_or("-");
    let p_well = input.metadata.well_number.as_deref().unwrap_or("-");
    let p_inst = input.metadata.instrument_type.as_deref().unwrap_or("-");

    // ── 2. Calibration block ─────────────────────────────────────────────
    let mut cal_block = String::new();
    if input.settings.show_calibration {
        if let Some(cal) = &input.metadata.calibration {
            let v_c_date = format_date(&cal.calibration_date, &input.settings.language);
            let v_c_r2 = format_number(cal.r_squared, 6);
            let v_c_slope = format_number(cal.slope, 4);
            let v_c_inter = format_number(cal.intercept, 4);
            let v_c_hyst = format_number(cal.hysteresis, 2);
            let v_c_stdev = format_number(cal.stdev, 2);
            let v_c_status = escape_typst(cal.status.as_deref().unwrap_or("-"));

            let status_color = if v_c_status == "PASS" { "rgb(\"#10B981\")" } else { "rgb(\"#EF4444\")" };

            cal_block = format!(r##"
                #section_header("{t_cal}")
                #v(5pt)
                #grid(
                  columns: (80pt, 1fr),
                  row-gutter: 6pt,
                  label[{l_c_date}], val[{v_c_date}],
                  label[{l_c_r2}], val[{v_c_r2}],
                  label[{l_c_slope}], val[{v_c_slope} / {v_c_inter}],
                  label[{l_c_hyst}], val[{v_c_hyst} / {v_c_stdev}],
                  label[{l_c_status}], text(fill: {status_color}, size: 8pt, weight: "bold")[{v_c_status}]
                )
                #v(20pt)
            "##,
                t_cal=t_cal,
                l_c_date=l_c_date, v_c_date=v_c_date,
                l_c_r2=l_c_r2, v_c_r2=v_c_r2,
                l_c_slope=l_c_slope, v_c_slope=v_c_slope, v_c_inter=v_c_inter,
                l_c_hyst=l_c_hyst, v_c_hyst=v_c_hyst, v_c_stdev=v_c_stdev,
                l_c_status=l_c_status, v_c_status=v_c_status, status_color=status_color
            );
        }
    }

    // ── 3. Water table ───────────────────────────────────────────────────
    let default_wp = WaterParams::default();
    let wp = input.water_params.as_ref().unwrap_or(&default_wp);
    let water_source = wp.source.as_deref().unwrap_or("-");

    let water_params_list = vec![
        ("pH", wp.ph, "ед."),
        ("Fe", wp.fe, "мг/л"),
        ("Ca", wp.ca, "мг/л"),
        ("Mg", wp.mg, "мг/л"),
        ("Cl", wp.cl, "мг/л"),
        ("SO4", wp.so4, "мг/л"),
        ("HCO3", wp.hco3, "мг/л"),
    ];

    let mut w_header = String::new();
    let mut w_units = String::new();
    let mut w_values = String::new();

    for (label, val, unit) in water_params_list {
        w_header.push_str(&format!("[#text(weight: \"bold\", size: 8pt, fill: rgb(\"#1E293B\"))[{}]], ", label));
        w_units.push_str(&format!("[#text(weight: \"regular\", fill: rgb(\"#64748B\"), size: 7pt)[{}]], ", unit));
        w_values.push_str(&format!("[#text(weight: \"regular\", fill: rgb(\"#0F172A\"), size: 7.5pt)[{}]], ", format_number(val, 1)));
    }

    // ── 4. Recipe ────────────────────────────────────────────────────────
    let mut recipe_rows = String::new();
    for r in &input.recipe {
        recipe_rows.push_str(&format!(
            "[{}], [{}], [{}], [{}], [{}],\n",
            escape_typst(&r.name),
            escape_typst(r.batch_number.as_deref().unwrap_or("-")),
            escape_typst(r.category.as_deref().unwrap_or("-")),
            escape_typst(&r.unit),
            r.concentration
        ));
    }

    // ── 5. Stats section (rows + headers + columns) ──────────────────────
    let stats = stats::build_stats_section(input, is_ru);

    // ── 6. Touch-points block (right side of page 1) ─────────────────────
    let touch_points_block = touch_points::build_touch_points_block(
        chart_config,
        is_ru,
        input.settings.show_touch_points,
        &input.settings.unit_system,
    );

    // ── 7. Chart page + raw-data page ────────────────────────────────────
    let chart_page = chart_page::build_chart_page(input, has_chart, chart_config, chart_ranges, is_ru);
    let raw_data_page = raw_data::build_raw_data_page(input, is_ru);

    // ── 8. Ramp block (above stats table) ────────────────────────────────
    let ramp_block = if let Some(ramp) = build_ramp_string(&input.cycles) {
        let ramp_label = if is_ru { "Скорость сдвига" } else { "Shear Rate" };
        format!(r##"
            #text(size: 8pt, weight: "bold", fill: rgb("#0F172A"))[{}: {} (1/s)]
            #v(5pt)
        "##, ramp_label, ramp)
    } else {
        String::new()
    };

    // ── 9. Assemble body (globals emitted separately) ────────────────────
    format!(r##"
// --- Page 1 Content ---
#v(-20pt)
#grid(
  columns: (1fr, 1.4fr),
  column-gutter: 24pt,
  row-gutter: 20pt,
  align: top + left,

  // -- Row 1 Left: Passport + Calibration --
  [
    #section_header("{t_passport}")
    #v(5pt)
    #grid(
      columns: (85pt, 1fr),
      row-gutter: 8pt,
      label[{l_file}], val[{p_file}],
      label[{l_date}], val[{date_str}],
      label[{l_oper}], val[{p_oper}],
      label[{l_lab}],  val[{p_lab}],
      label[{l_field}], val[{p_field}],
      label[{l_well}], val[{p_well}],
      label[{l_inst}], val[{p_inst}],
    )
    #v(20pt)
    {cal_block}
  ],

  // -- Row 1 Right: Recipe --
  [
    #section_header("{t_recipe}")
    #v(5pt)
    #table(
      columns: (2.2fr, 1.2fr, 1.6fr, 0.8fr, 0.8fr),
      stroke: 0.5pt + rgb("#E2E8F0"),
      fill: none,
      table.header(
        header_cell[{h_name}],
        header_cell[{h_lot}],
        header_cell[{h_type}],
        header_cell[{h_unit}],
        header_cell[{h_conc}]
      ),
     {recipe_rows}
    )
  ],

  // -- Row 2 Left: Water Analysis --
  [
    #section_header("{t_water}")
    #v(5pt)
    #text(size: 8pt, weight: "bold", fill: rgb("#0F172A"))[{l_source} {water_source}]
    #v(5pt)
    #table(
       columns: (1fr, 1fr, 1fr, 1fr, 1fr, 1fr, 1fr),
       align: center + horizon,
       stroke: 0.5pt + rgb("#E2E8F0"),
       fill: (_, y) => if y == 1 {{ rgb("#F8FAFC") }} else {{ none }},
       {w_header}
       {w_units}
       {w_values}
    )
  ],

  // -- Row 2 Right: Touch Points --
  [
    {touch_points_block}
  ]
)

#v(25pt)

// --- Statistics ---
#section_header("{t_stats}")
#v(5pt)
{ramp_block}


#show table.cell.where(y: 0): it => header_cell(it.body)
#set text(size: 6.5pt, weight: "regular", fill: rgb("#334155"))

#table(
  columns: ({stats_columns}),
  stroke: 0.5pt + rgb("#E2E8F0"),
  fill: none,
  align: center + horizon,

  table.header(
    {stats_headers}
  ),
  {stats_rows}
)


{chart_page}

{raw_data_page}
"##,
        t_passport=t_passport, t_water=t_water, t_recipe=t_recipe, t_stats=t_stats,
        l_file=l_file, p_file=escape_typst(p_file),
        l_date=l_date, date_str=date_str,
        l_oper=l_oper, p_oper=escape_typst(p_oper),
        l_lab=l_lab, p_lab=escape_typst(p_lab),
        l_field=l_field, p_field=escape_typst(p_field),
        l_well=l_well, p_well=escape_typst(p_well),
        l_inst=l_inst, p_inst=escape_typst(p_inst),
        l_source=l_source, water_source=escape_typst(water_source),

        cal_block=cal_block,

        w_header=w_header, w_units=w_units, w_values=w_values,

        h_name=h_name, h_lot=h_lot, h_type=h_type, h_unit=h_unit, h_conc=h_conc,
        recipe_rows=recipe_rows,
        touch_points_block=touch_points_block,

        stats_columns=stats.columns,
        stats_headers=stats.headers,
        stats_rows=stats.rows,

        chart_page=chart_page,
        raw_data_page=raw_data_page,
        ramp_block=ramp_block
    )
}

