# Release rollback drill

This drill is the operator checklist for rolling back a published updater
manifest without changing licensing, trial, demo, or local user data behavior.

## Scope

Use this for release/update incidents:

- bad installer or bad updater manifest;
- failed post-publish `check:update`;
- release gate regression found after publish;
- server publish produced a wrong channel manifest.

Do not use this as a database, license, or activation rollback procedure.

## 1. Detect and freeze the bad release

Record:

- channel: `alpha`, `beta`, or `stable`;
- bad version;
- evidence: release gate failure, `check:update` failure, crash report, or
  operator incident note;
- whether any users have already installed the bad version.

Useful commands:

```bash
npm run test:release-gate
npm run check:update -- --manifest outputs/release/<channel>.json --channel <channel>
npm run check:update -- --channel <channel> --version <bad-version>
```

Stop any further publish/deploy actions until the target channel is known.

## 2. Pick the channel deliberately

Channel blast radius:

- `alpha`: owner/superuser channel only;
- `beta`: Developer/internal beta channel only;
- `stable`: public Standard / Enterprise / Trial / Demo channel.

Never use `stable` to rollback an `alpha` or `beta` incident. That changes the
channel seen by trial/demo and external users.

## 3. Dry-run the local channel rollback

```bash
node scripts/release/rollback-drill.js \
  --channel beta \
  --bad-version <bad-version> \
  --to-version <rollback-version> \
  --reason "bad beta release"

node scripts/release/rollback-channel.js \
  --channel beta \
  --dry-run \
  --to-version <rollback-version>
```

The dry-run must show the expected previous manifest. If it does not, stop and
use `--to-manifest <release-manifest-v...json>` explicitly.

## 4. Apply the channel rollback locally

```bash
node scripts/release/rollback-channel.js \
  --channel beta \
  --to-version <rollback-version> \
  --reason "bad beta release"
```

This updates `runtime/release/channels/<channel>/latest-manifest.json` and
writes a rollback audit log. For `stable`, it also updates
`runtime/release/latest-manifest.json`.

## 5. Publish safely

Always dry-run the server publish first:

```bash
node scripts/deploy/publish-update.js \
  --from-manifest outputs/release/beta.json \
  --channel beta \
  --dry-run
```

Then publish:

```bash
node scripts/deploy/publish-update.js \
  --from-manifest outputs/release/beta.json \
  --channel beta
```

`publish-update.js` uploads `{channel}.json.tmp`, validates the server-side
version, then atomically renames it to `{channel}.json`. This prevents clients
from seeing a partial manifest.

## 6. Validate live updater contract

```bash
npm run check:update -- --channel beta --version <rollback-version>
```

Confirm:

- manifest schema is valid;
- signature has Tauri minisign structure;
- download URL is reachable;
- channel is still the intended channel.

## 7. Clean artifacts after validation

Only after the rollback channel is validated:

```bash
node scripts/deploy/cleanup-server.js --dry-run --keep 3
node scripts/deploy/cleanup-server.js --keep 3
```

The dry-run must list the artifact directories that will be kept/deleted.

## 8. User-facing version behavior

Updater rollback is not a downgrade mechanism.

If users already installed bad version `X`, and the rollback manifest points to
older version `Y`, those clients will not auto-downgrade from `X` to `Y`.

Expected behavior:

- users who have not installed `X` stop seeing `X`;
- users already on `X` need a forward hotfix version greater than `X`;
- stable rollback affects Trial and Demo users too.

For already-updated clients, publish a hotfix:

```text
bad:     0.2.3-alpha.24
rollback: 0.2.3-alpha.23  # stops future offers, does not downgrade X clients
hotfix:  0.2.3-alpha.25   # can update clients already on X
```

## Evidence to retain

- incident reason and channel;
- selected rollback manifest/version;
- `rollback-channel.js --dry-run` output;
- rollback audit log path;
- `publish-update.js --dry-run` output;
- `check:update` output after publish;
- cleanup dry-run output.
