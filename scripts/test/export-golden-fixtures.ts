/**
 * Export golden test fixtures as JSON for Rust tests
 * 
 * Usage: npx tsx scripts/export-golden-fixtures.ts
 */

import * as fs from 'fs';
import * as path from 'path';

import { detectSchedule } from '../src/lib/analysis/schedule-detector';
import { filterParasiticSteps } from '../src/lib/analysis/parasitic-filter';
import { RheoParser } from '../src/lib/parsing/RheoParser';
import type { RheoPoint } from '../src/lib/analysis/types';

const FIXTURES_DIR = path.join(__dirname, '../tests/fixtures');
const OUTPUT_DIR = path.join(__dirname, '../src/rust/rheolab-core/tests/fixtures');

// Fixtures to export
const FIXTURES = [
    { file: 'Отчёт Chandler.xls', name: 'chandler_steps' },
    { file: 'Отчёт BSL.xlsx', name: 'bsl_steps' },
    { file: 'Отчёт Grace.xlsx', name: 'grace_steps' },
    { file: 'Brookfeild 4.xlsx', name: 'brookfield_steps' },
    { file: '8958 SWB Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@96C 30.10.25.csv', name: 'swb_mamontovskoe_steps' },
    { file: '8957 SST Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@63C 30.10.25.csv', name: 'sst_mamontovskoe_steps' },
    { file: 'Ofite 1100.dat', name: 'ofite_1100_steps' },
];

function readFixture(filename: string): ArrayBuffer {
    const filepath = path.join(FIXTURES_DIR, filename);
    if (!fs.existsSync(filepath)) {
        throw new Error(`Fixture not found: ${filepath}`);
    }
    const buffer = fs.readFileSync(filepath);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function processFixture(filename: string) {
    const buffer = readFixture(filename);
    // Use parseAsync to correctly combine data from all sections (Sweep Data + Log Data)
    const result = await RheoParser.parseAsync(buffer, filename);
    const rawData = result.data;

    if (!rawData || rawData.length === 0) {
        throw new Error(`Failed to parse fixture: ${filename}`);
    }

    const rheoPoints: RheoPoint[] = rawData.map(d => ({
        time_sec: d.time_sec,
        viscosity_cp: d.viscosity_cp,
        temperature_c: d.temperature_c,
        shear_rate: d.shear_rate_s1,
        shear_stress: d.shear_stress_pa,
        pressure_bar: d.pressure_bar ?? 0,
        rpm: d.speed_rpm ?? 0
    }));

    const steps = detectSchedule(rheoPoints);
    const { filteredSteps } = filterParasiticSteps(steps);

    return { steps: filteredSteps, pointCount: rheoPoints.length };
}

async function main() {
    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    console.log('Exporting golden fixtures for Rust tests...\n');

    for (const fixture of FIXTURES) {
        try {
            console.log(`Processing: ${fixture.file}`);
            const { steps, pointCount } = await processFixture(fixture.file);

            // Convert to Rust-compatible format
            const rustSteps = steps.map((s, i) => ({
                id: i + 1,
                start_time: s.startTime,
                end_time: s.endTime,
                duration: s.duration,
                avg_shear_rate: s.avgShearRate,
                avg_shear_stress: s.avgShearStress,
                avg_viscosity: s.avgViscosity,
                avg_temperature: s.avgTemperature,
                avg_pressure: s.avgPressure || 0,
                points: [], // Skip raw points to reduce file size
                calc_points_count: s.calcPointsCount || s.points?.length || 0,
                is_ramp: s.isRamp || false,
                start_index: s.startIndex || 0,
                end_index: s.endIndex || 0,
                is_split_start: false,
            }));

            const outputPath = path.join(OUTPUT_DIR, `${fixture.name}.json`);
            fs.writeFileSync(outputPath, JSON.stringify(rustSteps, null, 2));

            console.log(`  ✓ ${steps.length} steps (from ${pointCount} points) → ${fixture.name}.json`);
        } catch (error) {
            console.error(`  ✗ Error: ${error}`);
        }
    }

    console.log('\nDone! Fixtures exported to:', OUTPUT_DIR);
}

main().catch(console.error);
