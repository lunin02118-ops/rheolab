# CI Release Gates

Date: 2026-06-14
Work item: W1-02
Plan label: `ci/re-enable-blocking-release-gates`
Branch: `ci/re-enable-blocking-release-gates`
Implementation commit: `57bb436da72406d974d4cc8a29b798e9e19f80bd`
GitHub PR: `#15` - https://github.com/lunin02118-ops/rheolab/pull/15
Base: `main`

## Numbering Note

The source plan labels this item as `PR #13`, but the real GitHub PR `#13`
was already used by the documentation plan. The real GitHub PR for this work is
`#15`.

## Purpose

Convert the strongest post-merge local validation gates into GitHub workflows
that run automatically on pull requests to `main`, while keeping long-running
release checks available as manual or scheduled gates.

## Scope

Files changed:

- `.github/workflows/release-gates.yml`
- `.github/workflows/release-manual-gates.yml`
- `docs/audits/progress/ci-release-gates.md`

No application runtime code, Tauri command code, license-server endpoint code,
database migration, dependency version, or version file was changed.

## Behavior Changes

Automation only.

- Pull requests to `main` now run the new `Release Gates` workflow.
- Pushes to `main` also run the same core gates for post-merge evidence.
- Long-running release checks are exposed through `Release Manual Gates` via
  `workflow_dispatch` and a weekly schedule.

There is no change to 30-day trial behavior, license payload semantics,
activation, validation, offline grace handling, or signed license data.

## PR-to-main Gates

`Release Gates` runs these blocking jobs:

| Job | Commands |
|---|---|
| App quality and npm security | `npm run version:validate`; `npm run lint`; `npm run typecheck`; `npm run build`; `npm test`; `npm run audit:large-ipc`; `npm audit --audit-level=high`; `npm audit --omit=dev` |
| Website build and npm security | `npm --prefix website ci`; `npm --prefix website run build`; `npm --prefix website audit --omit=dev` |
| Rust cargo checks | `node scripts/dev/ensure-dev-keys.mjs`; `cargo check --manifest-path src-tauri/Cargo.toml --all-targets --all-features`; `cargo check --release --manifest-path src-tauri/Cargo.toml` |

Each job has an explicit timeout and uploads failure artifacts when available.

## Manual / Scheduled Gates

`Release Manual Gates` runs on Windows via `workflow_dispatch` and weekly
schedule:

```bash
npm run audit:frontend-ipc -- --windows-runner
npm run test:release-gate
npx playwright test --config playwright.tauri.config.ts tests/e2e/multi-fixture-perf.tauri.spec.ts
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
```

These gates are intentionally not PR-triggered in this first CI-enforcement
step because they are longer-running and more environment-sensitive.

## Validation

Local checks for this PR:

| Command | Result | Notes |
|---|---|---|
| `git diff --check` | PASS | No whitespace errors in tracked diff. |
| hidden/bidi scan | PASS | Checked changed workflow/doc files. |
| package JSON parse | PASS | `package.json` and `website/package.json` parse cleanly. |

GitHub checks will be recorded on PR `#15`.

## Risks

- The first automatic run may expose environment differences between local
  validation and GitHub runners.
- Rust and Tauri checks require Linux native packages and runner-local dev test
  keys. The workflow installs packages and generates only gitignored test keys.
- Manual release gates may still need tuning if Windows runner timing differs
  from local release validation.

## Rollback

Revert this PR. Runtime behavior is not changed; rollback removes only the two
workflow files and this progress note.
