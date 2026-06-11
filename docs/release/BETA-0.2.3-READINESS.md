# Beta 0.2.3-beta.1 Readiness

Date: 2026-06-12

Base commit before beta prep: `969fa1f`.

## Verdict

READY FOR OWNER DECISION.

Local validation, e2e smoke, release gate, beta build and beta publish dry-run are all green. No live publish was performed.

## Version

| File | Version |
| --- | --- |
| `version.json` | `0.2.3-beta.1` |
| `package.json` | `0.2.3-beta.1` |
| `src-tauri/tauri.conf.json` | `0.2.3-beta.1` |
| `src-tauri/Cargo.toml` | `0.2.3-beta.1` |
| `src/lib/version.ts` | `0.2.3-beta.1` |
| Channel | `beta` |

## Local Validation

| Check | Result | Notes |
| --- | --- | --- |
| `npm run version:validate` | PASS | All 4 generated dependents match `/version.json`. |
| `npm run lint` | PASS | ESLint clean. |
| `npm run typecheck` | PASS | TypeScript `tsc --noEmit`. |
| `npm run test` | PASS | Full Vitest suite passed on the beta-bumped tree. |
| `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1` | PASS | 549 passed, 3 ignored. |
| `npm audit --omit=dev` | PASS | 0 vulnerabilities. |
| `cargo audit` in `src-tauri/` | PASS | 884 dependencies scanned, 0 advisories. |
| `npm run test:e2e:smoke` | PASS | 13/13 passed. |
| `npm run test:release-gate` | PASS | Full Comparison Report workflow green-lit, 7 exports, 4 fixtures. |
| `npm run release:prepare -- --channel beta --skip-qa` | PASS | Built `RheoLab Enterprise_0.2.3-beta.1_x64-setup.exe` and generated the beta release manifest locally. |
| `node scripts/deploy/publish-update.js --channel beta --dry-run` | PASS | Printed the SSH/SCP steps without uploading anything. |

## Release Rehearsal

The beta rehearsal required a real installer first. After `release:prepare`, `publish-update.js --channel beta --dry-run` produced:

```text
Manifest saved locally: outputs/release/beta.json
[DRY-RUN] ssh ... mkdir -p /var/www/license-server/releases/artifacts/0.2.3-beta.1
[DRY-RUN] scp ... RheoLab Enterprise_0.2.3-beta.1_x64-setup.exe ...
[DRY-RUN] ssh ... mkdir -p /var/www/license-server/releases/v1/update/windows-x86_64
[DRY-RUN] scp ... beta.json.tmp
[DRY-RUN] ssh ... validate beta.json.tmp
[DRY-RUN] ssh ... mv -f beta.json.tmp beta.json
[DRY-RUN] ssh ... prune stale artifacts
```

The generated local manifest is `outputs/release/beta.json`.

## Summary of Changes

The 0.2.3 line between stable `0.2.2` and the current beta prep contains 25 commits and a 400-file delta (`+21,364 / -7,392` lines). The work clusters into:

- Windows test runner hygiene and repo cleanup.
- Dependency security hardening for the dev-only `uuid` advisory through `exceljs`.
- Release safety hardening for the production `license_public.der` gate.
- Crash telemetry bootstrap for Rust panics, with local rotated `crash-*.log`.
- Alpha-series carry-over fixes in licensing, reporting, and website/download flows.

Notable commits in the current stack:

- `fix(test): pin canonical drive-letter casing for vitest on Windows`
- `fix(deps): override transitive uuid to >=11.1.1 (GHSA-w5hq-g745-h8pq)`
- `feat(release): assert production license public key at release gate`
- `feat(telemetry): write rotated crash reports on rust panic`
- `docs(telemetry): crash report submission design (WP-6.3 phase B)`

## Known Limitations and Risks

- Tauri release builds use `panic = "abort"` and `strip = "symbols"`. The crash hook is still useful, but the report signal is primarily `message + location()`, with backtrace treated as best-effort addresses.
- The crash-report send path is intentionally not implemented yet. The design doc leaves server transport vs. manual attachment as an owner decision.
- E2E and release-gate teardown still emit occasional Windows `EPERM` cleanup warnings for isolated WebView2 temp directories, but both commands exit 0.

## Promotion Procedure

Owner-approved beta publish:

1. `npm run tauri:build`
2. `npm run release:prepare`
3. `node scripts/deploy/publish-update.js --channel beta`

Rollback options:

- `node scripts/release/rollback-channel.js`
- `node scripts/deploy/publish-update.js --from-manifest outputs/release/beta.json --channel beta`

## Decision

APPROVED / REJECTED, date:

