# Further refactoring plan after merge train #6-#11

Date: 2026-06-14
Target repository: `lunin02118-ops/rheolab`
Target main after merge train: `44da378695216e12cd5a44c0aaa97e88e5b386db`
Previous staging branch status: `audit/00-baseline` must remain unmerged.

## Current baseline

The previous refactoring train is considered complete for internal release readiness:

- PR #6: frontend IPC audit runner hardening.
- PR #7: Rust Clippy cleanup baseline.
- PR #8: redacted logging and side-effect-free `AppError` serialization.
- PR #9: read-only IPC policy inventory.
- PR #10: comparison report export by IDs only.
- PR #11: release gate blocker cleanup.

Post-merge validation reported for `main`:

- `npm run version:validate` — PASS.
- `npm run lint` — PASS.
- `npm run typecheck` — PASS.
- `npm run build` — PASS.
- `npm test` — PASS.
- `npm run test:release-gate` — PASS.
- `npm run audit:frontend-ipc -- --windows-runner` — PASS.
- `npm run audit:large-ipc` — PASS.
- `npm audit --audit-level=high` — PASS.
- `npm audit --omit=dev` — PASS.
- `npm --prefix website ci` — PASS.
- `npm --prefix website audit --omit=dev` — PASS.
- `npm --prefix website run build` — PASS.
- `npx playwright test --workers=1 tests/e2e/reports/reports-export.spec.ts` — PASS.
- `npx playwright test --config playwright.tauri.config.ts tests/e2e/multi-fixture-perf.tauri.spec.ts` — PASS.
- `cargo check --manifest-path src-tauri/Cargo.toml --all-targets --all-features` — PASS.
- `cargo check --release --manifest-path src-tauri/Cargo.toml` — PASS.

Known warnings are not release blockers for internal release, but must be tracked:

- Vite/browser crypto warning.
- Plugin timing warnings.
- Astro/Vite deprecation warnings.
- Two Rust unused function warnings.
- EPERM/EBUSY cleanup warnings after Tauri E2E.

## Strategic goal

Move from internal release readiness to beta and then production readiness by addressing the remaining hardening, CI, security, IPC enforcement, reports maintainability, and operational risks.

The order is intentional:

1. CI and release hardening.
2. Security baseline.
3. IPC policy enforcement.
4. Reports module decomposition.
5. Frontend performance cleanup.
6. Release packaging and updater proof.
7. Operational documentation.

Do not start a broad mixed-purpose branch. Every item below must be implemented as a focused PR.

## Global rules for the next phase

1. Do not merge `audit/00-baseline`.
2. Do not create a new broad staging branch.
3. One PR must have one purpose.
4. Every PR must include validation output and rollback notes.
5. Every runtime PR must include behavior-change notes.
6. Every security PR must include negative tests or explicit non-testable rationale.
7. Every dependency override must include reason, owner, removal condition, and review date.
8. Long-running checks may be manual at first, but every release-critical gate must have a path to CI enforcement.

Recommended PR body template:

```markdown
## Purpose

## Scope

## Files changed

## Behavior changes

## Validation

| Command | Exit code | Result | Notes |
|---|---:|---|---|

## Risks

## Rollback

## Follow-ups
```

---

# Wave 1 — Release hardening foundation

## PR #12 — `ci/license-server-openssl-proof`

### Purpose

Make `license-server` verifiable in CI or a reproducible local environment.

### Rationale

`license-server/**` was not changed in PR #11, so it did not block that merge. It still blocks full product release readiness because local PHPUnit verification is environment-blocked by missing PHP `openssl`.

### Scope

Allowed files:

```text
.github/workflows/license-server.yml
license-server/composer.json
license-server/composer.lock
docs/audits/progress/license-server-ci.md
```

Only touch `composer.json` / `composer.lock` if required to expose a test script or make installation reproducible.

Forbidden scope:

```text
src/**
src-tauri/**
website/**
reports code
IPC policy
release/version changes
```

### Required checks

```bash
php -m | grep openssl
composer --working-dir=license-server validate
composer --working-dir=license-server install --no-interaction --prefer-dist
composer --working-dir=license-server test
```

If `composer test` does not exist, add a minimal Composer script that runs PHPUnit.

### Acceptance criteria

- CI proves PHP `openssl` is present.
- Composer validation passes.
- Dependencies install reproducibly.
- PHPUnit/license-server tests pass.
- The job can run on PR and manually.

Priority: P1 / beta blocker.

---

## PR #13 — `ci/re-enable-blocking-release-gates`

### Purpose

Convert the strongest local post-merge validation into CI-enforced gates.

### Scope

Allowed files:

```text
.github/workflows/**
docs/audits/progress/ci-release-gates.md
```

### Required PR-to-main gates

```bash
npm run version:validate
npm run lint
npm run typecheck
npm run build
npm test
npm run audit:large-ipc
npm audit --audit-level=high
npm audit --omit=dev
npm --prefix website ci
npm --prefix website run build
npm --prefix website audit --omit=dev
cargo check --manifest-path src-tauri/Cargo.toml --all-targets --all-features
cargo check --release --manifest-path src-tauri/Cargo.toml
```

### Release/manual gates

Long-running checks may stay manual, scheduled, or release-only initially:

```bash
npm run audit:frontend-ipc -- --windows-runner
npm run test:release-gate
npx playwright test --config playwright.tauri.config.ts tests/e2e/multi-fixture-perf.tauri.spec.ts
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
```

### Acceptance criteria

- PRs to `main` automatically run core quality/security gates.
- Long-running release checks are available as manual or scheduled jobs.
- Failed jobs upload useful artifacts.
- Jobs have explicit timeouts.

Priority: P1 / release confidence.

---

## PR #14 — `docs/dependency-overrides-register`

### Purpose

Track dependency overrides as managed supply-chain debt.

### Scope

Allowed files:

```text
docs/audits/dependency-overrides.md
package.json
website/package.json
```

Package files should only be touched if metadata/script support is required. Do not change dependency versions in this PR unless required to fix register consistency.

### Register format

```markdown
# Dependency Overrides Register

| Scope | Package | Forced version | Reason | Added in | Removal condition | Review date | Owner |
|---|---|---:|---|---|---|---|---|
```

Must cover at least:

- root `uuid` override;
- website `vite` override;
- website `esbuild` override;
- website `rollup` override.

### Acceptance criteria

- Every override has a reason.
- Every override has a removal condition.
- Every override has a review date.
- Root and website audits still pass.

Priority: P1 / supply-chain hygiene.

---

## PR #15 — `test/tauri-e2e-cleanup-hardening`

### Purpose

Reduce EPERM/EBUSY cleanup warnings after Tauri E2E and lower flake risk.

### Scope

Allowed files:

```text
tests/e2e/**
scripts/test/**
scripts/audit/**
docs/audits/progress/tauri-e2e-cleanup.md
```

### Required investigation

Check:

- WebView/Tauri process shutdown;
- lingering file handles;
- temp/runtime artifact cleanup;
- retry/backoff policy for Windows EPERM/EBUSY;
- logging of non-fatal cleanup failures.

### Required checks

```bash
npx playwright test --config playwright.tauri.config.ts tests/e2e/multi-fixture-perf.tauri.spec.ts
npx playwright test --workers=1 tests/e2e/reports/reports-export.spec.ts
npm run audit:frontend-ipc -- --windows-runner
```

### Acceptance criteria

- No new cleanup errors.
- EPERM/EBUSY warnings are either eliminated or explicitly classified and logged as non-blocking.
- No force-delete without retry/backoff.

Priority: P1/P2.

---

## PR #16 — `chore/rust-unused-functions-cleanup`

### Purpose

Remove the two known Rust unused function warnings.

### Scope

Allowed files:

```text
src-tauri/src/**
```

No runtime behavior changes.

### Required checks

```bash
cargo check --manifest-path src-tauri/Cargo.toml --all-targets --all-features
cargo check --release --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

### Acceptance criteria

- Known unused warnings are gone.
- Clippy passes with `-D warnings`.
- PR body lists every removed or cfg-gated function.

Priority: P2.

---

# Wave 2 — Security hardening

## PR #17 — `security/tauri-capabilities-inventory`

### Purpose

Create a full inventory of Tauri capabilities and permissions.

### Scope

Allowed files:

```text
src-tauri/capabilities/**
src-tauri/tauri.conf*.json
docs/security/tauri-capabilities-inventory.md
```

### Required classification

Classify:

- filesystem access;
- dialog permissions;
- process/shell permissions;
- updater permissions;
- logging permissions;
- network/external endpoints;
- path scopes.

### Acceptance criteria

- Every permission has a reason.
- Broad permissions have owner/follow-up.
- No runtime behavior change.

---

## PR #18 — `security/tauri-capabilities-hardening-phase-1`

### Purpose

Narrow obviously overbroad capabilities without changing intended behavior.

### Required checks

```bash
npm run build
npm run test:release-gate
npx playwright test --workers=1 tests/e2e/reports/reports-export.spec.ts
cargo check --release --manifest-path src-tauri/Cargo.toml
```

### Acceptance criteria

- Only low-risk narrowing is included.
- Any controversial permission is deferred to phase 2.
- Desktop report export and release gate still pass.

---

## PR #19 — `security/csp-tightening`

### Purpose

Reduce CSP risk.

### Targets

Audit and reduce:

- `unsafe-inline`;
- `unsafe-eval`;
- broad `connect-src`;
- broad `img-src` / `font-src`.

### Acceptance criteria

- Website build passes.
- Desktop build passes.
- No CSP console errors in smoke.
- External endpoints are documented.

---

## PR #20 — `security/external-ai-network-policy`

### Purpose

Make external AI/network endpoints opt-in, policy-controlled, and audit-visible.

### Acceptance criteria

- No accidental external network calls by default.
- Demo/offline mode has deterministic behavior.
- External network commands are listed in IPC policy.
- User-visible errors are safe and actionable.

---

# Wave 3 — IPC policy: inventory to enforcement

## PR #21 — `ref/ipc-demo-policy-enum`

### Purpose

Replace boolean demo policy with explicit semantics.

### Target model

```rust
pub enum DemoPolicy {
    Allowed,
    Limited,
    Denied,
    Unknown,
}
```

### Acceptance criteria

- `requires_license()` does not change demo policy automatically.
- High-risk commands do not default to `Allowed` silently.
- Existing IPC policy tests pass.
- New tests cover `Allowed`, `Limited`, `Denied`, and `Unknown`.

---

## PR #22 — `ref/ipc-command-boundary-wrapper`

### Purpose

Centralize IPC error logging, request IDs, and redaction at command boundaries.

### Target

A wrapper or macro similar to:

```rust
command_boundary("command_name", request_id, async move {
    // command body
})
```

### Acceptance criteria

- `AppError` serialization remains side-effect free.
- IPC response shape remains `{ kind, message }`.
- `log_ipc_error` or equivalent is applied at the boundary.
- Tests cover redacted log fields.

---

## PR #23 — `ref/ipc-policy-enforcement-phase-1`

### Purpose

Begin enforcement without breaking license/demo runtime behavior.

### Enforce

- Every registered command has policy.
- High-risk commands require audit metadata.
- File read/write commands cannot be low risk without explicit rationale.
- External network commands are tagged.
- Large JSON payload commands are prohibited in production unless explicitly excepted.

### Do not enforce yet

- Runtime license denial.
- Runtime demo denial.
- Full RBAC.

### Required checks

```bash
cargo test --manifest-path src-tauri/Cargo.toml ipc_policy -- --test-threads=1
npm run audit:large-ipc
cargo check --release --manifest-path src-tauri/Cargo.toml
```

---

# Wave 4 — Reports module decomposition

All reports refactors must be mechanical first. No behavior changes unless explicitly stated.

## PR #24 — `ref/reports-domain-types-extraction`

Extract pure report domain types into a dedicated module.

Suggested target:

```text
src-tauri/src/reports/domain/types.rs
src-tauri/src/reports/domain/options.rs
src-tauri/src/reports/domain/errors.rs
```

Required checks:

```bash
cargo check --manifest-path src-tauri/Cargo.toml --all-targets --all-features
cargo test --manifest-path src-tauri/Cargo.toml reports -- --test-threads=1
npm run typecheck
```

---

## PR #25 — `ref/reports-renderers-extraction`

Extract renderers:

```text
src-tauri/src/reports/render/pdf.rs
src-tauri/src/reports/render/excel.rs
src-tauri/src/reports/render/typst.rs
```

No by-IDs behavior changes. No cache/temp policy changes.

---

## PR #26 — `ref/reports-use-cases-by-ids`

Extract application use cases:

```text
src-tauri/src/reports/application/generate_by_ids.rs
src-tauri/src/reports/application/generate_single.rs
src-tauri/src/reports/application/comparison.rs
```

Acceptance criteria:

- production path remains by IDs;
- direct heavy comparison payload commands stay absent from production;
- `npm run audit:large-ipc` passes;
- report export E2E passes.

---

## PR #27 — `ref/reports-artifacts-temp-cache`

Stabilize report artifacts, temp files, cache policy, and cleanup.

Acceptance criteria:

- no leftover temp files after tests;
- Windows cleanup retry exists;
- report export E2E passes.

---

## PR #28 — `test/reports-golden-coverage`

Add golden/snapshot coverage for:

- PDF metadata;
- Excel sheet structure;
- comparison by IDs;
- local file guard;
- expected error cases.

---

# Wave 5 — Frontend performance and stability

## PR #29 — `perf/store-selector-audit`

Audit and reduce store subscription churn.

Targets:

- `useStore()` without selector;
- unstable derived arrays;
- large object selectors;
- chart-heavy hooks.

Metrics:

- `peakNodes`;
- `peakHeapMb`;
- `rendererWsMb`;
- `totalWallMs`.

---

## PR #30 — `perf/chart-rendering-budget-phase-1`

Improve chart rendering stability.

Targets:

- memoized series data;
- throttled brush/selection events;
- large dataset guardrails;
- render budget tests.

---

## PR #31 — `perf/library-filter-allocation-cleanup`

Fix the current P2 allocation hotspot:

```text
src/components/library/experiment-filters.tsx
```

Acceptance criteria:

- audit finding removed or downgraded;
- tests pass;
- frontend IPC audit shows no regression.

---

# Wave 6 — Release packaging and updater

## PR #32 — `release/signing-dry-run-proof`

Prove release signing path without publishing.

Acceptance criteria:

- staging/dry-run build passes;
- signing config is validated;
- secrets are not logged;
- artifact naming is deterministic.

---

## PR #33 — `release/updater-contract-smoke`

Validate updater endpoint contract.

Acceptance criteria:

- update manifest schema is validated;
- signature fields are validated;
- rollback channel is documented;
- download URLs are checked.

---

## PR #34 — `release/rollback-drill`

Document and test release rollback flow.

Must cover:

- bad release detection;
- rollback channel update;
- artifact cleanup;
- server-side deploy safety;
- user-facing version behavior.

---

# Wave 7 — Documentation and operations

## PR #35 — `docs/post-refactor-audit-status`

Create:

```text
docs/audits/2026-06-post-refactor-status.md
```

Must include:

- main SHA;
- merged PRs;
- validation matrix;
- known warnings;
- known risks;
- production blockers;
- next hardening plan.

---

## PR #36 — `docs/release-runbook`

Create a release operator runbook.

Must include:

- internal release flow;
- beta release flow;
- update endpoint verification;
- signing verification;
- rollback procedure;
- required logs/artifacts to retain.

---

# Required validation matrix

## Default runtime PR validation

```bash
npm run version:validate
npm run lint
npm run typecheck
npm run build
npm test
npm run audit:large-ipc
npm audit --audit-level=high
npm audit --omit=dev
cargo check --manifest-path src-tauri/Cargo.toml --all-targets --all-features
cargo check --release --manifest-path src-tauri/Cargo.toml
```

## Frontend / Tauri / reports PR validation

```bash
npm run test:release-gate
npx playwright test --workers=1 tests/e2e/reports/reports-export.spec.ts
npx playwright test --config playwright.tauri.config.ts tests/e2e/multi-fixture-perf.tauri.spec.ts
npm run audit:frontend-ipc -- --windows-runner
```

## Website PR validation

```bash
npm --prefix website ci
npm --prefix website run build
npm --prefix website audit --omit=dev
```

## License-server PR validation

```bash
php -m | grep openssl
composer --working-dir=license-server validate
composer --working-dir=license-server install --no-interaction --prefer-dist
composer --working-dir=license-server test
```

# Metrics to track

## Reliability

- CI pass rate.
- E2E flake count.
- EPERM/EBUSY cleanup count.
- Audit runner timeout count.
- Release-gate duration.

## Performance

- Heap growth MB.
- `peakHeapMb` p50/p95.
- `rendererWsMb` p50/p95.
- `totalWsMb` p50/p95.
- `totalWallMs` p50/p95.
- Report export duration.
- Large IPC command count.

## Security

- npm high/critical findings.
- Cargo audit findings.
- License-server PHPUnit status.
- Broad Tauri permission count.
- CSP unsafe directive count.
- External network command count.
- High-risk IPC commands without audit metadata.

## Maintainability

- Largest module LOC.
- `reports.rs` LOC.
- Clippy warnings.
- Rust warnings.
- Report/export test coverage.
- Number of dependency overrides.

# Execution order

Recommended order:

```text
#12 license-server CI proof
#13 blocking release gates
#14 dependency overrides register
#15 Tauri E2E cleanup hardening
#16 Rust unused warning cleanup
#17 Tauri capabilities inventory
#18 Tauri capabilities hardening phase 1
#19 CSP tightening
#20 external AI/network policy
#21 IPC DemoPolicy enum
#22 IPC command boundary wrapper
#23 IPC policy enforcement phase 1
#24 reports domain types extraction
#25 reports renderers extraction
#26 reports use cases by IDs
#27 reports artifacts/temp/cache cleanup
#28 reports golden coverage
#29 store selector audit
#30 chart rendering budget phase 1
#31 library filter allocation cleanup
#32 signing dry-run proof
#33 updater contract smoke
#34 rollback drill
#35 post-refactor audit status
#36 release runbook
```

# Current release position

After merge train #6-#11 and reported post-merge validation:

```text
Internal release: GO.
Beta candidate: CONDITIONAL GO after CI enforcement and license-server proof.
Production / enterprise release: NO-GO until security hardening, IPC enforcement, release signing/updater proof, and operational runbook are complete.
```
