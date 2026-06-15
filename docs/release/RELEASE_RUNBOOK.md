# Release operator runbook

This runbook is the operator-facing checklist for preparing, publishing, and
verifying RheoLab desktop releases. It complements `docs/RELEASE_AND_DEPLOY.md`,
`docs/release/RELEASE_GATE.md`, and `docs/release/ROLLBACK_DRILL.md`.

## Operating principles

- Local validation is authoritative for this repository.
- Do not publish from a dirty checkout.
- Do not hand-edit generated version dependents. Edit `version.json`, then run
  `npm run version:sync`.
- Do not use `--skip-release-gate` for any published release.
- Do not use `--allow-unsigned` as release evidence for signed channels.
- Do not publish `stable` when validating alpha/beta behavior.
- `audit/00-baseline` is a reference branch only and must not be merged.

## Channels

| Channel | Audience | Signing | Notes |
| --- | --- | --- | --- |
| `internal` | CI/local policy checks only | not required | Never distribute this channel to users. |
| `alpha` | owner/superuser validation | required | Default release channel for unqualified `release:prepare`. |
| `beta` | developer/internal beta users | required | Use for beta candidate validation. |
| `stable` | Standard / Enterprise / Trial / Demo users | required | Public production channel. Highest blast radius. |

## Required evidence folder

For each release candidate, retain these items with the release notes or audit
packet:

- `git rev-parse HEAD`
- `git status --short --branch`
- `npm run version:validate`
- `git diff --check`
- `npm run lint`
- `npm run typecheck`
- `npm run test:release-gate`
- `npm run release:prepare -- --channel <channel> --dry-run --skip-qa`
- generated signing dry-run proof under `runtime/release/dry-run/`
- release manifest and checksums under `runtime/release/`
- `npm run check:update -- --manifest outputs/release/<channel>.json --channel <channel> --skip-artifact-reachability`
- live `npm run check:update -- --channel <channel> --version <version>`
- `node scripts/deploy/publish-update.js --dry-run ...` output
- post-publish `node scripts/deploy/publish-update.js ...` output
- rollback drill output for the same channel
- cleanup dry-run output if server cleanup was performed

## Pre-flight for every channel

Start from a clean checkout:

```bash
git fetch --all --prune
git checkout main
git pull --ff-only
git status --short --branch
git rev-parse HEAD
git merge-base --is-ancestor audit/00-baseline main && echo BAD_MERGED || echo OK_NOT_MERGED
```

Validate version state:

```bash
npm run version:validate
git diff --check
```

Run quality gates:

```bash
npm run lint
npm run typecheck
npm run test:release-gate
npm run audit:large-ipc
```

For release/update changes, also run:

```bash
npm run test -- tests/release/signing-dry-run-proof.test.ts tests/release/updater-contract-smoke.test.ts tests/release/rollback-drill.test.ts
```

## Internal validation flow

Use this before handing a build to anyone outside the operator machine.

Important distinction: `--channel internal` is CI/local only and is not a user
distribution channel. For owner-machine validation, use `alpha`.

```bash
npm run release:prepare -- --channel alpha --dry-run --skip-qa
npm run test:release-gate
```

Confirm the dry-run proof exists:

```bash
dir runtime\release\dry-run
```

Expected result:

- signing environment validated;
- updater config validated;
- no raw signing or licensing secrets in logs or proof;
- no release artifact was published.

## Beta release flow

Use beta for developer/internal beta users only.

Strict signing dry-run:

```bash
npm run release:prepare -- --channel beta --dry-run --skip-qa
```

Build signed release artifacts:

```bash
npm run release:prepare -- --channel beta
```

Validate local update manifest before publish:

```bash
npm run check:update -- --manifest outputs/release/beta.json --channel beta --skip-artifact-reachability
```

Dry-run publish:

```bash
node scripts/deploy/publish-update.js --channel beta --dry-run
```

Publish:

```bash
node scripts/deploy/publish-update.js --channel beta
```

Verify live endpoint:

```bash
npm run check:update -- --channel beta --version <version>
```

Retain:

- signing dry-run proof;
- release manifest/checksums;
- `beta.json`;
- publish dry-run output;
- post-publish `check:update` output.

## Stable release flow

Stable serves Standard, Enterprise, Trial, and Demo users. Do not use it for
beta or alpha validation.

Strict signing dry-run:

```bash
npm run release:prepare -- --channel stable --dry-run --skip-qa
```

Build signed release artifacts:

```bash
npm run release:prepare -- --channel stable
```

Validate local update manifest:

```bash
npm run check:update -- --manifest outputs/release/stable.json --channel stable --skip-artifact-reachability
```

Dry-run publish:

```bash
node scripts/deploy/publish-update.js --channel stable --dry-run
```

Publish:

```bash
node scripts/deploy/publish-update.js --channel stable
```

Verify live endpoint:

```bash
npm run check:update -- --channel stable --version <version>
```

Retain stable evidence longer than alpha/beta evidence because it affects Trial
and Demo users.

## Signing verification

Signed channels are `alpha`, `beta`, and `stable`.

Run strict dry-run without `--allow-unsigned`:

```bash
npm run release:prepare -- --channel <alpha|beta|stable> --dry-run --skip-qa
```

Check:

- command exits with `0`;
- proof file exists under `runtime/release/dry-run/`;
- proof says `signedArtifactsRequired: true`;
- proof says `allowUnsignedOverride: false`;
- proof says `signingEnvironmentValidated: true`;
- logs do not contain raw private keys, passwords, integrity keys, or channel secrets.

`--allow-unsigned` is advisory-only. It is not release evidence for signed
channels.

## Update endpoint verification

Local manifest smoke:

```bash
npm run check:update -- --manifest outputs/release/<channel>.json --channel <channel> --skip-artifact-reachability
```

Live endpoint smoke:

```bash
npm run check:update -- --channel <channel> --version <version>
```

The smoke must validate:

- manifest schema;
- `platforms.windows-x86_64`;
- strict base64 updater signature;
- Tauri minisign structure;
- HTTPS artifact URL on `license.vizbuka.ru`;
- `/releases/artifacts/<version>/..._x64-setup.exe`;
- local artifact contract before publish, with remote `HEAD` intentionally
  skipped because the future artifact URL may not exist yet;
- post-publish/live `HEAD` reachability and content length.

## Rollback procedure

Use the drill before any rollback:

```bash
node scripts/release/rollback-drill.js \
  --channel <channel> \
  --bad-version <bad-version> \
  --to-version <rollback-version> \
  --reason "bad release"
```

Dry-run the local rollback:

```bash
node scripts/release/rollback-channel.js --channel <channel> --dry-run --to-version <rollback-version>
```

Apply local rollback:

```bash
node scripts/release/rollback-channel.js --channel <channel> --to-version <rollback-version> --reason "bad release"
```

Dry-run publish from the known manifest:

```bash
node scripts/deploy/publish-update.js --from-manifest outputs/release/<channel>.json --channel <channel> --dry-run
```

Publish rollback manifest:

```bash
node scripts/deploy/publish-update.js --from-manifest outputs/release/<channel>.json --channel <channel>
```

Validate live endpoint:

```bash
npm run check:update -- --channel <channel> --version <rollback-version>
```

Important: updater rollback does not downgrade clients that already installed a
bad higher version. Those clients need a forward hotfix with a version greater
than the bad release.

## Artifact cleanup

Only clean after the channel manifest and live endpoint are verified.

```bash
node scripts/deploy/cleanup-server.js --dry-run --keep 3
node scripts/deploy/cleanup-server.js --keep 3
```

Retain cleanup dry-run output in release evidence.

## Stop conditions

Stop the release and do not publish when any of these occur:

- `audit/00-baseline` is an ancestor of `main`;
- version validation fails;
- release gate fails;
- strict signing dry-run fails;
- proof or logs expose raw secret values;
- updater manifest schema/signature/URL validation fails;
- live artifact URL is not reachable;
- stable channel is selected for an alpha/beta incident;
- rollback target is lower than the bad version and no forward hotfix plan exists
  for already-updated users.
