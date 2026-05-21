// ============================================
// Core Data Types for RheoLab Enterprise
// ============================================
//
// Barrel module — re-exports from 5 domain modules. Import from this
// module from app code (`import type { ExperimentSavePayload } from '@/types'`)
// to keep existing call sites unchanged.

// Classification taxonomy
export type {
    FluidType,
    TestCategory,
    TestType,
    TestGroup,
    TestSubGroup,
} from './taxonomy';

// Raw rheology primitives
export type {
    RheoPoint,
    ColumnarData,
    ChartColumnarData,
    NumericColumn,
    NullableNumericColumn,
    RheoStep,
    GeometryParams,
} from './rheology';

// Derived metrics and model outputs
export type {
    HydrationMetrics,
    RheologyMetrics,
    DashboardMetrics,
    TestMetrics,
    ModelResult,
    PhysicsEngineResult,
    ExperimentReagentInput,
    CalibrationData,
} from './metrics';

// Experiment record + save payload
export type {
    Experiment,
    WaterParams,
    ExperimentSavePayload,
    RheologyParameterRow,
    RheologyParameterSource,
    LastContext,
} from './experiment';

// Parser layer
export type {
    ParseSummary,
    ParsedBy,
    ParseResult,
    RheoDataPoint,
    ParsingMetadata,
} from './parsing';
