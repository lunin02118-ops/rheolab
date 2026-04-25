/**
 * @fileoverview Report Input Converter — transforms PdfReportInput / ExcelReportInput
 * into the snake_case structure expected by the Rust WASM PDF/Excel generators.
 *
 * Extracted from converters.ts to keep each module under 400 LOC.
 *
 * @module wasm/report-converter
 */

import type { ExcelReportInput, PdfReportInput } from './types';

/**
 * Convert PDF/Excel report input to WASM-compatible format.
 *
 * This is a comprehensive converter that transforms the entire report input
 * structure for the Rust PDF/Excel generators. It handles:
 * - Axis value calculation from raw data
 * - Metadata field mapping (camelCase → snake_case)
 * - Cycle results conversion
 * - Recipe and water parameters
 * - Chart settings including line styles
 *
 * ## C# Port Notes
 *
 * This function shows the EXACT structure expected by Rust report generators.
 * When porting, ensure all field names match exactly (snake_case).
 *
 * @param input - TypeScript PdfReportInput or ExcelReportInput
 * @returns WASM-compatible report input object
 *
 * @example
 * ```typescript
 * const input: PdfReportInput = {
 *   metadata: { filename: 'test.xlsx', testId: '123' },
 *   cycleResults: [...],
 *   recipe: [...],
 *   settings: { language: 'en', unitSystem: 'SI', ... }
 * };
 * const wasmInput = convertReportInputToWasm(input);
 * const jsonStr = JSON.stringify(wasmInput);
 * const pdfBytes = wasmModule.generate_pdf_report(jsonStr);
 * ```
 */
export function convertReportInputToWasm(input: PdfReportInput | ExcelReportInput): unknown {
    // Calculate axis ranges if not provided
    let axis_values = null;

    if (input.rawData && input.rawData.length > 0) {
        // Use loop-based min/max instead of Math.min(...arr) to avoid
        // stack overflow on large arrays (>10k points).
        let timeMin = Infinity, timeMax = -Infinity;
        let viscMin = Infinity, viscMax = -Infinity;
        let tempMin = Infinity, tempMax = -Infinity;
        let rateMin = Infinity, rateMax = -Infinity;
        let pressMin = Infinity, pressMax = -Infinity;

        for (const p of input.rawData) {
            const t = p.time_sec || 0;
            const v = p.viscosity_cp || 0;
            const tc = p.temperature_c || 0;
            const r = p.shear_rate || 0;
            const pr = p.pressure_bar || 0;
            if (t < timeMin) timeMin = t;
            if (t > timeMax) timeMax = t;
            if (v < viscMin) viscMin = v;
            if (v > viscMax) viscMax = v;
            if (tc < tempMin) tempMin = tc;
            if (tc > tempMax) tempMax = tc;
            if (r < rateMin) rateMin = r;
            if (r > rateMax) rateMax = r;
            if (pr < pressMin) pressMin = pr;
            if (pr > pressMax) pressMax = pr;
        }

        axis_values = {
            time_min: timeMin === Infinity ? 0 : timeMin / 60,
            time_max: timeMax === -Infinity ? 0 : timeMax / 60,
            viscosity_min: viscMin === Infinity ? 0 : viscMin,
            viscosity_max: viscMax === -Infinity ? 0 : viscMax,
            temperature_min: tempMin === Infinity ? 0 : tempMin,
            temperature_max: tempMax === -Infinity ? 0 : tempMax,
            shear_rate_min: rateMin === Infinity ? 0 : rateMin,
            shear_rate_max: rateMax === -Infinity ? 0 : rateMax,
            pressure_min: pressMin === Infinity ? 0 : pressMin,
            pressure_max: pressMax === -Infinity ? 0 : pressMax,
        };
    }

    // Convert to snake_case for Rust
    return {
        axis_values,
        metadata: {
            filename: input.metadata.filename,
            test_id: input.metadata.testId ?? null,
            test_date: input.metadata.testDate ?? null,
            operator_name: input.metadata.operatorName ?? null,
            laboratory_name: input.metadata.laboratoryName ?? null,
            field_name: input.metadata.fieldName ?? null,
            well_number: input.metadata.wellNumber ?? null,
            instrument_type: input.metadata.instrumentType ?? null,
            geometry: input.metadata.geometry ?? null,
            company_name: input.metadata.companyName ?? null,
            company_logo_base64: input.metadata.companyLogoBase64 ?? null,
            calibration: input.metadata.calibration ? {
                device_type: input.metadata.calibration.deviceType ?? null,
                calibration_date: input.metadata.calibration.calibrationDate ?? null,
                r_squared: input.metadata.calibration.rSquared ?? null,
                slope: input.metadata.calibration.slope ?? null,
                intercept: input.metadata.calibration.intercept ?? null,
                hysteresis: input.metadata.calibration.hysteresis ?? null,
                stdev: input.metadata.calibration.stdev ?? null,
                status: input.metadata.calibration.status ?? null,
            } : null,
        },
        cycle_results: input.cycleResults.map(c => ({
            cycle_no: c.cycleNo,
            time_min: c.timeMin ?? 0,
            temp_c: c.tempC ?? 0,
            pressure_bar: c.pressure_bar ?? null,
            n_prime: c.nPrime,
            k_prime: c.kPrime,
            k_slot: c.kSlot != null && isFinite(c.kSlot) ? c.kSlot : null,
            k_pipe: c.kPipe != null && isFinite(c.kPipe) ? c.kPipe : null,
            r2: c.r2,
            visc_at_40: c.viscAt40 ?? null,
            visc_at_100: c.viscAt100 ?? null,
            visc_at_170: c.viscAt170 ?? null,
            viscosities: c.viscosities ?? {},
            bingham_pv: c.binghamPv ?? null,
            bingham_yp: c.binghamYp ?? null,
            bingham_r2: c.binghamR2 ?? null,
        })),
        recipe: input.recipe.map(r => ({
            name: r.name,
            concentration: r.concentration,
            unit: r.unit,
            category: r.category ?? null,
            batch_number: r.batchNumber ?? null,
        })),
        water_params: input.waterParams ? {
            source: input.waterParams.source ?? null,
            salinity: input.waterParams.salinity ?? null,
            ph: input.waterParams.ph ?? null,
            hardness: input.waterParams.hardness ?? null,
        } : null,
        chart_image_base64: input.chartImageBase64 ?? null,
        cycles: (input.cycles ?? []).map(c => ({
            type: c.type,
            steps: c.steps.map(s => ({ avg_shear_rate: s.avgShearRate })),
        })),
        raw_data: (input.rawData ?? []).map(p => ({
            time_sec: p.time_sec,
            viscosity_cp: p.viscosity_cp,
            temperature_c: p.temperature_c ?? null,
            shear_rate: p.shear_rate ?? null,
            shear_stress_pa: p.shear_stress_pa ?? null,
            speed_rpm: p.speed_rpm ?? null,
            pressure_bar: p.pressure_bar ?? null,
            bath_temperature_c: p.bath_temperature_c ?? null,
        })),
        settings: {
            language: input.settings.language,
            unit_system: input.settings.unitSystem,
            show_touch_points: input.settings.showTouchPoints,
            viscosity_threshold: input.settings.viscosityThreshold ?? 500,
            show_target_time: input.settings.showTargetTime ?? false,
            target_time: input.settings.targetTime ?? 10,
            show_calibration: input.settings.showCalibration,
            show_raw_data: input.settings.showRawData ?? false,
            viscosity_shear_rates: input.settings.viscosityShearRates ?? [40, 100, 170],
            show_temperature: input.settings.showTemperature,
            show_shear_rate: input.settings.showShearRate,
            show_pressure: input.settings.showPressure,
            show_bath_temperature: input.settings.showBathTemperature ?? false,
            shear_rate_axis: input.settings.shearRateAxis ?? 'left',
            pressure_axis: input.settings.pressureAxis ?? 'right',
            axis_mode: input.settings.axisMode ?? 'individual',
            show_advanced_stats: input.settings.showAdvancedStats ?? true,
            line_settings: input.settings.lineSettings ? {
                viscosity: {
                    color: input.settings.lineSettings.viscosity.color,
                    width: input.settings.lineSettings.viscosity.width,
                    style: input.settings.lineSettings.viscosity.style,
                },
                temperature: {
                    color: input.settings.lineSettings.temperature.color,
                    width: input.settings.lineSettings.temperature.width,
                    style: input.settings.lineSettings.temperature.style,
                },
                shear_rate: {
                    color: input.settings.lineSettings.shearRate.color,
                    width: input.settings.lineSettings.shearRate.width,
                    style: input.settings.lineSettings.shearRate.style,
                },
                pressure: {
                    color: input.settings.lineSettings.pressure.color,
                    width: input.settings.lineSettings.pressure.width,
                    style: input.settings.lineSettings.pressure.style,
                },
                rpm: {
                    color: input.settings.lineSettings.rpm.color,
                    width: input.settings.lineSettings.rpm.width,
                    style: input.settings.lineSettings.rpm.style,
                },
                ...(input.settings.lineSettings.bathTemperature ? {
                    bath_temperature: {
                        color: input.settings.lineSettings.bathTemperature.color,
                        width: input.settings.lineSettings.bathTemperature.width,
                        style: input.settings.lineSettings.bathTemperature.style,
                    },
                } : {}),
            } : null,
            // Per-category target units — passed through unchanged.
            // When present this takes precedence over `unit_system` on
            // the Rust side for stats-table labels AND conversions, so
            // the UI's mixed / custom unit presets survive the round
            // trip.  Absent → legacy `unit_system` path.
            rheology_units: input.settings.rheologyUnits ? {
                viscosity: input.settings.rheologyUnits.viscosity,
                temperature: input.settings.rheologyUnits.temperature,
                pressure: input.settings.rheologyUnits.pressure,
                consistency: input.settings.rheologyUnits.consistency,
                plastic_viscosity: input.settings.rheologyUnits.plasticViscosity,
                yield_point: input.settings.rheologyUnits.yieldPoint,
                time_format: input.settings.rheologyUnits.timeFormat,
            } : null,
        },
    };
}
