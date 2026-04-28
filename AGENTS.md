# AGENTS.md

Minimal repo context to survive chat compaction.

## Project

- RheoLab Enterprise V2
- Frontend: React 19 + TypeScript + Vite
- Desktop shell: Tauri 2 + Rust
- Database: SQLite via `rusqlite` / `r2d2_sqlite`

## Important Paths

- `src/`: React app and shared TypeScript logic
- `src-tauri/src/`: Tauri commands, backend orchestration, licensing
- `src/rust/rheolab-core/`: core rheology calculations and export logic
- `tests/`: Vitest, Playwright, integration coverage
- `scripts/`: build, test, release, audit helpers

## High-Risk Areas

- `src-tauri/src/commands/licensing/`: activation, signatures, machine fingerprinting
- DB migrations, export flows, and Tauri IPC boundaries

## Versioning (SSoT)

- **Single source of truth**: `/version.json` — only file a human edits to bump the app version. Holds `{ version, channel }`.
- **Four dependent files** are kept in lockstep automatically: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src/lib/version.ts`.
- **Never edit those four files by hand.** Edit `/version.json`, then run `npm run version:sync`.
- `npm run version:sync`: propagate `/version.json` → 4 dependents (idempotent).
- `npm run version:validate`: read-only consistency check; exits non-zero on any drift or channel/tag mismatch.
- Both `tauri:build` and `release:prepare` invoke `validate` (npm pre-hook + defense-in-depth check inside `scripts/dev/run-tauri-cli.js`) and refuse to build on rassinkhron.
- Channel rule: `channel="alpha"` requires `version` to end with `-alpha.N`; `beta` → `-beta.N`; `rc` → `-rc.N`; `stable` → no prerelease tag. Validator catches mistakes.
- Old auto-bumper `scripts/build/generate-version.js` is a deprecated shim that now just calls `version:sync` and prints a warning banner.

## Verified Commands

- `npm run test`: run Vitest suite
- `npm run test:parsing`: run parsing tests only
- `npm run tauri:dev`: start desktop app in dev mode (auto-syncs version.ts)
- `npm run version:validate`: SSoT consistency check
- `npm run version:sync`: propagate /version.json into the 4 dependent files
- `cargo test --manifest-path src-tauri/Cargo.toml`: run Rust tests
- `npm audit --omit=dev`: audit production npm dependencies
- `cargo audit` (from `src-tauri/`): audit Rust dependencies

## Context Hygiene

- Prefer reading only files in `src/`, `src-tauri/src/`, and directly relevant tests.
- Avoid broad scans over `tests/`, `runtime/`, `outputs/`, and generated artifacts unless required.
- Treat large terminal outputs as summaries first; do not paste full logs into chat unless needed.