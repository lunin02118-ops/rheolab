# VPS Maintenance - 2026-05-04

Scope: configured RheoLab VPS `license.vizbuka.ru` / `vm3776683.firstbyte.club`, plus local generated agent/test artifacts in `D:\Development\Rheolab`.

Mode: targeted cleanup after the read-only audit in `docs/server/VPS-AUDIT-2026-05-04.md`.

## VPS Actions Performed

No application code, database data, TLS material, SSH configuration, or web/app service configuration was changed. Only backup maintenance scripts were adjusted for local retention.

Removed / cleaned:

- failed license backup staging directory: `/var/backups/license-server/2026-05-01_03-00-01`;
- old local license backup archives from `2026-04-25` through `2026-04-30` after confirming matching S3 daily objects and `.sha256` files;
- incomplete local archive `backup_2026-05-01_03-00-01.tar.gz` after `gzip -t` failed;
- old website deploy snapshots under `/var/www/rheolab.site_backup_*`, keeping the latest 3 rollback snapshots;
- root pip cache: `/root/.cache/pip`;
- apt package cache via `apt-get clean`;
- system journal to a bounded size via `journalctl --vacuum-size=50M`;
- `/var/log/btmp` via `truncate -s 0`.

Backup retention adjusted:

- `/usr/local/bin/backup-license.sh`: added `LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-7}"` for local archives;
- `/usr/local/bin/backup-license.sh`: added `LOCAL_KEEP_COUNT="${LOCAL_KEEP_COUNT:-3}"`;
- `/usr/local/bin/backup-license.sh`: moved local archive pruning after successful S3 upload;
- `/usr/local/bin/backup-license.sh`: local pruning now keeps the latest 3 local archives and deletes older archives only when the matching S3 daily object and `.sha256` are confirmed;
- `/usr/local/bin/backup-license.sh`: if S3 upload is not configured/available, it falls back to age-based local cleanup instead of aggressively deleting recent backups;
- `/usr/local/bin/cleanup-license.sh`: changed local cleanup retention from `30` days to `7` days;
- S3/default remote retention remains based on `RETENTION_DAYS=30` unless `S3_RETENTION_DAYS` overrides it;
- script backups were saved under `/root/maintenance-20260504`.

Not performed:

- no package upgrades;
- no `apt-get autoremove`;
- no service restarts;
- no deletion of current website or license-server app directories;
- no deletion of current local license backup archives;
- no SSH hardening changes yet.

## VPS Result

| Metric | Before | After |
|---|---:|---:|
| Root disk used | `4.5G` / `78%` | `2.7G` / `46%` |
| Root disk free | `1.3G` | `3.2G` |
| `/var/backups/license-server` | `1.7G` | `188M` |
| apt archives | `94M` | `16K` |
| system journal | `95.2M` | `40.0M` |
| `/var/log/btmp` | `39M` | `0` |
| old website deploy snapshots | `60M`, many dirs | latest 3 snapshots retained |
| root pip cache | `24M` | removed |

Approximate VPS space reclaimed: `1.8G`.

## VPS Health Check

Services after cleanup:

- `apache2`: active;
- `mysql`: active;
- `cron`: active;
- `fail2ban`: active.

Network exposure remained unchanged:

- public: `22`, `80`, `443`;
- MySQL: localhost only on `127.0.0.1:3306` and `127.0.0.1:33060`.

Latest backup integrity was rechecked:

- `/var/backups/license-server/backup_2026-05-04_03-00-01.tar.gz`;
- size: `84M`;
- `gzip -t`: OK.

Local backup set after pruning:

- `backup_2026-05-02_03-00-01.tar.gz`: OK;
- `backup_2026-05-03_03-00-01.tar.gz`: OK;
- `backup_2026-05-04_03-00-01.tar.gz`: OK.

S3 was checked before pruning old local archives. Daily objects and `.sha256` files exist for `2026-04-25` through `2026-04-30`, plus `2026-05-02` through `2026-05-04`.

Known remaining issue:

- `rc-local.service` is still failed. This existed before cleanup and was not changed.

## CPA / Hermes

No CPA or Hermes runtime was found on this VPS during the audit:

- no matching systemd units;
- no matching running processes;
- no matching Debian packages;
- no matching directories under common app locations;
- no matching Apache references.

No CPA/Hermes update was performed because there is no detected CPA/Hermes installation on this server.

## Local Agent/Test Artifacts Cleanup

Removed generated local artifacts from `D:\Development\Rheolab`:

| Path | Reclaimed |
|---|---:|
| `outputs/e2e/temp-webview` | `1320.85 MB` |
| `outputs/e2e/temp-db` | `640.81 MB` |
| `outputs/seed` | `1137.35 MB` |
| `outputs/resource-bench/binaries` | `154.12 MB` |
| `coverage` | `3.34 MB` |
| `playwright-report` | `0.49 MB` |
| `test-results` | `0 MB` |
| `website/outputs/site-audit-2026-05-04` | `2.64 MB` |

Approximate local space reclaimed: `3259.6 MB`.

Local `outputs` size changed from about `3300 MB` to about `47 MB`.

Not removed:

- `runtime/cargo-target` (`~8.9G`), because it is a Rust/Tauri build cache and deleting it would slow subsequent builds;
- `website/outputs/codex-astro-dev.log`, because it is currently held by the running dev server and is only a few KB;
- audit/report documents and small evidence summaries.

## Recommended Next Actions

1. Watch the next scheduled backup on `2026-05-05 03:00` and confirm it succeeds with the new local retention.
2. Plan a separate maintenance window for normal package upgrades.
3. Review and fix or disable `rc-local.service`.
4. Harden SSH after verifying backup key-based access: disable password auth, restrict root login, disable X11 forwarding if unused.
