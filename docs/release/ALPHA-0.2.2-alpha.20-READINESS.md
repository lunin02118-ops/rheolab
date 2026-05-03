# Alpha 0.2.2-alpha.20 Readiness

Date: 2026-05-03

Base commit before alpha prep: `a459b71`.

## Verdict

GO for alpha `0.2.2-alpha.20`. Build and publish artifacts from a clean checkout after this readiness commit is on `main`.

The local gate is green. One Rust report test was fixed during this pass: the by-id XLSX test no longer compares raw XLSX ZIP bytes and instead validates workbook structure/content. The old assertion was brittle because equivalent XLSX files can differ at the byte level.

## Version

| File | Version |
| --- | --- |
| `version.json` | `0.2.2-alpha.20` |
| `package.json` | `0.2.2-alpha.20` |
| `src-tauri/tauri.conf.json` | `0.2.2-alpha.20` |
| `src-tauri/Cargo.toml` | `0.2.2-alpha.20` |
| `src/lib/version.ts` | `0.2.2-alpha.20` |
| Channel | `alpha` |

## Local Validation

| Check | Result | Notes |
| --- | --- | --- |
| `npm run version:validate` | PASS | All 4 generated dependents match `/version.json`. |
| `npm run typecheck` | PASS | TypeScript `tsc --noEmit`. |
| `npm run lint` | PASS | ESLint clean. |
| `npm run audit:large-ipc` | PASS | 92 Rust files scanned; no large-IPC contract violations. |
| `npm test` | PASS | Full Vitest suite passed. Known test stderr/stdout noise only: Zustand storage unavailable, parser logs, expected invalid-settings validation. |
| `npm run build:ci` | PASS | Vite/Rolldown build passed. Warnings: browser externalized `crypto` in `src/lib/utils/encryption.ts`; plugin timing warning mostly CSS. |
| `npm audit --omit=dev` | PASS | 0 vulnerabilities. |
| `cargo audit` in `src-tauri/` | PASS | RustSec scan completed against 884 dependencies. |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | PASS | 455 passed, 2 ignored. |
| `cargo test --manifest-path src-tauri/Cargo.toml` | PASS | Lib/main/integration/doc harness passed: 455 lib passed, 25 AI parsing, 12 DB integrity, 10 IPC contracts; expected ignored tests remain ignored. |
| `npm run test:release-gate` | PASS | Full desktop workflow: 4 fixtures, Comparison chart, report tab, 7 exports. Heap growth `+5.29 MB` vs `20 MB` budget. |
| `npx tauri build --debug --no-bundle --config src-tauri/tauri.e2e.conf.json` | PASS | Rebuilt E2E debug binary so perf smoke uses bundled `tauri.localhost`, not dev localhost. |
| `COMPARISON_SMOKE_N=5 COMPARISON_SMOKE_EXPORT_SAVE_MODE=direct npm run perf:comparison:tauri` | PASS | N=5 Comparison smoke: `cmp_ready_ms=4362`, mocked PDF `28 ms / 8 B`, mocked XLSX `46 ms / 4 B`. |
| `npm run release:prepare -- --dry-run --channel alpha` | PASS | Release policy dry-run: alpha channel, version sync and updater config validated; QA/build/artifact generation intentionally skipped by dry-run. |
| `git diff --check` | PASS | No whitespace errors. |

Notes:

- An initial `perf:comparison:tauri` run failed because the existing debug binary opened `localhost` instead of bundled `tauri.localhost`. Rebuilding with `src-tauri/tauri.e2e.conf.json` fixed the runner, and the rerun passed.
- Tauri E2E teardown still prints occasional Windows `EBUSY`/`EPERM` cleanup warnings for isolated temp DB/WebView2 folders after the test process exits. The release gate itself passed and terminated the Tauri process.

## Last Four Weeks: Comparison, Results, Benefit

Scope: 2026-04-05 through 2026-05-03. The available repository history inside
that window starts on 2026-04-17 with `0.2.0-beta.5`.

## Four-Week Executive Delta

| Metric | Start of available 4-week history | Current alpha.20 state | Result |
| --- | --- | --- | --- |
| Version/channel | `0.2.0-beta.5` | `0.2.2-alpha.20` | Alpha release train prepared with SSoT validation. |
| Commits in window | n/a | 375 commits | Heavy hardening/refactor/release push. |
| Files changed in window | n/a | 1,101 files touched | Large modernization pass, including docs/tests/generated artifacts. |
| Net diff in window | n/a | +226,234 / -29,465 lines | Broad codebase reshaping; includes generated/bundled/documentation churn. |
| Commit mix | n/a | 67 chore, 67 docs, 56 fix, 51 refactor, 44 perf, 40 feat, 12 test, 6 build, 5 sec | Work was not only feature work; most changes were release, audit, hardening and stabilization. |
| Version discipline | Multiple version files were manually synchronized | `/version.json` is SSoT; 4 dependents validated | Drift is caught by `version:validate` before build/release. |
| Release gate | Comparison report workflow existed but was not the final authority | `npm run test:release-gate` PASS | 4 fixtures, Comparison chart, Report tab, 7 exports; heap growth `+5.29 MB` vs `20 MB` budget. |
| Frontend/type gate | Existing suite varied by phase | `npm test`, `typecheck`, `lint`, `build:ci` all PASS | Alpha branch is locally green. |
| Rust gate | Multiple focused Rust suites existed | Full `cargo test --manifest-path src-tauri/Cargo.toml` PASS | 455 lib tests + 25 AI parsing + 12 DB integrity + 10 IPC contract tests. |
| Dependency security | npm/cargo audits were part of audit work | `npm audit --omit=dev` = 0 vulns; `cargo audit` PASS, 884 deps scanned | No known production dependency advisories in current gate. |
| Large IPC | Legacy report/comparison payload IPC still existed earlier in the window | `audit:large-ipc` PASS, 92 Rust files, 0 violations | Report/comparison paths no longer rely on full scientific payload IPC. |
| Tauri FS scope | Broad filesystem scope was identified as a security debt | `$HOME/**` removed; scope narrowed to app/download/temp/desktop/document paths | Smaller renderer-compromise blast radius. |
| Comparison app-owned memory | Earlier hypothesis blamed WN/Comparison store/export | raw/columnar `0/0`, parse cache `0`, JS heap after export GC about `11.5 MB` | Current evidence rejects more blind WN/store/export RAM refactors. |
| Remaining RSS/GPU | Total RSS was being treated as a hard target | Classified as WebView2/GPU compositor soft RSS at chart commit | Release claim is honest: app-owned memory bounded, Total/GPU RSS soft. |
| Comparison UX latency | No post-memory-closeout UX baseline | N=5 direct-save p50 `4302 ms`, p95 `4339.8 ms`; alpha.20 smoke `4362 ms` | Next perf target is selector search, not memory/cache. |
| Series/request footprint | Chart requested broader metric sets | Visible-metrics request path; frontend cache after add-5 `265,160 B` | Smaller renderer cache footprint without affecting report export truth. |
| Report/export path | Full payload report flows were still being removed | By-id PDF/XLSX path release-gated; 7 exports validated in desktop workflow | Export is safer, smaller over IPC and tested end-to-end. |
| DB/library | Audit identified index/query/projection work | Migrations/indexes/projection/query-plan tests pass | Better scaling path for saved experiment library. |
| Backup/restore | Restore/import integrity gaps were audited | FK collision rollback, pending restore validation and quarantine covered by tests | Lower risk of corrupting user data. |

## Four-Week Performance Metrics By Refactoring Stage

Detailed numbers are now split into:

- `docs/release/ALPHA-0.2.2-alpha.20-PERFORMANCE-STAGE-METRICS.md`

Compact readout:

| Stage | Main metric result | Interpretation |
| --- | --- | --- |
| Soak cleanup | peak heap p95 `15.26 MB -> 8.24 MB`; peak DOM p95 `10,034 -> 1,349` | Old heap/node outliers were removed. |
| IPC/by-id export RC gate | Total RSS p50 `673.82 MB -> 624.70 MB`; Tauri CPU peak `5.73 s -> 5.44 s`; large IPC `0 violations` | Report/comparison paths became safer without blowing workflow budgets. |
| Memory hardening | JS heap peak stayed `~9.8 MB`; renderer RSS stayed around `~205-207 MB` | App-owned scientific arrays are bounded; Total RSS remains soft. |
| Warm navigation | return to 5 old lines `455 ms`; old-line refetches `0`; add 6th `903 ms` with 1 new window request | Warm UX is preserved without retaining raw/columnar store data. |
| Visible chart metrics | series cache after add-5 `303,040 B -> 265,160 B`; after chart-visible GPU `247.48 MB -> 214.46 MB` | Chart request/cache footprint is smaller. |
| Chart layout stabilization | add-5 click GPU delta `+84.90 MB -> +61.06 MB` | App-controlled resize component reduced by about `23.84 MB` p50. |
| GPU/RSS closeout | selector close alone `-12.15 MB GPU`; deferred chart commit moved burst to chart commit `+85.45 MB GPU` | Remaining burst is WebView2/GPU compositor allocation, not store/export/WN. |
| Current UX latency | N=5 ready p50 `4,302 ms`; selector search p50 `528 ms`; long tasks `0` | Next performance target is selector search latency, not RAM refactor. |

## Four-Week Work Breakdown

| Area | What changed | Real result | Product/release benefit |
| --- | --- | --- | --- |
| Licensing and alpha channel security | Closed alpha manifest bypass, added working superuser license tooling, enforced RSA-signed activation payloads, made online deactivate fail closed, gated debug/test env overrides. | Activation accepts only signed payloads; server failure no longer silently clears local license state; alpha/beta update tokens are distinct and tested. | Safer alpha distribution and lower risk of accidental or forged license states. |
| Versioning and release discipline | Added `/version.json` as the version SSoT; generated `package.json`, Tauri config, Cargo.toml and `src/lib/version.ts`; added local release gate policy. | `version:validate` is part of release/build flow and passes for `0.2.2-alpha.20`. | Version drift is now caught before build/release instead of during deployment. |
| Desktop E2E isolation | Isolated release-gate DB and WebView2 UserData per run. | Release gate uses temp DB/WebView2 paths and does not touch the production user DB. | Prevents accidental schema migration of the developer/user production database during QA. |
| Report/export architecture | Moved saved and comparison report export to by-id Rust/Tauri paths; removed legacy large comparison payload IPC. | Report export no longer depends on shipping full scientific payloads through renderer IPC. Release gate validates 7 PDF/XLSX exports. | Lower IPC/memory risk and stronger confidence in real desktop report workflows. |
| Large IPC guardrails | Added and enforced `audit:large-ipc`. | Current scan: 92 Rust files, 0 large-IPC violations. | Prevents reintroducing large raw/scientific payload IPC paths. |
| Saved detail and raw table memory | Saved details load without raw points; raw table is paged by id; columnar storage used for raw series. | Renderer-owned raw data retention is bounded in saved-detail/table paths. | Large experiments are safer to inspect without filling JS heap. |
| Binary series and warm navigation | Added binary series IPC, shared frontend warm window cache, Rust decoded series cache, viewport window refetch. | Comparison chart uses bounded windows; frontend series cache in N=5 direct-save diagnostics stayed around hundreds of KB, not full payloads. | Faster and lighter comparison navigation without returning to full payload IPC. |
| Comparison memory attribution | Added N=5 direct-save phase diagnostics, Rust series cache stats, canvas/uPlot lifecycle markers, chart/GPU readouts. | App-owned invariants are clean: comparison raw/columnar `0/0`, parse cache `0`, JS heap after export GC around `11.5 MB`; remaining fifth-add RSS classified as WebView2/GPU compositor allocation. | Memory claims are now honest: app-owned memory bounded, Total/GPU RSS tracked as soft runtime metrics. |
| Visible chart metrics | Comparison chart requests visible metrics instead of the full metric set where possible. | Frontend series cache reduced from about `303,040 B` to `265,160 B` after add-5 in measured N=5 runs. | Smaller renderer/cache footprint without changing report/export source of truth. |
| Comparison user-visible latency baseline | Added N=5 direct-save latency scorecard. | Latest baseline: `cmp_ready_ms` p50 about `4302 ms`, p95 about `4339.8 ms`; selector search is the largest repeated phase. Current alpha.20 smoke: `4362 ms`. | Gives the next performance sprint a real KPI instead of chasing RSS noise. |
| DB and library performance | Added migrations/indexes v0004-v0009, projection table work, query-plan tests, library filter debounce policy. | Migration tests, query-plan guards and projection parity tests pass. | Faster and more predictable library/search behavior as stored experiment count grows. |
| Backup/restore hardening | Added rollback/quarantine behavior and FK collision guards. | Rust tests cover downgrade refusal, pending restore validation, FK collision rollback and merge integrity. | Reduces risk of corrupting user data during import/restore. |
| Runtime job safety | Bounded retained jobs and made queued jobs wait before entering blocking pools. | Scheduler tests cover pruning, cancellation, serialization and blocking-pool gate behavior. | Long-running report/analysis jobs are less likely to starve runtime resources. |
| Frontend UX and settings | Added unit system, time format, report section toggles, chart brush/zoom fixes, branding/window chrome/icon fixes. | Vitest and release-gate workflows cover the major UI paths; chart brush/viewport fixes stabilized comparison navigation. | More polished alpha UX and fewer obvious workflow regressions. |
| Security config | Removed broad `$HOME/**` Tauri filesystem scope and added guardrails. | FS scope is pinned to app data/local app data/downloads/temp/desktop/documents flows. | Smaller blast radius if renderer compromise ever occurs. |

## Current Claim Boundary

Can claim:

- Alpha `0.2.2-alpha.20` local gate is green.
- Comparison app-owned memory is bounded in the measured N=5 direct-save workflows.
- Report export path is by-id and release-gated through real desktop workflow.
- Tauri filesystem scope no longer contains broad `$HOME/**`.

Do not claim:

- Total RSS is fixed.
- GPU memory is fixed.
- The fifth-add compositor burst is gone.
- GitHub statuses are authoritative for release readiness.

## Next Recommended Work

1. Commit the alpha.20 readiness changes.
2. From a clean checkout, run `npm run release:prepare -- --channel alpha` to produce signed alpha artifacts and manifests.
3. Publish only after the generated manifest has `releaseGateExecuted: true`.
