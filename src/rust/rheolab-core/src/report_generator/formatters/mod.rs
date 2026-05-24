//! Formatters
//!
//! Number and unit formatting functions matching report-formatters.ts
//!
//! ЕДИНЫЙ ИСТОЧНИК форматирования для PDF и Excel
//! Все значения должны форматироваться одинаково в обоих форматах!
//!
//! # Module layout
//!
//! Split into focused submodules so each section stays under ~500 LOC:
//!
//! | File | LOC | Responsibility |
//! |---|---:|---|
//! | `mod.rs` | ~75 | Constants (`decimals`, `excel_formats`) + re-exports |
//! | `numbers.rs` | ~65 | `format_number`, `format_date`, `build_ramp_string` |
//! | `time.rs` | ~55 | `time_axis_unit`, `format_time_value` |
//! | `units.rs` | ~210 | All unit conversion (legacy `convert_*` + `render_*_with`) |
//! | `resolve.rs` | ~80 | `ResolvedUnits` + `resolve_units` |
//! | `tests.rs` | ~410 | All 26 tests |
//!
//! Public API is preserved by re-exporting every function from the
//! sub-modules at the module root, so `formatters::format_number(...)`,
//! `formatters::convert_viscosity(...)`, `formatters::resolve_units(...)`,
//! etc. continue to work for the 18 internal call sites.

/// Константы для количества знаков после запятой
/// ЕДИНЫЙ ИСТОЧНИК для PDF и Excel
pub mod decimals {
    /// Время (минуты): 1 знак после запятой
    pub const TIME: u32 = 1;
    /// Температура (°C): 1 знак
    pub const TEMPERATURE: u32 = 1;
    /// Давление (bar): 1 знак
    pub const PRESSURE: u32 = 1;
    /// n' (индекс поведения): 3 знака
    pub const N_PRIME: u32 = 3;
    /// K' (индекс консистенции): 4 знака
    pub const K_PRIME: u32 = 4;
    /// R² (коэффициент детерминации): 4 знака
    pub const R_SQUARED: u32 = 4;
    /// Вязкость при фиксированных скоростях сдвига (η@40, η@100, η@170)
    /// mPa·s / cP: 0 знаков, Pa·s: 4 знака
    pub const VISCOSITY_FIXED: u32 = 0;
    /// Вязкость в Pa·s: 4 знака после запятой
    pub const VISCOSITY_PAS: u32 = 4;
    /// PV (пластическая вязкость): 2 знака
    pub const PV: u32 = 2;
    /// YP (предел текучести): 1 знак
    pub const YP: u32 = 1;
    /// Bingham R²: 4 знака
    pub const BINGHAM_R2: u32 = 4;
    /// Анализ воды: 1 знак
    pub const WATER_PARAMS: u32 = 1;
    /// Калибровка R²: 6 знаков
    pub const CAL_R2: u32 = 6;
    /// Калибровка slope/intercept: 4 знака
    pub const CAL_SLOPE: u32 = 4;
    /// Калибровка hysteresis/stdev: 2 знака
    pub const CAL_HYST: u32 = 2;
}

/// Excel форматы для числовых ячеек
/// Соответствуют константам из decimals
pub mod excel_formats {
    pub const TIME: &str = "0.0";
    pub const TEMPERATURE: &str = "0.0";
    pub const PRESSURE: &str = "0.0";
    pub const N_PRIME: &str = "0.000";
    pub const K_PRIME: &str = "0.0000";
    pub const R_SQUARED: &str = "0.0000";
    /// Вязкость mPa·s / cP: 0 знаков
    pub const VISCOSITY_FIXED: &str = "0";
    /// Вязкость Pa·s: 4 знака
    pub const VISCOSITY_PAS: &str = "0.0000";
    pub const PV: &str = "0.00";
    pub const YP: &str = "0.0";
    pub const BINGHAM_R2: &str = "0.0000";
    pub const WATER_PARAMS: &str = "0.0";
    pub const DEFAULT: &str = "0.00";
}

mod numbers;
mod resolve;
mod time;
mod units;

#[cfg(test)]
mod tests;

pub use numbers::{build_ramp_string, format_date, format_number, format_number_direct};
pub use resolve::{resolve_units, ResolvedUnits};
pub use time::{format_time_value, time_axis_unit};
pub use units::{
    convert_consistency_index, convert_pv, convert_viscosity, convert_yp, get_k_unit, get_pv_unit,
    get_viscosity_unit, get_yp_unit, render_k_with, render_pv_with, render_viscosity_with,
    render_yp_with, viscosity_decimals, viscosity_decimals_for, viscosity_excel_format,
    viscosity_excel_format_for,
};
