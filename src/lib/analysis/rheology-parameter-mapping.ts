import type { GraceCycleResult, RheoCycle } from '@/lib/analysis/types';
import type { RheologyParameterRow, RheologyParameterSource } from '@/types';

export interface CycleTimingMinutes {
    timeMin: number;
    endTimeMin: number;
}

export function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

export function finiteOr(value: number | null | undefined, fallback: number): number {
    return isFiniteNumber(value) ? value : fallback;
}

export function cycleTimingMinutes(cycle: RheoCycle | undefined): CycleTimingMinutes | null {
    if (!cycle) return null;
    const startSec = cycle.steps[0]?.startTime;
    const durationSec = Number.isFinite(cycle.duration) ? Math.max(0, cycle.duration) : 0;
    if (isFiniteNumber(startSec)) {
        return {
            timeMin: startSec / 60,
            endTimeMin: (startSec + durationSec) / 60,
        };
    }
    if (durationSec > 0) {
        return {
            timeMin: 0,
            endTimeMin: durationSec / 60,
        };
    }
    return null;
}

function normalizedViscosities(row: RheologyParameterRow): Record<number, number> {
    const viscosities: Record<number, number> = {};
    Object.entries(row.viscosities ?? {}).forEach(([rate, value]) => {
        const numericRate = Number(rate);
        if (Number.isFinite(numericRate) && isFiniteNumber(value)) {
            viscosities[numericRate] = value;
        }
    });
    return viscosities;
}

export function rheologyParameterRowToGraceCycleResult(
    row: RheologyParameterRow,
    timingFallback?: CycleTimingMinutes | null,
): GraceCycleResult {
    const rowTimeMin = isFiniteNumber(row.timeMin) ? row.timeMin : undefined;
    const rowEndTimeMin = isFiniteNumber(row.endTimeMin) ? row.endTimeMin : undefined;
    const timeMin = rowTimeMin
        ?? rowEndTimeMin
        ?? timingFallback?.timeMin
        ?? 0;
    const endTimeMin = rowEndTimeMin
        ?? rowTimeMin
        ?? timingFallback?.endTimeMin
        ?? timeMin;
    const viscosities = normalizedViscosities(row);

    return {
        cycleNo: row.cycleNo,
        timeMin,
        endTimeMin,
        timeSec: timeMin * 60,
        tempC: finiteOr(row.tempC, 25),
        pressure_bar: finiteOr(row.pressureBar, 0),
        n_prime: finiteOr(row.nPrime, NaN),
        Kv_PaSn: finiteOr(row.kvPaSn ?? row.kPrimePaSn, NaN),
        r2: finiteOr(row.r2, NaN),
        K_prime_PaSn: finiteOr(row.kPrimePaSn ?? row.kvPaSn, NaN),
        K_prime_slot_PaSn: finiteOr(row.kSlotPaSn, NaN),
        K_pipe_PaSn: finiteOr(row.kPipePaSn, NaN),
        viscosities,
        viscAt40: viscosities[40],
        viscAt100: viscosities[100],
        viscAt170: viscosities[170],
        bingham_PV_PaS: finiteOr(row.binghamPvPaS, NaN),
        bingham_YP_Pa: finiteOr(row.binghamYpPa, NaN),
        bingham_r2: finiteOr(row.binghamR2, NaN),
        calcPoints: Math.max(0, Math.round(finiteOr(row.calcPoints, 0))),
    };
}

export function graceCycleResultToRheologyParameterRow(
    result: GraceCycleResult,
    source: RheologyParameterSource = 'program',
): RheologyParameterRow {
    const viscosities: Record<string, number> = {};
    Object.entries(result.viscosities ?? {}).forEach(([rate, value]) => {
        if (Number.isFinite(Number(value))) {
            viscosities[String(rate)] = Number(value);
        }
    });

    return {
        source,
        cycleNo: result.cycleNo,
        timeMin: result.timeMin,
        endTimeMin: result.endTimeMin,
        tempC: result.tempC,
        pressureBar: result.pressure_bar,
        nPrime: result.n_prime,
        kvPaSn: result.Kv_PaSn,
        kPrimePaSn: result.K_prime_PaSn,
        kSlotPaSn: result.K_prime_slot_PaSn,
        kPipePaSn: result.K_pipe_PaSn,
        r2: result.r2,
        viscosities,
        binghamPvPaS: result.bingham_PV_PaS,
        binghamYpPa: result.bingham_YP_Pa,
        binghamR2: result.bingham_r2,
        calcPoints: result.calcPoints,
        units: {
            consistency: 'Pa*s^n',
            viscosity: 'cP',
            binghamPv: 'Pa*s',
            binghamYp: 'Pa',
        },
    };
}
