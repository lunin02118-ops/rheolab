# Memory Hardening - Raw Table Paging

**Date:** 2026-04-30.
**Track:** MEM-3.
**Status:** implementation validation.

## Goal

Saved-experiment raw table viewing should no longer force the dashboard to
load full `rawPoints` into the WebView. The table tab now requests bounded
pages by experiment id while the unsaved-upload flow keeps the existing
in-memory table path.

## Implemented Path

```text
Dashboard metadata-only saved detail
  -> table tab
  -> experiments_raw_table_page_by_id(experimentId, page, pageSize)
  -> Rust reads ExperimentData.dataBlob
  -> Rust decodes columnar data server-side
  -> Rust returns only pageSize rows
  -> renderer stores current page only
```

The command caps `pageSize` at 500 rows. The default dashboard table page uses
25 rows.

## Scope Boundary

This slice removes the full raw-data IPC/render-state requirement for saved
experiment table viewing. Rust still decodes the experiment's columnar blob to
serve the requested page; that keeps the UX and data semantics stable while
preventing full-array transfer and retention in the renderer.

## Validation

Targeted checks:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml raw_table_page --lib
npm test -- --run tests/components/raw-data-table-by-id.test.tsx tests/components/DashboardContent.test.tsx tests/experiments/client.test.ts
```

Coverage:

- `load_raw_table_page_by_id` returns the requested columnar page.
- Missing experiments return a typed empty/error response.
- Metadata-only dashboard table tab renders `RawDataTableById`.
- Metadata-only table tab does not call `onRequireFullData`.
- Frontend experiment client routes `getRawTablePageById` through the platform bridge.

## Remaining Memory Work

- MEM-4: keep binary chart series as typed arrays end to end.
- MEM-5: wire zoom/pan to `experiments_series_window`.
- MEM-6: add runtime retention/cache policies.
- MEM-7: repeat memory p50/p95 measurements after all memory hardening slices.
