# Agent action plan: split and repair `audit/00-baseline`

Date: 2026-06-13
Reviewer: ChatGPT
Repository: `lunin02118-ops/rheolab`
Reviewed branch: `audit/00-baseline`
Base branch: `main`
Current compare result at review time: `audit/00-baseline` is ahead of `main` by 29 commits.

## Decision

`REQUEST CHANGES`.

Do **not** merge `audit/00-baseline` as a single PR.

The branch is useful as a staging/reference branch, but it mixes too many unrelated changes:

- audit/refactoring docs;
- progress reports;
- release/version documentation;
- package/version churn;
- frontend IPC audit runner changes;
- Rust clippy cleanup;
- `AppError` / IPC error-boundary changes;
- IPC policy inventory;
- comparison report IPC behavior changes;
- crash reporter spike;
- about/support UI work;
- license key release assertion;
- test runner changes;
- removal of local sample data files;
- miscellaneous plans and beta readiness docs.

This must be split into reviewable PRs with one purpose per PR.

## Non-negotiable rules

1. Do not push directly to `main`.
2. Do not merge `audit/00-baseline` as-is.
3. Do not keep adding new work to `audit/00-baseline`.
4. Do not start the large `reports.rs` split until the baseline/error-boundary/IPC-policy/comparison-IPC PRs are merged cleanly.
5. Every split PR must have its own branch, own progress report, own command matrix, and own rollback note.
6. Every progress report must reference the actual commit SHA of the split PR, not an old parent commit.
7. A PR is not complete unless all skipped checks are explicitly listed with reason and follow-up issue/PR.

## Required split plan

Create the following branches from the current `main`, not from `audit/00-baseline` unless cherry-picking specific commits/files intentionally.

### PR-A — docs/audit-execution-pack

Purpose: add only the audit/refactoring process documents.

Suggested branch:

```bash
git checkout main
git pull --ff-only
git checkout -b docs/audit-execution-pack
```

Allowed files:

```text
.github/PULL_REQUEST_TEMPLATE/agent-refactor.md
docs/audits/2026-06-13-refactoring-master-plan.md
docs/audits/agent-execution-protocol.md
docs/audits/checklists/release-quality-gate.md
docs/audits/checklists/security-review.md
docs/audits/progress/AGENT_PROGRESS_TEMPLATE.md
```

Not allowed:

```text
package.json
package-lock.json
src/**
src-tauri/**
scripts/**
version.json
CHANGELOG.md
release docs
plans/**
```

Checks:

```bash
git diff --check
npm run version:validate
```

Acceptance criteria:

- documentation-only diff;
- no runtime/code/config changes;
- PR body states that this is only the execution framework.

---

### PR-B — audit/baseline-command-matrix

Purpose: record the factual baseline command matrix and known deviations.

Suggested branch:

```bash
git checkout main
git pull --ff-only
git checkout -b audit/baseline-command-matrix
```

Allowed files:

```text
docs/audits/progress/2026-06-13-baseline.md
```

The report must include:

```text
Branch:
Commit:
Base:
PR:
Date:

Command matrix:
- command
- exit code
- pass/fail/skip
- duration if available
- notes

Known deviations:
- full dynamic frontend IPC audit status
- website gate status
- license-server/composer gate status
- any unavailable toolchain
```

Checks:

```bash
git diff --check
npm run version:validate
```

Acceptance criteria:

- commit SHA is the actual SHA for this PR;
- no code changes;
- skipped commands are not hidden.

---

### PR-C — tooling/frontend-ipc-runner-hardening

Purpose: improve the frontend IPC audit runner only.

Suggested branch:

```bash
git checkout main
git pull --ff-only
git checkout -b tooling/frontend-ipc-runner-hardening
```

Allowed files:

```text
scripts/audit/run-frontend-ipc-deep-audit.js
docs/performance/PERF_TESTING.md
```

Required fix before review:

`--run-id` must be sanitized. The runner must reject absolute paths, `..`, `/`, and `\\` path separators. It must not allow writing artifacts outside `runtime/audit/<run-id>`.

Suggested implementation:

```js
function normalizeRunId(value) {
  if (!value) return null;

  if (path.isAbsolute(value) || value.includes('..') || /[\\/]/.test(value)) {
    throw new Error(`Invalid --run-id: ${value}`);
  }

  const normalized = value
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

  if (!normalized) {
    throw new Error('Invalid --run-id: empty after normalization');
  }

  return normalized;
}
```

Checks:

```bash
node --check scripts/audit/run-frontend-ipc-deep-audit.js
node scripts/audit/run-frontend-ipc-deep-audit.js --skip-dynamic --non-blocking --run-id=runner-smoke
node scripts/audit/run-frontend-ipc-deep-audit.js --skip-dynamic --run-id=../../bad
```

Expected result for the last command: fails safely and does not create files outside `runtime/audit`.

Acceptance criteria:

- tooling-only diff;
- run-id traversal rejected;
- dynamic audit status documented honestly.

---

### PR-D — chore/rust-clippy-clean-baseline

Purpose: Rust clippy cleanup only, with no intended behavior change.

Suggested branch:

```bash
git checkout main
git pull --ff-only
git checkout -b chore/rust-clippy-clean-baseline
```

Allowed files: only files required to make Rust clippy pass.

Not allowed:

```text
frontend UI changes
package version changes
release docs
crash reporter feature work
comparison export behavior change
IPC policy inventory
AppError behavior change
```

Checks:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml --all-targets --all-features
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
npm run typecheck
```

Acceptance criteria:

- clippy passes with `-D warnings`;
- no intentional runtime behavior change;
- PR body lists every touched Rust module and why it was required.

---

### PR-E — ref/error-boundary-redacted-logging

Purpose: make `AppError` serialization side-effect free and provide safe IPC error logging helpers.

Suggested branch:

```bash
git checkout main
git pull --ff-only
git checkout -b ref/error-boundary-redacted-logging
```

Allowed files:

```text
src-tauri/src/error.rs
docs/audits/progress/2026-06-13-error-boundary.md
```

Required behavior:

- `Serialize for AppError` must not log;
- serialized IPC response shape remains `{ kind, message }`;
- raw internal errors must not leak to serialized response;
- logging helper may exist, but automatic logging inside serialization is forbidden.

Checks:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml error -- --test-threads=1
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
npm run typecheck
```

Acceptance criteria:

- serialization is pure;
- tests cover safe message redaction;
- follow-up note exists for adding a common command-boundary wrapper/macro.

---

### PR-F — ref/ipc-policy-inventory

Purpose: add read-only IPC command policy metadata inventory.

Suggested branch:

```bash
git checkout main
git pull --ff-only
git checkout -b ref/ipc-policy-inventory
```

Allowed files:

```text
src-tauri/src/ipc_policy.rs
src-tauri/src/lib.rs
docs/audits/progress/2026-06-13-ipc-policy.md
```

Required semantic fix:

`requires_license()` must not automatically mean `allowed_in_demo = false`.

The current licensing model uses runtime gates that may allow demo/grace access for some write/report paths. Policy metadata must not collapse these separate concepts.

Use separate concepts, for example:

```rust
pub const fn requires_license(mut self) -> Self {
    self.requires_license = true;
    self
}

pub const fn denied_in_demo(mut self) -> Self {
    self.allowed_in_demo = false;
    self
}
```

Or introduce:

```rust
pub enum DemoPolicy {
    Allowed,
    Limited,
    Denied,
}
```

Checks:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml ipc_policy -- --test-threads=1
cargo check --manifest-path src-tauri/Cargo.toml --all-targets --all-features
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
npm run audit:large-ipc
```

Acceptance criteria:

- metadata is read-only inventory, not enforcement yet;
- command names match the production registry;
- high-risk commands have audit metadata;
- binary/large payload commands are marked;
- demo/license semantics are not conflated.

---

### PR-G — ref/comparison-by-ids-only

Purpose: remove direct heavy comparison report payload IPC from production path.

Suggested branch:

```bash
git checkout main
git pull --ff-only
git checkout -b ref/comparison-by-ids-only
```

Allowed files:

```text
src-tauri/src/startup/commands_registry.rs
src-tauri/src/commands/reports.rs
src-tauri/src/ipc_policy.rs
src/components/comparison/reports/hooks/useComparisonReportExport.ts
src/lib/reports/client.ts
src/lib/reports/comparison-direct-export.ts
src/lib/tauri/reports.ts
src/lib/tauri/bridge/index.ts
src/types/tauri.d.ts
tests/reports/client.test.ts
tests/reports/comparison-direct-export.test.ts
tests/reports/useComparisonReportExport.test.ts
docs/audits/progress/2026-06-13-direct-comparison-ipc.md
```

Production behavior required:

- production registry must not expose `reports_generate_comparison_pdf`;
- production registry must not expose `reports_generate_comparison_excel`;
- frontend must not call direct comparison payload commands;
- comparison export uses `reports_generate_comparison_pdf_by_ids` and `reports_generate_comparison_excel_by_ids`;
- report bytes remain binary IPC, not JSON number arrays;
- unsaved/local-file comparison behavior is tested and has clear UX.

Checks:

```bash
npm run typecheck
npm run lint
npm run test -- tests/reports/client.test.ts tests/reports/useComparisonReportExport.test.ts
cargo test --manifest-path src-tauri/Cargo.toml ipc_policy -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml reports -- --test-threads=1
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
npm run audit:large-ipc
```

Acceptance criteria:

- direct comparison payload commands are debug/test-only or removed;
- production code path is by-IDs only;
- tests cover the new behavior;
- no unrelated UI/release/crash/doc changes in this PR.

---

## Work that must be postponed

Do not include these in the baseline split PRs:

```text
reports.rs module split
crash reporter implementation
about/support dialog
beta promotion docs
release notes churn
version bump
license-server hardening
website gates
DB backup/restore hardening
performance budgets
single-report by-id migration
```

These are valid follow-up items, but they must be separate PRs after the baseline/control PRs are merged.

## Required PR body template for every split PR

Use this structure:

```markdown
## Purpose

One sentence.

## Scope

Files changed:
- ...

Explicitly out of scope:
- ...

## Validation

| Command | Exit code | Result | Notes |
|---|---:|---|---|
| ... | ... | ... | ... |

## Risks

- ...

## Rollback

- Revert this PR.

## Follow-ups

- ...
```

## Final reviewer instruction

The current `audit/00-baseline` branch should be treated as a staging branch only.

The mergeable path is:

```text
PR-A docs/audit-execution-pack
PR-B audit/baseline-command-matrix
PR-C tooling/frontend-ipc-runner-hardening
PR-D chore/rust-clippy-clean-baseline
PR-E ref/error-boundary-redacted-logging
PR-F ref/ipc-policy-inventory
PR-G ref/comparison-by-ids-only
```

After those PRs are merged cleanly, continue with:

```text
PR-H release gate enforcement
PR-I Tauri capabilities hardening
PR-J backup/restore hardening
PR-K reports.rs mechanical split phase 1
```

Do not merge broad mixed-purpose branches.
