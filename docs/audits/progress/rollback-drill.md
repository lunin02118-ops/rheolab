# W6-03 rollback drill

## Scope

Documents and tests the release rollback drill.

Changed areas:

- `scripts/release/lib/rollback-drill.js`
- `scripts/release/rollback-drill.js`
- `tests/release/rollback-drill.test.ts`
- `docs/release/ROLLBACK_DRILL.md`
- `docs/RELEASE_AND_DEPLOY.md`
- `docs/audits/progress/rollback-drill.md`

## Non-scope

- No licensing, demo, or 30-day trial behavior changes.
- No updater server, VPS credential, deploy state, or release artifact changes.
- No version bump.

## What changed

- Added a non-mutating rollback drill planner.
- The drill covers bad release detection, rollback channel update,
  server-side deploy safety, artifact cleanup, and user-facing version behavior.
- The stable channel blast radius explicitly includes Trial and Demo users.
- The drill documents that updater rollback does not downgrade clients that
  already installed the bad version; those clients need a forward hotfix.

## Validation

Planned before review:

- `npm run version:validate`
- `git diff --check`
- hidden/bidi scan on changed docs/scripts/tests
- `node --check scripts/release/rollback-drill.js`
- `node --check scripts/release/lib/rollback-drill.js`
- `npm run typecheck`
- `npm run lint`
- `npm run test -- tests/release/rollback-drill.test.ts tests/release/rollback-utils.test.ts tests/release/updater-contract-smoke.test.ts`
- `node scripts/release/rollback-drill.js --channel beta --bad-version 0.2.3-alpha.24 --to-version 0.2.3-alpha.23 --reason "bad beta release regression"`
- `npm run audit:large-ipc`

## Rollback

Revert this PR. Runtime updater behavior and server state are unchanged.
