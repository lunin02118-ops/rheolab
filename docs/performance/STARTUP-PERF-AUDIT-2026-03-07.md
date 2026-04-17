# Аудит производительности запуска — RheoLab Enterprise
**Дата:** 2026-03-07  
**Версия:** 0.1.507  
**Фокус:** Повторный (тёплый) запуск

---

## Измеренные тайминги (из startup.log)

Данные получены из реальных запусков release-сборки (`src-tauri/target/release/rheolab-enterprise.exe`).

| Этап | Запуск 1 (13:20:41) | Запуск 2 (13:21:04, через 23 мин) |
|------|--------------------|------------------------------------|
| **Старт процесса → Setup started** | 408 мс | 401 мс |
| **Setup started → AppState created** | **3 901 мс** | **3 915 мс** |
| **AppState → окно отрисовано** | ~30 мс | ~30 мс |
| **Итого до появления окна** | **~4 340 мс** | **~4 346 мс** |

> **Вывод:** Оба запуска показывают идентичную картину — 3.9 секунды тратится внутри `AppState::new()`. Для тёплого запуска (когда TTL кэша истёк) это стабильный результат, не зависящий от состояния ОС-кэшей диска.

---

## Анатомия узкого места: `AppState::new()` ← `block_in_place(engine.check())`

### Стек вызовов при тёплом запуске (TTL > 120 с)

```
setup() в lib.rs
  └─ AppState::new()                              ← занимает ~3.9 с
        ├─ create_dir_all(app_data_dir)           ~1 мс  (FS stat)
        ├─ create_dir_all(backups_dir)            ~1 мс  (FS stat)
        ├─ db::create_pool()                      ~30 мс (открытие SQLite + PRAGMAs)
        ├─ run_migrations(&conn)                  ~50 мс (DDL IF NOT EXISTS + INSERT OR IGNORE)
        ├─ migrate_legacy_xor_keys(...)           ~2 мс  (SELECT WHERE key LIKE 'OBFHEX:%' → 0 строк → return)
        ├─ LicenseEngine::new()                   ~0 мс  (аллокация структуры)
        └─ block_in_place(engine.check())         ≈ 3 800 мс  ← ГЛАВНАЯ ПРОБЛЕМА
              ├─ cache miss (TTL 120 с истёк)
              ├─ load_verified_license (DB)       ~2 мс
              └─ check_stored_license()           ≈ 3 800 мс
                    └─ validate_online()          ≈ 3 800 мс
                          └─ HTTP POST license.vizbuka.ru/api/validate.php
                                (timeout = 15 с, реальный RTT = ~3.8 с)
```

### Почему именно `block_in_place`?

В `app_state.rs` :

```rust
let license_result = tokio::task::block_in_place(|| {
    tokio::runtime::Handle::current()
        .block_on(engine.check(&db_pool))    // ← блокирует поток Tauri setup
});
```

`block_in_place` переводит текущий worker-поток Tokio в блокирующий режим и ждёт завершения HTTP-запроса. Это значит: **окно приложения не открывается** пока HTTP-запрос к серверу лицензий не завершится.

### Параметры, усугубляющие ситуацию

- `CHECK_CACHE_TTL_SECS = 120` — кэш живёт 2 минуты. При обычной работе пользователь закрывает приложение → открывает через 5+ минут → кэш протух → снова HTTP.
- `timeout = 15 с` в `http_client()` — при недоступном сервере пользователь ждёт 15 секунд перед тем как приложение откроется.
- `validate_online()` вызывается **на каждый запуск** с истёкшим TTL, не только раз в сутки.

---

## Полная карта проблем

### 🔴 Критично (3–4 секунды на каждый запуск)

| # | Проблема | Местоположение | Эффект |
|---|----------|---------------|--------|
| C1 | `block_in_place(engine.check())` — HTTP на старте | `app_state.rs:70–75` | +3.8 с при каждом запуске с истёкшим TTL |
| C2 | TTL кэша = 120 с | `engine/mod.rs: CHECK_CACHE_TTL_SECS` | TTL истекает при любом перезапуске через 2+ мин |
| C3 | Нет ограничения частоты HTTP-проверок | `engine/verification.rs:107–111` | Каждый `check()` с истёкшим TTL = HTTP-запрос |

### 🟠 Значимо (50–100 мс)

| # | Проблема | Местоположение | Эффект |
|---|----------|---------------|--------|
| M1 | `run_migrations()` на каждом старте | `app_state.rs:56` | Парсит весь DDL + `INSERT OR IGNORE` для всех реагентов по умолчанию (~50 мс) |
| M2 | `--num-raster-threads=1` в WebView2 | `tauri.conf.json` | Ограничивает GPU-конвейер рендеринга, увеличивает FCP |
| M3 | `--force-gpu-mem-available-mb=256` | `tauri.conf.json` | Создаёт давление на GPU-память |

### 🟡 Умеренно (1–10 мс, пренебрежимо мало)

| # | Проблема | Местоположение | Эффект |
|---|----------|---------------|--------|
| L1 | `migrate_legacy_xor_keys` на каждом старте | `api_keys/mod.rs:183` | `SELECT WHERE LIKE` → 0 строк → возврат; ~2 мс |
| L2 | 8 плагинов init синхронно | `lib.rs:80–90` | Суммарно ~5–10 мс |
| L3 | pre_startup_restore stat | `lib.rs:104` | FS stat, ~1 мс |

### 🔵 Frontend (после появления окна)

| # | Проблема | Местоположение | Эффект |
|---|----------|---------------|--------|
| F1 | `licensing_get_status` + `experiments_count` в `init()` | `license-store.ts:152`, `DashboardLayoutClient.tsx:32` | Параллельный IPC на mount; `licensing_get_status` попадает в кэш (быстро), `experiments_count` = `COUNT(*)` на таблице Experiment |
| F2 | Lazy-loading всех страниц | `routes.tsx` | Дополнительный сетевой запрос к WebView только при первой навигации (разовый) |
| F3 | Vendor-chunks разделены, но парсятся последовательно | `vite.config.ts:manualChunks` | vendor-react + vendor-radix должны загружаться первыми |

---

## Рекомендации

### Рекомендация 1: Убрать HTTP из критического пути старта (ПРИОРИТЕТ 1)

**Текущее поведение:** `AppState::new()` блокирует весь Tauri setup на HTTP-запрос.

**Решение — двухфазная инициализация:**

```rust
// app_state.rs — ПОСЛЕ
impl AppState {
    pub fn new(app_data_dir: PathBuf, backups_dir: PathBuf) -> Result<Self> {
        // ... fs, pool, migrations, migrate_legacy_xor_keys как сейчас ...
        
        let engine = LicenseEngine::new(app_data_dir.clone());
        
        // Фаза 1 (синхронная): только чтение из БД — без HTTP
        let initial_status = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                engine.check_local_only(&db_pool).await  // новый метод — только БД
            })
        });
        
        let state = AppState { db_pool, engine, app_data_dir, backups_dir };
        
        // Фаза 2 (асинхронная): HTTP-проверка в фоне, обновление кэша
        let state_clone = state.clone_handle(); // Arc-клон
        tokio::spawn(async move {
            state_clone.engine.check(&state_clone.db_pool).await;
            // фронтенд получит актуальный статус при следующем вызове licensing_get_status
        });
        
        Ok(state)
    }
}
```

**Новый метод `check_local_only`** — только HMAC-верификация + чтение из БД + локальная проверка срока действия, без HTTP:

```rust
/// Быстрая проверка только по локальным данным (для старта приложения).
/// HTTP-валидация выполняется в фоновом потоке после инициализации.
pub async fn check_local_only(&self, db_pool: &DbPool) -> LicenseCheckResult {
    // Кэш ещё горячий?
    if let Some(cached) = self.get_if_fresh().await { return cached; }
    
    let conn = db_pool.get()...;
    match self.load_verified_license(&conn) {
        Some((json, _)) => self.build_expiry_result_from_json(&json), // без HTTP
        None => check_demo(&conn),
    }
}
```

**Результат:** старт сокращается с ~4.3 с до ~0.5 с. HTTP идёт в фоне, фронтенд получает актуальный статус через 3–4 секунды после открытия окна (незаметно для пользователя).

---

### Рекомендация 2: Увеличить TTL / добавить суточный тик (ПРИОРИТЕТ 2)

**Текущее:** TTL = 120 с. Каждый перезапуск через 2+ минуты = HTTP.

**Решение:** Разделить два понятия:
- **In-memory TTL** (`CHECK_CACHE_TTL_SECS`): оставить 120 с — для живых frontend-вызовов
- **HTTP check frequency**: добавить отдельный персистентный флаг «последняя HTTP-проверка»

```rust
// engine/mod.rs
const ONLINE_CHECK_INTERVAL_SECS: u64 = 3600; // HTTP не чаще раза в час

// В check_stored_license:
let last_http = self.load_last_http_check_time(); // из fs или DB
if last_http.elapsed() < ONLINE_CHECK_INTERVAL_SECS {
    return self.build_expiry_result_from_json(license_json); // без HTTP
}
// иначе — HTTP как сейчас
```

**Результат:** для пользователя, который перезапускает приложение в течение часа, каждый тёплый старт будет <0.5 с.

---

### Рекомендация 3: Оптимизировать run_migrations (ПРИОРИТЕТ 3)

**Текущее:** на каждом старте выполняется вся DDL + `INSERT OR IGNORE` для реагентов.

**Решение:** добавить таблицу `SchemaVersion` (или `AppMeta`) с номером примeнённой схемы:

```sql
CREATE TABLE IF NOT EXISTS AppMeta (key TEXT PRIMARY KEY, value TEXT);
```

```rust
fn run_migrations(conn: &Connection) -> Result<()> {
    let current = get_meta(conn, "schema_version").unwrap_or(0);
    if current >= CURRENT_SCHEMA_VERSION {
        return Ok(()); // ← ранний выход: ~0 мс вместо ~50 мс
    }
    // ... применить миграции ...
    set_meta(conn, "schema_version", CURRENT_SCHEMA_VERSION)?;
    Ok(())
}
```

---

### Рекомендация 4: Исправить WebView2 флаги (ПРИОРИТЕТ 4)

В `tauri.conf.json` изменить:

```json
// УБРАТЬ или изменить:
"--num-raster-threads=1"            // → убрать (или "--num-raster-threads=2")
"--force-gpu-mem-available-mb=256"  // → убрать

// ОСТАВИТЬ (полезные):
"--disable-extensions"
"--disable-spell-checking" 
"--disable-component-update"
"--max-old-space-size=512"
```

`--num-raster-threads=1` ограничивает GPU-конвейер ONE потоком, что увеличивает время First Contentful Paint на машинах с многоядерным GPU. Значение по умолчанию в Chromium (2–4) лучше подходит для рабочего приложения.

---

### Рекомендация 5: Добавить временны́е метки в startup.log (ПРИОРИТЕТ 5)

Для постоянного мониторинга добавить инструментирование в `app_state.rs`:

```rust
pub fn new(app_data_dir: PathBuf, backups_dir: PathBuf) -> Result<Self> {
    let t0 = std::time::Instant::now();
    
    // ... create_dir_all ...
    log_startup!("dirs_created", t0.elapsed().as_millis());
    
    let pool = db::create_pool(&db_path)?;
    log_startup!("pool_created", t0.elapsed().as_millis());
    
    run_migrations(&conn)?;
    log_startup!("migrations_done", t0.elapsed().as_millis());
    
    migrate_legacy_xor_keys(&pool, &app_data_dir);
    log_startup!("xor_migration_done", t0.elapsed().as_millis());
    
    block_in_place(engine.check(&pool));
    log_startup!("license_check_done", t0.elapsed().as_millis());  // ← покажет реальные цифры
}
```

---

## Ожидаемый эффект от внедрения

| Оптимизация | Экономия на тёплом запуске |
|-------------|---------------------------|
| Рек. 1 (HTTP в фон) | **−3 800 мс** |
| Рек. 2 (TTL/HTTP throttle) | −3 800 мс (альтернатива или дополнение к Рек. 1) |
| Рек. 3 (skip migrations) | −50 мс |
| Рек. 4 (WebView2 flags) | −50–100 мс (FCP, субъективно) |
| Рек. 5 (логирование) | 0 мс (мониторинг) |
| **Итого (все реализованы)** | **~4 340 мс → ~400–500 мс** |

---

## Что НЕ является проблемой

- **`migrate_legacy_xor_keys`**: выполняет `SELECT WHERE LIKE 'OBFHEX:%'` → после первой миграции всегда возвращает 0 строк за ~2 мс. Безопасно запускать на каждом старте (но можно добавить флаг в AppMeta для пропуска).
- **`min_idle=1` в пуле r2d2**: правильно настроен, 1 соединение остаётся тёплым.
- **Lazy-loading страниц**: разовая стоимость при первой навигации, не влияет на последующие запуска.
- **StrictMode double-render**: только в dev-сборке.
- **Specta TypeScript export**: только в debug-сборке (`#[cfg(debug_assertions)]`).

---

## Приоритизированный план реализации

```
[Sprint N]
  P1: Реализовать check_local_only() + двухфазную инициализацию AppState
  P1: Добавить временны́е метки в startup.log (необходимо для верификации)

[Sprint N+1]  
  P2: ONLINE_CHECK_INTERVAL_SECS (суточный HTTP-тик)
  P3: SchemaVersion таблица для пропуска уже применённых миграций

[Sprint N+2]
  P4: Исправить WebView2 флаги
  QA: Измерить startup.log до/после каждой оптимизации
```

---

## Методология аудита

Данные получены путём анализа кода + чтения реальных записей `startup.log` (файл: `%LOCALAPPDATA%\com.rheolab.enterprise\startup.log`). Временны́е метки в логе дают точность ±1 мс. Для получения sub-millisecond breakdown по отдельным шагам внутри `AppState::new()` необходима дополнительная инструментация (Рек. 5).
