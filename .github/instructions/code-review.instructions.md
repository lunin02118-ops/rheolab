---
applyTo: '{src/**/*.{ts,tsx,js,jsx},src/rust/**/*.rs,src-tauri/src/**/*.rs}'
---

# Code Review Standards — RheoLab Enterprise

Apply these standards whenever reviewing or analysing source code in this repository.

---

## Security (Always Check)

### Rust / Tauri
- All `#[tauri::command]` inputs must be validated before use — never trust the frontend.
- SQL queries must use rusqlite parameterised statements (named params). Flag any `format!()` used to build SQL strings.
- Cryptographic operations in `src-tauri/src/commands/licensing/` must use constant-time comparisons for secrets. Flag timing-vulnerable branches.
- `reqwest` HTTP calls must only target the configured licence server endpoint. Flag any dynamic URL construction from user input.
- `.unwrap()` / `.expect()` in non-test code is a bug risk — flag and suggest proper error propagation.

### TypeScript / React
- All `invoke()` Tauri command calls must have error handling (`.catch()` or `try/catch`).
- Never `eval()` user input or insert it into `dangerouslySetInnerHTML`.
- No hardcoded secrets, API keys, or tokens in source files.
- Input from forms and file imports must be sanitised / validated before use.

---

## Reliability

- **Rust**: `unwrap()` / `expect()` outside `#[test]` → flag it.
- **Rust**: `tokio::spawn` without error handling → flag it.
- **TypeScript**: Unhandled promise rejections → flag them.
- **SQLite**: Holding a pool connection across async await points → flag it.
- **TypeScript**: Mutations of React state outside `setState` / Zustand actions → flag them.

---

## Performance

- Rust calculation loops (rheology models, downsampling, interpolation in `rheolab-core`) — flag unnecessary `Vec` allocations inside loops.
- React components rendering large data lists (measurements, calibrations, experiment rows) — flag new object/array literals or inline functions in render.
- SQLite queries on `experiments`, `measurements`, `calibrations` — flag queries missing `WHERE` on indexed columns.
- Tauri IPC serialisation of large payloads (> 100 KB) — suggest file-based or streaming approach.

---

## Maintainability

- Functions longer than 80 lines (Rust) or 60 lines (TypeScript) → suggest decomposition.
- Commented-out code blocks → flag (use revision history instead).
- `#[allow(dead_code)]` or `// eslint-disable` without a justification comment → flag.
- `todo!()` / `unimplemented!()` outside of test/dev paths → flag as a panic risk.

---

## Testing Gaps

- New public Rust functions in `rheolab-core/src/` without `#[test]` → flag.
- New `#[tauri::command]` handlers without matching test in `src-tauri/tests/` → flag.
- New React components with business logic and no Vitest test → flag.
- Changes to licensing, DB migrations, or export paths with no E2E coverage → flag.

---

## Licensing Module (Critical)

Extra scrutiny for `src-tauri/src/commands/licensing/**`:
- Machine fingerprint changes break existing activations → always flag.
- Signature verification bypass paths → always flag as Critical.
- Deprecated crypto (MD5, SHA-1, DES, RSA < 2048-bit) → always flag as Critical.
