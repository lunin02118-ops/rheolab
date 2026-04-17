/**
 * Rheology Data Types
 */

export interface RheoPoint {
    time_sec: number;
    viscosity_cp: number;
    temperature_c: number;
    shear_rate?: number;
    shear_stress?: number;
    pressure_bar?: number;
    rpm?: number;
}

/**
 * Represents a step in the rheological schedule (constant shear rate period)
 */
export interface RheoStep {
    id: number;
    startTime: number;
    endTime: number;
    duration: number;
    avgShearRate: number;
    avgShearStress: number;
    avgViscosity: number;
    avgTemperature: number;
    avgPressure: number;
    points: RheoPoint[];
    calcPointsCount: number;
    isRamp: boolean;
    startIndex: number;
    endIndex: number;
    isSplitStart?: boolean; // True if this is the START segment of a split mixing step
}

/**
 * Represents a rheological cycle (group of steps)
 */
export interface RheoCycle {
    id: number;
    cycleIndex?: number; // 1-based for ISO/API cycles
    type: 'ISO' | 'API' | 'Custom' | 'SST' | 'Mixing';
    steps: RheoStep[];
    description: string;
    models?: CycleModels;
    duration: number;
    isSST?: boolean;
}

/**
 * Model results for a cycle
 */
export interface CycleModels {
    powerLaw: {
        n: number;      // Flow behavior index
        k: number;      // Consistency index (Pa·s^n)
        k_ind?: number; // Corrected K
        k_slot?: number;
        r2: number;
    };
    bingham: {
        pv: number;     // Plastic viscosity (Pa·s)
        yp: number;     // Yield point (Pa)
        r2: number;
    };
    viscosities: {
        [rate: number]: number; // Viscosity at shear rate (cP)
    };
}

export interface ExpertSettings {
    pointsToAverage: number; // 0 = All, N > 0 = Last N points
    kIndexType: 'Kv' | 'K_ind' | 'K_slot' | 'K_pipe';
    viscosityShearRates: number[];
    stepSplitting: boolean;
    splitStartDuration: number;
    splitEndDuration: number;
    minDurationForSplit: number;
}

export interface GraceCycleResult {
    cycleNo: number;
    timeMin: number;
    endTimeMin: number;
    timeSec: number;
    tempC: number;
    pressure_bar: number;

    // Power Law
    n_prime: number;
    Kv_PaSn: number;
    r2: number;
    K_prime_PaSn: number;
    K_prime_slot_PaSn: number;
    K_pipe_PaSn: number;

    // Viscosities
    viscosities: { [rate: number]: number };
    viscAt40?: number;
    viscAt100?: number;
    viscAt170?: number;

    // Bingham
    bingham_PV_PaS: number;
    bingham_YP_Pa: number;
    bingham_r2: number;

    calcPoints: number;
}

export interface ModelResult {
    modelName: string;
    parameters: { [key: string]: number };
    r2: number;
}

export interface PhysicsEngineResult {
    bingham: ModelResult;
    powerLaw: ModelResult;
}

export interface ScheduleConfig {
    shearRateTolerance: number;
    shearRateRelTolerance: number;
    minStepDuration: number;
    stepSplitting: boolean;
    splitStartDuration: number;
    splitEndDuration: number;
    minDurationForSplit: number;
}

/**
 * Settings for step detection — matches ScheduleConfig but with optional
 * tolerance/duration fields (defaults are applied in the IPC layer).
 */
export type DetectionSettingsInput = {
    shearRateTolerance?: number;
    shearRateRelTolerance?: number;
    minStepDuration?: number;
    stepSplitting: boolean;
    splitStartDuration: number;
    splitEndDuration: number;
    minDurationForSplit: number;
};

/** Result shape returned by full analysis and regroup-by-pattern pipelines. */
export interface AnalysisResult {
    cycles: RheoCycle[];
    results: Map<number, GraceCycleResult>;
    allSteps: RheoStep[];
}
