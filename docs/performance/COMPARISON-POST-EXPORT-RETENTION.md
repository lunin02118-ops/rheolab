# Comparison Post-Export Retention

**Scope:** RC hardening follow-up after the memory-hardening scorecard.

## Goal

Comparison renderer RSS remains the main memory watch item. This pass does not
promise a fixed MB reduction because WebView2/download/runtime retention is
partly outside app control. It makes post-export memory easier to diagnose and
removes app-controlled transient references where we can.

## Changes

- `useComparisonReportExport` now releases transient PDF/XLSX byte references
  and clears `cmp:` User Timing measures in every export `finally` block.
- The hook emits `rheolab:comparison-export-buffers-released` as a product-side,
  best-effort diagnostic signal after it has dropped local PDF/XLSX byte
  references; product logic must not depend on this event.
- Browser/e2e report download fallback now passes the `Uint8Array` directly to
  `Blob` instead of first copying it through `ArrayBuffer.slice`.
- The comparison smoke memory runner records `after_export_gc_hint` only when
  `COMPARISON_SMOKE_MEMORY_STEPS=1`. The hint dispatches a page cleanup event,
  clears comparison timing entries, requests CDP garbage collection, waits
  briefly, and then samples Win32 RSS.
- Comparison download assertions delete their temporary Playwright download
  artifact after measuring bytes.
- The Comparison page cleanup test now locks both route-leave cleanup paths:
  selected heavy data and selector cache.

## How To Run

```powershell
npm test -- --run tests/reports/useComparisonReportExport.test.ts tests/pages/comparison-page.cleanup.test.tsx
npm run perf:comparison:tauri:memory
```

Use the memory runner sidecar to compare these phases:

- `after_xlsx`
- `after_export_gc_hint`
- `after_route_leave`

Diagnostic event naming:

- `rheolab:comparison-export-buffers-released` comes from the product export
  hook after hook-owned byte references are cleared.
- `rheolab:comparison-export-cleanup` comes from the perf runner immediately
  before the CDP GC hint and RSS sample.

Interpretation:

- If `after_export_gc_hint` drops materially below `after_xlsx`, the export
  buffers were reclaimable and the remaining issue is GC/idle timing.
- If `after_export_gc_hint` stays high but `after_route_leave` drops, the
  mounted report/chart tab is the likely retained surface.
- If both stay high, treat WebView2/download manager/runtime retention as the
  next diagnostic target before changing product architecture.
