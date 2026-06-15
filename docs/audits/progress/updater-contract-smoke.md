# W6-02 updater contract smoke

## Scope

Adds a reusable updater manifest contract validator and wires it into the
existing update endpoint smoke script.

Changed areas:

- `scripts/release/lib/updater-contract.mjs`
- `scripts/test/check-update-endpoint.mjs`
- `tests/release/updater-contract-smoke.test.ts`
- `docs/RELEASE_AND_DEPLOY.md`
- `docs/audits/progress/updater-contract-smoke.md`

## Non-scope

- No licensing, demo, trial, or update-channel server behavior changes.
- No publish/deploy credentials, VPS scripts, or release artifacts changed.
- No version bump.

## What changed

- Update manifest schema validation is centralized in a pure release helper.
- Signature checks are stricter: non-empty strict base64, UTF-8 decoded minisign
  structure, and explicit failure reporting.
- Download URL contract is validated before the live HEAD check.
- `check:update` now supports `--manifest outputs/release/<channel>.json` for
  local pre-publish smoke.
- Rollback documentation now calls out channel-specific rollback and the
  stable/trial/demo blast radius.

## Validation

Planned before review:

- `npm run version:validate`
- `git diff --check`
- hidden/bidi scan on changed docs/scripts/tests
- `node --check scripts/test/check-update-endpoint.mjs`
- `node --check scripts/release/lib/updater-contract.mjs`
- `npm run typecheck`
- `npm run test -- tests/release/updater-contract-smoke.test.ts tests/release/update-manifest-format.test.ts tests/release/rollback-utils.test.ts`
- `npm run audit:large-ipc`

## Rollback

Revert this PR. Runtime updater behavior and server state are unchanged.
