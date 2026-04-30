# ReportTab By-ID Hardening

**Scope:** RC memory-hardening follow-up after binary chart, by-id analysis,
raw table paging, and comparison export cleanup.

## Goal

Saved experiment ReportTab should not force the dashboard to load the full
`experiments_get` payload just to export PDF/XLSX. The renderer keeps metadata,
settings, and user-visible recipe/water overrides; Rust loads heavy raw series
from SQLite and runs/caches analysis by experiment id.

## Changes

- Added native IPC:
  - `reports_generate_pdf_by_id`
  - `reports_generate_excel_by_id`
- Both commands validate `experimentId`, report settings, recipe/water override
  bounds, and per-format license features.
- Both commands run through the runtime job scheduler as `SinglePdf` /
  `SingleExcel`, return binary `tauri::ipc::Response`, and reuse the existing
  AnalysisArtifact cache path.
- The frontend ReportTab now uses the by-id export path when opened from a
  metadata-only saved experiment.
- The metadata-only report tab no longer calls `onRequireFullData` and no
  longer shows the "load full dataset" spinner.
- Recipe and water overrides are sent as bounded lightweight metadata so the
  by-id path preserves user-visible edits without sending raw points.

## Non-Claims

- This does not remove full raw data from the Save dialog. Save still lazy-loads
  full data when needed.
- This does not claim a hard Total RSS reduction. It removes one app-controlled
  route that could rematerialize full raw points in renderer state.

## Validation

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib commands::reports
npm test -- --run tests/components/DashboardContent.test.tsx tests/reports/client.test.ts tests/tauri/index.test.ts tests/performance/report-tab-perf.test.tsx tests/performance/dashboard-tabs-perf.test.tsx
npm run build:ci
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run version:validate
npm run audit:large-ipc
git diff --check
```

Expected behavioral proof:

- `DashboardContent` renders saved metadata-only ReportTab by id.
- `onRequireFullData` is not called when switching to saved ReportTab.
- PDF/XLSX by-id bridge methods route to `reports_generate_*_by_id`.
- Rust by-id report builder loads from DB and applies recipe/water overrides.
