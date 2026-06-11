# Crash reporting design: WP-6.3

## Context

WP-6.3 requires a local crash signal for Rust panics:

- write a `crash.log` entry on panic,
- keep it rotated,
- avoid PII and user-path leakage,
- keep sending explicitly opt-in.

Фаза A уже реализована в коде:

- `src-tauri/src/startup/crash_reporter.rs` пишет `crash-YYYYMMDD-HHMMSS.log`,
- `src-tauri/src/startup/setup.rs` ставит `std::panic::set_hook(...)` после того, как доступен `app.path().app_log_dir()`,
- отчёт кладётся рядом с приложением в `.../crash/`,
- старые отчёты удерживаются по принципу keep-5.

## Runtime behavior

### What happens on panic

1. panic hook собирает panic message,
2. hook captures `location()` from `PanicInfo`,
3. hook captures a best-effort backtrace,
4. `write_crash_report()` writes the report,
5. `prune_old_reports(..., 5)` trims old files,
6. hook delegates to the previous panic hook so stderr behavior remains intact.

### Abort / release profile

Release builds use `panic = "abort"`.

That is acceptable here because the hook runs before abort, so the report can still be written. The implementation therefore treats flushing as explicit and best-effort:

- `write_crash_report()` calls `file.sync_all()` before returning,
- Drop-based flushing is not relied upon,
- the design does not depend on any post-panic cleanup.

### Symbols / backtrace quality

Release profile also uses `strip = "symbols"`.

Implication:

- the primary signal is `panic message + location()`,
- backtrace is best-effort address data in release builds,
- source-symbol quality depends on whether the build retains symbols elsewhere.

Open question for the owner: should release builds keep PDB files for offline symbolication of crash addresses?

## UX proposal

On next startup, if a fresh crash report exists:

- show a small native dialog,
- explain that an internal error occurred,
- show the report path,
- offer `Send` / `Do not send`,
- include a `Do not ask again` checkbox.

No network send path is implemented yet. The dialog is only a design target for a later phase.

## Transport candidates

Two possible paths are left for decision:

1. POST the report to the existing license-server surface, alongside `api/*.php`, because that side already has auth and rate limiting.
2. Keep the workflow manual: user attaches the file in QA chat or support ticket.

Open questions for the owner:

- do we want any server transport at all, or is manual attachment enough?
- if there is a server, what retention policy should it use?
- should the channel be limited to alpha/beta licensed builds only?

## Sanitization

The report intentionally avoids user/environment input by construction:

- no command-line arguments,
- no environment variables,
- no user directory paths are read into the report body.

What can remain is build-time context:

- panic message,
- source location,
- address-style backtrace frames.

Those are acceptable as developer diagnostics, not user PII.

## Decisions / open items

- Phase A: done.
- Send-to-server path: not implemented.
- PDB retention for symbolication: open.
- Whether the report should auto-open on next launch or wait for user action: open.
