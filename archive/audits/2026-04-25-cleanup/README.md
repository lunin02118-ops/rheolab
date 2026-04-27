# Audit Archive - 2026-04-25 Cleanup

This archive contains audit and report artifacts moved out of active working folders on 2026-04-25.

## Current Sources Left Active

- [`runtime/qa-reports/deep-audit-waves-2026-04-25.md`](../../../runtime/qa-reports/deep-audit-waves-2026-04-25.md) - authoritative codebase audit for `main` at `6b0f0991e00cce45c0a65ccbc9de6860c85b4929`.
- [`docs/performance/FRONTEND-IPC-DEEP-AUDIT-2026-04-25.md`](../../../docs/performance/FRONTEND-IPC-DEEP-AUDIT-2026-04-25.md) and `FRONTEND-IPC-DEEP-AUDIT-LATEST.md` - active frontend/IPC snapshot.
- [`docs/performance/memory-performance-report-2026-04-25.md`](../../../docs/performance/memory-performance-report-2026-04-25.md) - active Tauri soak memory snapshot.
- [`runtime/audit/2026-04-25-enterprise-deep-audit/`](../../../runtime/audit/2026-04-25-enterprise-deep-audit/) - current enterprise audit artifacts.
- [`runtime/audit/20260425-100230942-frontend-ipc-deep-audit/`](../../../runtime/audit/20260425-100230942-frontend-ipc-deep-audit/) - current frontend/IPC audit artifacts.

## Why These Files Were Archived

- Reports dated before 2026-04-25 were superseded by the fresh multi-wave audit.
- Several older reports include stale metrics: outdated test counts, command counts, bundle names, release verdicts, or pre-fix findings.
- `runtime/qa-reports/audit-2026-04-25/AUDIT-REPORT.md` was archived despite the same date because it references commit `94c16713` and says "Production-ready"; the later authoritative audit references commit `6b0f0991` and marks quality gates RED.
- Runtime wrapper logs and older `runtime/audit` / `outputs/audit` runs were moved to keep active audit folders focused on the current evidence set.

## Archived Inventory

- `docs/audit/`: 8 historical markdown audit documents.
- `docs/performance/`: 7 superseded performance/memory audit reports.
- `runtime/`: 170 old audit logs, QA summaries, GEO audit outputs, wrapper logs, and superseded run artifacts.
- `outputs/`: 43 files from the 2026-04-24 audit bundle.

Total moved files: 228.
