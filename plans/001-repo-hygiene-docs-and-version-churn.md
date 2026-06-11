# План 001: Привести мета-документацию в актуальное состояние, убрать мусор из корня и устранить churn version.ts — с полной регрессией

> **Инструкция исполнителю**: выполняй план строго по шагам. После каждого шага
> запускай команду верификации и сверяй результат с ожидаемым, прежде чем идти
> дальше. Если наступает любое условие из раздела «Условия STOP» — остановись и
> доложи, не импровизируй. По завершении обнови строку статуса этого плана в
> `plans/README.md`.
>
> **Проверка дрейфа (выполнить первой)**:
> `git diff --stat 37e9202..HEAD -- README.md progress.txt src/lib/version.ts scripts/version/ vite.config.ts src/vite-env.d.ts AGENTS.md CLAUDE.md "t-12.03.26-3BSL.xlsx"`
> Если какой-либо из этих файлов изменился после написания плана — сравни
> фрагменты из раздела «Текущее состояние» с живым кодом; при расхождении —
> это условие STOP.

## Статус

- **Приоритет**: P1
- **Трудозатраты**: M
- **Риск**: MED (этап 5 затрагивает релизный инструментарий; остальные этапы LOW)
- **Зависит от**: нет
- **Категория**: docs + dx + tech-debt (консолидированный план)
- **Составлен на**: коммит `37e9202`, 2026-06-11

## Почему это важно

Аудит от 2026-06-11 показал: код в отличном состоянии, но **мета-документация
активно лжёт**. `progress.txt` числит открытыми три проблемы, которые уже
решены (включая «известный падающий тест», из-за которого релизы шли с
`--skip-qa`). `README.md` называет источниками правды версии не те файлы и
указывает версию двухсотлетней давности. `src/lib/version.ts` — самый
часто меняющийся файл репозитория (62 из последних 200 коммитов) только
из-за того, что `BUILD_DATE`/`COMMIT_HASH` коммитятся как исходники.
В корне лежат два неприкаянных файла-фикстуры. После этого плана: документация
соответствует реальности, релизы перестают генерировать шумовые коммиты,
полный регрессионный прогон подтверждает, что ничего не сломано.

## Текущее состояние

Файлы и факты (проверены на коммите `37e9202`):

- `README.md` — строки ~13–15 содержат (по-русски):
  - «Актуальная версия приложения на момент обновления документации: `0.2.0-beta.5`.»
  - «Источники правды по версии: `package.json`, `src-tauri/tauri.conf.json` и `src/lib/version.ts`.»
  - Это **неверно**: единственный источник правды — `/version.json`
    (см. `AGENTS.md`, раздел «Versioning (SSoT)», и `scripts/version/lib.js`).
    Фактическая версия на момент написания плана: `0.2.3-alpha.19`.
- `progress.txt` (175 строк) — три пункта, все устарели:
  - Пункт 0 «[IN PROGRESS] Comparison Report Generation — ADR-0010»: фазы 1–3
    очевидно выпущены (`src/components/comparison/reports/ComparisonReportTab.tsx`,
    `ComparisonReportSettings.tsx`, `hooks/useComparisonReportExport.ts`
    существуют; в `src-tauri/src/commands/reports.rs` 440 упоминаний `comparison`).
    Статус фаз 4–5 (Playwright E2E + перф-бюджет; i18n/доки/release notes)
    требует проверки исполнителем.
  - Пункт 1 «Pre-existing regression in `test_stub_force_ai_uses_structured_mapping_for_fixture`»:
    тест **проходит** на HEAD (проверено 2026-06-11:
    `test result: ok. 1 passed; 0 failed`). Тест находится в
    `src-tauri/tests/ai_parsing.rs:1264`.
  - Пункт 2 «Channel-header rewrites bypass HMAC validation»: исправлено —
    в `license-server/releases.htaccess` строки 12–15 содержат комментарий
    «(Fixed 2026-04-19; was tracked in docs/LICENSING_CHANNELS.md as a
    hardening TODO.)», и все запросы `^v1/update/([^/]+)/update$` идут через
    `api/update-channel.php`, который валидирует HMAC.
- Корень репозитория — два отслеживаемых git'ом файла:
  - `t-12.03.26-3BSL.xlsx` (172 005 байт) — **байт-в-байт дубликат**
    `tests/fixtures/t-12.03.26-3BSL.xlsx` (тот же размер). Тесты читают фикстуру
    из `tests/fixtures/` через `fixtures_dir()`
    (`src-tauri/tests/ai_parsing.rs:110-112`:
    `PathBuf::from(manifest).join("../tests/fixtures")`), корневая копия не нужна.
  - `t-12.10.26-3BSL 12.03.2026 1139.data` (164 044 байта) — ссылок в коде не
    найдено (поиск по `t-12.10.26` в `src-tauri/tests/*.rs` пуст); требуется
    повторная проверка по всему репо перед удалением.
- `src/lib/version.ts` — генерируется `scripts/version/lib.js::writeVersionTs()`,
  текущее содержимое:

  ```ts
  export const APP_VERSION = '0.2.3-alpha.19';
  export const BUILD_DATE = '2026-06-10';
  export const COMMIT_HASH = 'd041a5f';
  ```

  Потребители (все три константы используются только здесь):
  - `src/app/dashboard/settings/tabs/DataTab.tsx:9` —
    `import { APP_VERSION, BUILD_DATE, COMMIT_HASH } from '@/lib/version';`
    (отображение в карточке «О приложении», строки ~94–104).
  - `src/app/dashboard/settings/UpdateCheck.tsx:3,221` — только `APP_VERSION`.
  - `src/lib/settings/app-settings-manager.ts:10,52` — только `APP_VERSION`.
- `scripts/version/lib.js` — функция `writeVersionTs(version)` (в конце файла)
  при каждом запуске вписывает свежие `BUILD_DATE` (текущая дата) и
  `COMMIT_HASH` (из `resolveCommitHash()`: `git rev-parse --short HEAD`,
  фолбэк `GITHUB_SHA`/`CI_COMMIT_SHA`, иначе `'dev'`). Из-за этого каждый
  `version:sync` (он же pre-hook `pretauri:dev`, `prebuild:ci`) меняет файл.
  `readVersionTsVersion()` проверяет **только** `APP_VERSION` — валидатор
  (`scripts/version/validate.js`) не зависит от `BUILD_DATE`/`COMMIT_HASH`.
- `vite.config.ts` — секции `define` сейчас **нет** (только plugins/server/watch).
- `AGENTS.md`, раздел «Versioning (SSoT)» — содержит фразу
  «`src/lib/version.ts` also contains build metadata (`BUILD_DATE`,
  `COMMIT_HASH`)… do not hand-edit `COMMIT_HASH` in source PRs.» — после
  этапа 5 это описание нужно обновить. `CLAUDE.md` проверить на зеркальный текст.

Конвенции репозитория:

- Коммиты — conventional commits на английском, примеры из `git log`:
  `fix(audit): merge audit fixes and prune stale releases`,
  `chore(release): record 0.2.3-alpha.19 build metadata`.
- Язык документации — русский (`README.md`, `progress.txt`); код и
  комментарии в скриптах — английский. См. `docs/LANGUAGE_POLICY.md`.
- Локальные проверки — авторитетный гейт (GitHub Actions не является
  блокирующим, см. `AGENTS.md` «Verified Commands»).

## Команды, которые понадобятся

| Назначение | Команда | Ожидаемо при успехе |
|---|---|---|
| SSoT-валидация | `npm run version:validate` | exit 0, «all 4 dependents agree» |
| SSoT-синхронизация | `npm run version:sync` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0, без ошибок |
| Lint | `npm run lint` | exit 0, пустой вывод |
| Vitest (полный) | `npm run test` | exit 0, все тесты зелёные |
| Rust-тесты (полные) | `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1` | exit 0, все зелёные |
| Один Rust-тест | `cargo test --manifest-path src-tauri/Cargo.toml --test ai_parsing test_stub_force_ai_uses_structured_mapping_for_fixture` | `1 passed; 0 failed` |
| E2E smoke | `npm run test:e2e:smoke` | exit 0 |
| Быстрый аудит | `npm run audit:enterprise:quick` | exit 0 |

(Все команды взяты из `package.json` и проверены при разведке, кроме
`test:e2e:smoke` и `audit:enterprise:quick` — они задокументированы в
`README.md`/`AGENTS.md`, но в сессии аудита не запускались.)

## Объём

**В объёме** (только эти файлы можно менять):
- `README.md`
- `progress.txt`
- `t-12.03.26-3BSL.xlsx` (удаление из корня)
- `t-12.10.26-3BSL 12.03.2026 1139.data` (удаление из корня, после проверки)
- `src/lib/version.ts` (через регенерацию)
- `scripts/version/lib.js`
- `vite.config.ts`
- `src/vite-env.d.ts`
- `AGENTS.md`, `CLAUDE.md` (только раздел про version.ts)
- `plans/README.md` (статус)

**Вне объёма** (НЕ трогать, даже если выглядит связанным):
- `scripts/version/validate.js`, `scripts/version/sync.js` — их логика не
  зависит от `BUILD_DATE`/`COMMIT_HASH`; менять не нужно.
- `scripts/build/generate-version.js` — deprecated-шим, оставлен намеренно.
- `src/app/dashboard/settings/tabs/DataTab.tsx`, `UpdateCheck.tsx`,
  `app-settings-manager.ts` — импорты остаются валидными по дизайну этапа 5;
  если кажется, что их надо править — это условие STOP.
- `tests/fixtures/**` — фикстуры не перемещать и не переименовывать.
- `license-server/**` — обход HMAC уже исправлен; ничего не менять.
- `src-tauri/src/commands/reports.rs` — разбиение файла осознанно отклонено
  аудитом (команда недавно завершила глубокий рефакторинг).
- `version.json` — версию не бампать.

## Git-процесс

- Ветка: `advisor/001-repo-hygiene` от `main`.
- Один коммит на этап, conventional commits, например:
  - `docs(readme): fix stale version and SSoT description`
  - `docs(progress): close resolved items, record verification`
  - `chore(repo): remove duplicate root fixtures`
  - `build(version): inject BUILD_DATE/COMMIT_HASH at build time`
- Не пушить и не открывать MR без указания оператора.

## Шаги

### Этап 0: Зафиксировать зелёный baseline

До любых изменений прогнать и записать результаты (в вывод сессии, не в файлы):

1. `npm run version:validate` → exit 0
2. `npm run typecheck` → exit 0
3. `npm run lint` → exit 0
4. `npm run test` → exit 0 (записать количество тестов)
5. `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1` → exit 0 (записать количество)

**Верификация**: все пять команд завершились с exit 0. Если хоть одна красная —
STOP: baseline не зелёный, чинить чужие поломки не входит в план.

### Этап 1: Актуализировать README.md

В `README.md` заменить блок (строки ~13–15):

- Было: «Актуальная версия приложения на момент обновления документации:
  `0.2.0-beta.5`.» и «Источники правды по версии: `package.json`,
  `src-tauri/tauri.conf.json` и `src/lib/version.ts`.»
- Стало (по смыслу, на русском): единственный источник правды по версии —
  `/version.json` (поля `version` и `channel`); четыре зависимых файла
  (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
  `src/lib/version.ts`) синхронизируются командой `npm run version:sync` и
  проверяются `npm run version:validate`; руками их не редактировать.
  Конкретное число версии в README **не указывать вовсе** (чтобы не
  протухало) — сослаться на `version.json`.

**Верификация**:
`powershell -Command "Select-String README.md -Pattern 'beta.5'"` → пусто;
`powershell -Command "Select-String README.md -Pattern 'version.json'"` → ≥1 совпадение.

### Этап 2: Закрыть устаревшие пункты progress.txt

Для каждого пункта — сначала перепроверить факт, затем переписать запись:

1. **Пункт 1 (падающий тест)**: запустить
   `cargo test --manifest-path src-tauri/Cargo.toml --test ai_parsing test_stub_force_ai_uses_structured_mapping_for_fixture`
   → ожидаемо `1 passed`. Если тест ПАДАЕТ — STOP (значит, регрессия вернулась,
   и это уже не доковая задача). Если проходит — пометить пункт как
   `[RESOLVED, <дата>]` с одной строкой: тест зелёный на HEAD, дата проверки,
   команда. Удалить из пункта рекомендацию `--skip-qa` как устаревшую.
2. **Пункт 2 (HMAC bypass)**: убедиться, что в
   `license-server/releases.htaccess` нет per-channel RewriteRule на
   `alpha.json`/`beta.json` (только маршрут через `api/update-channel.php` и
   legacy-stable-правило). Команда:
   `powershell -Command "Select-String license-server\releases.htaccess -Pattern 'alpha.json|beta.json' | Where-Object Line -notmatch '^\s*#'"`
   → пусто (упоминания только в комментариях). Пометить пункт
   `[RESOLVED 2026-04-19]` со ссылкой на фикс-комментарий в htaccess.
3. **Пункт 0 (ADR-0010)**: проверить чеклист фаз:
   - Фазы 1–3: файлы `src/components/comparison/reports/ComparisonReportTab.tsx`,
     `ComparisonReportSettings.tsx`, `hooks/useComparisonReportExport.ts`
     существуют → отметить `[x]`.
   - Фаза 4: поискать Playwright-спеки:
     `powershell -Command "Get-ChildItem tests\e2e -Filter '*comparison*'"`.
     Если спека генерации отчёта есть → `[x]`; нет → оставить `[ ]` и приписать
     одну строку «остаток работ».
   - Фаза 5: проверить упоминание comparison-отчёта в `CHANGELOG.md`
     (коммит `6c5b420 feat: release rheology reporting alpha 0.2.3-alpha.16`
     — ориентир). Аналогично отметить или оставить с пометкой.
   - Заголовок пункта сменить с `[IN PROGRESS]` на актуальный статус
     (`[DONE]` или `[REMAINDER: phases 4-5 …]`).

Записи **не удалять** — переписывать со статусом и датой: файл явно служит
журналом для будущих сессий.

**Верификация**:
`powershell -Command "Select-String progress.txt -Pattern 'IN PROGRESS|SEC-TODO'"`
→ пусто, либо остаются только честные «remainder»-пункты с датой проверки 
актуальности.

### Этап 3: Убрать дубликаты фикстур из корня

1. Сверить хеши корневой и канонической копии:
   `powershell -Command "(Get-FileHash 't-12.03.26-3BSL.xlsx').Hash -eq (Get-FileHash 'tests\fixtures\t-12.03.26-3BSL.xlsx').Hash"`
   → `True`. Если `False` — STOP (копии разошлись, решает человек).
2. Проверить отсутствие ссылок на корневые копии (пути без `tests/fixtures`):
   `powershell -Command "Get-ChildItem -Recurse -Include *.rs,*.ts,*.tsx,*.js,*.mjs,*.json,*.toml -Exclude node_modules | Select-String -Pattern 't-12\.10\.26' "`
   → пусто (для `.data`-файла). Для `.xlsx` совпадения допустимы только в
   `src-tauri/tests/ai_parsing.rs` (там путь строится через `fixtures_dir()`)
   и в `progress.txt`/документации. Любая другая ссылка на КОРНЕВОЙ путь — STOP.
3. `git rm "t-12.03.26-3BSL.xlsx" "t-12.10.26-3BSL 12.03.2026 1139.data"`

**Верификация**:
`cargo test --manifest-path src-tauri/Cargo.toml --test ai_parsing` → все
тесты зелёные (фикстура читается из `tests/fixtures/`, удаление корневой
копии ни на что не влияет).

### Этап 4: Стабилизировать src/lib/version.ts (устранение churn)

Цель: файл меняется **только** при смене версии, `BUILD_DATE`/`COMMIT_HASH`
внедряются на этапе сборки. Импорты потребителей не меняются.

1. В `scripts/version/lib.js` заменить тело `writeVersionTs(version)` так,
   чтобы генерировался следующий стабильный шаблон (даты/хеша в содержимом
   больше нет — функция становится идемпотентной по байтам):

   ```ts
   /**
    * Auto-generated version file
    * Do not edit manually
    *
    * Source of truth: /version.json
    * Run `npm run version:sync` to regenerate this file.
    *
    * BUILD_DATE / COMMIT_HASH are injected at build time by Vite `define`
    * (see vite.config.ts). Outside a Vite build they fall back to 'dev'.
    */

   declare const __BUILD_DATE__: string | undefined;
   declare const __COMMIT_HASH__: string | undefined;

   export const APP_VERSION = '${version}';
   export const BUILD_DATE: string =
       typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'dev';
   export const COMMIT_HASH: string =
       typeof __COMMIT_HASH__ !== 'undefined' ? __COMMIT_HASH__ : 'dev';
   ```

   Возвращаемое значение функции сохранить совместимым с `sync.js`
   (`{ changed, buildDate, commitHash }`) — `buildDate`/`commitHash` теперь
   просто информационные для лога (можно вычислять как раньше).
   `resolveCommitHash()` НЕ удалять — она понадобится в `vite.config.ts`
   (но импортировать её туда нельзя: lib.js — CommonJS, vite.config.ts — ESM;
   продублировать 8-строчную функцию в vite.config.ts с комментарием-ссылкой).
2. В `vite.config.ts` добавить в возвращаемый объект `defineConfig` секцию:

   ```ts
   define: {
     __BUILD_DATE__: JSON.stringify(new Date().toISOString().split('T')[0]),
     __COMMIT_HASH__: JSON.stringify(resolveCommitHash()), // локальная копия функции
   },
   ```

3. В `src/vite-env.d.ts` добавить глобальные декларации:

   ```ts
   declare const __BUILD_DATE__: string | undefined;
   declare const __COMMIT_HASH__: string | undefined;
   ```

   Если из-за дублирования с инлайн-`declare` в version.ts tsc выдаст
   конфликт — оставить декларации только в `vite-env.d.ts` и убрать их из
   шаблона version.ts.
4. Запустить `npm run version:sync` → version.ts перегенерирован по новому
   шаблону. Запустить `npm run version:sync` **второй раз** и проверить
   идемпотентность: `git status --porcelain src/lib/version.ts` → пусто
   (файл больше не меняется от повторного запуска).
5. Обновить `AGENTS.md` (раздел «Versioning (SSoT)») и, если там есть
   зеркальный текст, `CLAUDE.md`: `BUILD_DATE`/`COMMIT_HASH` теперь
   внедряются Vite на этапе сборки; version.ts меняется только при бампе
   версии; рекомендация «run sync from the clean release checkout
   immediately before build» больше не относится к метаданным сборки.

**Верификация** (все четыре):
- `npm run version:validate` → exit 0;
- `npm run typecheck` → exit 0;
- `npm run build` → exit 0, и в собранном бандле есть реальные значения:
  `powershell -Command "Select-String dist\assets\*.js -Pattern '\d{4}-\d{2}-\d{2}' -List | Select-Object -First 1"` → найдена дата;
- `npm run version:sync` дважды подряд → `git status --porcelain src/lib/version.ts` пуст.

### Этап 5: Полный регрессионный прогон

Выполнить полный гейт (тот же, что в этапе 0, плюс e2e и аудит):

1. `npm run version:validate` → exit 0
2. `npm run lint` → exit 0
3. `npm run typecheck` → exit 0
4. `npm run test` → exit 0; количество тестов ≥ baseline из этапа 0
5. `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1` → exit 0; количество ≥ baseline
6. `npm run test:e2e:smoke` → exit 0 (в окружении должен быть собран Tauri-бинарь
   или соответствующий web-раннер; если раннер требует недоступного бинаря —
   зафиксировать это в отчёте, НЕ считать провалом плана, но отметить в
   `plans/README.md` как ограничение прогона)
7. `npm run audit:enterprise:quick` → exit 0

**Верификация**: пункты 1–5 обязательны (exit 0). Пункты 6–7 обязательны при
доступном окружении; при недоступности — явная пометка в отчёте.

## Тест-план

Новые автотесты в этом плане не создаются (изменения — документация, удаление
дублей, генерация констант). Регрессия обеспечивается:

- полным существующим набором: Vitest (`npm run test`), Rust
  (`cargo test … --test-threads=1`), e2e smoke;
- специфичные точки контроля:
  - `src-tauri/tests/ai_parsing.rs` — подтверждает, что удаление корневой
    копии фикстуры безвредно (тесты читают `tests/fixtures/`);
  - двойной `version:sync` + `git status` — подтверждает идемпотентность
    нового version.ts;
  - `npm run build` + поиск даты в бандле — подтверждает, что Vite define
    реально внедряет значения (карточка «О приложении» в
    `DataTab.tsx` продолжит показывать дату сборки и хеш).

## Критерии готовности

Все пункты машинно-проверяемы, ВСЕ должны выполняться:

- [ ] `Select-String README.md -Pattern 'beta.5'` → пусто
- [ ] `Select-String progress.txt -Pattern 'IN PROGRESS|SEC-TODO'` → пусто
- [ ] `git ls-files "t-12.03.26-3BSL.xlsx" "t-12.10.26-3BSL 12.03.2026 1139.data"` → пусто
- [ ] `git ls-files tests/fixtures/t-12.03.26-3BSL.xlsx` → файл на месте
- [ ] `npm run version:sync` дважды → `git status --porcelain src/lib/version.ts` пуст
- [ ] `npm run version:validate` → exit 0
- [ ] `npm run lint` → exit 0
- [ ] `npm run typecheck` → exit 0
- [ ] `npm run test` → exit 0
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1` → exit 0
- [ ] `npm run build` → exit 0, в `dist/assets/*.js` найдена дата формата `YYYY-MM-DD`
- [ ] Изменены только файлы из списка «В объёме» (`git status`)
- [ ] Строка статуса в `plans/README.md` обновлена

## Условия STOP

Остановись и доложи (не импровизируй), если:

- Код в местах из «Текущего состояния» не совпадает с приведёнными фрагментами
  (репозиторий дрейфанул после `37e9202`).
- Этап 0: любой baseline-прогон красный.
- Этап 2: тест `test_stub_force_ai_uses_structured_mapping_for_fixture`
  падает — значит, регрессия из progress.txt вернулась; закрывать пункт нельзя.
- Этап 3: хеши корневой и канонической фикстуры не совпадают, или найдена
  ссылка на корневой путь фикстуры вне `tests/fixtures`.
- Этап 4: для починки typecheck/build требуется менять
  `DataTab.tsx`/`UpdateCheck.tsx`/`app-settings-manager.ts` или
  `scripts/version/validate.js` — дизайн обязан обходиться без этого.
- Этап 4: после изменений `npm run version:validate` падает и причина не
  очевидна за одну итерацию правки.
- Любая верификация шага падает дважды после разумной попытки исправления.

## Заметки на сопровождение

- После этапа 4 контракт version.ts меняется: «файл стабилен между бампами
  версии». Если в будущем кто-то вернёт запись даты/хеша в файл — churn
  вернётся; ревьюеру PR стоит проверить именно diff `scripts/version/lib.js`
  и секцию `define` в `vite.config.ts`.
- `BUILD_DATE`/`COMMIT_HASH` в dev-режиме Vite вычисляются на старте dev-сервера
  (значение перестаёт меняться до перезапуска) — для карточки «О приложении»
  это приемлемо; в юнит-тестах значения падают в `'dev'`.
- `progress.txt` теперь журнал со статусами — будущим сессиям стоит дописывать
  даты проверок, а не держать вечные «IN PROGRESS».
- Отложено сознательно (вне плана): разбиение `commands/reports.rs`
  (4 566 строк) — отклонено аудитом как «сейчас не стоит»; телеметрия
  крашей WP-6.3 — кандидат на отдельный план по запросу владельца.
