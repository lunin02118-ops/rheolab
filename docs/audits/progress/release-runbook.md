# W7-02 release runbook

## Scope

Adds the release operator runbook.

Changed areas:

- `docs/release/RELEASE_RUNBOOK.md`
- `docs/RELEASE_AND_DEPLOY.md`
- `docs/audits/progress/release-runbook.md`

## Non-scope

- No runtime code changes.
- No scripts, tests, dependencies, CI, release artifacts, version files, Tauri
  config, website code, or license-server code changed.

## What changed

- Added operator flows for internal/alpha validation, beta release, and stable
  release.
- Added signing verification steps and proof retention requirements.
- Added local and live update endpoint verification steps.
- Linked rollback procedure to the W6 rollback drill.
- Listed release logs/artifacts that must be retained.

## Validation

Planned before review:

- `npm run version:validate`
- `git diff --check`
- hidden/bidi scan on changed docs

## Rollback

Revert this PR or delete `docs/release/RELEASE_RUNBOOK.md` and the progress
note, then remove the link from `docs/RELEASE_AND_DEPLOY.md`.
