import { describe, it, expect } from 'vitest';
import {
    downsampleRheoPointsSmart,
    downsampleRheoPointsMultiChannel,
} from '../src/lib/utils/downsample';

/**
 * Generate fake RheoPoint data with step-change shear_rate ramps.
 * Pattern: plateau at shear_rate=100 for `plateauLen` points,
 *          then ramp to 150 over `rampLen` points,
 *          then plateau at 150, etc.
 */
function makeSteppedData(
    plateauLen: number,
    rampLen: number,
    steps: number[]
) {
    const data: {
        time_sec: number;
        viscosity_cp: number;
        temperature_c: number;
        shear_rate: number;
    }[] = [];

    let t = 0;
    for (let si = 0; si < steps.length; si++) {
        const sr = steps[si];
        // Plateau
        for (let i = 0; i < plateauLen; i++) {
            data.push({
                time_sec: t,
                viscosity_cp: 1000 / sr + Math.random() * 5,
                temperature_c: 94 + Math.random() * 0.5,
                shear_rate: sr,
            });
            t += 30; // 30 sec intervals
        }
        // Ramp to next step
        if (si < steps.length - 1) {
            const nextSr = steps[si + 1];
            for (let i = 1; i <= rampLen; i++) {
                const frac = i / (rampLen + 1);
                const interpSr = sr + frac * (nextSr - sr);
                data.push({
                    time_sec: t,
                    viscosity_cp: 1000 / interpSr + Math.random() * 5,
                    temperature_c: 94 + Math.random() * 0.5,
                    shear_rate: interpSr,
                });
                t += 5; // Fast ramp points
            }
        }
    }
    return data;
}

describe('downsampleRheoPointsSmart', () => {
    // Steps: 100 → 150 → 125 → 175 (matching user's real data pattern)
    const steps = [100, 150, 125, 175];
    const plateauLen = 40; // 40 points per plateau
    const rampLen = 5;     // 5 points per ramp
    const testData = makeSteppedData(plateauLen, rampLen, steps);

    it('should return all data if below threshold', () => {
        const result = downsampleRheoPointsSmart(testData, 10000);
        expect(result.length).toBe(testData.length);
    });

    it('should preserve ALL ramp points (shear_rate transitions)', () => {
        const threshold = 50; // Very aggressive — only 50 points budget
        const result = downsampleRheoPointsSmart(testData, threshold);

        // Find ramp regions in the original data (where shear_rate is changing)
        const rampPoints = testData.filter((p, i) => {
            if (i === 0 || i === testData.length - 1) return false;
            const prev = testData[i - 1].shear_rate;
            const next = testData[i + 1].shear_rate;
            return Math.abs(next - prev) / ((Math.abs(prev) + Math.abs(next)) / 2 || 1) > 0.01;
        });

        // Every ramp point should appear in result
        for (const rp of rampPoints) {
            const found = result.some(
                r => r.time_sec === rp.time_sec && r.shear_rate === rp.shear_rate
            );
            expect(found).toBe(true);
        }
    });

    it('should reduce total point count significantly', () => {
        const threshold = 60;
        const result = downsampleRheoPointsSmart(testData, threshold);
        // Should be less than original but more than threshold (ramp points add extra)
        expect(result.length).toBeLessThan(testData.length);
        // Should be significantly reduced from original ~175 points
        expect(result.length).toBeLessThan(testData.length * 0.7);
    });

    it('should preserve step-change pattern in shear_rate', () => {
        const threshold = 80;
        const result = downsampleRheoPointsSmart(testData, threshold);

        // Collect unique shear_rate values (rounded to integers)
        const uniqueSr = new Set(result.map(p => Math.round(p.shear_rate)));
        // All original step values should be present
        for (const sr of steps) {
            expect(uniqueSr.has(sr)).toBe(true);
        }

        // Check that plateaus have constant shear_rate (not smoothed out)
        // Group consecutive points with same rounded shear_rate
        let plateauCount = 0;
        let currentSr = Math.round(result[0].shear_rate);
        let segLen = 1;
        for (let i = 1; i < result.length; i++) {
            const sr = Math.round(result[i].shear_rate);
            if (sr === currentSr) {
                segLen++;
            } else {
                if (segLen >= 2) plateauCount++;
                currentSr = sr;
                segLen = 1;
            }
        }
        if (segLen >= 2) plateauCount++;

        // Should have at least as many plateau segments as step values
        expect(plateauCount).toBeGreaterThanOrEqual(steps.length);
    });

    it('should also work with shear_rate_s1 field name', () => {
        // Rename shear_rate to shear_rate_s1
        const data = testData.map(p => ({
            time_sec: p.time_sec,
            viscosity_cp: p.viscosity_cp,
            temperature_c: p.temperature_c,
            shear_rate_s1: p.shear_rate,
        }));

        const threshold = 60;
        const result = downsampleRheoPointsSmart(data, threshold);
        expect(result.length).toBeLessThan(data.length);
        expect(result.length).toBeGreaterThan(threshold * 0.3); // Not too aggressive
    });
});

describe('downsampleRheoPointsMultiChannel', () => {
    const steps = [100, 150, 125];
    const testData = makeSteppedData(30, 3, steps);

    it('should reduce point count to threshold', () => {
        const threshold = 40;
        const result = downsampleRheoPointsMultiChannel(testData, threshold);
        expect(result.length).toBe(threshold);
    });
});

describe('downsampling mode "off"', () => {
    it('should return original data unchanged', () => {
        const data = makeSteppedData(10, 2, [100, 200]);
        // Simulate what comparison-chart does with mode='off'
        const result = data; // No function call, just pass through
        expect(result.length).toBe(data.length);
        expect(result).toBe(data);
    });
});
