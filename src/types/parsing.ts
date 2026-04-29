/**
 * Parser-layer types: parse results, summary statistics, and the AI-mapper
 * diagnostics surface.
 */
import type { ColumnarData } from './rheology';

// Re-export from the parser module for convenience.
export type { RheoDataPoint, ParsingMetadata } from '@/lib/parsing/types';

/**
 * Summary statistics for parsed data.
 */
export interface ParseSummary {
    pointCount: number;
    timeRange?: { start: number; end: number; durationMinutes: number };
    viscosityRange?: { min: number; max: number; avg?: number };
    temperatureRange?: { min: number; max: number; avg?: number };
    pressureRange?: { min: number; max: number };
}

/** Which parser backend produced the result. */
export type ParsedBy = 'native' | 'wasm' | 'legacy-api';

/**
 * Parse result from Smart Ingestion (unified type).
 * Uses RheoDataPoint (all required fields) for API compatibility.
 */
export interface ParseResult {
    success: boolean;
    source: 'regex' | 'ai';
    /** Which parser backend produced the result */
    parsedBy?: ParsedBy;
    /** Non-fatal warnings accumulated during parsing (e.g. fallback transitions) */
    warnings?: string[];
    data: import('@/lib/parsing/types').RheoDataPoint[];
    columnarData?: ColumnarData;
    metadata: {
        filename: string;
        /** Present when the result was loaded from the local experiment DB. */
        experimentId?: string;
        sheetName?: string;
        instrumentType?: string;
        geometry?: string;
        geometrySource?: 'context' | 'loose' | 'physics' | 'default';
        shearRateRecovered?: boolean;
        speedRecovered?: boolean;
        usedAI?: boolean;
        aiDiagnostics?: {
            attempted: boolean;
            provider: string;
            model: string;
            promptVersion: string;
            candidateCount: number;
            selectedCandidate?: number;
            status: 'accepted' | 'failed' | 'rejected';
            failureReason?: string;
            appliedMapping?: Array<{
                field: string;
                index: number;
                confidence?: number;
            }>;
        };
        aiDetails?: {
            keyUsed?: string;
            tokenUsage?: {
                prompt: number;
                completion: number;
                total: number;
            };
            model?: string;
            error?: string;
            cached?: boolean;
        };
        hasShearRateIssue?: boolean;
        testDate?: Date;
        filenameMetadata?: {
            testId?: string;
            testType?: string;
            testTypeFull?: string;
            fieldName?: string;
            wellNumber?: string;
            operatorName?: string;
            waterSource?: string;
            savedExperimentName?: string;
            destination?: string;
            temperature?: number;
            laboratoryName?: string;
            recipe?: Array<{
                abbreviation: string;
                concentration: number;
                unit: string;
                category?: string;
                reagentId?: string;
                reagentName?: string;
            }>;
        };
        calibration?: {
            deviceType: string;
            rSquared: number;
            slope: number;
            intercept: number;
            hysteresis: number;
            stdev: number;
            status: 'PASS' | 'FAIL';
            lastCalDate?: string;
            calibrationDate?: Date | null;
            issues: string[];
            rawData: string;
        };
        /** Parser engine that produced this result — V8 round-trip field */
        parsedBy?: string;
        /** Source file/path used during parsing — V8 round-trip field */
        parseSource?: string;
    };
    summary: ParseSummary;
}
