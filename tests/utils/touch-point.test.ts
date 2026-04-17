import { describe, it, expect } from 'vitest';
import {
    type TouchPointInput,
    findDominantShearRate,
    filterByShearRate,
    findViscosityPeak,
    calculateSmartTouchPoints,
} from '@/lib/utils/touch-point';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pt(time_min: number, viscosity_cp: number, shear_rate: number = 100): TouchPointInput {
    return { time_min, viscosity_cp, shear_rate };
}

/**
 * Generate a simple ramp-up-then-decay curve.
 * @param main_rate – shear rate for all points
 * @param peak_time – time at which peak occurs
 * @param peak_visc – peak viscosity
 * @param step – time step in minutes
 * @param count – total number of points
 */
function rampUpDecay(
    main_rate: number,
    peak_time: number,
    peak_visc: number,
    step: number,
    count: number,
): TouchPointInput[] {
    const result: TouchPointInput[] = [];
    for (let i = 0; i < count; i++) {
        const t = i * step;
        let v: number;
        if (t <= peak_time) {
            v = peak_visc * 0.3 + (peak_visc * 0.7 * t) / peak_time; // ramp-up
        } else {
            v = peak_visc - (peak_visc * 0.6 * (t - peak_time)) / ((count - 1) * step - peak_time); // decay
        }
        result.push(pt(t, v, main_rate));
    }
    return result;
}

// ─── findDominantShearRate ───────────────────────────────────────────────────

describe('findDominantShearRate', () => {
    it('returns null when no shear-rate data (all zeros)', () => {
        const points = [pt(0, 500, 0), pt(1, 400, 0)];
        expect(findDominantShearRate(points)).toBeNull();
    });

    it('returns null for empty array', () => {
        expect(findDominantShearRate([])).toBeNull();
    });

    it('finds single cluster', () => {
        const points = [
            pt(0, 1000, 100),
            pt(1, 900, 101),
            pt(2, 800, 99),
            pt(3, 700, 100),
        ];
        const rate = findDominantShearRate(points)!;
        expect(rate).toBeGreaterThanOrEqual(99);
        expect(rate).toBeLessThanOrEqual(101);
    });

    it('picks the bigger cluster when there are two groups', () => {
        // 5 points at ~100, 2 points at ~200
        const points = [
            pt(0, 1000, 100), pt(1, 900, 101), pt(2, 800, 99),
            pt(3, 700, 100), pt(4, 600, 102),
            pt(5, 500, 200), pt(6, 400, 201),
        ];
        const rate = findDominantShearRate(points)!;
        expect(rate).toBeGreaterThanOrEqual(99);
        expect(rate).toBeLessThanOrEqual(102);
    });

    it('ignores zero shear rates when clustering', () => {
        const points = [
            pt(0, 1000, 0), pt(1, 900, 0), pt(2, 800, 0),   // zeros — ignored
            pt(3, 700, 50), pt(4, 600, 51),                   // small cluster
        ];
        const rate = findDominantShearRate(points)!;
        expect(rate).toBeGreaterThanOrEqual(50);
        expect(rate).toBeLessThanOrEqual(51);
    });
});

// ─── filterByShearRate ───────────────────────────────────────────────────────

describe('filterByShearRate', () => {
    it('keeps only points within ±tolerance', () => {
        const points = [
            pt(0, 1000, 100),
            pt(1, 900, 200),   // ramp — should be excluded
            pt(2, 800, 102),
            pt(3, 700, 98),
            pt(4, 600, 50),    // too low — excluded
        ];
        const filtered = filterByShearRate(points, 100, 0.05);
        expect(filtered).toHaveLength(3);
        expect(filtered.map(p => p.time_min)).toEqual([0, 2, 3]);
    });

    it('returns empty array when nothing matches', () => {
        const points = [pt(0, 1000, 200), pt(1, 900, 300)];
        expect(filterByShearRate(points, 100, 0.05)).toHaveLength(0);
    });

    it('handles tolerance correctly at boundary', () => {
        // 100 * 1.05 = 105 → 105 should be included, 106 excluded
        const points = [pt(0, 1000, 105), pt(1, 900, 106)];
        const filtered = filterByShearRate(points, 100, 0.05);
        expect(filtered).toHaveLength(1);
        expect(filtered[0].time_min).toBe(0);
    });

    it('keeps all dominant-rate points including those near ramps', () => {
        // Simple ±5% filter — ramp (non-dominant) points are excluded,
        // all dominant-rate points are kept regardless of proximity to ramps.
        // findViscosityPeak handles the transient-viscosity issue downstream.
        const points = [
            pt(0.0, 1000, 170),   // dominant
            pt(1.0, 980, 170),    // dominant
            pt(1.90, 600, 40),    // ramp — excluded
            pt(1.95, 550, 40),    // ramp — excluded
            pt(2.00, 300, 168),   // dominant (within ±5%)
            pt(2.05, 280, 170),   // dominant
            pt(3.00, 450, 170),   // dominant
        ];
        const filtered = filterByShearRate(points, 170, 0.05);
        // All dominant-rate points kept, ramp points excluded
        expect(filtered).toHaveLength(5);
        expect(filtered.map(p => p.time_min)).toEqual([0.0, 1.0, 2.00, 2.05, 3.00]);
    });
});

// ─── findViscosityPeak ───────────────────────────────────────────────────────

describe('findViscosityPeak', () => {
    it('returns null for fewer than 2 points', () => {
        expect(findViscosityPeak([pt(0, 500)])).toBeNull();
        expect(findViscosityPeak([])).toBeNull();
    });

    it('returns null when data span is shorter than one window', () => {
        const points = [pt(0, 500), pt(0.5, 600)]; // 0.5 min < 1 min window
        expect(findViscosityPeak(points)).toBeNull();
    });

    it('returns peak at very start for monotonically falling viscosity', () => {
        const points: TouchPointInput[] = [];
        for (let i = 0; i < 20; i++) {
            points.push(pt(i * 0.5, 1000 - i * 30));
        }
        // Monotonically falling → decline detected from the start → peak at beginning
        const peak = findViscosityPeak(points);
        expect(peak).not.toBeNull();
        expect(peak!).toBeLessThan(1.0); // near start
    });

    it('returns null for monotonically rising viscosity', () => {
        const points: TouchPointInput[] = [];
        for (let i = 0; i < 20; i++) {
            points.push(pt(i * 0.5, 300 + i * 50));
        }
        expect(findViscosityPeak(points)).toBeNull();
    });

    it('detects peak for ramp-up-then-decay data', () => {
        // Peak around t=5, then decay
        const points: TouchPointInput[] = [];
        for (let i = 0; i < 30; i++) {
            const t = i * 0.5; // 0..15 min
            let v: number;
            if (t < 5) {
                v = 500 + t * 100; // rising to 1000
            } else {
                v = 1000 - (t - 5) * 50; // falling
            }
            points.push(pt(t, v));
        }
        const peak = findViscosityPeak(points, 1.0);
        expect(peak).not.toBeNull();
        expect(peak!).toBeGreaterThanOrEqual(3);
        expect(peak!).toBeLessThanOrEqual(7);
    });

    it('ignores gap-induced decline between shear-rate segments', () => {
        // Simulates filtered 100 s⁻¹ data from a multi-rate experiment:
        //  Segment 1: t=4..8, viscosity rising 300→1000
        //  GAP (511 s⁻¹ phase, filtered out): t=8..12, no data
        //  Segment 2: t=12..20, viscosity 400→900 overshoot→870→850→830→...
        // The gap from t=8 to t=12 causes window averages to drop from
        // ~1000 to ~400, which looks like a decline but is an artefact.
        // After that, the overshoot at t≈13.5 produces 2 consecutive window
        // declines (overshoot peak → oscillation dips).
        // The TRUE peak should be found only when genuine sustained decline
        // happens WITHIN a contiguous segment.
        const points: TouchPointInput[] = [];
        // Segment 1: rising
        for (let t = 4; t <= 8; t += 0.1) {
            points.push(pt(t, 300 + (t - 4) * 175)); // 300 at t=4, 1000 at t=8
        }
        // GAP: no points from t=8 to t=12
        // Segment 2: recovery overshoot then slow decline
        for (let t = 12; t <= 20; t += 0.1) {
            const dt = t - 12;
            let v: number;
            if (dt < 1.5) {
                v = 400 + dt * 400; // recovery: 400 → 1000 (overshoot)
            } else {
                v = 1000 - (dt - 1.5) * 30; // slow decline: 1000 → 745 at t=20
            }
            points.push(pt(t, v));
        }

        const peak = findViscosityPeak(points, 1.0);
        // Peak should be in segment 2 around the overshoot (t≈13-14),
        // NOT triggered by the gap-induced decline between segments.
        // Before the fix, it would return a peak near t=8 (artefact).
        expect(peak).not.toBeNull();
        expect(peak!).toBeGreaterThanOrEqual(12.5);
    });
});

// ─── calculateSmartTouchPoints ───────────────────────────────────────────────

describe('calculateSmartTouchPoints', () => {
    it('returns empty array for empty input', () => {
        const result = calculateSmartTouchPoints([], {
            viscosityThreshold: 500,
            showTargetTime: false,
            targetTime: 10,
        });
        expect(result).toHaveLength(0);
    });

    it('finds threshold crossing on simple falling data', () => {
        const points: TouchPointInput[] = [];
        for (let i = 0; i < 30; i++) {
            const t = i;
            points.push(pt(t, 1000 - t * 25, 100));
        }
        // viscosity drops from 1000 to 275 over 30 min
        // crosses 500 at t = 20, then stays below: 475, 450, 425, 400, 375...
        const result = calculateSmartTouchPoints(points, {
            viscosityThreshold: 500,
            showTargetTime: false,
            targetTime: 10,
        });
        const threshold = result.find(r => r.type === 'threshold');
        expect(threshold).toBeDefined();
        expect(threshold!.time).toBeGreaterThan(18);
        expect(threshold!.time).toBeLessThan(22);
    });

    it('threshold crossing is found AFTER peak (not during ramp-up)', () => {
        // Ramp-up: 0-5 min, 300 → 1000 cP
        // Decay:   5-20 min, 1000 → 400 cP → crosses 500 at ~13.3 min
        const points = rampUpDecay(100, 5, 1000, 0.5, 40);
        const result = calculateSmartTouchPoints(points, {
            viscosityThreshold: 500,
            showTargetTime: false,
            targetTime: 10,
        });
        const threshold = result.find(r => r.type === 'threshold');
        expect(threshold).toBeDefined();
        // Must be after peak (t=5), not during ramp-up phase
        expect(threshold!.time).toBeGreaterThan(5);
    });

    it('does NOT trigger on ramp at different shear rate', () => {
        // Main speed 100 s⁻¹: ramp-up then slow decay, staying above 500 cP
        // Ramp at 200 s⁻¹ at t=7: viscosity drops to 400 → should be IGNORED
        // Real crossing at 100 s⁻¹ at t=13, sustained for 5+ points
        const points: TouchPointInput[] = [
            pt(0, 800, 100), pt(1, 900, 100), pt(2, 1000, 100),
            pt(3, 1050, 100), pt(4, 1000, 100), pt(5, 950, 100),
            pt(6, 900, 100),
            // Ramp at 200 → drops below threshold (must be ignored)
            pt(7, 400, 200), pt(7.5, 350, 200),
            // Back to 100
            pt(8, 850, 100), pt(9, 800, 100), pt(10, 750, 100),
            pt(11, 700, 100), pt(12, 600, 100),
            pt(13, 500, 100), pt(14, 480, 100), pt(15, 460, 100),
            pt(16, 440, 100), pt(17, 420, 100), pt(18, 400, 100),
        ];

        const result = calculateSmartTouchPoints(points, {
            viscosityThreshold: 500,
            showTargetTime: false,
            targetTime: 10,
        });
        const threshold = result.find(r => r.type === 'threshold');
        expect(threshold).toBeDefined();
        // Should NOT be at t=7 (ramp); should be at ~t=13
        expect(threshold!.time).toBeGreaterThanOrEqual(12);
    });

    it('finds target-time point when showTargetTime is true', () => {
        const points = rampUpDecay(100, 5, 1000, 0.5, 40); // t: 0..19.5
        const result = calculateSmartTouchPoints(points, {
            viscosityThreshold: 500,
            showTargetTime: true,
            targetTime: 10,
        });
        const target = result.find(r => r.type === 'target');
        expect(target).toBeDefined();
        expect(target!.time).toBe(10);
        expect(target!.viscosity).toBeGreaterThan(0);
    });

    it('does NOT include target-time when showTargetTime is false', () => {
        const points = rampUpDecay(100, 5, 1000, 0.5, 40);
        const result = calculateSmartTouchPoints(points, {
            viscosityThreshold: 500,
            showTargetTime: false,
            targetTime: 10,
        });
        expect(result.find(r => r.type === 'target')).toBeUndefined();
    });

    it('works when all shear rates are 0 (no shear data, fallback)', () => {
        const points: TouchPointInput[] = [];
        for (let i = 0; i < 30; i++) {
            points.push(pt(i, 1000 - i * 25, 0));
        }
        const result = calculateSmartTouchPoints(points, {
            viscosityThreshold: 500,
            showTargetTime: false,
            targetTime: 10,
        });
        const threshold = result.find(r => r.type === 'threshold');
        expect(threshold).toBeDefined();
    });

    it('returns both threshold and target when applicable', () => {
        const points = rampUpDecay(100, 5, 1000, 0.5, 40);
        const result = calculateSmartTouchPoints(points, {
            viscosityThreshold: 500,
            showTargetTime: true,
            targetTime: 10,
        });
        expect(result).toHaveLength(2);
        expect(result.map(r => r.type).sort()).toEqual(['target', 'threshold']);
    });

    it('returns no threshold if viscosity never drops below threshold', () => {
        // Constant high viscosity
        const points = Array.from({ length: 20 }, (_, i) => pt(i, 900, 100));
        const result = calculateSmartTouchPoints(points, {
            viscosityThreshold: 500,
            showTargetTime: false,
            targetTime: 10,
        });
        expect(result.find(r => r.type === 'threshold')).toBeUndefined();
    });

    it('linearly interpolates threshold crossing time', () => {
        // Steady decline with enough points below threshold for sustained crossing
        const points = [
            pt(0, 1000, 100),
            pt(1, 1000, 100),
            pt(2, 1000, 100),
            pt(3, 1000, 100),
            pt(4, 1000, 100),
            pt(5, 900, 100),
            pt(6, 800, 100),
            pt(7, 700, 100),
            pt(8, 600, 100),
            pt(9, 500, 100),   // exactly at threshold
            pt(10, 480, 100),
            pt(11, 460, 100),
            pt(12, 440, 100),
            pt(13, 420, 100),
            pt(14, 400, 100),
        ];
        const result = calculateSmartTouchPoints(points, {
            viscosityThreshold: 500,
            showTargetTime: false,
            targetTime: 10,
        });
        const threshold = result.find(r => r.type === 'threshold');
        expect(threshold).toBeDefined();
        // First point at-or-below 500 is t=9 (500cP), and run of 6 confirms it
        expect(threshold!.time).toBeCloseTo(9, 0);
    });

    it('target-time interpolates viscosity between points', () => {
        // Points at t=9 (visc=800) and t=11 (visc=600)
        // At t=10 → expect ~700
        const points = [
            pt(0, 1000, 100), pt(1, 1000, 100), pt(2, 1000, 100),
            pt(3, 1000, 100), pt(4, 1000, 100), pt(5, 1000, 100),
            pt(6, 1000, 100), pt(7, 1000, 100), pt(8, 900, 100),
            pt(9, 800, 100), pt(11, 600, 100),
        ];
        const result = calculateSmartTouchPoints(points, {
            viscosityThreshold: 400,
            showTargetTime: true,
            targetTime: 10,
        });
        const target = result.find(r => r.type === 'target');
        expect(target).toBeDefined();
        expect(target!.time).toBe(10);
        expect(target!.viscosity).toBeCloseTo(700, 0);
    });

    it('handles single point input gracefully', () => {
        const result = calculateSmartTouchPoints([pt(5, 800, 100)], {
            viscosityThreshold: 500,
            showTargetTime: true,
            targetTime: 10,
        });
        // Single point: can't cross threshold (800 > 500), target time 10 > 5
        expect(result).toHaveLength(0);
    });

    it('handles multiple shear rate ramps during experiment', () => {
        // 100 s⁻¹ main, with ramps at 50 and 200 s⁻¹
        const points: TouchPointInput[] = [
            // Initial mixing at 100
            pt(0, 600, 100), pt(0.5, 700, 100), pt(1, 800, 100),
            pt(1.5, 900, 100), pt(2, 1000, 100), pt(2.5, 1050, 100),
            pt(3, 1000, 100), pt(3.5, 950, 100), pt(4, 900, 100),
            // Ramp DOWN to 50 → viscosity spikes up (shear-thinning fluid)
            pt(4.5, 1500, 50), pt(5, 1600, 50),
            // Back to 100
            pt(5.5, 850, 100), pt(6, 800, 100),
            // Ramp UP to 200 → viscosity drops
            pt(6.5, 300, 200), pt(7, 280, 200),
            // Back to 100 — sustained decline through threshold
            pt(7.5, 750, 100), pt(8, 700, 100), pt(8.5, 650, 100),
            pt(9, 600, 100), pt(9.5, 550, 100), pt(10, 500, 100),
            pt(10.5, 480, 100), pt(11, 460, 100), pt(11.5, 440, 100),
            pt(12, 420, 100),
        ];

        const result = calculateSmartTouchPoints(points, {
            viscosityThreshold: 500,
            showTargetTime: false,
            targetTime: 10,
        });
        const threshold = result.find(r => r.type === 'threshold');
        expect(threshold).toBeDefined();
        // Must ignore ramp at 200 (t=6.5, visc=300) and ramp at 50 (t=4.5)
        // Should find crossing at ~10 min
        expect(threshold!.time).toBeGreaterThanOrEqual(9);
    });

    it('ignores transient spikes below threshold (requires sustained crossing)', () => {
        // Viscosity hovers around 550-650, with brief dips below 500 that
        // are just anomalies (1-2 points), then a REAL sustained crossing later.
        const points: TouchPointInput[] = [
            pt(0, 800, 100), pt(1, 800, 100), pt(2, 800, 100),
            pt(3, 750, 100), pt(4, 700, 100), pt(5, 650, 100),
            // Anomaly dip 1 — single point below 500
            pt(6, 480, 100),
            pt(7, 620, 100), pt(8, 610, 100), pt(9, 600, 100),
            // Anomaly dip 2 — 2 points below 500 (3-point window median stays
            // below 500 for only 2 consecutive points, so MIN_CONSECUTIVE=3
            // is not triggered — both mean and median reject this transient).
            pt(10, 490, 100), pt(11, 470, 100),
            pt(12, 550, 100), pt(13, 540, 100),
            // Real sustained crossing — 5+ consecutive below 500
            pt(14, 500, 100), pt(15, 490, 100), pt(16, 480, 100),
            pt(17, 470, 100), pt(18, 460, 100), pt(19, 450, 100),
        ];

        const result = calculateSmartTouchPoints(points, {
            viscosityThreshold: 500,
            showTargetTime: false,
            targetTime: 10,
        });
        const threshold = result.find(r => r.type === 'threshold');
        expect(threshold).toBeDefined();
        // Must NOT be at t=6 (single spike) or t=10-11 (2-point dip)
        // Should be at t=14+ where the sustained crossing starts
        expect(threshold!.time).toBeGreaterThanOrEqual(13);
        expect(threshold!.time).toBeLessThanOrEqual(15);
    });

    it('target-time uses actual viscosity for SST (multi-rate) experiments', () => {
        // SST pattern: alternating low-rate (50 s⁻¹ → ~700 cP) and high-rate
        // (500 s⁻¹ → ~200 cP) phases.  Dominant rate is 50 (more points).
        // At t=10 the experiment is in a HIGH-rate phase (low viscosity ~200).
        // The marker must show ~200, NOT ~700 from nearest low-rate points.
        const points: TouchPointInput[] = [
            // Phase 1: low rate (dominant) — high viscosity
            pt(0, 700, 50), pt(1, 710, 50), pt(2, 720, 50),
            pt(3, 700, 50), pt(4, 690, 50), pt(5, 700, 50),
            pt(6, 710, 50), pt(7, 700, 50),
            // Phase 2: high rate — low viscosity  (t=8..12)
            pt(8, 250, 500), pt(9, 220, 500), pt(10, 200, 500),
            pt(11, 210, 500), pt(12, 190, 500),
            // Phase 3: back to low rate
            pt(13, 700, 50), pt(14, 710, 50), pt(15, 700, 50),
            pt(16, 690, 50), pt(17, 700, 50), pt(18, 710, 50),
        ];

        const result = calculateSmartTouchPoints(points, {
            viscosityThreshold: 500,
            showTargetTime: true,
            targetTime: 10,
        });
        const target = result.find(r => r.type === 'target');
        expect(target).toBeDefined();
        expect(target!.time).toBe(10);
        // Must reflect the actual viscosity at t=10 (200 cP), not the dominant-rate value (~700)
        expect(target!.viscosity).toBeLessThan(300);
        expect(target!.viscosity).toBeCloseTo(200, 0);
    });

    it('rejects threshold crossing on ascending viscosity trend (slope guard)', () => {
        // Simulates the Chandler 5550 multi-rate experiment:
        //   - 100 s⁻¹ segment 1: t=4..8, viscosity 300→1000 (rising)
        //   - GAP (511 s⁻¹ filtered out): t=8..12
        //   - 100 s⁻¹ segment 2: t=12..20, viscosity 200→900 (ascending recovery)
        //   - 100 s⁻¹ continuation: t=20..35, viscosity 900→400 (descending, crosses 500)
        // Threshold = 500.  Without slope guard, the algorithm would find the
        // crossing at t≈13 on the ascending recovery.  With the guard it must
        // skip that and find the real crossing on the descending part (~t=28).
        const points: TouchPointInput[] = [];

        // Segment 1: rising at 100 s⁻¹
        for (let t = 4; t <= 8; t += 0.1) {
            points.push(pt(t, 300 + (t - 4) * 175, 100));
        }
        // Segment 2: ascending recovery at 100 s⁻¹ (crosses 500 from below)
        for (let t = 12; t <= 20; t += 0.1) {
            const v = 200 + (t - 12) * 87.5; // 200 → 900
            points.push(pt(t, v, 100));
        }
        // Segment 3: descending at 100 s⁻¹ (crosses 500 from above)
        for (let t = 20.1; t <= 35; t += 0.1) {
            const v = 900 - (t - 20) * 30; // 900 → 450 at t=35
            points.push(pt(t, v, 100));
        }

        const result = calculateSmartTouchPoints(points, {
            viscosityThreshold: 500,
            showTargetTime: false,
            targetTime: 10,
        });
        const threshold = result.find(r => r.type === 'threshold');
        expect(threshold).toBeDefined();
        // Must be on the descending part (t > 20), NOT on the ascending recovery (t ≈ 15)
        expect(threshold!.time).toBeGreaterThan(20);
    });

    it('detects threshold crossing in large-amplitude oscillating gel (crosslinked/110°C fixture)', () => {
        // Reproduces the failure mode seen with the t-20.02.26-1 fixture:
        // a crosslinked fracturing gel at 110°C that oscillates with
        // amplitudes of 50–150 cP throughout 250 min.
        //
        // The KEY assertion: with MEAN-based smoothing the crossing would be
        // missed (mean is pulled above threshold by spikes), but MEDIAN-based
        // smoothing correctly detects it because the median ignores outlier spikes.
        //
        // Spike model matching the real fixture:
        //   ~25 % of points are spikes at 200 cP (periodic gel-break peaks)
        //   ~75 % of points are baseline at 20 cP (inter-spike low viscosity)
        //   3-min window MEAN  = 0.25 × 200 + 0.75 × 20 = 65 cP > 50 cP  ← WRONG
        //   3-min window MEDIAN = 20 cP ≤ 50 cP                             ← CORRECT
        //
        // Sampling: 0.5 min steps. Spikes occur every 2 min (1 in 4 points).
        const THRESHOLD = 50;
        const points: TouchPointInput[] = [];
        // High phase: 0–20 min, viscosity ramps up to 600 cP then back down
        for (let t = 0; t <= 20; t += 0.5) {
            const v = t <= 15 ? 250 + t * 23 : 600 - (t - 15) * 20;
            points.push(pt(t, Math.max(v, 200), 100));
        }
        // Oscillating decline: 20–180 min.  Baseline kept at a CONSTANT 80 cP
        // (well above 50 cP threshold) with 25 % periodic spikes at 200 cP.
        //   3-min median of window = 80 cP > 50  → no detection here (correct)
        //   3-min mean  of window = 0.25×200 + 0.75×80 = 110 cP > 50  → also no detection
        // Neither algorithm detects a crossing in this section.
        for (let t = 20.5; t <= 180; t += 0.5) {
            const isSpike = Math.sin(t * Math.PI) > 0.87; // top ~25 % of sine cycle
            points.push(pt(t, isSpike ? 200 : 80, 100));
        }
        // Final descent: 181–250 min.
        // 25 % of points are spikes at 200 cP; 75 % at 20 cP.
        // 3-min window MEAN  = 0.25×200 + 0.75×20 = 65 cP > 50  → mean MISSES crossing
        // 3-min window MEDIAN = 20 cP ≤ 50                        → median DETECTS ✓
        for (let t = 181; t <= 250; t += 0.5) {
            const isSpike = Math.sin(t * Math.PI) > 0.87;
            points.push(pt(t, isSpike ? 200 : 20, 100));
        }

        const result = calculateSmartTouchPoints(points, {
            viscosityThreshold: THRESHOLD,
            showTargetTime: false,
            targetTime: 10,
        });
        const threshold = result.find(r => r.type === 'threshold');
        expect(threshold).toBeDefined();
        // Crossing must be detected in the final descent (after t=180),
        // NOT in the oscillating decline where mean is still > 50 cP.
        expect(threshold!.time).toBeGreaterThanOrEqual(178);
        expect(threshold!.time).toBeLessThanOrEqual(200);
    });

    it('handles noisy oscillation around threshold (regression: smoothing fix)', () => {
        // Simulates real-world data where viscosity oscillates near the
        // threshold due to viscometer noise.  The old algorithm (strict
        // consecutive check) would fail because single spikes above threshold
        // reset the run counter, delaying detection by hundreds of minutes.
        //
        // Pattern: ramp-up 0–3 min, peak ~1100 cP, then noisy decline that
        // oscillates around 500 cP near t=10 min.
        const points: TouchPointInput[] = [];
        // Ramp-up phase
        for (let t = 0; t <= 3; t += 0.5) {
            points.push(pt(t, 300 + t * 250, 170));
        }
        // Decline phase: 1050 → ~500 over 3–10 min
        for (let t = 3.5; t <= 9.5; t += 0.5) {
            const base = 1050 - (t - 3) * 85;
            points.push(pt(t, base, 170));
        }
        // Noisy oscillation around 500 cP at t=10–15 min
        // This is the critical zone: noise causes values to alternate above/below 500
        const noisyValues = [
            510, 498, 502, 497, 505, 493, 501, 496, 508, 494,
            492, 503, 489, 497, 488, 485, 491, 483, 479, 476,
        ];
        for (let i = 0; i < noisyValues.length; i++) {
            points.push(pt(10 + i * 0.25, noisyValues[i], 170));
        }
        // Clear decline below threshold after oscillation zone
        for (let t = 15.5; t <= 25; t += 0.5) {
            points.push(pt(t, 470 - (t - 15.5) * 10, 170));
        }

        const result = calculateSmartTouchPoints(points, {
            viscosityThreshold: 500,
            showTargetTime: false,
            targetTime: 10,
        });
        const threshold = result.find(r => r.type === 'threshold');
        expect(threshold).toBeDefined();
        // Must detect crossing in the oscillation zone (t=10–13), NOT at t=15+
        expect(threshold!.time).toBeGreaterThanOrEqual(9);
        expect(threshold!.time).toBeLessThanOrEqual(14);
    });
});
