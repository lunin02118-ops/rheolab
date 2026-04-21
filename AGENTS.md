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

## Verified Commands

- `npm run test`: run Vitest suite
- `npm run test:parsing`: run parsing tests only
- `npm run tauri:dev`: start desktop app in dev mode
- `cargo test --manifest-path src-tauri/Cargo.toml`: run Rust tests

## Context Hygiene

- Prefer reading only files in `src/`, `src-tauri/src/`, and directly relevant tests.
- Avoid broad scans over `tests/`, `runtime/`, `outputs/`, and generated artifacts unless required.
- Treat large terminal outputs as summaries first; do not paste full logs into chat unless needed.