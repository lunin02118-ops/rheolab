# Archived E2E Specs

These tests were moved here during the Wave 1 code hygiene audit (2026-02-21).

## Why archived?

All files in this directory were excluded from the main `playwright.config.ts`
`testIgnore` list because they depend on the old `utils.ts` helpers
(`setupDashboard`, `loginAsAdmin`, `waitForAnalysisComplete`) instead of the
current `base-test.ts` infrastructure.

## Status

| File | Reason archived | Restore path |
|------|----------------|--------------|
| `analysis_pipeline.spec.ts` | Old utils.ts | Migrate to base-test.ts |
| `comparison-memory-soak.spec.ts` | Slow soak (already on base-test.ts) | Add to perf config |
| `csharp-ui-parity.spec.ts` | Old utils.ts | Migrate to base-test.ts |
| `geometry-save-load.test.ts` | Needs auth state setup | Configure PW auth + migrate |
| `pdf_export.test.ts` | Old utils.ts | Migrate to base-test.ts |
| `report-combinations.spec.ts` | Old utils.ts | Migrate to base-test.ts |
| `report_generation.test.ts` | Old utils.ts | Migrate to base-test.ts |
| `wasm_workflow.test.ts` | Old utils.ts | Migrate to base-test.ts |
| `workflow-critical.spec.ts` | Old utils.ts | Migrate to base-test.ts |

`debug-license.spec.ts` — deleted (debug utility, not a real test scenario).
