# RheoLab Enterprise V2 - Multi-Client / Cloud SQL Feasibility

Дата: 2026-04-24  
Запрос: рассмотреть работу нескольких программ с одной БД в сети, вынос БД в облако и вариант SQL database на reg.ru.

## Short Answer

Функционал реализуем, но **не как общий SQLite-файл на сетевой папке**. Для нескольких клиентов, которые одновременно пишут в одну базу по сети, правильная архитектура - client/server DB или API-сервер поверх БД.

Рекомендуемый целевой вариант:

- Локальный standalone режим оставить на SQLite.
- Для командной/сетевой работы добавить режим `Team / Cloud`.
- В `Team / Cloud` режиме Tauri-клиенты работают не напрямую с файлом БД, а через backend API.
- Backend API работает с PostgreSQL или MySQL в облаке.
- Для reg.ru использовать не обычную “сетевую папку” и не SQLite, а managed PostgreSQL/MySQL из Рег.облака.

## External Source Notes

SQLite официально предупреждает, что прямой доступ нескольких компьютеров к одному SQLite-файлу через network filesystem часто приводит к проблемам. В документации SQLite указано, что при множестве client programs, отправляющих SQL к одной БД по сети, следует использовать client/server database engine вместо SQLite: [Appropriate Uses For SQLite](https://sqlite.org/whentouse.html). Отдельная страница SQLite про network use также говорит, что remote database через network filesystem обычно не лучший путь: [SQLite Over a Network](https://www.sqlite.org/useovernet.html).

reg.ru / Рег.облако сейчас предлагает managed cloud DB для PostgreSQL и MySQL: [Реляционные базы данных | Рег.ру](https://help.reg.ru/support/servery-vps/oblachnyye-bazy-dannykh/zakaz-i-upravleniye-uslugoy-oblachnyye-bazy-dannykh/relyatsionnyye-bazy-dannykh). В описании указаны готовые кластеры, реплики, масштабирование и перенос БД. На странице MySQL также указаны managed MySQL, репликация, failover, тарифы и backups: [MySQL облачная база данных | Рег.облако](https://reg.cloud/services/mysql).

## Current Architecture Impact

Текущая БД-архитектура плотно завязана на SQLite:

- `src-tauri/Cargo.toml` использует `rusqlite` и `r2d2_sqlite`.
- `src-tauri/src/db/pool.rs` создает SQLite pool и настраивает `PRAGMA journal_mode = WAL`, `synchronous`, `mmap_size`.
- `src-tauri/src/db/migration.rs` и `src-tauri/src/db/migrations/*` содержат SQLite schema/migration flow.
- Многие команды напрямую используют `rusqlite::Connection`, `params`, `transaction`, `unchecked_transaction`.
- Backup/import завязаны на SQLite-only операции: `VACUUM INTO`, `ATTACH DATABASE`, WAL/SHM companion files.
- Локальные секреты/API keys/license cache сейчас привязаны к desktop/local storage model.

Вывод: cloud SQL нельзя безопасно внедрить простой заменой SQLite path на remote path. Нужен storage boundary и отдельный backend mode.

## Options

### Option A - Shared SQLite file on LAN/network share

Verdict: **Do not implement as production feature**.

Pros:

- Минимальный объем кода на первый взгляд.
- Похоже на “один файл для всех”.

Cons:

- Официально проблемный сценарий для SQLite при multi-computer access.
- Риск corruption из-за сетевых locks, SMB/NFS latency и broken file locking.
- WAL/SHM поведение в сетевых сценариях усложняет backup/restore.
- Не решает auth, audit log, tenant isolation, conflict resolution.

Acceptable only:

- Как явно unsupported lab/debug mode для одного writer и резервных копий.
- Не для enterprise/customer release.

### Option B - Direct desktop clients connect to cloud PostgreSQL/MySQL

Verdict: **Technically possible, but not recommended as default architecture**.

Pros:

- Нет отдельного API сервера.
- Быстрее сделать proof of concept.
- PostgreSQL/MySQL решают server-side concurrency лучше SQLite.

Cons:

- DB credentials придется хранить/распространять в desktop app.
- Трудно безопасно ограничить SQL surface на клиентах.
- Миграции и schema versioning становятся опасными: разные версии приложения могут менять одну БД.
- Firewall/IP allowlist/TLS/cert rotation усложняют поддержку.
- Offline mode почти отсутствует.
- Любая ошибка в Tauri app может стать прямой DB mutation.

Acceptable only:

- Internal admin tool.
- Short-lived prototype.
- Environment behind VPN with strict DB roles and no customer distribution.

### Option C - API server + managed PostgreSQL/MySQL

Verdict: **Recommended primary architecture**.

Shape:

- Tauri app -> HTTPS API -> PostgreSQL/MySQL.
- API server owns DB credentials and migrations.
- Desktop receives scoped auth token, not DB password.
- API enforces license, RBAC, write gates, validation, optimistic concurrency.

Pros:

- Safer security boundary.
- One place for migrations and business rules.
- Works with reg.ru managed PostgreSQL/MySQL.
- Easier audit logging and support.
- Allows web/mobile clients later.
- Better release compatibility: old clients can be rejected or routed by API version.

Cons:

- Requires backend service development and deployment.
- Requires auth/session design.
- Requires online connectivity unless combined with local cache/sync.

Best fit:

- Enterprise team mode.
- Shared lab database.
- Cloud-hosted customer orgs.

### Option D - Offline-first local SQLite + cloud sync

Verdict: **Best UX, highest complexity**.

Shape:

- Each desktop keeps local SQLite.
- Cloud DB/API stores canonical shared state.
- App syncs deltas, resolves conflicts, supports offline work.

Pros:

- Works offline.
- Keeps fast local reports/parsing.
- Reduces cloud latency in UI.
- Can reuse some existing `data_flows/sync` concepts.

Cons:

- Conflict resolution is hard.
- Needs tombstones, per-row versions, idempotency keys, sync cursors.
- Must define domain-specific conflict policy for experiments/reagents/operators/labs/reports.
- More tests and audit burden.

Best fit:

- Labs with unreliable network.
- Field/offline users.
- Long-term product direction after API-server foundation.

## Recommended Product Direction

Build two supported modes:

### Mode 1 - Local Standalone

- Current SQLite model.
- Single user / single desktop.
- Local backup/restore.
- No network sharing of SQLite file.

### Mode 2 - Team / Cloud

- Central API server.
- PostgreSQL preferred; MySQL possible.
- reg.ru managed PostgreSQL/MySQL can be provider option.
- Optional local read-through cache later.

For reg.ru specifically:

- Prefer **Рег.облако Managed PostgreSQL** for new architecture.
- MySQL is acceptable if there is a strong hosting/business reason, but PostgreSQL is usually better for complex domain models, JSON metadata, row locks, migrations and future analytics.
- Avoid ordinary shared hosting DB as the primary enterprise backend if it lacks private networking, reliable backup controls, monitoring and connection limits suitable for desktop clients.

## Required Architecture Changes

### 1. Storage Boundary

Introduce a storage abstraction so commands stop depending directly on `rusqlite::Connection`.

Example conceptual split:

- `ExperimentRepository`
- `ReagentRepository`
- `OperatorRepository`
- `LabRepository`
- `BackupRepository`
- `DataFlowRepository`
- `LicenseRepository`

Each repository should have at least:

- SQLite implementation for standalone.
- Remote/API implementation for team/cloud.
- Test contract shared by both implementations.

### 2. Server-Side API

Add a backend service, likely Rust:

- `axum` or similar HTTP framework.
- PostgreSQL via `sqlx` or `deadpool-postgres`.
- Auth middleware.
- Tenant/org isolation.
- Audit logging.
- Migration runner.
- Versioned API routes.

Potential API groups:

- `/auth`
- `/license`
- `/experiments`
- `/reagents`
- `/operators`
- `/labs`
- `/reports`
- `/sync`
- `/admin/backup`

### 3. Schema Portability

SQLite schema must be translated:

- `TEXT` IDs can remain UUID strings or become native UUID in PostgreSQL.
- `BLOB` remains `BYTEA` in PostgreSQL.
- `datetime('now')` becomes `now()` / timestamptz.
- `INSERT OR IGNORE` becomes `ON CONFLICT DO NOTHING`.
- SQLite PRAGMA/WAL/ATTACH/VACUUM operations need new equivalents or API-side workflows.
- Full-text/search strategy needs explicit decision: PostgreSQL FTS, trigram indexes, or app-side search.

### 4. Concurrency Model

Multi-client writes require explicit policy:

- Add `tenant_id` / `org_id` to shared data.
- Add `created_by`, `updated_by`.
- Add `row_version` or `revision`.
- Add `updated_at` with server time.
- Add `deleted_at` tombstones for sync.
- Use optimistic concurrency: update succeeds only if expected version matches.
- Use idempotency keys for import/sync/save operations.
- Add server-side audit log for destructive actions.

### 5. Licensing and Permissions

Current write-gate audit findings become more important in team mode.

Need:

- Server-side license enforcement.
- Server-side RBAC: owner/admin/operator/viewer.
- Client-side gating only as UX; server is authority.
- Per-tenant quotas if SaaS-like.
- Explicit policy for offline grace period if offline sync is later added.

### 6. Backup/Restore Model

Local SQLite backup/restore does not map directly to cloud shared DB.

Team/cloud backup should be:

- Server-side scheduled backups.
- Point-in-time restore if provider supports it.
- Tenant-scoped export/import jobs.
- Restore to staging/new tenant first, not in-place destructive restore.
- Admin-only operation with audit trail.

### 7. Security

Minimum controls:

- TLS everywhere.
- No raw DB credentials in desktop app for production.
- API tokens with rotation/expiry.
- DB only accessible from API server/VPN/private network.
- IP allowlist/private networking where possible.
- Secrets stored server-side.
- Audit logs for writes/deletes/import/export.
- Data residency/privacy review for customer data.

## reg.ru Deployment Shape

Recommended reg.ru shape:

- Reg.Cloud Managed PostgreSQL as primary DB.
- Separate VPS/cloud server for RheoLab API.
- DB network access restricted to API server.
- HTTPS endpoint for Tauri clients.
- Backups/snapshots enabled and tested.
- Staging and production DB clusters separated.

Minimal pilot shape:

- 1 small managed PostgreSQL cluster.
- 1 API server.
- 1 staging tenant.
- 2-3 desktop clients running concurrent experiment/reagent/operator workflows.

Do not expose:

- PostgreSQL/MySQL public credentials directly in every Tauri client.
- SQLite database file on SMB/NFS as official multi-user mode.

## Migration Strategy

### Phase A - Discovery / POC

Goal: prove that the app can use a non-SQLite backend for one vertical slice.

Tasks:

- Select PostgreSQL vs MySQL. Recommendation: PostgreSQL first.
- Pick one domain: experiments list/save/delete.
- Extract repository contract for that domain.
- Implement API endpoints for that domain.
- Add remote mode config behind feature flag.
- Run two clients against same server and test concurrent writes.

Acceptance:

- Two desktop clients can see shared experiments.
- Conflict on same experiment is detected, not silently overwritten.
- Local SQLite mode still works.

### Phase B - Core Team Mode

Goal: move all shared mutable domains behind API.

Tasks:

- Experiments.
- Reagents.
- Operators.
- Laboratories.
- Data flows/sync artifacts.
- Report metadata/settings.
- Auth/RBAC/license enforcement.

Acceptance:

- No client direct SQL writes in team mode.
- Server-side tests cover permissions and concurrency.
- API version compatibility policy exists.

### Phase C - Cloud Ops

Goal: make provider deployment safe.

Tasks:

- Reg.ru staging deployment.
- Backups/restore drill.
- Monitoring/logging.
- DB migrations pipeline.
- Secrets management.
- Rate limits and audit log export.

Acceptance:

- Restore drill successful.
- Failed migration rollback/recovery documented.
- Production deploy checklist exists.

### Phase D - Offline Sync

Goal: optional future offline-first mode.

Tasks:

- Local cache schema.
- Sync cursor/delta protocol.
- Conflict UI.
- Tombstones.
- Retry/idempotency.

Acceptance:

- Offline edits sync after reconnect.
- Conflicts are visible and resolvable.
- Data loss tests pass.

## Risk Register

### R1 - Direct cloud DB credentials in desktop app

Severity: High  
Mitigation: use API server; do not ship DB credentials to clients.

### R2 - Multi-version clients mutate one schema

Severity: High  
Mitigation: API versioning and server-owned migrations.

### R3 - Silent overwrite conflicts

Severity: High  
Mitigation: optimistic concurrency and domain conflict UI.

### R4 - Cloud outage blocks lab work

Severity: Medium/High depending on customer workflow  
Mitigation: local standalone fallback or offline sync roadmap.

### R5 - Provider lock-in / data residency

Severity: Medium  
Mitigation: standard PostgreSQL schema, export tools, documented backup/restore, provider-neutral API.

### R6 - Current write-gate gaps become server-side authorization gaps

Severity: High  
Mitigation: close Wave 4 write-gate issues before/while implementing team mode.

## Recommendation

Do not implement network-shared SQLite. Treat it as unsupported.

Start with a PostgreSQL-backed API-server POC. reg.ru / Рег.облако is a viable provider option for managed PostgreSQL/MySQL, but the application should be architected provider-neutral so it can run on reg.ru, another cloud, or an on-prem customer server.

Suggested next concrete step:

1. Create a `TEAM_MODE_ARCHITECTURE.md` / technical design from this feasibility note.
2. Choose POC vertical slice: experiments list/save/delete.
3. Define repository/API contracts and concurrency semantics.
4. Build a small staging PostgreSQL/API pilot before touching all domains.
