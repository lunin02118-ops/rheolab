/**
 * @fileoverview WASM Engine Types — barrel re-export.
 *
 * All types are defined in focused sub-modules:
 * - {@link ./wasm-models}   — interfaces that mirror Rust/WASM data structures
 * - {@link ./report-inputs} — Excel/PDF report input types + chart settings
 *
 * Import directly from `types` to maintain backward compatibility with
 * existing import paths.
 *
 * @module report-types/types
 */

export * from './wasm-models';
export * from './report-inputs';
export * from './comparison-report-inputs';
