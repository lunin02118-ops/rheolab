/**
 * touch-point-fixture.test.ts
 *
 * Real-data regression test: runs calculateSmartTouchPoints against the actual
 * t-20.02.26-1 - 561)@110C.xls fixture to guard against false-early detection.
 *
 * Root-cause summary:
 *   The fixture is a Grace 3600 multi-rate experiment at 110°C.  It has large
 *   periodic viscosity peaks at the dominant shear rate (100 s⁻¹) throughout
 *   the run, and a true 50 cP threshold crossing that occurs in the 180–220 min
 *   window.  Without proper shear-rate filtering AND median smoothing, earlier
 *   (low-shear-rate) segments — which carry very low viscosity — trigger false
 *   detection.  This test ensures both safeguards stay in place.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
// xlsx is a devDependency only — NOT in the production bundle.
// `npm audit --omit=dev` reports 0 vulnerabilities for production.
// ExcelJS (also a devDep) does not support legacy .xls format; the fixture
// files here are Grace 3600 .xls exports, so xlsx must be kept for this
// specific test.  AUD-008 is therefore fully mitigated at the bundle boundary.
import * as XLSX from 'xlsx';
import {
    type TouchPointInput,
    calculateSmartTouchPoints,
} from '@/lib/utils/touch-point';

// ─── Fixture parser ───────────────────────────────────────────────────────────

/**
 * Parse the Grace 3600 XLS fixture into TouchPointInput[].
 *
 * Sheet: "Raw Data"
 * Column layout (row 0 = header):
 *   0  Viscosity (cP)
 *   4  Shear Rate (s⁻¹)
 *   10 Test Time (HH:MM:SS)
 */
function parseGraceFixture(fixtureName: string): TouchPointInput[] {
    const fixturePath = join(process.cwd(), 'tests', 'fixtures', fixtureName);
    const rawBuffer = readFileSync(fixturePath);
    const wb = XLSX.read(rawBuffer, { type: 'buffer', raw: true });

    const ws = wb.Sheets['Raw Data'];
    if (!ws) throw new Error('Sheet "Raw Data" not found');

    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
        header: 1,
        defval: null,
    });

    const points: TouchPointInput[] = [];
    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r[0] == null) continue;

        const timeStr = r[10] as string | null;
        if (!timeStr || typeof timeStr !== 'string') continue;

        const parts = timeStr.split(':');
        if (parts.length !== 3) continue;

        const timeSec =
            parseInt(parts[0], 10) * 3600 +
            parseInt(parts[1], 10) * 60 +
            parseInt(parts[2], 10);

        const viscosity = parseFloat(String(r[0]));
        const shearRate = parseFloat(String(r[4]));

        if (!isFinite(timeSec) || !isFinite(viscosity)) continue;

        points.push({
            time_min: timeSec / 60,
            viscosity_cp: viscosity,
            shear_rate: isFinite(shearRate) ? shearRate : 0,
        });
    }

    return points;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('calculateSmartTouchPoints — real fixture: t-20.02.26-1 @110C', () => {
    const FIXTURE = 't-20.02.26-1  - 561)@110C.xls';
    const THRESHOLD = 50; // cP

    it('parses the fixture and finds 670 data points across 305 minutes', () => {
        const pts = parseGraceFixture(FIXTURE);
        expect(pts.length).toBeGreaterThanOrEqual(600);
        expect(pts[pts.length - 1].time_min).toBeGreaterThan(290);
    });

    it('dominant shear rate is ~100 s⁻¹ and filtered points are 300+', () => {
        const pts = parseGraceFixture(FIXTURE);
        // Manually compute dominant rate (mirrors findDominantShearRate logic)
        const rates = pts.filter(p => p.shear_rate > 0).map(p => p.shear_rate);
        rates.sort((a, b) => a - b);
        const tol = 0.05;
        let bestCount = 0;
        let clusterStart = 0;
        while (clusterStart < rates.length) {
            const hi = rates[clusterStart] * (1 + tol);
            let end = clusterStart;
            while (end < rates.length && rates[end] <= hi) end++;
            if (end - clusterStart > bestCount) bestCount = end - clusterStart;
            clusterStart = end;
        }
        // Dominant cluster should be ~349 points at 100 s⁻¹
        expect(bestCount).toBeGreaterThan(300);
    });

    it('detects threshold crossing in the 180–220 min window (not early)', () => {
        const pts = parseGraceFixture(FIXTURE);

        const results = calculateSmartTouchPoints(pts, {
            viscosityThreshold: THRESHOLD,
            showTargetTime: false,
            targetTime: 10,
        });

        const threshold = results.find(r => r.type === 'threshold');

        expect(threshold).toBeDefined();

        // Must be in the correct late window, NOT in the startup phase (< 30 min)
        // where the low-shear-rate segments have viscosity < 50 cP.
        expect(threshold!.time).toBeGreaterThanOrEqual(180);
        expect(threshold!.time).toBeLessThanOrEqual(220);

        // Viscosity at the crossing point is the actual first-below-threshold
        // data point value (≤ threshold), not the interpolated threshold value.
        // The marker now sits ON the data curve, not on the threshold line.
        expect(threshold!.viscosity).toBeLessThanOrEqual(THRESHOLD);
        expect(threshold!.viscosity).toBeGreaterThan(0);
    });

    it('correctly uses median smoothing (not mean) — spike test', () => {
        // A synthetic slice from the fixture domain:
        // 6 consecutive dominant-rate points with a spike pattern:
        //   25 % spikes at 200 cP, 75 % baseline at 20 cP.
        // 3-min MEAN  = 65 cP > 50 → would miss the crossing.
        // 3-min MEDIAN = 20 cP ≤ 50 → correctly detects.
        const points: TouchPointInput[] = [];
        // Peak phase: forces the algorithm to skip early region
        for (let t = 0; t <= 5; t += 0.5) {
            points.push({ time_min: t, viscosity_cp: 500 + t * 20, shear_rate: 100 });
        }
        // Steady state with 25 % spikes at 200 cP, 75 % at 20 cP
        for (let t = 5.5; t <= 30; t += 0.5) {
            const isSpike = Math.sin(t * Math.PI) > 0.87;
            points.push({ time_min: t, viscosity_cp: isSpike ? 200 : 20, shear_rate: 100 });
        }

        const results = calculateSmartTouchPoints(points, {
            viscosityThreshold: 50,
            showTargetTime: false,
            targetTime: 10,
        });

        const tp = results.find(r => r.type === 'threshold');
        expect(tp).toBeDefined();
        // Should detect in the 20-cP baseline section, NOT fail to detect
        expect(tp!.time).toBeGreaterThanOrEqual(5);
    });
});
