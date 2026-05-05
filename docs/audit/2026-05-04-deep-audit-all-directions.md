# Глубокий аудит RheoLab Enterprise V2 — все направления

**Дата**: 2026-05-04  
**Версия кодовой базы**: `0.2.2-alpha.22` (channel: `alpha`)  
**Автор аудита**: Cascade (read-only review, без изменений в коде)  
**Охват**: архитектура, производительность, безопасность, код-качество, тесты, зависимости, CI/релиз

---

## 0. Executive summary

Кодовая база **в хорошем enterprise-состоянии**. Архитектурных проблем нет:

- Чистая граница Rust ↔ TypeScript через Tauri IPC + `specta` для автогенерации типов.
- Продуманная многоуровневая безопасность лицензирования (HMAC + RSA + HKDF + AES-GCM).
- SSoT-версионирование с защитой pre-build валидаторами.
- Развитая тестовая инфраструктура: Vitest, Playwright (Tauri perf/soak/benchmark), `cargo test`, proptest, criterion, insta.
- Строгий ESLint (`no-explicit-any: error`, `exhaustive-deps: error`, `no-floating-promises: error`, гейт на raw `invoke`).

Найденные проблемы — **housekeeping**, а не архитектурные:

| Количество | Категория |
|---|---|
| **4** | P1 — высокий приоритет (исправить в ближайший цикл) |
| **5** | P2 — средний приоритет (следующая итерация) |
| **7** | P3 — накопительная гигиена |

Системных рисков для релиза не выявлено.

---

## 1. Общая карта стека

### 1.1 Frontend
- **React 19.2.5** + **TypeScript 6** (strict), **Vite 8 (Rolldown)**.
- **Zustand 5** для state, **TanStack Virtual 3** для списков, **uPlot 1.6** для графиков.
- **Radix UI** + **Tailwind 4** + `class-variance-authority` / `tailwind-merge`.
- Lazy-loaded routes через `react-router-dom 7`.
- CSP: `default-src 'self'`, `connect-src` ограничен `license.vizbuka.ru` + `api.groq.com`.

### 1.2 Desktop shell — Tauri 2.10
- Плагины: `fs`, `dialog`, `http`, `updater`, `log`, `os`, `shell`, `process`, `opener`.
- Signed NSIS installer, pubkey для updater встроен.
- `additionalBrowserArgs` агрессивно ограничивает WebView2 (BFCache off, single renderer, js-heap 512 MB).

### 1.3 Backend — Rust 2021
- `src-tauri/src/`: 147 файлов Rust, 1 484 KB кода.
- `src/rust/rheolab-core/`: 95 файлов, 818 KB (рассчётное ядро + parser + Typst PDF + Excel + plotters SVG).
- SQLite: `rusqlite 0.32` + `r2d2_sqlite 0.25`, WAL + mmap 256 MB + cache 20 MB, `max_size=8`.
- Крипто: `aes-gcm 0.10`, `hkdf 0.12`, `hmac 0.12`, `sha2 0.10`, `rsa 0.9` (PKCS1-v1.5 / SHA-256).
- Отчёты: `typst 0.12` + `typst-pdf`, `rust_xlsxwriter 0.80`, `plotters 0.3` (SVG backend).
- `rayon 1` для параллельного decode, `zstd 0.13` для сжатия.
- HTTP: `reqwest 0.12` с `rustls-tls` + `gzip`, 15-сек timeout.
- Observability: `tracing 0.1` + `tracing-subscriber 0.3` (`env-filter`).

### 1.4 Размеры артефактов
- Release exe: **30.39 MB** (signed).
- NSIS installer: **10.36 MB** (signed).
- Cold release build: ~5 мин 10 с.

---

## 2. Что сделано хорошо (сохранить и использовать как образец)

### 2.1 SSoT-версионирование
- Один файл `/version.json` → авто-sync в 4 зависимых файла (`package.json`, `tauri.conf.json`, `Cargo.toml`, `src/lib/version.ts`).
- `npm run version:validate` — read-only check; npm pre-hooks на `tauri:build` и `release:prepare`.
- Защита от channel/tag mismatch: `channel="alpha"` требует `-alpha.N` в версии.

### 2.2 `AppError` и IPC-ошибки
`@/d:/Development/Rheolab/src-tauri/src/error.rs:89-101` — `safe_message()` гарантирует, что инфраструктурные варианты (`Pool`, `Sql`, `Io`, `Serde`, `Http`) **не утекают** наружу:

```@d:\Development\Rheolab\src-tauri\src\error.rs:89-101
    fn safe_message(&self) -> &str {
        match self {
            Self::Pool(_) => "Database temporarily unavailable",
            Self::Sql(_) => "Database error",
            Self::Io(_) => "File operation failed",
            Self::Join(_) => "Internal processing error",
            Self::Serde(_) => "Data format error",
            Self::Http(_) => "Network error",
            Self::Other(msg) => msg.as_str(),
            // Domain errors — their messages are intentionally user-visible.
            Self::BadRequest(msg) | Self::License(msg) | Self::Parse(msg) => msg.as_str(),
        }
    }
```

Сериализация как `{kind, message}` позволяет фронтенду надёжно matching'ить ошибки без парсинга строк.

### 2.3 Fail-closed лицензионный гейт
Все E2E-bypass-пути (`RHEOLAB_E2E_SKIP_LICENSE_GATE`, `INTEGRITY_SECRET_KEY`) работают **только** в `debug_assertions` сборках. Release-бинарник физически не умеет читать эти env-переменные.

`@d:/Development/Rheolab/src-tauri/src/commands/licensing/crypto.rs:130-138`:

```@d:\Development\Rheolab\src-tauri\src\commands\licensing\crypto.rs:130-138
pub(super) fn get_integrity_key() -> String {
    #[cfg(debug_assertions)]
    {
        if let Ok(k) = std::env::var("INTEGRITY_SECRET_KEY") {
            return k;
        }
    }
    DEFAULT_INTEGRITY_KEY.to_string()
}
```

Задокументирован audit-v2 SEC-004 с полным обоснованием.

### 2.4 Миграции БД с реестром
- `CURRENT_SCHEMA_VERSION=9`, `v0001..v0009` модулями, линейный реестр.
- `validate_registry()` проверяет монотонность на старте (`debug_assert!`).
- Downgrade-detection **не трогает** `schema_meta` — fail-closed с honest MigrationResult:

`@d:/Development/Rheolab/src-tauri/src/db/migration.rs:141-160` — audit-preflight DB-001.

### 2.5 Columnar v2 + zstd
- Format v2 с per-channel null bitmap (отличает 0.0 от null).
- Compression ratio **> 5×** для числовых данных (perf-budget тест).
- Поддержка legacy v1 (decode-only, backward compat).
- Рассчитанные perf-budgets: encode+decode 25 k точек < 1 s, decode_typed < 500 ms.
- Параллельный decode через `rayon::par_iter` в slow-path библиотечного фильтра (`experiments/list/dynamic.rs`).

### 2.6 Явный release-pattern для pool connection
`@d:/Development/Rheolab/src-tauri/src/commands/experiments/list/dynamic.rs:47-196` — комментарий объясняет, почему `drop(conn)` между SQL fetch и CPU-heavy decode-loop критически важен. Решает исторический бесконечный баг "Database temporarily unavailable" при включении viscosity threshold фильтра.

### 2.7 Dev-tooling
- Pre-commit hooks (`.pre-commit-config.yaml`).
- `gitleaks` со своим `.gitleaks.toml` + `.gitleaksignore`.
- `_typos.toml` — spelling.
- Strict `eslint.config.mjs`: `no-explicit-any: error`, `exhaustive-deps: error`, `no-floating-promises: error`, `no-console: error` (только `warn/error`), гейт на raw `invoke` в домен-модулях `src/lib/tauri/*`.

### 2.8 Тестовая инфраструктура
- Vitest для TS с `jsdom` для hooks/components, `node` для lib.
- Playwright 8 конфигов: `benchmark`, `db-scale.config.ts`, `full-workflow.tauri/web`, `tauri-soak`, `tauri`, основной.
- `cargo test` + `proptest 1` + `criterion 0.5` + `insta 1` для snapshot-тестов PDF.
- Microbench-скрипты: `perf:microbench:pdf`, `perf:microbench:analysis`, `perf:microbench:dbsweep` + compare-режимы.
- Release-gate скрипт — единый точка входа для prerelease проверок.

### 2.9 Крипто
- AES-256-GCM (2024+) с миграцией от AES-256-CBC v1.
- HKDF-SHA256 derivation (с миграцией от legacy HMAC-SHA256 single-block).
- Legacy-machine-id fallback — при смене HW пытается разшифровать старым ключом и переподписать.
- RSA-2048 PKCS1-v1.5 verification встроена (`include_bytes!("../../../keys/license_public.der")`), dev-keypair для тестов через `#[cfg(test)]`.

---

## 3. P1 — критичные, исправлять в ближайший цикл

### 3.1 Кастомный `SpinMutex` в scheduler

**Где**: `@d:/Development/Rheolab/src-tauri/src/runtime/jobs/scheduler.rs:34-85`.

```@d:\Development\Rheolab\src-tauri\src\runtime\jobs\scheduler.rs:51-60
    fn lock(&self) -> SpinMutexGuard<'_, T> {
        while self
            .locked
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .is_err()
        {
            std::hint::spin_loop();
        }
        SpinMutexGuard { lock: self }
    }
```

**Проблема**: ручной busy-wait без cooperative yield вокруг `registry: HashMap<String, JobRecord>` (до 100 записей, clone+sort_by в `list()`). При конкурентных запросах IPC (`jobs_list`, progress-events, cancel) lock удерживается не микросекунды, а десятки-сотни микросекунд — CPU burn + potential starvation, особенно на 2-ядерных CI-раннерах.

**Рекомендация**: заменить на `parking_lot::Mutex` (тянется транзитивно через `tauri`) либо `std::sync::Mutex`. Для диагностики времени удержания — добавить `tracing::info_span!` вокруг `registry.lock()` в горячих путях.

**Оценка**: 1–2 часа работы + прогон perf-benchmark'ов для сравнения baselines.

---

### 3.2 `commands/reports.rs` — 141 KB в одном файле

**Где**: `@d:/Development/Rheolab/src-tauri/src/commands/reports.rs` — 3 897 строк, содержит IPC handlers, cache coordination, by-id pipeline, comparison pipeline, tests.

**Проблема**:
- Существенно увеличивает compile time.
- Затрудняет review и maintenance.
- В одном файле смешаны уровни: thin IPC wrappers и объёмная cache-бизнес-логика.

**Рекомендация**: разбить на `src-tauri/src/commands/reports/`:

| Модуль | Содержимое |
|---|---|
| `mod.rs` | тонкий registrar с `#[tauri::command]` |
| `single.rs` | `reports_generate_pdf/excel` + `by_id` варианты |
| `comparison.rs` | `reports_generate_comparison_*_by_ids` |
| `cache.rs` | `build_*_cached_with_job`, `resolve_comparison_cache_misses_*` |
| `tests/` | подмодули под unit / perf-bench / by-ids fixtures |

Аналогично: `@d:/Development/Rheolab/src-tauri/src/db/repositories/experiment_projection.rs` (49 KB) и `@d:/Development/Rheolab/src-tauri/src/commands/licensing/engine/operations.rs` (41 KB) — следующие кандидаты.

**Оценка**: 1 день на `reports.rs`, по 0.5 дня на два других.

---

### 3.3 Capabilities FS scope шире, чем нужно

**Где**: `@d:/Development/Rheolab/src-tauri/capabilities/default.json:22-32`.

```@d:\Development\Rheolab\src-tauri\capabilities\default.json:22-32
    {
      "identifier": "fs:scope",
      "allow": [
        "$APPDATA/com.rheolab.enterprise/**",
        "$LOCALAPPDATA/com.rheolab.enterprise/**",
        "$DOWNLOADS/**",
        "$TEMP/**",
        "$DESKTOP/**",
        "$DOCUMENT/**"
      ]
    },
```

**Проблема**: весь renderer получает read+write доступ к `$DOWNLOADS`, `$DESKTOP`, `$DOCUMENT`. Проверка сужается на уровне IPC через `validate_user_file_path`, но capability — первая линия.

**Рекомендация**: разделить capabilities:
- `default.json` — узкий (только `$APPDATA/com.rheolab.enterprise/**`).
- `file-io.json` — расширенный, **привязанный к конкретным IPC-командам** через Tauri 2 capabilities command-filtering (поле `permissions[].allow[].commands`).

**Оценка**: 0.5 дня + регрессия через Playwright FS тесты.

---

### 3.4 HMAC-bypass на license-server (known, не в app)

**Где**: `license-server/releases.htaccess` (документировано в `progress.txt:30-75`).

**Проблема**: `.htaccess` RewriteRule отдаёт `alpha.json` напрямую с `[L]`, минуя `api/update-channel.php`, где есть HMAC-проверка. Любой клиент с заголовком `X-Update-Channel: alpha` получает privileged manifest без валидного токена.

Не интегрити-issue (Tauri updater всё равно проверяет подпись бинарника), а **конфиденциальность**: утечка URL alpha-сборки + факт её существования.

**Рекомендация**: согласно плану в `progress.txt:62-75` — удалить alpha/beta RewriteRules, направить все запросы через `update-channel.php`, который уже умеет HMAC + fallback на stable.

**Оценка**: 0.5 дня + smoke-test против staging license-server.

---

## 4. P2 — средний приоритет, следующая итерация

### 4.1 Фронтенд-сторы: `console.*` минуя `logger`

**Где**: `@d:/Development/Rheolab/src/lib/store/license-store.ts:131-236` и др.

```@d:\Development\Rheolab\src\lib\store\license-store.ts:131-135
        try {
            ...
        } catch (error) {
            console.error('[LicenseStore] Error fetching experiments count:', error);
        }
```

**Проблема**: `logger.error` форвардит в Tauri on-disk log (`app.log`), `console.error` — нет. Потеря диагностики при инцидентах у клиентов.

**Рекомендация**: заменить все `console.error/warn` в `src/lib/store/`, `src/lib/licensing/`, `src/lib/utils/encryption.ts` на `logger.error/warn`. `logger.ts` уже содержит `/* eslint-disable no-console */` — допустимо только там.

**Оценка**: 2 часа + grep-tooling для предотвращения регрессий.

---

### 4.2 Топ-5 TSX-файлов > 20 KB

| Файл | Размер | Признак боли |
|---|---|---|
| `comparison-chart-uplot.tsx` | 31 KB, 729 строк | 21 `useCallback/useMemo`, 4 вложенных хука |
| `experiment-filters.tsx` | 27 KB | 11 `useCallback/useMemo` |
| `reagents-manager.tsx` | 24 KB | 5 `useCallback/useMemo` + mixed CRUD + UI |
| `DashboardContent.tsx` | 24 KB | 9 `useEffect` — слишком много effects |
| `experiment-card.tsx` | 23 KB | 1 компонент, много prop-drilling |

**Проблема**: большие `useMemo`/`useCallback` кластеры — сигнал, что компонент управляет множественными срезами state.

**Рекомендация**:
- Извлекать чистые селекторы в отдельные hooks (`useChartSelection`, `useExperimentFilterModel`).
- Разбить на дочерние компоненты с чётко ограниченными props.
- Использовать `useSyncExternalStore` или Zustand selectors для изоляции re-render'ов.

**Оценка**: 2–3 дня на весь топ-5.

---

### 4.3 `block_in_place` + `block_on` в sync-setup

**Где**: `@d:/Development/Rheolab/src-tauri/src/state/app_state.rs:124-137`.

```@d:\Development\Rheolab\src-tauri\src\state\app_state.rs:128-132
        let startup_result = tokio::task::block_in_place(|| {
            tauri::async_runtime::handle().block_on(engine.check_local_startup(pool))
        });
```

**Проблема**:
- `block_in_place` требует multi-threaded Tokio runtime — падает на `rt-current-thread`.
- Блокирует `.setup()` закрытие на async I/O; потенциально увеличивает TTI.

**Рекомендация**: использовать Tauri 2 `setup_async` (`.setup(|app| Box::pin(async move { ... }))`) или отдать local-check в background task, возвращая `expired_features()` до прихода результата.

**Оценка**: 0.5 дня + регрессионный тест времени запуска.

---

### 4.4 SQL builder в `experiments/list/query.rs`

**Где**: `@d:/Development/Rheolab/src-tauri/src/commands/experiments/list/query.rs:62-200`.

WHERE собирается вручную через `Vec<String>` + `Vec<Box<dyn rusqlite::ToSql>>`. Параметры биндятся безопасно, **но** column names форматируются в `format!("{} LIKE ?", $col)` — корректность зависит от макроса.

**Рекомендация**: ввести типизированный filter builder:

```rust
enum FilterColumn {
    ExperimentName,
    FieldName,
    // ...
}
impl FilterColumn {
    fn column(self) -> &'static str { ... }
}
```

Это не полный переход на `sqlx` (большая работа), но упростит audit при добавлении фильтров и защитит от опечаток.

**Оценка**: 1 день.

---

### 4.5 Разделить `is_e2e_mode` на два флага

**Где**: `@d:/Development/Rheolab/src-tauri/src/commands/licensing/mod.rs:579-589` и frontend `UpdateChecker.tsx`.

**Проблема**: `is_e2e_mode()` читает один флаг `RHEOLAB_E2E_SKIP_LICENSE_GATE`, от которого зависят **и** лицензионный bypass, **и** подавление updater. Нельзя тестировать updater в E2E без открытия лицензионного гейта.

**Рекомендация**: два независимых env-флага:
- `RHEOLAB_E2E_SKIP_LICENSE_GATE` — только лицензионный bypass.
- `RHEOLAB_E2E_DISABLE_UPDATER` — только отключение updater.

Оба gated на `cfg(any(debug_assertions, test))`.

**Оценка**: 2 часа.

---

## 5. P3 — накопительная гигиена

### 5.1 `archive/` (230 файлов) в репозитории
Кандидат на вынос в `rheolab-archive` git-subtree или удаление. Сейчас замедляет checkout и засоряет поиск.

### 5.2 `runtime/` 9 GB / ~14 k файлов
Корректно в `.gitignore`. Рекомендуется добавить `npm run clean:runtime` для CI pristine-checkpoints (если ещё нет).

### 5.3 Зависимости
- **`exceljs` → `uuid<14` moderate (dev-only)**: обновить `exceljs` до версии с `uuid>=14` или заменить на `rust_xlsxwriter` E2E assertions.
- **`typst 0.12`**: актуальная 0.13+, проверить совместимость с `plotters`/`ttf-parser`.
- **`specta 2.0.0-rc.22`**: RC, обновить до stable когда выйдет.

### 5.4 Build-time assertions для ключей
Добавить в `build.rs` check, что `license_public.der` != `dev_public.der` (сравнение по хешу) в `cargo build --release`. Защита от случайной подмены.

### 5.5 `constants.rs` для разбросанных лимитов
`BATCH_GET_MAX=50`, `RAW_TABLE_PAGE_SIZE_MAX=500`, `MAX_GEOMETRY_BYTES=64`, `SERIES_DECODE_CACHE_MAX_BYTES`, `MAX_ITERATIONS` в `setup.rs` и т.д. — вынести в `src-tauri/src/constants.rs` с doc-комментариями про тюнинг.

### 5.6 V8 heap ceiling
`--js-flags=--max-old-space-size=512` в `additionalBrowserArgs` может быть тесно на больших сравнениях (8 экспериментов × 20 k точек). Замерить через `perf:comparison:tauri:memory`; при пересечении лимита — 768 или 1024 MB.

### 5.7 Sequence diagram licensing flow
Лицензионный flow несколько раз переписан (Sprint'ы, audit-v2). Добавить `docs/security/licensing-flow.md` со sequence diagram (Mermaid), чтобы будущий контрибьютор не убрал гейт "за ненадобностью".

---

## 6. Производительность — где выжать ещё

### 6.1 PDF generation
- `opt-level=3` для typst + subdeps уже выставлен.
- Typst 0.13 умеет параллельный per-page compile — замер через `perf:microbench:pdf`, потенциальный win 20–40%.

### 6.2 Analysis pipeline
- `perf:microbench:analysis` + DB-sweep существуют.
- `linear_regression` в `physics.rs:147` вызывается на тысячах точек — `std::simd` (Rust 1.84+) или `wide` crate даст 2–4× на hot path.

### 6.3 Columnar decode
- `rayon::par_iter` уже используется. Проверить `RAYON_NUM_THREADS` в runtime (по умолчанию = num_cpus) — на 16-ядерной машине может давать overhead.

### 6.4 Frontend chart hot path
- `comparison-chart-uplot.tsx` с 21 `useMemo/useCallback` — проверить через React DevTools Profiler каскадные рекомпутации при zoom/pan.
- `chart-settings-store.ts` использует `makeDebouncedStorage(500)` — хорошо. Проверить, что `beforeunload` flush работает в WebView2 (иногда срабатывает только `pagehide`).

### 6.5 Compile time
Workspace `codegen-units=1` + `lto="thin"` даёт ~5 мин cold build. Если бьёт по dev-loop — сделать отдельный `release-prod` профиль, а `release` для local debugging — `lto=false`.

---

## 7. Безопасность — итог

### 7.1 Сильные стороны
- Fail-closed на всех лицензионных путях в release.
- Defense-in-depth: HMAC + RSA (caller не может подменить signedPayload).
- Per-feature gate (`REP-001`): export_pdf/export_excel проверяются отдельно от общего write-gate.
- HKDF key derivation для storage.
- Legacy key migration с forward-compat.
- Path validation (`validate_path_within`, `validate_user_file_path`) блокирует `..`, null bytes, sensitive dirs.
- SQL parameter binding везде (нет строковой конкатенации значений).
- Input validation: `validate_hash_id`, `validate_bounded_str`, `validate_file_size`.

### 7.2 Известные issue
- **`releases.htaccess` HMAC bypass** (`progress.txt` п.2) — **см. P1 §3.4**.
- **`test_stub_force_ai_uses_structured_mapping_for_fixture`** (`progress.txt` п.1) — pre-existing regression в AI-candidate scoring, план в `progress.txt:138-170`.

### 7.3 Рекомендации
- **Формализовать licensing flow** диаграммой (P3 §5.7).
- **CSP**: уже строгий, но добавить `frame-ancestors 'none'` и `form-action 'self'` для defense-in-depth.

---

## 8. Тесты и CI

### 8.1 Покрытие
- **Unit**: Vitest, ~200+ тестов в `tests/` + внутренние `#[cfg(test)]` модули в Rust (`crud_tests.rs`, `licensing_tests.rs`, `migration_tests.rs`, и т.д.).
- **Integration**: DB-scale, multi-fixture, comparison memory phases.
- **E2E**: 62 файла в `tests/e2e/`, Tauri с реальным webview.
- **Perf**: memory-stress, chart-series, comparison-smoke, warm-navigation, soak.

### 8.2 Качество
- `no-floating-promises` ESLint-правило включено.
- Rust crates с `#![warn(clippy::unwrap_used, clippy::expect_used, clippy::panic)]` в критичных модулях (`db/migration.rs`, `licensing/*`).
- `proptest` для parsing edge-cases.
- `insta` snapshots для PDF детерминизма.

### 8.3 Замечания
- AGENTS.md явно говорит "GitHub Actions не авторитетный гейт" — значит, **локальные runners** отвечают за QA. Добавить документацию "как локально реплицировать release-gate" (возможно, уже есть в `docs/RELEASE_AND_DEPLOY.md`).
- `test:desktop-core` (`scripts/dev/run-desktop-parity.js`) — ключевой parity-check между web и Tauri. Нужно включить его в обязательный pre-commit, если ещё не.

---

## 9. Зависимости — аудит

### 9.1 npm
```
npm audit (prod): no vulnerabilities
npm audit (all):  2 vulnerabilities (moderate) — exceljs → uuid<14, dev-only
```

### 9.2 Cargo
Критичные пакеты — на актуальных major-версиях:
- `tauri 2.10.3` (актуальный 2.x)
- `tokio 1.52.1`
- `reqwest 0.12.28`
- `rusqlite 0.32.1` (bundled SQLite)
- `rsa 0.9.10`
- `aes-gcm 0.10`, `hkdf 0.12`, `hmac 0.12`, `sha2 0.10`
- `r2d2 0.8.10`, `r2d2_sqlite 0.25`
- `rayon 1.12`, `zstd 0.13.3`

Кандидаты на обновление:
- `typst 0.12 → 0.13+` (P3 §5.3).
- `specta 2.0.0-rc.22 → stable` (P3 §5.3).

### 9.3 Встроенные секреты
- `keys/license_public.der` (production, RSA-2048).
- `keys/dev_public.der` + `keys/dev_private.der` (test builds, через `#[cfg(test)]`).
- `DEFAULT_INTEGRITY_KEY`, `STORAGE_SALT`, `BETA_CHANNEL_KEY`, `ALPHA_CHANNEL_KEY` — compile-time константы.

**Рекомендация** (P3 §5.4): `build.rs`-check, что release не собирается с dev keys.

---

## 10. Приоритезированный action list

| # | Приоритет | Действие | Оценка | Владелец |
|---|-----------|----------|--------|----------|
| 1 | **P1** | Заменить `SpinMutex` в `scheduler.rs` на `parking_lot::Mutex` | 1–2 ч | backend |
| 2 | **P1** | Разбить `reports.rs` → `commands/reports/{mod,single,comparison,cache}.rs` | 1 день | backend |
| 3 | **P1** | Узкий FS scope в `capabilities/default.json` + command-binding | 0.5 дня | backend + qa |
| 4 | **P1** | Починить `releases.htaccess` HMAC bypass на license-server | 0.5 дня | devops |
| 5 | **P2** | Заменить `console.error` → `logger.error` в store'ах | 2 ч | frontend |
| 6 | **P2** | Декомпозировать топ-5 TSX > 20 KB | 2–3 дня | frontend |
| 7 | **P2** | `setup_async` вместо `block_in_place` в `AppState::build` | 0.5 дня | backend |
| 8 | **P2** | Типизированный SQL filter builder в `experiments/list/query.rs` | 1 день | backend |
| 9 | **P2** | Разделить `is_e2e_mode` на `license_bypass` + `updater_disabled` | 2 ч | backend + qa |
| 10 | **P3** | Перенести `archive/` в отдельный subtree или удалить | 0.5 дня | maintenance |
| 11 | **P3** | Обновить `exceljs`→`uuid@14`, `typst 0.12→0.13` | 2 ч + тесты | backend |
| 12 | **P3** | Sequence diagram licensing flow в `docs/security/` | 0.5 дня | docs |
| 13 | **P3** | `build.rs` check dev-keys ≠ production-keys | 1 ч | backend |
| 14 | **P3** | Вынести разбросанные limits в `src-tauri/src/constants.rs` | 2 ч | backend |
| 15 | **P3** | Разделить `release` / `release-prod` Cargo профили | 1 ч | backend |
| 16 | **P3** | Замер V8 heap для n=8 comparison; увеличить `max-old-space-size` если нужно | 0.5 дня | frontend + qa |

**Итого нагрузки**: P1 ~3 дня, P2 ~5 дней, P3 ~3 дня. Всего ~2 недели одного инженера для полной очистки, но блокирующих релиз пунктов нет.

---

## 11. Заключение

Кодовая база показывает **зрелый инженерный подход**:
- Ответственный security (ADR-документированные решения, fail-closed, multi-layer).
- Производительность на уровне продукта (columnar+zstd, Rayon, rolled-out Tauri IPC контракты, debounced storage).
- Прозрачный релизный процесс (SSoT-версионирование с валидаторами).
- Разветвлённая тестовая инфраструктура (unit/integration/E2E/perf/soak/microbench).

Главные рекомендации — это **декомпозиция крупных файлов** и замена одного сомнительного примитива синхронизации. Архитектура и безопасность претензий не вызывают.

**Рекомендуемый следующий шаг**: реализовать P1 блок (§3.1–3.4) отдельными PR с connected регрессионными тестами. После этого вернуться к P2 в рамках очередной итерации.

---

*Этот отчёт — результат read-only аудита, без изменений в исходниках. Все ссылки на файлы даны в формате `@<path>:<lines>` для быстрого перехода в IDE.*
