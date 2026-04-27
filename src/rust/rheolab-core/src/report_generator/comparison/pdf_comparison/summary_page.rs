//! Page 2 of the comparison PDF: portrait page with the summary table and
//! optional touch-point tables.

use super::super::super::formatters::{convert_viscosity, get_viscosity_unit};
use super::super::super::pdf::template::helpers::escape_typst;
use super::super::summary::build_summaries;
use super::super::types::ComparisonReportInput;
use super::touch_points::build_comparison_touch_points_block;

/// Build page 2: summary table + touch points on a separate portrait page.
pub(super) fn build_summary_table_page(
    input: &ComparisonReportInput,
    is_ru: bool,
) -> String {
    let title = if is_ru { "Сравнение экспериментов" } else { "Experiment Comparison" };
    // `test_id` stays on `ExperimentSummary` so the DB-side payload is
    // unchanged, but the Summary table no longer renders it — the user
    // asked for one less column and the experiment name already carries
    // enough identity on the chart + legend.
    let t_exp    = if is_ru { "Эксперимент"            } else { "Experiment" };
    let t_pts    = if is_ru { "Точек"                  } else { "Points" };
    let t_dur    = if is_ru { "Длительность (мин)"     } else { "Duration (min)" };
    let t_maxv   = if is_ru { "Макс. вязкость"         } else { "Max viscosity" };
    let t_finv   = if is_ru { "Финал. вязкость"        } else { "Final viscosity" };

    let visc_unit = get_viscosity_unit(&input.unit_system);

    let summaries = build_summaries(&input.experiments);
    let mut rows_typst = String::new();
    for s in &summaries {
        let max_v = convert_viscosity(s.max_viscosity_cp, &input.unit_system);
        let fin_v = convert_viscosity(s.final_viscosity_cp, &input.unit_system);
        rows_typst.push_str(&format!(
            "  [{}], [{}], [{:.1}], [{:.1} {}], [{:.1} {}],\n",
            escape_typst(&s.display_name),
            s.data_points,
            s.duration_min,
            max_v, visc_unit,
            fin_v, visc_unit,
        ));
    }

    let touch_points_block = build_comparison_touch_points_block(input, is_ru);

    format!(r##"
#pagebreak()
#page(paper: "a4", flipped: false, margin: (top: 2.5cm, bottom: 1.2cm, left: 2cm, right: 2cm))[

#text(size: 14pt, weight: "bold", fill: rgb("#0F172A"))[{title}]
#v(12pt)

#section_header("{summary_hdr}")
#v(8pt)

#table(
  columns: (2.8fr, 0.9fr, 1.3fr, 1.5fr, 1.5fr),
  stroke: 0.5pt + rgb("#E2E8F0"),
  fill: none,
  align: center + horizon,
  table.header(
    header_cell[{t_exp}],
    header_cell[{t_pts}],
    header_cell[{t_dur}],
    header_cell[{t_maxv}],
    header_cell[{t_finv}]
  ),
{rows}
)

{touch_points}
]
"##,
        title = escape_typst(title),
        summary_hdr = if is_ru { "Сводная таблица" } else { "Summary" },
        t_exp = t_exp, t_pts = t_pts,
        t_dur = t_dur, t_maxv = t_maxv, t_finv = t_finv,
        rows = rows_typst,
        touch_points = touch_points_block,
    )
}
