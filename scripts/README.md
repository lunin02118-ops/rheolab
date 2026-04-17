# Scripts

Utility scripts for development, testing, building, and releasing RheoLab Enterprise.

---

## Directory Layout

```
scripts/
├── dev/         Development helpers
├── build/       Build helpers (portable ZIP, installer)
├── release/     Release pipeline (manifest, checksums, updater keys)
├── test/        Test runners (E2E matrix, benchmarks)
├── audit/       Code/dependency audit helpers
├── debug/       Debug helpers (log extraction, process inspection)
├── deploy/      Deployment helpers (license server, Docker)
├── nsis/        NSIS installer customisation
└── utils/       Shared utility modules
```

---

## Common Scripts

### Development

| Script | Purpose |
|--------|---------|
| `scripts/dev/run-autonomous-windows.ps1` | One-liner dev startup — checks npm, installs deps, launches `npm run tauri:dev` |
| `scripts/dev/fresh-launch.ps1` | Clean-slate launch of the **release** binary (two scenarios below) |
| `scripts/dev/clean-slate.ps1` | Wipe all app data directories and registry keys |

#### Two-scenario release testing

**Scenario A — Голый запуск (Bare / First-run simulation)**

Simulates a brand-new user who has just installed the app with no data.

```powershell
# Build the release binary first (one-time, takes ~10-15 min)
npm run tauri:build

# Wipe app data + launch with empty DB, no experiments
.\scripts\dev\fresh-launch.ps1
```

The script sets the required runtime env vars (`INTEGRITY_SECRET_KEY` /
`LICENSE_ENCRYPTION_KEY`) automatically using dev-safe defaults.
To use production keys, copy `scripts/dev/.env.keys.example` →
`scripts/dev/.env.keys` and fill in real values (.env.keys is gitignored).

**Scenario B — Восстановление бэкапа (Backup restore after bare launch)**

After a bare launch, restore a previously exported `.db` backup to bring in
experiments without reinstalling.

Two modes available from the app UI (Settings → Backups):

| UI button | Rust command | Behaviour |
|----------|-------------|-----------|
| **Restore** | `backup_restore` | Replaces the whole DB with the backup. App **restarts automatically** (works in release mode; dev mode restart is unreliable). |
| **Import DB** | `backup_import_db` | Merges only experiments from the `.db` file into the current DB. No restart needed. Safe to run on an existing populated DB. |

Typical flow:
```
1. .\scripts\dev\fresh-launch.ps1          # clean DB, голый запуск
2. In app UI → Settings → Backups → Import DB → select your .db backup
3. Experiments appear in the library immediately (no restart)
```

Or, if you want a full DB swap:
```
1. .\scripts\dev\fresh-launch.ps1          # clean DB
2. In app UI → Settings → Backups → Restore → select backup → app restarts
```

### Build

| Script | Purpose |
|--------|---------|
| `scripts/build/build-portable.ps1` | Creates a portable ZIP in `outputs/portable/` (no installer) |

### Release

| Script | Purpose |
|--------|---------|
| `scripts/release/generate-updater-keys.js` | Generates Tauri updater Ed25519 key pair. Run once per environment. |

Usage:
```powershell
node scripts/release/generate-updater-keys.js
```
Store the private key + password as CI secrets (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). Commit the public key to `src-tauri/tauri.conf.json → plugins.updater.pubkey`.

The release pipeline is invoked via npm scripts:
```bash
npm run release:prepare              # Full: QA → build → manifest + checksums
npm run release:prepare:skip-qa      # Skip QA preflight
npm run release:prepare -- --dry-run # Policy check only (no build)
```

### Testing

| Script | Purpose |
|--------|---------|
| `scripts/test/run-e2e-matrix.js` | Runs Playwright E2E test matrix against a built Tauri app |

Usage:
```bash
node scripts/test/run-e2e-matrix.js smoke   # Smoke suite
node scripts/test/run-e2e-matrix.js full    # Full suite
node scripts/test/run-e2e-matrix.js all     # All suites
```

### Audit

```powershell
scripts/audit/   # Dependency and code audit helpers
```

---

## npm Script Shortcuts

All commonly-used scripts are exposed as npm scripts in `package.json`:

| npm script | Underlying command |
|------------|--------------------|
| `npm run tauri:dev` | `tauri dev` (Vite + Rust, hot reload) |
| `npm run tauri:build` | `tauri build` (production NSIS installer) |
| `npm run test` | `vitest run` |
| `npm run test:watch` | `vitest` |
| `npm run test:coverage` | `vitest run --coverage` |
| `npm run qa:autonomous:fast` | Vitest + build check |
| `npm run qa:autonomous` | Vitest + build + Tauri debug installer |
| `npm run release:prepare` | Full release pipeline |
| `npm run doctor:windows` | Prerequisite check (Windows) |
| `npm run doctor:linux` | Prerequisite check (Linux) |
