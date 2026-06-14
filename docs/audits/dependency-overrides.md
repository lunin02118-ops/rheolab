# Dependency Overrides Register

Date: 2026-06-14
Branch: `docs/dependency-overrides-register`
GitHub PR: TBD
Base: `main`

## Purpose

Track dependency overrides as managed supply-chain debt. Overrides are allowed
only when each entry has an owner, reason, removal condition, and review date.

## Scope

This register documents the existing overrides in:

- `package.json`
- `website/package.json`

No dependency versions were changed in this PR.

## Register

| Scope | Package | Forced version | Reason | Added in | Removal condition | Review date | Owner |
|---|---|---:|---|---|---|---|---|
| root app | `uuid` | `11.1.1` | Keep the application dependency graph on a single audited `uuid` version and prevent older transitive resolution from re-entering the lockfile. | Present in `main` at `44da378695216e12cd5a44c0aaa97e88e5b386db`. | Remove when direct and transitive dependencies resolve to an acceptable audited `uuid` version without an override, and both root audits still pass. | 2026-07-14 | Release owner |
| website | `vite` | `8.0.16` | Hold the Astro website build on the audited Vite line used by the current release evidence. | Present in `main` at `44da378695216e12cd5a44c0aaa97e88e5b386db`. | Remove when Astro and its transitive dependencies resolve to an acceptable audited Vite version without an override, and website build/audit still pass. | 2026-07-14 | Website owner |
| website | `esbuild` | `0.28.1` | Keep Vite's native build dependency on the audited esbuild version used by the current website release evidence. | Present in `main` at `44da378695216e12cd5a44c0aaa97e88e5b386db`. | Remove when Vite/Astro resolve to an acceptable audited esbuild version without an override, and website build/audit still pass. | 2026-07-14 | Website owner |
| website | `rollup` | `4.62.0` | Keep Vite's bundler dependency on the audited Rollup version used by the current website release evidence. | Present in `main` at `44da378695216e12cd5a44c0aaa97e88e5b386db`. | Remove when Vite/Astro resolve to an acceptable audited Rollup version without an override, and website build/audit still pass. | 2026-07-14 | Website owner |

## Validation

| Command | Result | Notes |
|---|---|---|
| `npm audit --audit-level=high` | PASS | `found 0 vulnerabilities`. |
| `npm audit --omit=dev` | PASS | `found 0 vulnerabilities`. |
| `npm --prefix website audit --omit=dev` | PASS | `found 0 vulnerabilities`. |
| `git diff --check` | PASS | No whitespace errors. |
| hidden/bidi scan | PASS | No hidden/bidi Unicode found in this file. |

## Behavior Changes

None. Documentation-only.

## Rollback

Revert this PR or delete `docs/audits/dependency-overrides.md`.
