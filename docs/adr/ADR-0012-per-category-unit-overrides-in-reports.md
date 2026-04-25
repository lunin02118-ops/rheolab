# ADR-0012 — Per-category unit overrides in PDF / Excel reports

**Status**: Accepted
**Date**: 2026-04-22
**Deciders**: Backend + Frontend
**Supersedes**: part of ADR-0007 (parser pipeline) unit-system handling

## Context

Until 2026-04-22 the Rust report generator received a single coarse
`unit_system: String` (one of `"SI"`, `"SI_Pas"`, or `"Imperial"`) and
used it to drive every label and every numeric conversion in the
rheological statistics table — K', Ks, Kp, PV, YP, η@N, plus the time
column.

The UI store, on the other hand, exposes **per-category** unit
preferences via `chartSettings.rheologyUnits`:

| Category           | Metric preset   | Imperial preset       |
|--------------------|-----------------|-----------------------|
| `viscosity`        | `mPa·s`         | `cP`                  |
| `consistency` (K') | `Pa·s^n`        | `lbf·s^n/100ft²`      |
| `plasticViscosity` | `Pa·s`          | `cP`                  |
| `yieldPoint`       | `Pa`            | `lbf/100ft²`          |
| `pressure`         | `bar`           | `psi`                 |
| `temperature`      | `°C`            | `°F`                  |
| `timeFormat`       | `seconds`       | `minutes`             |

The UI also supports a **custom / mixed** preset where each category
can be set independently — e.g. a user might prefer `cP` for viscosity
(matches oilfield convention for quick-look numbers) but `Pa·s^n` for
K' (dimensionally honest, scientifically precise).

### The bug

`ReportTab.tsx` and `ReportsPanel.tsx` derived `unitSystem` from ONE
field — `chartSettings.lines.viscosity.unit`:

```ts
const unitSystem = (() => {
    const vUnit = chartSettings.lines.viscosity.unit;
    if (vUnit === 'Pa·s') return 'SI_Pas';
    if (vUnit === 'cP')   return 'Imperial';
    return 'SI';
})();
```

Then passed that single string to Rust, which applied it to all eight
quantities. Consequence: a user with `viscosity: 'cP'` (Imperial-ish)
+ `consistency: 'Pa·s^n'` (metric) saw:

* UI table header: `K' (Pa·s^n)`, value `10.4618`
* PDF / Excel stats: `K' (lbf/100ft²)`, value ≈ 500+ (and the `lbf/100ft²`
  label was additionally wrong — K' has stress·time^n dimensions, not
  just stress).

Numerical conversion also used factor `47.88` (Pa → lbf/ft²) instead
of `2.0885` (Pa → lbf/100ft²), so the value was ~23× too large for the
promised label.

## Decision

Introduce **`RheologyUnits`** — a per-category target-unit struct
mirrored from `chartSettings.rheologyUnits` — and make it the primary
unit source for the stats table. `unit_system` stays as a fallback
for legacy callers.

### Wire format

TS → Rust via Tauri IPC, snake_case on the wire:

```jsonc
// ReportSettings.rheology_units (optional)
{
  "viscosity":         "cP",             // or "mPa·s" | "Pa·s"
  "temperature":       "°C",             // or "°F"
  "pressure":          "bar",            // or "psi"
  "consistency":       "Pa·s^n",         // or "lbf·s^n/100ft²"
  "plastic_viscosity": "Pa·s",           // or "cP"
  "yield_point":       "Pa",             // or "lbf/100ft²"
  "time_format":       "minutes"         // or "seconds" | "hh:mm:ss"
}
```

### Rust-side helpers

```
formatters::render_k_with(k_pa_sn,  target) -> (converted, label)
formatters::render_pv_with(pv_pas,  target) -> (converted, label)
formatters::render_yp_with(yp_pa,   target) -> (converted, label)
formatters::render_viscosity_with(v_mpa_s, target) -> (converted, label)

formatters::resolve_units(input)          -> ResolvedUnits
formatters::format_time_value(t_min, fmt) -> String
formatters::time_axis_unit(fmt, lang)     -> &'static str
```

`resolve_units` picks targets from `settings.rheology_units` if
populated, falls back to `unit_system`-derived labels otherwise.
Empty per-category fields fall back individually, so partial
overrides are legal.

### Numerical conversion factors

All derived from API RP 13D:

| From        | To                  | Factor    |
|-------------|---------------------|-----------|
| `Pa·s^n`    | `lbf·s^n/100ft²`    | 2.0885    |
| `Pa·s`      | `cP`                | 1 000     |
| `Pa`        | `lbf/100ft²`        | 2.0885    |
| `mPa·s`     | `Pa·s`              | ÷ 1 000   |
| `mPa·s`     | `cP`                | 1 (exact) |

The historical `47.88` factor for K' (Pa → lbf/ft²) was off by 100×
from the `lbf/100ft²` label used elsewhere in the report. Fixed to
`2.0885` to match YP and the industry-standard rheological
convention.

## Consequences

### Positive

* Custom / mixed presets in the UI now survive the trip to PDF and
  Excel — header labels AND values match the Analysis tab byte-for-byte.
* K' Imperial conversion is dimensionally correct and matches API
  RP 13D tables.
* Time column follows the chart axis: `Время (с)` / `Время (мин)` /
  `Время (чч:мм:сс)` based on `rheology_units.time_format`.
* Legacy callers that send only `unit_system` keep working — zero
  back-compat break.

### Negative

* Wire format now carries an extra ~200 bytes of unit strings per
  report request. Negligible next to the ~100 KB of raw data.
* Two places now know how to map a unit-system enum to a unit label —
  `resolve_units()` and the legacy `get_<q>_unit()` helpers. The
  latter stays for the fallback path; future cleanup could fold
  them together once all callers have migrated.

### Neutral

* `ResolvedUnits` is the shared internal shape between PDF and Excel
  stats builders. Moving it into `formatters.rs` eliminates an
  identical copy that used to live in both templates.

## Testing

* Unit tests in `report_generator::formatters::tests::` cover every
  preset combination (clean SI, clean Imperial, user's mixed-custom
  case, partial override with empty fields, all three time formats)
  and every `render_*_with` helper.
* `test_parser_parity_ofite_1100` (golden test) verifies the
  combined Sweep Data + Log Data extraction still produces the right
  number of raw points for downstream consumers.
* Existing Excel determinism and round-trip tests pass unchanged — the
  refactor is semantics-preserving for legacy callers.

## References

* `src/rust/rheolab-core/src/report_generator/formatters.rs`
  (`render_*_with`, `resolve_units`, `format_time_value`,
   `time_axis_unit`)
* `src/rust/rheolab-core/src/report_generator/types.rs`
  (`RheologyUnits`, `ReportSettings.rheology_units`)
* `src/rust/rheolab-core/src/report_generator/pdf/template/stats.rs`
  and `src/rust/rheolab-core/src/report_generator/excel/stats.rs`
* `src/lib/analysis/report-types/report-inputs.ts` (`ReportRheologyUnits`)
* `src/lib/analysis/report-types/report-converter.ts`
  (TS → Rust field mapping)
* `src/lib/reports/report-builders.ts`
  (threading `chartSettings.rheologyUnits` through the report input)
* API RP 13D — *Recommended Practice on the Rheology and Hydraulics
  of Oil-Well Drilling Fluids* — Appendix A unit-conversion table.
