# W6-01 signing dry-run proof

## Scope

Adds release dry-run evidence for the existing `release:prepare` flow.

Changed areas:

- `scripts/release/prepare-production.js`
- `scripts/release/lib/signing-dry-run-proof.js`
- `tests/release/signing-dry-run-proof.test.ts`
- `docs/RELEASE_AND_DEPLOY.md`
- `docs/audits/progress/signing-dry-run-proof.md`

## Non-scope

- No licensing, demo, or 30-day trial behavior changes.
- No updater server, publish, or VPS changes.
- No Tauri bundle/signing implementation replacement.
- No version bump.

## What changed

- `--dry-run` now writes an ignored proof artifact under
  `runtime/release/dry-run/`.
- The proof records signing policy, updater validation, compile-time secret
  presence, and deterministic release artifact naming.
- The proof deliberately records booleans and public artifact names only; raw
  signing keys, passwords, integrity keys, channel secrets, and token-like env
  values are rejected.
- Strict release evidence is the dry-run path without `--allow-unsigned`.
  `--allow-unsigned` remains advisory-only.

## Validation

Planned before review:

- `npm run version:validate`
- `git diff --check`
- hidden/bidi scan on changed docs/scripts/tests
- `npm run typecheck`
- `npm run test -- tests/release/signing-dry-run-proof.test.ts tests/release/release-policy.test.ts tests/release/tauri-updater-config.test.ts tests/release/update-manifest-format.test.ts`
- `npm run release:prepare -- --channel beta --dry-run --skip-qa`

## Rollback

Revert this PR. Runtime dry-run proof files are written under ignored
`runtime/release/`.
