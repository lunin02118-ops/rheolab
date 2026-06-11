# План 005 (spike): Crash/panic-телеметрия WP-6.3 — локальный crash.log с ротацией + design-док отправки

> **Инструкция исполнителю**: выполняй план строго по шагам. После каждого шага
> запускай команду верификации и сверяй результат, прежде чем идти дальше.
> При любом условии из «Условия STOP» — остановись и доложи. По завершении
> обнови строку статуса этого плана в `plans/README.md`.
>
> **Проверка дрейфа (выполнить первой)**:
> `git diff --stat 6d9035e..HEAD -- src-tauri/src/lib.rs src-tauri/src/main.rs src-tauri/src/startup/`
> Если эти файлы менялись — сверь фрагменты из «Текущее состояние» с живым
> кодом; при расхождении — STOP.

## Статус

- **Приоритет**: P3
- **Трудозатраты**: M (фаза A — код; фаза B — только документ)
- **Риск**: LOW (новый изолированный код, не трогает существующие потоки)
- **Зависит от**: plans/002-commit-windows-vitest-runner-fix.md (чистое дерево)
- **Категория**: direction (spike по отложенному WP-6.3)
- **Составлен на**: коммит `6d9035e`, 2026-06-11

## Почему это важно

WP-6.3 из `docs/REFACTORING_DEEP_PLAN.md:678` отложен с апреля 2026:
паника в Rust-бэкенде сейчас умирает молча — пользователь видит закрывшееся
окно, а разработчик не получает ничего. При активной alpha-программе
(19 итераций 0.2.3-alpha с мая) каждый невоспроизводимый краш стоит цикла
переписки с QA-флотом. Исходная спека WP-6.3 минимальна и самодостаточна:
`std::panic::set_hook` → stack-trace без PII в ротируемый `crash.log` +
**явно opt-in** диалог отправки. Этот план реализует локальную часть
(фаза A) и оформляет дизайн отправки с открытыми вопросами (фаза B) —
отправка НЕ реализуется, это решение владельца.

## Текущее состояние

- Паник-хука нет: `git grep -n "set_hook" src-tauri/src` → пусто.
- Логирование инициализируется в `src-tauri/src/lib.rs:90-105` через
  `tauri_plugin_log::Builder`, цель — `TargetKind::LogDir`, ротация
  `RotationStrategy::KeepSome(5)`. Новый crash-отчёт должен жить рядом
  (тот же каталог логов приложения), чтобы пользователю было одно место
  для «приложить логи».
- `src-tauri/src/main.rs:9-11` — в `main` уже есть ранний guard
  («panic early in release if dev keys are still used») и комментарий, что
  логирование живёт в lib.rs. Хук паники ставить ДО старта Tauri-билдера,
  чтобы ловить и паники инициализации.
- `src-tauri/src/startup/logging.rs` — bootstrap-логирование до подъёма
  plugin_log; образец того, как в этом репо оформляют startup-модули.
- Конвенции: модули Rust с `//!`-докзаголовком, ошибки через
  `crate::error::AppError`, тесты inline `#[cfg(test)] mod tests`,
  conventional commits на английском.

Спека WP-6.3 дословно (`docs/REFACTORING_DEEP_PLAN.md:678-681`):

> - `std::panic::set_hook` → пишет stack-trace (без PII) в `crash.log`, ротируется.
> - Диалог пользователю: «Приложение столкнулось с внутренней ошибкой.
>   Файл `crash.log` сохранён. Отправить разработчикам?» — явный opt-in.

## Команды, которые понадобятся

| Назначение | Команда | Ожидаемо при успехе |
|---|---|---|
| Rust-тесты модуля | `cargo test --manifest-path src-tauri/Cargo.toml crash` | все зелёные |
| Полные Rust-тесты | `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1` | exit 0, ≥546 passed |
| Typecheck фронта | `npm run typecheck` | exit 0 (фронт не трогаем — sanity) |
| Lint | `npm run lint` | exit 0 |

## Объём

**В объёме**:
- `src-tauri/src/startup/crash_reporter.rs` (создать)
- `src-tauri/src/startup/mod.rs` (объявить модуль)
- `src-tauri/src/main.rs` ИЛИ `src-tauri/src/lib.rs` (один вызов установки
  хука — выбрать самую раннюю точку, где известен каталог логов; если
  каталог известен только после билдера — двухфазная схема, см. шаг 2)
- `docs/telemetry/CRASH-REPORTING-DESIGN.md` (создать, фаза B)
- `plans/README.md` (статус)

**Вне объёма** (НЕ трогать):
- Любая сетевая отправка crash-отчётов, эндпоинты license-server — только
  design-док.
- UI-диалог «Отправить разработчикам?» — описывается в design-доке, не
  реализуется (нет серверной части).
- `tauri_plugin_log`-конфигурация в `lib.rs:90-105` — не менять, crash_log
  живёт отдельным файлом.
- `panic = "abort"` / профили Cargo — не трогать.

## Git-процесс

- Ветка: `advisor/005-crash-telemetry` от текущей.
- Коммиты: `feat(telemetry): write rotated crash reports on rust panic`,
  `docs(telemetry): crash report submission design (WP-6.3 phase B)`.
- Не пушить и не открывать MR без указания оператора.

## Шаги

### Шаг 1: Модуль crash_reporter

Создать `src-tauri/src/startup/crash_reporter.rs`:

- `pub fn write_crash_report(dir: &Path, message: &str, backtrace: &str) -> std::io::Result<PathBuf>`
  — чистая функция: создаёт `dir` при отсутствии, пишет файл
  `crash-YYYYMMDD-HHMMSS.log` (UTC) с шапкой: версия приложения
  (`env!("CARGO_PKG_VERSION")`), ОС (`std::env::consts::OS`), timestamp,
  затем `message` и `backtrace`. Никаких аргументов командной строки,
  переменных окружения и путей пользователя в содержимом.
- `pub fn prune_old_reports(dir: &Path, keep: usize)` — оставляет `keep`
  новейших `crash-*.log` (по имени файла, оно сортируемо), остальные
  удаляет; ошибки удаления игнорировать молча (best effort).
- `pub fn install_panic_hook(dir: PathBuf)` — `std::panic::set_hook`:
  собирает `payload` (downcast `&str`/`String`, иначе `"<non-string panic>"`),
  `location()`, `std::backtrace::Backtrace::force_capture()`, вызывает
  `write_crash_report` + `prune_old_reports(dir, 5)`, затем вызывает
  предыдущий хук (сохранить через `std::panic::take_hook()` до установки),
  чтобы стандартный stderr-вывод не пропал. Внутри хука — никаких паник:
  все Result игнорировать.

Inline-тесты (`#[cfg(test)]`, tempfile уже в dev-deps — образец:
`engine/offline.rs` tests):

1. `write_crash_report` создаёт файл, содержимое включает версию и message.
2. `prune_old_reports` с 7 файлами и keep=5 оставляет 5 новейших.
3. Содержимое отчёта не содержит значения `std::env::var("USERNAME")`
   (тест выставляет фиктивную переменную и проверяет отсутствие).

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml crash_reporter` → все зелёные.

### Шаг 2: Установка хука при старте

Каталог: подкаталог `crash/` рядом с логами приложения. Если путь логов
доступен только после построения Tauri-приложения — установить хук в
`setup`-хуке билдера в `lib.rs` (рядом с инициализацией plugin_log),
получив каталог через `app.path().app_log_dir()`. Паники ДО setup уйдут
в stderr как раньше — зафиксировать это ограничение комментарием.

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1`
→ exit 0, ≥546 passed (ничего не сломано).

### Шаг 3: Ручная дымовая проверка (локально, опционально при наличии окружения)

Временно (НЕ коммитить) вставить `panic!("crash-reporter smoke")` в любой
dev-only путь, запустить `npm run tauri:dev`, вызвать панику, убедиться,
что в каталоге логов появился `crash-*.log` с бэктрейсом. Удалить
временную вставку.

**Verify**: `git status --porcelain src-tauri/` → нет незапланированных
изменений после отката вставки.

### Шаг 4: Design-док фазы B (отправка, opt-in)

Создать `docs/telemetry/CRASH-REPORTING-DESIGN.md` (на русском, как
остальные docs/): контекст WP-6.3; что уже сделано (фаза A); предлагаемый
UX (диалог при следующем старте, если найден свежий crash-лог: показать
путь, кнопки «Отправить» / «Не отправлять», чекбокс «больше не спрашивать»);
транспорт-кандидаты (POST на license-server рядом с существующими
api/*.php — есть auth-модель и rate_limiter; либо ручной экспорт файла);
санитизация (бэктрейс содержит пути сборочной машины — это пути
разработчика, не пользователя; user-пути не пишутся by construction);
открытые вопросы владельцу: (1) нужен ли вообще сетевой канал или
достаточно «приложите файл в чат QA», (2) ретенция на сервере, (3) канал
только для alpha/beta лицензий?

**Verify**: файл существует; `npm run lint && npm run typecheck` → exit 0.

## Тест-план

- Новые inline-тесты в `crash_reporter.rs` (шаг 1, три случая) — образец
  структуры: `src-tauri/src/commands/licensing/engine/offline.rs`
  (`mod tests` с tempfile).
- Регрессия: полный `cargo test` (шаг 2).
- Поведение самого хука в проде покрывается дымовой проверкой шага 3
  (хук нельзя честно юнит-тестить в общем прогоне — паника в тесте с
  установленным глобальным хуком загрязняет другие тесты; поэтому тестами
  покрыты writer/prune, а не set_hook).

## Критерии готовности

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml crash_reporter` → все зелёные, ≥3 теста
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1` → exit 0, ≥546 passed
- [ ] `git grep -n "set_hook" src-tauri/src` → ровно одно вхождение (установка)
- [ ] `docs/telemetry/CRASH-REPORTING-DESIGN.md` существует и содержит раздел «Открытые вопросы»
- [ ] `npm run lint`, `npm run typecheck` → exit 0
- [ ] Изменены только файлы из «В объёме» (`git status`)
- [ ] Строка статуса в `plans/README.md` обновлена

## Условия STOP

- В `Cargo.toml` обнаружен `panic = "abort"` для release-профиля — хук всё
  равно отработает до abort, но поведение надо перепроверить; доложить
  и согласовать прежде чем коммитить.
- Установка хука требует менять порядок инициализации plugin_log или
  AppState — дизайн обязан обходиться без этого.
- Полный `cargo test` после шага 2 падает дважды.
- Возникает соблазн «заодно» сделать отправку на сервер — это фаза B,
  только документ.

## Заметки на сопровождение

- Хук глобальный и единственный: если в будущем кто-то добавит свой
  `set_hook`, цепочка должна сохраняться (мы вызываем предыдущий хук —
  новые должны делать так же).
- При реализации фазы B (отправка) пересмотреть санитизацию: бэктрейсы
  release-сборок содержат пути из CI/сборочной машины — решить, считаются
  ли они приемлемыми для передачи.
- `prune_old_reports(keep=5)` синхронизирован по духу с
  `RotationStrategy::KeepSome(5)` основных логов — менять согласованно.
