# Changelog

Все значимые изменения RheoLab Enterprise документируются здесь.  
Формат: [Keep a Changelog](https://keepachangelog.com/ru/1.0.0/).  
Версионирование: [Semantic Versioning](https://semver.org/lang/ru/).

---

## [0.2.3-alpha.16] — 2026-05-23

> Hotfix смены экспертного паттерна для экспериментов, открытых из библиотеки.

### Исправлено
- **Analysis / Library**: при редактировании цикла у metadata-only эксперимента приложение автоматически догружает полный набор данных перед открытием редактора паттерна.
- **Expert mode**: сообщение `Экспертный паттерн требует полной загрузки данных` больше не блокирует пользователя, если полный эксперимент доступен в базе.

### Проверки
- `npm run test -- tests/components/DashboardContent.test.tsx` — passed.
- `npm run typecheck` — passed.

---

## [0.2.3-alpha.15] — 2026-05-22

> Hotfix загрузки сохранённых приборных реологических параметров из базы.

### Исправлено
- **Analysis / Library**: при открытии сохранённого эксперимента из базы снова подтягивается таблица реологических расчётов прибора.
- **Metadata load**: быстрый путь загрузки эксперимента теперь возвращает `rheologyParameters`, чтобы режим `Прибор` во вкладке анализа не терял сохранённые строки.

### Проверки
- `npm run test -- tests/experiments/mappers.test.ts tests/components/DashboardContent.test.tsx tests/experiments/client.test.ts tests/reports/report-builders.test.ts` — passed.
- `cargo test --manifest-path src-tauri/Cargo.toml detail_meta_includes_rheology_parameters -- --nocapture` — passed.
- `cargo test --manifest-path src-tauri/Cargo.toml roundtrip_rheology_parameters_for_both_sources -- --nocapture` — passed.
- `npm run version:validate` — passed.

---

## [0.2.3-alpha.14] — 2026-05-22

> В отчётах явно указан источник таблицы реологических параметров.

### Добавлено
- **PDF / Excel reports**: перед таблицей реологической статистики выводится `Источник данных: Прибор` или `Источник данных: Программа`.
- **Reports / comparison**: источник прокидывается через весь пайплайн отчёта, включая экспорт из вкладки анализа, отчёты по сохранённым экспериментам и страницы сравнения.

### Проверки
- `npm run typecheck` — passed.
- `npm run test -- tests/reports/report-builders.test.ts tests/reports/report-regression.test.ts tests/reports/comparison-experiment-adapter.test.ts tests/reports/comparison-report-converter.test.ts` — passed.
- `cargo test --manifest-path src-tauri/Cargo.toml reports::tests::` — passed.
- `cargo test --manifest-path src/rust/rheolab-core/Cargo.toml report_generator` — passed.
- `npm run version:validate` — passed.

---

## [0.2.3-alpha.13] — 2026-05-22

> Уточнён выбор источника таблицы реологии при формировании отчёта.

### Изменено
- **Reports / comparison**: убрана неоднозначная опция `Как сохранено`; пользователь явно выбирает `Прибор` или `Расчёт`.
- **Comparison reports**: режим сравнения по умолчанию использует `Расчёт`, чтобы смешанные наборы экспериментов не зависели от наличия приборной таблицы во всех файлах.
- **Calculated rheology confirmation**: при экспорте с режимом `Расчёт` показывается предупреждение, что в отчёт будет загружена расчётная таблица реологии, и экспорт продолжается только после подтверждения.

### Проверки
- `npm run typecheck` — passed.
- `npm run test -- tests/components/comparison-report-settings.test.tsx tests/components/report-tab-rheology-source.test.tsx` — passed.
- `npm run test -- tests/reports/useComparisonReportExport.test.ts tests/reports/useReportExportById.test.tsx tests/reports/report-builders.test.ts` — passed.

---

## [0.2.3-alpha.12] — 2026-05-21

> Hotfix парсинга таблицы реологии Chandler и выравнивание визуального стиля блока рецептуры.

### Исправлено
- **Chandler instrument rheology**: парсер больше не захватывает строки из секции `Raw Data` как расчётные параметры прибора.
- **Recipe panel UI**: иконка блока `Рецептура` приведена к общему стилю панели анализа воды.

### Проверки
- `cargo test --manifest-path src\rust\rheolab-core\Cargo.toml chandler -- --nocapture` — passed.
- `cargo test --manifest-path src\rust\rheolab-core\Cargo.toml test_gold_ -- --nocapture` — passed.
- `npm run typecheck` — passed.

---

## [0.2.3-alpha.9] — 2026-05-21

> Добавлены два источника реологических параметров: значения прибора из отчёта и значения, рассчитанные RheoLab.

### Добавлено
- **Instrument rheology parsing**: Grace, BSL, Chandler и Brookfield отчёты теперь извлекают расчётные `n'`, `K'`, `Ks`, `Kp`, `R²`, вязкости и параметры Бингама из приборных таблиц.
- **ExperimentRheologyParameter**: новая таблица хранит приборные и программные параметры по циклам вместе с единицами, листом и строкой источника.
- **Save Dialog**: при наличии приборных параметров пользователь выбирает источник по умолчанию для отчётов и сравнения: `Прибор` или `Программа`.

### Изменено
- **Reports / comparison**: сохранённые отчёты и сравнение используют источник, выбранный для каждого эксперимента; для старых экспериментов `program` продолжает пересчитываться из сырых точек.
- **Basic mode**: `PV`, `YP` и `R² Bingham` отображаются и экспортируются всегда, редактирование циклов остаётся только в экспертном режиме.
- **DB import/merge**: импорт `.db` переносит новую таблицу реологических параметров.

### Проверки
- `cargo test --manifest-path src-tauri/Cargo.toml` — passed.
- `npm run test` — passed.
- `npm run version:validate` — passed.

---

## [0.2.3-alpha.8] — 2026-05-21

> Убрана идея пула “свободных” корпоративных лицензий: офлайн-лицензия создаётся автоматически при выдаче кода активации.

### Изменено
- **License admin**: при вставке `RL-REQ1:...` сервер сам создаёт новый корпоративный ключ, сразу привязывает его к Machine ID и отдаёт `RL-ACT1:...`.
- **Idempotency**: если для этого Machine ID уже есть активная корпоративная лицензия, сервер переиспользует её, чтобы после переустановки ОС не плодить дубликаты.
- **Offline license actions**: для корпоративных офлайн-лицензий убраны действия `Сбросить` и `Отозвать`, потому что сервер не может удалённо отключить уже выданный `RL-ACT1`.
- **Admin copy/docs**: текст в админке и документации больше не говорит про свободные ключи или предварительное создание лицензии.

### Проверки
- `php -l license-server\admin\index.php` — passed.
- `.\vendor\bin\phpunit` в `license-server` — passed.
- `npm run version:validate` — passed.
- `npm run typecheck` — passed.
- `node scripts\release\prepare-production.js --channel alpha` — passed.
- `python scripts\dev\verify-alpha-pipeline.py --expect-version 0.2.3-alpha.8` — passed.

---

## [0.2.3-alpha.7] — 2026-05-21

> Kaizen-упрощение корпоративной офлайн-активации: оператор вставляет только код запроса и сразу получает код активации.

### Изменено
- **License admin**: убран ручной выбор корпоративной лицензии; сервер сам берёт свободный корпоративный ключ и привязывает его к Machine ID из запроса.
- **Offline Corporate request**: код запроса стал постоянным для текущего Machine ID и больше не содержит случайный requestId/дату генерации.
- **Offline formats**: удалена поддержка старых `RHEOLAB-OFFLINE-...` префиксов и второго “старого” кода активации.

### Проверки
- `php -l license-server\admin\index.php` — passed.
- `.\vendor\bin\phpunit` в `license-server` — passed.
- `cargo test --manifest-path src-tauri\Cargo.toml commands::licensing::engine::offline --lib` — passed.
- `npm run typecheck` — passed.
- `npm run version:validate` — passed.
- `node scripts\release\prepare-production.js --channel alpha` — passed.
- `python scripts\dev\verify-alpha-pipeline.py --expect-version 0.2.3-alpha.7` — passed.

---

## [0.2.3-alpha.6] — 2026-05-21

> Alpha-hotfix для корпоративной офлайн-активации: клиент больше не вводит лицензионный ключ при генерации запроса, а админка выбирает корпоративную лицензию из списка.

### Изменено
- **Offline Corporate request**: вкладка офлайн-активации в приложении формирует `RL-REQ1:` без поля ключа/договора.
- **License admin**: ручной ввод корпоративного ключа заменён выбором активной корпоративной лицензии из списка.
- **Offline request payload**: `licenseKey` больше не попадает в request-код; старые request-коды продолжают приниматься сервером.

### Проверки
- `npm run typecheck` — passed.
- `php -l license-server\admin\index.php` — passed.
- `.\vendor\bin\phpunit` в `license-server` — passed.
- `cargo test --manifest-path src-tauri\Cargo.toml commands::licensing::engine::offline --lib` — passed.
- `npm run version:validate` — passed.

---

## [0.2.3-alpha.5] — 2026-05-20

> Alpha-hotfix для корпоративной офлайн-активации: короткие коды запроса/активации и уборка revoked-лицензий в админке сервера.

### Изменено
- **Offline Corporate activation**: новый короткий формат кодов `RL-REQ1:` и `RL-ACT1:` вместо длинного `RHEOLAB-OFFLINE-...`.
- **Legacy compatibility**: старые request/activation-префиксы продолжают приниматься, чтобы не ломать клиентов до обновления.
- **License admin cleanup**: в админке сервера лицензий добавлено удаление отозванных ключей по одному и массово.

### Проверки
- `php -l license-server\admin\index.php` — passed.
- `.\vendor\bin\phpunit` в `license-server` — passed.
- `cargo test --manifest-path src-tauri\Cargo.toml commands::licensing::engine::offline --lib` — passed.
- `npm run typecheck` — passed.
- `npm run version:validate` — passed.

---

## [0.2.3-alpha.4] — 2026-05-20

> Alpha-сборка с обновлённой корпоративной лицензией: калибровка скрыта из пользовательского интерфейса и заблокирована на backend-уровне для корпоративного режима.

### Изменено
- **Corporate license features**: корпоративная версия больше не получает доступ к режимам калибровки; калибровка остаётся только для developer/superuser-сценариев.
- **Analysis and comparison reports**: опции калибровки скрываются из настроек отчётов, если текущая лицензия не разрешает этот режим.
- **Parsing and experiment save guards**: данные калибровки не сохраняются и не проходят через парсинг для корпоративной лицензии.

### Проверки
- `npm run version:validate` — passed.
- `npm run typecheck` — passed.
- `npm run test` — passed.
- `cargo test --manifest-path src-tauri\Cargo.toml` — passed.
- Release gate вкладки «Сравнение» — passed.

---

## [0.2.3-alpha.3] — 2026-05-20

> Alpha-hotfix для PDF-отчётов: верхний колонтитул теперь стоит на одной высоте на страницах экспериментов, графиков и сводных таблиц.

### Исправлено
- **Report header alignment**: страницы графика сравнения и сводной таблицы используют те же вертикальные поля, что и листы экспериментов.
- **Single report chart page alignment**: отдельная страница графика в обычном отчёте также приведена к общим полям отчёта.
- **Chart fit after margin alignment**: высота графиков пересчитана под новую рабочую область страницы, чтобы график, подпись оси и легенда оставались внутри листа.

### Проверки
- `cargo test --manifest-path src\rust\rheolab-core\Cargo.toml pdf` — passed.
- `cargo check --manifest-path src-tauri\Cargo.toml` — passed.
- `npm run build` — passed.
- `npm run version:validate` — passed.

---

## [0.2.3-alpha.2] — 2026-05-20

> Alpha-hotfix для брендинга отчётов: SVG-логотип компании теперь корректно вставляется в PDF и больше не декодируется как PNG.

### Исправлено
- **SVG company logo in PDF**: генератор отчётов определяет формат логотипа по data URI/сигнатуре файла и передаёт в Typst `logo.svg`, `logo.png`, `logo.jpg` или `logo.gif` с корректным расширением.
- **Comparison report header logo**: вкладка «Сравнение» использует тот же формат логотипа в общем заголовке отчёта, включая логотип, заданный на уровне настроек сравнения.
- **Unsupported image formats fail soft**: неподдержанный или повреждённый логотип больше не должен ломать генерацию PDF; отчёт будет собран без логотипа.

### Проверки
- `cargo test --manifest-path src\rust\rheolab-core\Cargo.toml svg_logo` — passed.
- `cargo test --manifest-path src\rust\rheolab-core\Cargo.toml pdf_compiles_with_svg_company_logo` — passed.
- `npm run build` — passed.
- `cargo check --manifest-path src-tauri\Cargo.toml` — passed.

---

## [0.2.3-alpha.1] — 2026-05-20

> Alpha-hotfix для вкладки «Сравнение»: отчёт теперь сохраняется и для экспериментов, добавленных напрямую с локального диска, без обязательного сохранения в библиотеку/базу.

### Исправлено
- **Comparison report from local files**: экспорт PDF/XLSX больше не падает с ошибкой `Experiment IDs not found: file-...`, если часть сравниваемых экспериментов была добавлена горячим добавлением из файла.
- **Mixed comparison selections**: отчёт корректно собирается для смешанного набора, где часть экспериментов уже хранится в базе, а часть находится только в памяти текущей сессии.
- **Fast DB path preserved**: для отчётов, где все эксперименты уже сохранены в базе, сохранён прежний backend-путь экспорта по ID.

### Проверки
- `npm run test -- --run tests/reports/comparison-direct-export.test.ts tests/reports/client.test.ts` — passed.
- `npm run build` — passed.
- `cargo check --manifest-path src-tauri\Cargo.toml` — passed.
- `cargo test --manifest-path src-tauri\Cargo.toml reports_generate_comparison_` — passed.
- `npm run version:validate` — passed before alpha version bump.

---

## [0.2.2] — 2026-05-09

> Stable release, promoted from `0.2.2-alpha.24` after validation. The startup DB backfill throttling and user-visible DB update status from the alpha line are now the public default.

### Исправлено
- **Startup DB backfill throttling**: догоняющий расчёт touch-point precompute после импорта старой БД ограничен маленькими batch'ами, лимитом итераций и коротким time budget.
- **No long hidden CPU churn**: вместо обработки до 100 000 legacy rows за один запуск startup теперь берёт ограниченный объём и продолжает догонять данные постепенно.
- **Ненавязчивый статус обновления БД**: во время фонового обновления справа сверху показывается компактное уведомление “Обновление базы данных”; оно не блокирует работу и исчезает после завершения.
- **Backfill diagnostics**: backend пишет `processed/skipped/has_more/elapsed_ms` и отправляет события `started/progress/complete`.

### Проверки
- `npm run typecheck`, `npm run lint` — passed.
- `cargo test --manifest-path src-tauri\Cargo.toml --lib` — 461 passed, 2 ignored.
- `npm run release:prepare -- --skip-qa` — signed installer built, release gate passed.

---

## [0.2.2-alpha.23] — 2026-05-06

> Alpha-hotfix для импорта БД из старой beta в свежую alpha: ссылки на реагенты больше не ломают merge при совпадении каталога по имени.

### Исправлено
- **DB import beta → alpha**: `ExperimentReagent.reagentId` теперь ремапится на уже существующий `ReagentCatalog` по имени, если старая БД содержит тот же реагент с другим `id`.
- **FK fail-closed сохранён**: импорт по-прежнему откатывается при настоящих нарушениях целостности, но больше не падает на штатной несовместимости seeded catalog между версиями.

### Проверки
- `cargo test --manifest-path src-tauri\Cargo.toml backup::restore --lib` — 30 passed.
- `cargo test --manifest-path src-tauri\Cargo.toml --lib` — 460 passed, 2 ignored.
- `npm run version:validate`, `git diff --check` — passed.

---

## [0.2.2-alpha.19] — 2026-05-01

> Alpha-hotfix для Comparison: после удаления экспериментов график снова автоматически подгоняет X-шкалу под оставшиеся линии.

### Исправлено
- **Auto-fit after removal**: если сохранённый viewport выходит за фактический диапазон оставшихся экспериментов, Comparison очищает stale viewport и сжимает X-шкалу к текущим данным.
- **Brush stale labels**: нижняя полоса больше не держит старую подпись диапазона от удалённых экспериментов, например `354.7 min`, когда оставшаяся линия заканчивается около `178.6 min`.
- **No-zoom data changes**: при изменении набора данных без активного brush/zoom uPlot явно переустанавливает X-шкалу по текущему time extent.

### Проверки
- `npm run lint`, `npm run typecheck`, targeted Vitest `comparison-chart-viewport-policy` + `chart-brush` + `useComparisonSeriesWindows`, `npm run build:ci`, `npm run version:validate`, `npm run audit:large-ipc` — passed.

---

## [0.2.2-alpha.18] — 2026-05-01

> Alpha-hotfix для Windows shortcut icon: после updater-обновления ярлык рабочего стола и Start Menu больше не остаются на старой cached icon.

### Исправлено
- **Desktop/Start Menu shortcut icon**: installer теперь кладёт `rheolab-app-icon.ico` рядом с приложением и после установки/обновления явно прописывает его в существующие ярлыки.
- **Explorer refresh**: installer отправляет shell notification после обновления ярлыков, чтобы Windows быстрее сбросила старый icon cache.
- **Add/Remove Programs icon**: `DisplayIcon` теперь указывает на тот же bundled `.ico`, а не на кэшируемый icon resource внутри `.exe`.

### Проверки
- Installed `0.2.2-alpha.17` binary уже содержал новую icon resource; проблема была в shortcut `IconLocation = ,0` и Explorer cache.

---

## [0.2.2-alpha.17] — 2026-05-01

> Alpha-hotfix для native icon: значок приложения/ярлыка/favicon теперь белый круг с фирменной синей каплей внутри.

### Исправлено
- **Native app icon**: Windows/Tauri `.ico` пересобран как белый круг с каплей, чтобы ярлык/taskbar/tray не показывали старый тёмный знак.
- **Favicon**: `favicon.svg` и `favicon.ico` синхронизированы с native app icon.
- **Icon generator**: добавлен `npm run branding:icons`, чтобы app icon/favicons собирались из одного брендового SVG без ручных расхождений.

### Проверки
- Preview: `outputs/logo-preview/app-icon-white-circle-256.png`.

---

## [0.2.2-alpha.16] — 2026-05-01

> Alpha-polish для обновлённого брендинга: логотип стал крупнее, а внутренняя белая подложка убрана из UI/favicons/native icon.

### Исправлено
- **Прозрачный логотип**: удалена большая белая внутренняя заливка из брендового SVG, `public/logo.svg` и `public/favicon.svg`.
- **Крупнее в интерфейсе**: общий компонент логотипа теперь визуально масштабирует знак, а сам SVG использует более плотный `viewBox` без лишних полей.
- **Native icon**: Windows/Tauri `.ico` пересобран из прозрачного укрупнённого логотипа.

### Проверки
- `npm run lint`, `npm run typecheck`, `npm run build:ci`, `git diff --check` — passed.

---

## [0.2.2-alpha.15] — 2026-05-01

> Alpha-проверка обновлённого брендинга: новый логотип RheoLab в приложении, favicon/installer icon и нативная верхняя строка окна, окрашенная под текущую тему.

### Изменено
- **Новый логотип RheoLab**: общий UI-компонент логотипа теперь использует новый брендовый SVG.
- **Иконки приложения**: обновлены favicon/public logo и Windows/Tauri `.ico` для installer/app icon.
- **Theme-aware titlebar**: нативная верхняя строка окна Windows получает цвет caption/text/border под светлую или тёмную тему, сохраняя стандартные кнопки окна.

### Проверки
- `npm run lint`, `npm run typecheck`, `npm run build:ci`, `cargo check --manifest-path src-tauri/Cargo.toml`, `npm run version:validate`, `git diff --check` — passed.

---

## [0.2.2-alpha.14] — 2026-05-01

> Hotfix alpha после боевой проверки узкой полосы масштабирования Comparison. Закрывает сценарий, где 3-4 минутный brush мог восприниматься как resize handle, а не как pan, из-за чего полоса “плясала” или схлопывала график.

### Исправлено
- **Narrow brush panning**: клик внутри очень узкой selection теперь всегда считается pan по центру, а не resize левого/правого handle. Узкую полосу снова можно спокойно вести влево/вправо.
- **Viewport stability**: Comparison больше не очищает committed viewport только потому, что текущий narrow window временно пустой или не совпал с rendered axis extent. Логический zoom пользователя сохраняется.
- **Empty window fallback**: если точный viewport-window пустой для отдельной линии, chart использует overview как visual fallback вместо пустого/схлопнутого слоя.
- **Battle E2E proof**: добавлен Tauri-runner `perf:comparison:brush-battle`, который сохраняет 5 реальных экспериментов, ставит viewport `600s..810s` (3.5 минуты), двигает нижнюю полосу со скриншотами и проверяет отсутствие `experiments_series_window` во время drag.

### Проверки
- `npm run typecheck`, `npm run lint`, targeted Vitest `useComparisonSeriesWindows` + `chart-brush` — passed.
- Full `npm test` — passed.
- Tauri battle smoke: initial/committed viewport `3.5 min`; during drag `0` window requests; after commit chart layer `window`; brush width stable while both edges pan together.
- `npm run version:validate`, `npm run audit:large-ipc`, `git diff --check` — passed.

---

## [0.2.2-alpha.13] — 2026-05-01

> Hotfix alpha после ручной проверки `0.2.2-alpha.12`. Закрывает неправильное смешивание overview/window-слоёв в Comparison, из-за которого часть линий могла растягиваться на полный диапазон, часть оставаться в узком viewport, а график визуально “схлопывался”.

### Исправлено
- **Viewport/window layer isolation**: пустой `experiments_series_window` теперь считается валидной пустой линией текущего viewport, а не поводом подставить overview в основной график. Overview остаётся только для нижней полосы и live-preview.
- **Brush preview readiness**: основной график переключается в `brush-overview` во время drag только когда overview готов для всех DB-backed линий. Иначе он остаётся на текущем chart/window layer без гибридной отрисовки.
- **Scale preservation**: после смены uPlot data слой повторно применяет текущий brush x-range, чтобы точное window-обновление не сбрасывало масштаб.
- **Runtime proof**: warm-navigation smoke теперь проверяет `data-chart-layer="window"` после zoom/commit/return/add, чтобы гибридный слой не прошёл в release незаметно.

### Проверки
- Targeted Vitest: `useComparisonSeriesWindows` + `chart-brush` — 20 passed.
- Full `npm test`, `npm run lint`, `npm run typecheck`, `npm run build:ci`, `cargo test --manifest-path src-tauri/Cargo.toml --lib`, `npm run version:validate`, `npm run audit:large-ipc`, `git diff --check` — passed.
- Tauri warm-nav smoke: during brush drag `0` window requests; return old lines `0` refetch; add 6th old-line refetch `0`; 6th line window requests `1`; chart layer asserted as `window` after commit/return/add.

---

## [0.2.2-alpha.12] — 2026-05-01

> Follow-up hotfix для `0.2.2-alpha.11`. Закрывает edge-case нижней полосы масштабирования Comparison: простой клик без движения или `pointercancel` больше не оставляет график в overview-preview режиме.

### Исправлено
- **Brush noop/cancel lifecycle**: `ChartBrush` теперь явно сообщает `onDragEnd('commit' | 'noop' | 'cancel')`. При `noop` и `cancel` Comparison выключает preview-mode и возвращает шкалу к последнему committed viewport.
- **Cancel rollback**: если drag был отменён после локального preview-сдвига, незакоммиченный диапазон не остаётся на графике и не попадает в store.
- **Runtime proof**: warm-navigation Tauri smoke проверяет реальный no-move click по brush: preview выключается, а новых `experiments_series_window` запросов нет.

### Проверки
- Targeted Vitest: `chart-brush` + `useComparisonSeriesWindows` — 19 passed.
- Full `npm test`, `npm run build:ci`, `npm run lint`, `npm run typecheck`, `npm run version:validate`, `npm run audit:large-ipc`, `git diff --check` — passed.
- Tauri warm-nav smoke: `brush_noop_series_requests: []`, `brush_pan_series_requests_during_drag: []`, return old-line refetch `0`, add 6th line window requests `1`.

---

## [0.2.2-alpha.11] — 2026-05-01

> Hotfix alpha после ручной проверки `0.2.2-alpha.10`. Возвращает бесшовное масштабирование Comparison: узкую brush-полосу снова можно вести влево/вправо без постоянных window-подгрузок, прыжков и “схлопывания” графика.

### Исправлено
- **Comparison brush pan live preview**: `ChartBrush` теперь разделяет live-preview (`onChange`) и финальный commit (`onCommit`). Во время drag/pan viewport не пишется в store, поэтому `experiments_series_window` не вызывается на каждый pointermove.
- **Overview-backed road ahead**: пока пользователь тащит brush-полосу, основной график временно рисуется из overview-данных, чтобы движение было визуально непрерывным. Точная window-серия догружается один раз после отпускания мыши.
- **Brush extent stability**: при активном viewport нижняя полоса использует overview extent, а не текущий window-кусок. Это убирает скачки шкалы и случай, где сама полоса масштабирования “схлопывалась”.

### Проверки
- Targeted Vitest: `chart-brush`, `useComparisonSeriesWindows`, warm-navigation hook coverage — 28 passed.
- Full `npm test`, `npm run build:ci`, `npm run release:prepare -- --channel alpha`, `npm run version:validate`, `npm run audit:large-ipc`, `git diff --check` — passed.
- Tauri warm-nav smoke: during brush drag `0` series requests; after commit `5` window requests for selected experiments; return old lines `0` refetch; add 6th line `1` request.

---

## [0.2.2-alpha.8] — 2026-05-01

> Hotfix alpha после ручной проверки `0.2.2-alpha.7`. Закрывает regression масштабирования Comparison, где график “схлопывался” или уходил в пустой диапазон после zoom/brush/window-подгрузки.

### Исправлено
- **Comparison zoom/window time origin**: binary window-серия теперь сохраняет общий `timeOriginSec` эксперимента. Раньше window-кусок повторно нормализовался от своего первого сэмпла (`72–178 мин` превращались в `0–106 мин`), а viewport оставался на старой шкале — из-за этого график визуально схлопывался или рисовал данные только в части области.
- **Columnar chart pipeline**: `sanitiseAndNormaliseColumnarDirect` и touch-point input path учитывают `timeOriginSec`, поэтому overview и window данные остаются в одной системе координат.

### Проверки
- Targeted Vitest: `useComparisonSeriesWindows`, `comparison-data`, `zoom-plugin` — 57 passed.
- `npm run build:ci`, `npm run perf:warm-nav:tauri`, `npm run version:validate`, `npm run audit:large-ipc`, `git diff --check` — passed.

---

## [0.2.2-alpha.7] — 2026-04-30

> Hotfix alpha после ручной проверки `0.2.2-alpha.6`. Закрывает оставшийся user-visible regression в Comparison, когда saved test из базы добавлялся в список, но график оставался на `Загрузка данных...`, а double-click reset мог не сбрасывать внешний viewport.

### Исправлено
- **Comparison saved DB chart load**: если persisted viewport/brush от предыдущего сравнения не пересекается с выбранным saved experiment, binary `experiments_series_window` может вернуть валидное, но пустое окно. Frontend больше не считает такой ответ успешной линией: для этого experiment выполняется fallback на overview, viewport помечается как stale и сбрасывается, чтобы график сразу показал полный диапазон вместо вечной загрузки или пустой x-scale.
- **Comparison double-click reset**: reset-handler теперь использует тот же `resetZoom`, что и brush reset: сначала очищает brush/viewport ref, затем выставляет полный x-range. Это закрывает случай, где внешний persisted viewport мог удерживать старую шкалу после double-click.

### Проверки
- Targeted Vitest: `useComparisonSeriesWindows`, `zoom-plugin`, `comparison-selector` — 12 passed.
- Full `npm test`, `cargo test --manifest-path src-tauri/Cargo.toml --lib`, `npm run build:ci`, `npm run perf:warm-nav:tauri`, `npm run version:validate`, `npm run audit:large-ipc`, `git diff --check` — passed.

---

## [0.2.2-alpha.6] — 2026-04-30

> Hotfix alpha после ручной проверки `0.2.2-alpha.5`. Закрывает два user-visible regression'а в Comparison: добавление saved tests из базы и double-click reset графика.

### Исправлено
- **Comparison selector saved DB path**: при включённом binary Comparison выборе experiment из библиотеки больше не вызывается legacy `experiments_get` / full-data load. Selector добавляет лёгкую metadata-only запись, а график загружает bounded binary series по id. Legacy full-data path сохранён только за fallback flag `RHEOLAB_COMPARISON_LEGACY_EXPERIMENT_STORE=1`.
- **Double-click chart reset**: `zoomPlugin` теперь сбрасывает x-range по double-click даже когда текущий zoom пришёл из persisted viewport / brush state, а не из самого selection-zoom plugin. Это возвращает привычное поведение “двойной клик по графику — назад к нормальному виду”.

### Проверки
- Targeted Vitest: `comparison-selector`, `zoom-plugin`, `useComparisonSeriesWindows`, `comparison-store` — 35 passed.
- Full `npm test` — passed.
- `npm run build:ci`, `npm run version:validate`, `npm run audit:large-ipc`, `git diff --check` — passed.
- `npm run perf:warm-nav:tauri` — passed: return old 5 lines 438 ms, series requests on return 0, add 6th line 901 ms, refetched existing lines after add 0.

---

## [0.2.2-alpha.5] — 2026-04-30

> Alpha-релиз после merge warm-navigation стека в `main`. Главная цель — сохранить бесшовный UX Comparison при переходах между экранами, но сделать тяжёлые renderer-owned данные управляемыми по lifecycle.

### Добавлено
- **Warm Navigation lifecycle для Comparison**: выбранные эксперименты, metadata chips, настройки отображения, активная вкладка и viewport теперь живут как лёгкое logical session state. При уходе со страницы DB-backed raw/columnar payload очищается из renderer store, а недавно видимые binary chart windows остаются в bounded warm cache.
- **Shared frontend series window cache**: общий TTL/LRU/byte-bounded cache для binary overview/window данных. Возврат в Comparison в пределах warm window не refetch'ит уже выбранные линии.
- **Per-line binary Comparison loading**: DB-backed линии Comparison грузятся независимо по id через binary series pipeline. Добавление 6-го эксперимента грузит только новую линию, старые остаются видимыми.
- **Persisted Comparison viewport/session**: active tab и chart viewport восстанавливаются при route return; persisted viewport догружается как bounded window, а не как полный raw payload.
- **Rust decoded series cache**: backend повторно использует декодированные series для overview/window запросов, bounded по TTL, entries и bytes.
- **Warm navigation Tauri smoke**: `npm run perf:warm-nav:tauri` проверяет сценарий 5 saved experiments → уход на Dashboard ~30s → возврат без old-line refetch → добавление 6-го одной window-загрузкой.

### Исправлено
- **Frontend warm cache invalidation**: successful save/delete инвалидирует cache только изменённого experiment id; broad import/restore/sync paths очищают recoverable warm windows полностью. Это закрывает stale-cache риск до внедрения dataHash в frontend cache key.

### Документация и релизная политика
- Добавлен WN closeout: `docs/performance/WARM-NAVIGATION-CLOSEOUT.md`.
- В `AGENTS.md` и performance docs зафиксировано: GitHub Actions не являются authoritative gate для этого репозитория; readiness/merge/release основаны на локальном top-of-stack gate и Tauri smoke/perf sidecars.
- Release claim намеренно ограничен: bounded renderer-owned state и warm recoverable views, без обещания hard Total RSS win и без утверждения, что 5x100k stress уже доказан.

### Проверки
- Warm-nav smoke после invalidation: return to old 5 lines 455 ms, series requests on return 0, add 6th line 903 ms, old-line refetch after add 0, raw/columnar in store after route leave 0/0.
- Перед merge в `main`: `build:ci`, targeted warm-cache tests, full `npm test`, `cargo test --lib`, `perf:warm-nav:tauri`, `version:validate`, `audit:large-ipc`, `git diff --check`.
- Alpha release gate на `0.2.2-alpha.5`: passed, 7 exports / 4 fixtures / 4 settings phases, heap growth about +5.4 MB при budget 20 MB.

---

## [0.2.2-alpha.3] — 2026-04-29

> Alpha-релиз после Sprint 2 merge и release-gate на merge commit. Главная цель — отдать Superuser alpha-каналу новый default path сравнительных отчётов и оставить legacy payload lane только как аварийный rollback на одно alpha/beta окно.

### Изменено
- **Comparison PDF/XLSX default path**: сравнительные PDF и XLSX теперь по умолчанию идут через native by-IDs IPC. Frontend передаёт experiment IDs и настройки, Rust загружает данные из SQLite и рендерит отчёты без тяжёлой TypeScript-сборки per-experiment payload.
- **Legacy rollback lane**: старый payload path сохранён только как emergency rollback через `RHEOLAB_REPORTS_LEGACY_TS_ASSEMBLY=1` / settings flag. Он больше не является production default.

### Инфраструктура
- **Fixture-backed microbench validation**: Sprint 2 closeout зафиксировал PDF/XLSX native by-IDs microbench на production-shaped fixture DB. Результаты: PDF N=5 p50 230.8 ms / p95 246.1 ms, PDF N=10 p50 252.3 ms / p95 289.9 ms, XLSX N=5 p50 2,399.8 ms / p95 2,458.0 ms, XLSX N=10 p50 2,657.9 ms / p95 2,689.8 ms.
- **Release debt tracked**: `LARGE-IPC-EXCEPTION` остаётся только пока зарегистрирован legacy rollback command; removal gate — одно alpha и одно beta окно без by-IDs regressions.

---

## [0.2.1-beta.1] — 2026-04-28

> Первый beta-build после `0.2.1-alpha.6 → alpha.7 → alpha.8` цикла ручного тестирования. Кодово идентичен `alpha.8` (`dd55c04`) — отличается только полем `channel: "beta"` в SSoT-версии и пересчитанным `Cargo.lock`. Этот релиз открывает beta-канал auto-updater'а: Superuser-лицензии остаются на alpha (более частые сборки), Beta-лицензии получают этот build как первое обновление линии `0.2.1`.

### Изменено
- **Канал релиза**: `alpha → beta` через `/version.json` SSoT. `npm run version:sync` пробросил `0.2.1-beta.1` в `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src/lib/version.ts`. Validator принял конфигурацию (channel/tag правило `beta → -beta.N` соблюдено). Манифест опубликован в `runtime/release/channels/beta/latest-manifest.json` и развёрнут на VPS — все 31 deploy smoke-checks ✅ (artifact URL HTTP 200, 9.85 MB, sha256 `58e498…dae2d3`, remote-signature совпадает с local `beta.json`).

### Известные ограничения
- Это **первый** релиз в beta-канале — пользователи без активной beta/superuser лицензии не получат это обновление; auto-updater отфильтрует их по licence-tier до того, как фронтенд загрузит манифест.

---

## [0.2.1-alpha.8] — 2026-04-28

> Второй фоллоу-ап-релиз после `alpha.7` ручного тестирования. Закрывает feature-parity gap между PDF и Excel вариантами сравнительного отчёта и пинит persist-контракт `analysisSettingsStore` четырьмя новыми тестами после жалобы пользователя на «настройки слетают после перезапуска».

### Добавлено
- **REPORT-COMPARISON-AVG**: Две новые колонки `Сред. темп. (°C)` и `Сред. давл. (бар)` в `Сводная таблица` сравнительного отчёта (и PDF, и Excel).
  - Расчёт в `report_generator/comparison/summary.rs::ExperimentSummary::from_report_input` — арифметическое среднее по каждому finite-сэмплу из `raw_data[*].temperature_c` / `raw_data[*].pressure_bar`. `None`, `NaN`, `Inf` пропускаются единым хелпером `average_finite_optional`.
  - Когда ни одного finite-значения нет (типичный случай для атмосферных тестов, где давление в принципе не пишется), поле остаётся `Option::None` и рендерится как `—`, а не вводящий в заблуждение `0.0` (который читался бы как «измеренное атмосферное давление 0 бар»).
  - **PDF** (`pdf_comparison/summary_page.rs`): таблица расширена с 5 до 7 колонок, ширины перебалансированы с `(2.8fr, 0.9fr, 1.3fr, 1.5fr, 1.5fr)` на `(2.4fr, 0.7fr, 1.1fr, 1.4fr, 1.4fr, 1.0fr, 1.1fr)` чтобы две новые колонки помещались на A4 portrait без обрезки.
  - **Excel** (`excel_comparison/overlap_sheet.rs`): на листе `Overlap Chart` теперь рендерится `Сводная таблица` блоком в свободной полосе строк между чартом (строки 0..30) и существующими таблицами `Точки касания` / `Вязкость в заданное время`. Раньше Excel-вариант был «беднее» PDF — пользователь это явно отметил скриншотом alpha.7.
  - Семь объектов `Format` (section title, header + три ячейки × normal/alt zebra) вынесены из `if !data.touch_points.is_empty()` блока — теперь summary и touch-point таблицы делят их, что вдвое сокращает вклад в style-table workbook'a и гарантирует одинаковую типографику обеих таблиц.

### Исправлено
- **PERSIST-ANALYSIS-SETTINGS-TEST**: Тест `rehydrates user-customised settings` в `tests/store/analysis-settings-store.test.ts` использовал `setExpertSettings` + `setState({ expertSettings: DEFAULT })` для имитации перезапуска приложения. Оба вызова идут через persist middleware и **переписывают** `localStorage` дефолтами до того, как `rehydrate()` успевал их прочитать, поэтому assertion `pointsToAverage = 15` падала с `expected +0 to be 15`.
  - Тест теперь записывает persisted-blob (`{ state: { expertSettings }, version: 0 }`) **напрямую** в `localStorage`, обходя middleware, и затем вызывает `useAnalysisSettingsStore.persist.rehydrate()`. Это корректно отражает «холодный старт после рестарта» и совпадает с тем, что делает Zustand persist при инициализации стора.
  - **Важно**: production persist setup в `src/store/analysis-settings-store.ts` корректен — все 23 store-теста зелёные и round-trip покрывает `pointsToAverage`, `viscosityShearRates` (включая дополнительные ставки сверх дефолтного `[40, 100, 170]`), `stepSplitting` и остальные поля `ExpertSettings`. Жалоба пользователя на «слетают настройки после перезапуска» **не является регрессией кода**; вероятный root cause — разовый сброс WebView2 UserData (после недавнего `b622bdd` мы изолируем WebView2 dir per-E2E-run, что могло однократно перепутать локальный профиль вне E2E-контекста).

### Инфраструктура
- **Rust**: `ExperimentSummary` получил `avg_temp_c: Option<f64>` и `avg_pressure_bar: Option<f64>`. Хелпер `average_finite_optional<I: IntoIterator<Item = Option<f64>>>` вынесен в module-private API, +3 регрессионных теста (`summary_averages_finite_temperature_and_pressure`, `summary_temperature_average_skips_non_finite_and_missing`, `summary_returns_none_when_every_sample_is_non_finite`), +2 ассерта в существующем `summary_computes_basic_metrics`.
- **Excel renderer**: column widths `A=32, B=12, C=18, D=18, E=18, F=16, G=16` теперь выставляются один раз сверху и переиспользуются обоими блоками таблиц.
- **Тесты**: cargo `report_generator::comparison::*` — **54/54 ✅** (вкл. 8 summary тестов с +3 новыми). Vitest — **1341 passed / 6 skipped** (90 файлов), вкл. 4 новых persist-теста и 23 store-теста total. Lint clean.

---

## [0.2.1-alpha.7] — 2026-04-28

> Первый фоллоу-ап-релиз после ручного тестирования `alpha.6`. Два user-visible фикса по результатам manual-test feedback от мейнтейнера.

### Исправлено
- **REPORT-COMPARISON-CUSTOM-RATES**: В сравнительном отчёте, когда пользователь добавлял дополнительную сдвиговую скорость в expert-mode (например 220 1/s), per-experiment лист `Реология` рендерил заголовок столбца `η@220 1/с`, но **все ячейки в этом столбце были `—`**.
  - Root cause: `src/lib/reports/comparison-experiment-adapter.ts` прогонял Grace-pipeline с захардкоженным `viscosityShearRates: [40, 100, 170]` независимо от пользовательской настройки в expert-mode. Rust никогда не пересчитывал `viscosities[220]` в `GraceCycleResult`, и lookup в TS-builder'е находил `undefined` → ячейка получала `—`. Заголовок столбца оставался — он управляется отдельным полем `reportViscosityRates`, которое **корректно** доходит из UI.
  - Fix: adapter форвардит `overrides.reportViscosityRates` в `expertSettings.viscosityShearRates`, попутно отфильтровывая non-finite/non-positive значения (иначе `calc_visc(rate=0)` дал бы `0` в отчёте, что хуже чем прочерк).
  - +3 vitest регрессионных теста: `forwardsCustomShearRatesIntoExpertSettings`, `sanitisesNonFiniteAndNonPositiveRates`, `gracefullyHandlesMissingOverridesList`.
- **LIBRARY-FILTER-GROUPS-COLLAPSED**: Четыре группы фильтров в библиотеке (`Поиск`, `Локация и объект`, `Параметры теста`, `Диапазоны`) явно передавали `defaultOpen` в `FilterGroup` — открывались на маунте даже без активных фильтров, что захламляло сайдбар. Группы `QA` и `Реагенты` уже работали по схеме «collapsed on mount, expanded on click».
  - Fix: проп `defaultOpen` удалён со всех четырёх групп. Сайдбар теперь рендерится тихо; `activeCount`-бейдж по-прежнему виден, если в URL пришли pre-loaded фильтры — раскрывать пользователь вправе сам.
  - Тестовая правка: `renderWith` хелпер в `experiment-filters-touch-point.test.tsx` теперь кликает по заголовку группы `Диапазоны` перед взаимодействием с touch-point-блоком — `FilterGroup` размонтирует children в свёрнутом состоянии, поэтому без клика тесты не находят children-инпутов.

### Инфраструктура
- **Tests**: vitest +3 (comparison-experiment-adapter), no Rust changes. Lint + `npm run test` clean.
- **Version bump**: `/version.json` `0.2.1-alpha.6 → 0.2.1-alpha.7`, `version:sync` обновил 4 dependents, `version:validate` PASS.

---

## [0.2.1-alpha.6] — 2026-04-28

> Первый alpha-build после deep-optimization sprint (Phase 0-7). Только для Superuser-лицензии (project owner personal tier). Беты не будет, пока ручное тестирование не подтвердит стабильность — после этого следующая версия станет `0.2.1-beta.X`.
>
> **Версия `0.2.1-alpha.6`**, а не `.1`, потому что у владельца локально уже стояли пробные сборки `0.2.1-alpha.5` из прошлых рефакторинговых итераций. SemVer alpha.5 < alpha.6 — auto-updater корректно подхватит обновление вместо того, чтобы трактовать новую сборку как downgrade.

### Добавлено
- **Single Source of Truth для версии**: `/version.json` (`{ version, channel }`) — единственный файл, который человек редактирует руками. `npm run version:sync` автоматически прокидывает значение в `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src/lib/version.ts`. `npm run version:validate` — read-only проверка целостности; exit≠0 на любой drift или mismatch между `channel` и prerelease-tag (`alpha`/`beta`/`rc`/`stable`).
- **Defense-in-depth для версии в build-pipeline**: npm pre-hooks (`pretauri:dev` → sync, `pretauri:build` / `prerelease:prepare` → validate) **плюс** дублирующая проверка внутри `scripts/dev/run-tauri-cli.js` для случаев, когда `prepare-production.js` запускает Tauri-CLI через `spawnSync`, минуя npm. Любой entry-point — npm scripts, прямой `node`, или CI — полицится одинаково. Старый `scripts/build/generate-version.js` (с auto-bump-логикой и без safety net) превращён в deprecated shim, делегирующий в `version:sync`.
- **DB-индексы (Phase 4b/4d)**: Три новых миграции `v0004` (default Library list composite index), `v0005` (`COLLATE NOCASE` индексы для `ReagentCatalog` и `Experiment.testType`), `v0006` (FK-индексы для `importBatchId` на `ExperimentPayload` / `ParserArtifact` / `ReportArtifact`). Все hot-path queries в `EXPLAIN QUERY PLAN` теперь используют index seek без `TEMP B-TREE` сортировок.
- **F1 fix**: `is_duplicate_name` (импорт каталога реагентов) переведён с `LOWER()`-обёртки на `COLLATE NOCASE`, теперь корректно использует `idx_reagent_category_name_nocase`.
- **F3**: Filter-metadata cache invalidation на фронтенде — `ExperimentFilters` и `ExperimentList` делят один module-level promise-кэш с явным TTL, без лишних IPC-дёргов при изменении состояния списка.

### Исправлено
- **E2E DB-isolation**: Release-gate Playwright-тест и все остальные Tauri-E2E больше не открывают живую `%APPDATA%\com.rheolab.enterprise\rheolab.db`. `tauri-e2e-setup.js` выделяет per-run `outputs/e2e/temp-db/e2e-<ts>-<pid>.db` и пробрасывает путь через `RHEOLAB_E2E_DB_PATH` (Rust bootstrap уже умел honor-ить эту переменную). `tauri-e2e-teardown.js` подбирает за собой DB + sqlite sidecars (`-wal`/`-shm`/`-journal`). До фикса release-gate миграции тащили продакшен-DB вверх по schema_version, и старая локальная сборка с CURRENT_SCHEMA_VERSION ниже отказывалась её открывать на следующем запуске.

### Изменено
- **Phase 5a**: Удалено 5 неиспользуемых npm-зависимостей и 6 orphan-скриптов (`-54 packages, -1054 LOC`).
- **Phase 7a**: Закрыто 65/65 violations `eslint-plugin-react-hooks 7.x` — устранены `setState-in-effect` и `refs-in-render` паттерны в charts, useSaveDialogInit, BackupManager и ещё 11 файлах.
- **Refactor**: Разбиты три oversize Rust-файла — `touch_point_precompute.rs` (765 → 7 модулей), `pdf_comparison.rs` (1620 → 5 модулей), `report_generator/pdf/template/mod.rs` (646 → 3 модуля). Public API не менялся.

### Инфраструктура (только для разработчиков)
- **Phase 3 ecosystem bumps**: Vite 6→7→8 (Rolldown bundler), `@vitejs/plugin-react` 5→6, TypeScript 5→6, ESLint 9→10, `@types/node` 20→25, `typescript-eslint` 8.59.1, jsdom 27→29.
- **Phase 6 dep batches**: react/react-dom 19.2.1→19.2.5, lucide-react 0.561→1.11, ещё 17 пакетов в minor/patch ladder.
- **Audit hardening (Phase 0)**: Frontend-IPC deep audit gate PASS, gitleaks triaged, security-best-practices baseline зафиксирован в `docs/audit/2026-04-27-deep-optimization-plan.md`.
- **Performance regression hunt (Phase 3 follow-up)**: Apples-to-apples сравнение pre/post Phase 3 показало no regression на heap, DOM nodes, wall time или CPU. Benchmark suite leak slope улучшился с +2.7 → -0.1 MB/round. Полный отчёт: `docs/performance/PHASE-3-PERFORMANCE-DELTA-2026-04-28.md`.

### Известные ограничения
- В alpha-канал попадают только Superuser-лицензии (project owner personal tier). Beta/stable пользователи не получат это обновление автоматически.
- `madge@8.0.0` всё ещё требует `--legacy-peer-deps` для установки из-за устаревшего peerOptional на старый typescript-eslint.

---

## [0.2.0-beta.24] — 2026-04-22

### Исправлено
- **TP-FILTER-DYNAMIC**: Фильтр «Точка касания» в библиотеке теперь действительно находит эксперименты, пересекающие пользовательский порог — вместо бесполезного диапазонного поиска по самой вязкости в момент касания.
  - Было: три диапазонных поля (`crossingViscosityMin/Max` на precomputed колонке `touchCrossingViscosityCp`) выдавали 0 результатов для любого осмысленного ввода. Причина: по построению алгоритма `touchCrossingViscosityCp` — это viscosity **first-below-threshold** сэмпла, поэтому всегда сидит вплотную к 50 сП (в БД пользователя из 220 эксп. — 37.77 сП у единственного с пересечением). Диапазон «300..600 сП» никогда не попадал и не мог попасть.
  - Стало:
    - **UI** (`viscosity-threshold-selector.tsx`, `experiment-filters.tsx`): новый компонент `ViscosityThresholdSelector` с preset-пилюлями `авто (50) / 10 / 50 / 100 / 200 / 300 / 500` + свободный input для кастомных лабораторных значений. Пресеты покрывают типовые break-points для разных типов жидкостей (сликвотер → low, сшитый гель → 500). Disclaimer в секции теперь объясняет «момент падения вязкости ниже выбранного порога», лейбл `Достигнут порог X сП` динамически подстраивается.
    - **Rust slow path** (`commands/experiments/list/dynamic.rs`, новый модуль 343 строки): когда `viscosityThreshold` задан и положителен, query-билдер обходит precomputed колонки и прогоняет `smart_touch_points` on-the-fly против пользовательского порога. Coarse SQL-pruning по `maxViscosity ≥ threshold` (NULL-safe) отсекает заведомо непересекающие ряды, остальные декодируются из columnar zstd blob и пересчитываются. Фильтры `hasCrossing`, `crossingTime{Min,Max}`, `viscosityAtTarget{Min,Max}` применяются против свежих значений, в UI-карточках тоже показываются свежие (не stale 50 сП).
    - **Rust fast path** сохранён 1:1: пустой `viscosityThreshold` → existing precomputed SQL-путь, байт-в-байт тот же результат, что и раньше (не ломаем backward compat).
    - **Guard от started-below-threshold edge case**: если вся кривая лежит ниже порога (нет гельной фазы), алгоритм мог ложно сообщить о «пересечении» (slope guard пропускается при `run_start=0`). В slow path post-check `max(inputs.viscosity) > threshold` отбрасывает эти spurious crossings.
  - Убран бесполезный `RangeFilter` «Вязкость в точке касания (сП)» из UI. Rust-поля `crossing_viscosity_min/max` оставлены в `ExperimentsListQuery` для backward-compat API — просто игнорируются UI, а при отсутствии значения становятся no-op.
- **TP-FILTER-UX-EMPTY-STATE**: Пустой список в библиотеке при активных touch-point фильтрах теперь объясняет, почему всё скрылось, и даёт one-click выход.
  - Было: при 0 результатов показывалось безликое «Эксперименты не найдены. Попробуйте изменить параметры фильтрации», без намёка на причину.
  - Стало: extended `filter_metadata` (`touch_point_stats` агрегат на стороне Rust) отдаёт `{ totalExperiments, withCrossingCount, crossingTime{Min,Max}Minutes, crossingViscosity{Min,Max}Cp, viscosityAtTarget{Min,Max}Cp }`. UI использует их дважды:
    - **В сайдбаре** под каждым touch-point-ренджем показывается подпись `в БД: X..Y мин` (или «нет данных»), `«M из N эксп. достигли порога»` — так сразу видно какие диапазоны имеют смысл.
    - **В empty state** при активных touch-point-диапазонных фильтрах и 0 результатов рендерится контекстное сообщение вида «Из 220 эксп. только 1 достиг порога 50 сП. Остальные исключаются диапазонными фильтрами точки касания. Доступный диапазон — время: 0.02 мин, вязкость: 37.8 сП. Снимите или расширьте touch-point фильтры.» + кнопка **«Сбросить фильтры точки касания»** (включая `viscosityThreshold` и `hasCrossing`).
  - Исправлен dev-артефакт: Vite дёргал полный page-reload при edit'e Rust-исходников (`vite.config.ts` watch.ignored = `['**/src/rust/**']`) — ломало persist загруженных экспериментов в dashboard store при обычном программировании. Store уже отбрасывает тяжёлые Float64Array на уровне persist-конфига по памяти, но обычная navigation между вкладками больше не вызывает перемонтирование из-за reload.

### Инфраструктура
- Rust (TP-FILTER-DYNAMIC): новый модуль `src-tauri/src/commands/experiments/list/dynamic.rs` с собственным candidate-selection SQL (join с `ExperimentData`), per-row decode + recompute, in-memory sort/paginate + batch-reagent load. `touch_point_precompute.rs` получил новую функцию `compute_from_inputs_with_threshold(&inputs, threshold)`, старая `compute_from_inputs` стала обёрткой над ней с фиксированным `LIBRARY_THRESHOLD_CP`. `query.rs` зарефакторен на helper-функции `append_base_conditions` / `append_precomputed_touch_conditions` — общий код fast/slow путей теперь в одном месте.
- Rust (TP-FILTER-UX): в `ExperimentsFilterMetadataResponse` добавлено поле `touch_point_stats: TouchPointLibraryStats` с 9 полями (total / withCrossing / withTarget / 3 пары range). Единый агрегатный SELECT в `query_touch_point_stats` кэшируется под тем же `FILTER_META_TTL`.
- TypeScript: новый hook `src/hooks/useExperimentFilterMetadata.ts` с module-level promise-кэшем — `ExperimentFilters` и `ExperimentList` делят одну metadata-загрузку на сессию (+ `resetExperimentFilterMetadataCache()` для тестов). `src/lib/library/touch-point-hints.ts` — 5 pure-формтеров для сайдбарных и empty-state подсказок. `RangeFilter` получил опциональный `hint` + `hintTestId` props. `FilterState` расширен `viscosityThreshold`, удалены устаревшие `crossingViscosity{Min,Max}` поля, EMPTY_FILTERS синхронизирован.
- Тесты:
  - Rust: +5 тестов `dynamic_threshold_*` (crosslinked gel 500 сП, maxViscosity prune, crossing-time narrowing, junk-input fallback на fast path, hasCrossing=no) + 3 теста `touch_point_stats_*` (empty DB, actual ranges, pending-backfill ignored). Итого cargo: **296/296 ✅** (+8 lib, rheolab-core неизменен).
  - Vitest: `touch-point-hints.test.ts` — 19 pure-тестов на форматеры. `experiment-filters-touch-point.test.tsx` обновлён: новые тесты на пресеты threshold (`ViscosityThresholdPreset-500` / `-default`), кастомный input, динамический лейбл `Достигнут порог`, «Clear All» теперь сбрасывает и threshold. Итого: **193/193 ✅** (15 файлов), +22 против предыдущего прогона.
  - `tsc --noEmit`: clean.

### Добавлено
- **REPORT-COMPARISON**: Сравнительный отчёт для вкладки Comparison (ADR-0010).
  - Новая под-вкладка «Отчёт» / «Report» рядом с графиком в Comparison view (Radix Tabs).
  - PDF: страница 1 — сводный мульти-эксперимент SVG-чарт + сводная таблица (filename, date, instrument, #cycles, средняя вязкость, температура); страницы 2..N+1 — полный per-experiment отчёт (тот же формат, что и single-exp). Рендер вектором (Typst + Plotters SVG), не PNG.
  - Excel: лист `Сравнение`/`Comparison` — заголовок, сводная таблица, native Excel chart (редактируемый); листы 2..N+1 — компактный per-experiment отчёт (metadata + chart + stats + recipe + water + calibration + опц. raw data). Sheet name: truncate 31 символ + sanitize `[]:*?/\` + детерминированный суффикс `_2`, `_3` при коллизии.
  - UI: независимые section-toggles (Calibration / Raw data / Recipe / Water analysis), выбор языка (RU/EN) из `brandingStore`, счётчик экспериментов, индикатор прогресса при генерации.
- **IPC**: новые Tauri-команды `reports_generate_comparison_pdf`, `reports_generate_comparison_excel` (HMAC-gated, такой же паттерн, как single-exp отчёты).
- **TP-PRECOMPUTE (PR2)**: библиотека теперь хранит и фильтрует результаты по точкам касания (ADR-0011).
  - Миграция БД `v0002_touch_point_metrics`: пять новых колонок в `experiments` (`touch_has_crossing`, `touch_crossing_time_min`, `touch_crossing_viscosity_cp`, `touch_viscosity_at_target_cp`, `touch_precompute_version`) + частичные индексы `idx_experiment_touch_has_crossing` и `idx_experiment_touch_crossing_time_min`. Зафиксированный контракт: threshold = 50 сП, target time = 10 мин.
  - Save-path: при сохранении эксперимента Rust-hook пересчитывает метрики и пишет precompute-колонки в одной транзакции с основной записью (без накладных расходов на чтение позже).
  - Read-path: `experiments_list` получил пять новых фильтров — `hasCrossing` (tri-state: `'' | 'yes' | 'no'`), `crossingTime{Min,Max}`, `crossingViscosity{Min,Max}`, `viscosityAtTarget{Min,Max}`. Все фильтры составляются через параметризованный SQL и используют новые индексы.
  - UI: в сайдбаре библиотеки появилась секция «Точка касания» с Radix Select для hasCrossing и тремя RangeFilter; привязано к `ExperimentFilters` через прямой spread в `listExperiments`, кнопка «Очистить всё» обнуляет и touch-point поля.

### Инфраструктура
- Rust: модуль `report_generator/comparison/` (`types`, `summary`, `excel_comparison`, `pdf_comparison`, `mod`), multi-experiment SVG-рендерер `chart_generator/line/multi_experiment.rs`, extraction общих helpers в `excel/mod.rs` и `pdf/template/mod.rs`.
- Rust (PR2): `src-tauri/src/db/migrations/v0002_touch_point_metrics.rs`, `src-tauri/src/db/touch_point_precompute.rs`, расширение `experiments::list::query` новыми WHERE-пунктами и маппингом колонок в `ExperimentListItem`.
- TypeScript: `src/lib/analysis/report-types/comparison-report-{inputs,converter}.ts` (camelCase ↔ snake_case), `src/lib/reports/comparison-{builders,experiment-adapter}.ts`, расширен `bridge.reports` + `src/lib/reports/client.ts` (retry-fallback).
- TypeScript (PR2): `src/types/experiment-filters.ts` расширен пятью новыми полями `FilterState`; `RangeFilter` получил опциональные `minTestId`/`maxTestId` для стабильных E2E-селекторов.
- Тесты:
  - Rust: `rheolab-core` 144/144 ✅, + comparison-golden-tests и integration-тесты в `src-tauri` (PDF magic bytes, XLSX ZIP structure, sheet names, bytes > threshold); +22 тест в `src-tauri` для touch-point precompute (`crud_tests`, `migration_tests`, `list_tests`), итоговый Rust-счёт 288 lib + 22 integration.
  - Vitest: +42 теста (converter / builders / adapter / client / hook) + 8 тестов на touch-point UI (`experiment-filters-touch-point.test.tsx`), все 1280 ✅.
  - Playwright: +6 новых E2E в `tests/e2e/reports/comparison-report.spec.ts` (sub-tab routing, PDF/Excel download, section toggles, empty-state disable, language switch) + 6 Tauri E2E для touch-point (`tests/e2e/library/touch-point-filters.tauri.spec.ts`: seed/correctness + query-latency benchmark + heap-stability soak). Бенчмарк на реальном Tauri-бинаре: p95 фильтрованного `experiments_list` ≤ 5 мс (SLA 250 мс), heap Δ = 0 MB за 30 циклов apply/clear.

### Исправлено
- **CHART-TIME-FORMAT-01**: Ось «Время» в PDF-графике и Excel-чарте теперь следует за выбором `rheologyUnits.timeFormat` в UI (как и таблица «Реология» до этого).
  - Было: и PDF, и Excel игнорировали выбранный `timeFormat` — ось всегда подписывалась «Время (мин)» / «Time (min)», тики рендерились в десятичных минутах (`0, 5, 10, …`), ячейки в Excel хранились в минутах с форматом `0.00`. Дашборд тем временем показывал `00:04:00`, если пользователь выбрал `hh:mm:ss`.
  - Стало:
    - **PDF (`chart_generator::common::ChartConfig::time_format` + Typst overlay `pdf/template/chart_page.rs::make_ticks`)**: подпись оси динамически строится через `time_axis_unit()`, bottom-tick labels форматируются через `format_time_value()` для `seconds`/`hh:mm:ss`, минуты сохраняют legacy-формат байт-в-байт.
    - **Excel (`excel/raw_data.rs` + `excel/chart.rs`)**: заголовок time-колонки, хранимое значение (минуты / целые секунды / Excel day-serial) и `num_format` (`0` / `0` / `[h]:mm:ss`) теперь подбираются per `time_format`; `x_axis.set_max` использует возвращаемый `max_time_display` в той же единице.
    - **Comparison PDF (`comparison/pdf_comparison.rs`)**: использует `resolve_units` anchor-эксперимента для выбора подписи оси — comparison-график согласован с per-experiment страницами.

### Инфраструктура
- Rust: `ChartConfig` получил поле `time_format: String` (пустая строка = `minutes` для обратной совместимости), `RawDataSummary` переименовал `max_time_minutes → max_time_display` и добавил `time_format`. `pdf/mod.rs`, `excel/mod.rs`, `pdf_comparison.rs` все вызывают `resolve_units` (единая точка резолва из UI).
- Тесты: +1 Rust-регрессионный тест `excel::tests::time_format_propagates_to_xlsx_output` — проверяет, что `minutes/seconds/hh:mm:ss` дают три различных XLSX-байт-стрима и каждый из них детерминирован на повторных запусках. Исторический `single_exp_output_is_deterministic` продолжает проходить (minutes-путь байт-в-байт не изменился). Итоговый rheolab-core счёт: 166/166 ✅ (+1).

### Исправлено
- **REPORT-UNITS**: Таблица «Реология» в PDF / Excel теперь показывает ровно те единицы, что выбраны в UI графика (ADR-0012).
  - Было: `unitSystem` выводился из **одного поля** `chartSettings.lines.viscosity.unit`, что ломало смешанные пресеты («сП вязкость + Pa·s^n K' + Pa·s PV» — UI показывал `K' (Pa·s^n) = 10.4618`, а отчёт выгружал `K' (lbf/100ft²) ≈ 500+`).
  - Стало: через TS `chartSettings.rheologyUnits` и Rust `ReportSettings.rheology_units` передаются **отдельные target-единицы** для каждой категории (viscosity / consistency / plasticViscosity / yieldPoint / time_format). Per-category overrides побеждают коарсовый `unit_system`, значения и подписи в отчёте совпадают с `CycleResultsTable` byte-for-byte.
  - Исправлен коэффициент конверсии K' для Imperial: было `47.88` (Pa → lbf/ft²), стало `2.0885` (Pa → lbf/100ft², API RP 13D, совпадает с YP). Старые отчёты на Imperial показывали K' в ~23× больше корректного значения.
  - Исправлена подпись K' для Imperial: было `lbf/100ft²` (как у стресса), стало `lbf·s^n/100ft²` (честная размерность стресс·время^n, синхронизирована с TS `IMPERIAL_UNITS.consistency`).
  - Колонка «Время» в таблице отчёта теперь рендерится согласно `rheology_units.time_format` выбранному в настройках графика: `Время (с)` → целые секунды, `Время (мин)` → десятичные минуты (как прежде), `Время (чч:мм:сс)` → `00:09:00`.

### Инфраструктура
- Rust: новая `RheologyUnits` структура в `report_generator::types`, публичные target-aware хелперы `render_k_with`/`render_pv_with`/`render_yp_with`/`render_viscosity_with` + `format_time_value` + `time_axis_unit` + `resolve_units` в `report_generator::formatters`. `pdf/template/stats.rs` и `excel/stats.rs` консолидированы на общий `resolve_units` вместо дубликатов.
- TypeScript: новый тип `ReportRheologyUnits` в `report-types/report-inputs.ts`, serializer в `report-converter.ts` (`plasticViscosity → plastic_viscosity`, `yieldPoint → yield_point`, `timeFormat → time_format`), плюминг в обеих сборщиках `report-builders.ts` (PDF + Excel). Comparison-report автоматически наследует фикс через делегирование `convertReportInputToWasm`.
- Тесты: +17 Rust unit-тестов в `formatters::tests::` (6 `resolve_units_*` для всех пресет-комбинаций включая user's mixed-custom + partial override + hh:mm:ss; 4 `render_*_with_targets`; 4 time-helpers; 3 viscosity-format). K'-factor-test обновлён с `47.88 → 2.0885`. Итоговый Rust-счёт: 165 lib (+17) + 230 integration.
- Документация: новый ADR-0012 `per-category-unit-overrides-in-reports.md` описывает архитектуру wire-format, коэффициенты API RP 13D, fallback-семантику и rationale для каждого решения.

### Исправлено (продолжение)
- **CHART-BATH-01**: Точки без `bath_temperature_c` (Sweep Data в мердже OFITE 1100 Sweep + Log Data) больше не рендерятся как `0` на uPlot-графике.
  - Было: при пропущенной температуре бани ряд попадал на X-ось → оранжевая штриховая линия падала вертикально к нулю в каждой такой точке, что визуально читалось как катастрофические сбои нагрева (хотя данных просто не было).
  - Стало: `useRheologyData` хранит `bathTemperatures` как `Array<number | null>` и пишет `null` для пропусков — uPlot рендерит `gap`; `sanitiseAndNormaliseColumnarDirect` (Comparison-pipeline) пишет `NaN` в `Float64Array`, далее `alignSeriesFromColumnarLinear` корректно эмитит `null`. Два затронутых пути: AoS (`useRheologyData.ts:166`) и columnar (`useRheologyData.ts:266`); плюс comparison columnar (`comparison/normalize.ts:280`).
- **CHART-BATH-02**: Правая Y-ось теперь подписана корректно, когда на ней одновременно находятся температура пробы и температура бани (shared-axes mode).
  - Было: `build-axes-series.ts` в shared-режиме пушил в `rightLabels` только `t.temperatureAxis`, и подпись «Темп. бани» не появлялась никогда, даже если линия была видна.
  - Стало: новая тройная ветвь — оба → `tempBathCombinedAxis` ("Температура / Темп. бани (°C)"), только баня → `bathTempAxis`, только температура → `temperatureAxis`. Individual-режим уже был корректен.

### Инфраструктура (продолжение)
- Тесты: +16 Vitest-тестов регрессии CHART-BATH.
  - `tests/hooks/useRheologyData.test.ts` (5 тестов): null-handling в AoS- и columnar-пути, сохранение `0` как валидного измерения, конверсия бани через °F-конвертер.
  - `tests/hooks/chart-options/build-axes-series.test.ts` (8 тестов): комбинаторика labels для shared- и individual-режимов × 4 сочетания температура/баня.
  - `tests/components/comparison-data.test.ts` (+3 теста): `sanitiseAndNormaliseColumnarDirect` пишет `NaN` вместо `0`, `alignSeriesFromColumnarLinear` эмитит `null`, паттерн OFITE 1100 (чередование bath/no-bath) не даёт `0` в выходе.
  - Full Vitest: 1296/1302 ✅ (+16 тестов, 0 регрессий, 6 skipped как раньше).

### Релиз
- Alpha installer собран локально: `RheoLab Enterprise_0.2.0-beta.24_x64-setup.exe` + `.sig`.
- Channel manifests: `runtime/release/channels/alpha/{latest-manifest,release-manifest-…}.json`.
- Release-gate PASSED на пересобранном бинарнике: 4 фикстуры × 4 настройки × 7 экспортов за 18 секунд, memory stability OK.

---

## [0.2.0-beta.9] — 2026-04-21

### Добавлено
- **UI-018**: Глобальный селектор единиц вязкости в настройках → «Общие». Три системы: **SI** (мПа·с, по умолчанию), **SI (Па·с)** и **Imperial** (сП). Выбор сохраняется в localStorage и применяется к:
  - таблице результатов циклов на дашборде (заголовок η@γ и значения),
  - экспорту Excel (колонки η@γ, сырые данные, таблица touch points и статистика),
  - экспорту PDF (таблица cycle-results, сырые данные, чарт: ось Y, легенда, порог, touch points).
- Адаптивная точность: 4 знака после запятой для Па·с (суб-единичный диапазон), 1 знак для мПа·с/сП.

### Изменено
- Хранение вязкости во всём pipeline остаётся в мПа·с; конвертация в display-unit происходит ровно один раз — на границе вывода. Это сохраняет численную консистентность touch-point алгоритма и порога (оба сравниваются в мПа·с).

### Инфраструктура
- Добавлен `display-settings-store` (Zustand + persist) с санитайзером недопустимых значений.
- Rust: helpers `convert_viscosity()`, `get_viscosity_unit()`, `viscosity_decimals()`, `viscosity_excel_format()` в `report_generator::formatters`.
- Тесты: +5 Rust-тестов (label formatting для всех 3 систем + invariant «storage unit preserved»), +18 Vitest-тестов для стора и helpers.

---

## [0.2.0-beta.4] — 2026-03-19

### Исправлено
- **PARSE-001**: Исправлен тест `test_stub_optional_ai_falls_back_to_heuristic_on_invalid_mapping` — при inline-загрузке файла (байты из браузера/API) опциональный AI-маппер теперь всегда запускается независимо от состояния эвристики. Ранее при здоровой эвристике функция возвращала результат досрочно и `ai_diagnostics.failure_reason` оставалось `None` вместо сообщения об ошибке.
- **PARSE-002**: Сообщение об ошибке AI-маппера в `ai_diagnostics.failure_reason` больше не содержит префикс варианта `"Parse error: "` — в поле записывается только текст ошибки.
- **PARSE-003**: Оптимизация и исправления специфичных BSL-файлов (например, фикстуры `t-12.03.26-3BSL`):
  - Исправлено определение времени (`fractional-minute` / дробные доли минуты) для BSL файлов, где заголовок содержит только "Время" без единиц измерения.
  - Починен парсинг кодировки времени через запятую-тысячные (bug ×1000).
  - Починен баг "dropped-decimal time encoding" (потеря десятичных знаков в BSL-таблицах).
  - Интеллектуальный парсинг: для сложных и неизвестных форматов (в т.ч. некоторых BSL) добавлен принудительный запуск AI-парсера (forceAI toggle).
  - Исправлена физическая эвристика: расчётное значение скорости сдвига больше не перезаписывается, если табличное значение превышает физическую оценку (never overwrite sr).
  - Добавлена интеграция native Groq HTTP для глубокой AI-обработки файлов в десктопе Tauri.

### Добавлено
- **LIC-BACKUP**: Добавлен Windows-скрипт `license-server/download-backup.ps1` для безопасного скачивания последнего backup-архива или SQL-дампа БД лицензирования с сервера на локальный ПК по SSH/SCP.
- **LIC-SERVER**: Добавлен серверный скрипт `license-server/cleanup.sh` для очистки истёкших `rate_limits`, ротации `license-backup.log` и удаления устаревшего временного мусора.
- **LIC-SERVER**: Скрипт `license-server/backup.sh` переведён на `mysqldump --single-transaction --no-tablespaces`, чтобы резервное копирование не ломалось из-за лишних привилегий MySQL.
- **LIC-S3**: Добавлена поддержка ежедневной выгрузки полного backup-архива сервера лицензирования в S3-совместимое хранилище (`latest` + `daily`) и восстановления напрямую из S3 через `restore.sh`.

---

## [0.2.0-beta.3] — 2026-03-16

### Исправлено
- **Сохранение отчётов**: Исправлен двойной баг в `saveBlob`, из-за которого диалог выбора пути сохранения не появлялся:
  1. **Регрессия beta.2**: E2E-флаг `__e2e_skip_dialogs` читался без `import.meta.env.DEV` защиты — в production-сборке диалог корректно блокировался, если `localStorage` был загрязнён.
  2. **Застревший localStorage**: флаг из E2E-сессии в `localStorage` оставался между запусками и мог блокировать диалог в dev-режиме.
- Фикс: переход с `localStorage` на `sessionStorage` для `__e2e_skip_dialogs` — флаг автоматически очищается при каждом запуске приложения. В production-сборке `import.meta.env.DEV === false`, поэтому диалог выбора файла всегда появляется.

---

## [0.2.0-beta.2] — 2026-03-16

### Исправлено
- **Сохранение отчётов**: Расширена зона разрешённых путей (`fs:scope`) — теперь PDF и Excel сохраняются в любую папку внутри домашнего каталога пользователя (`$HOME/**`), включая OneDrive, рабочие папки и кастомные директории. Ранее `writeFile` молча отказывал, если путь выходил за рамки Документов/Рабочего стола/Загрузок.
- **Сохранение отчётов**: Добавлено внятное сообщение об ошибке, если путь всё же недоступен (другой диск, сетевой ресурс).

---

## [0.2.0-beta.1] — 2026-03-16

### Исправлено
- **E2E**: Исправлена гонка состояний в тесте сравнения 4 инструментов — легенда чарта читалась до окончания 150ms debounce (`expect.poll`, timeout 5s).
- **E2E**: Исправлена проверка CSS-класса переключателя в настройках отчёта — `bg-slate-950` → `bg-background` после внедрения light/dark темы.
- **E2E**: Восстановлена корректная проверка сохранения типа жидкости — диалог сохранения теперь проверяется через фильтр библиотеки, а не через несуществующий бейдж.
- **E2E**: Убрана проверка фильтра «Автор» — поле удалено из UI в v0.1.537.
- **E2E**: Mock-файлы PDF/Excel увеличены до 6000 байт (порог `assertDownload` — 5000 байт).
- **E2E**: Тест `save_each_field_cleared_disables_save_button` приведён в соответствие реальным обязательным полям (имя + оператор; Field/Well необязательны).

---

## [0.1.538] — 2026-03-14

### Изменено
- Очистка репозитория: `license-server/vendor/` и `runtime/qa/` добавлены в `.gitignore`.
- Зафиксированы все незакоммиченные изменения v0.1.537 (security fixes, infra pipeline, тесты).
- Синхронизированы номера версий во всех конфигурационных файлах.

---

## [0.1.537] — 2026-03-14

### Безопасность
- **LIC-005**: Онлайн-валидация лицензии теперь сохраняет `last_check` при **любом** HTTP-ответе от сервера (включая 4xx/5xx), а не только при успехе. Предотвращает цикл повторных запросов при серверных отказах.
- **LIC-006**: Malformed JSON в сохранённой лицензии теперь отклоняется fail-closed (`return None`). Ранее `unwrap_or(json!({}))` допускал fail-open прохождение.
- **S-2**: Закрыт grace-period для legacy HMAC-only записей — все лицензии обязаны иметь RSA-подпись сервера.

### Исправлено
- **INF-001**: Устранён конфликт ESM/CommonJS в dev/release-скриптах.
- **INF-002**: Синхронизированы integration-тесты `ai_parsing` с текущим безопасным API.
- **INF-003**: Исправлен разбор `scripts/dev/.env.keys` в CRLF-формате — `INTEGRITY_SECRET_KEY` не подхватывался release-скриптом.
- Исправлены битые внутренние ссылки в документации после cleanup.

### Добавлено
- Регрессионные тесты на fail-closed malformed JSON и throttle при серверных отказах.
- Тест `build_validation_result_persists_last_check_for_http_rejection`.
- Тест `load_verified_rejects_malformed_json_even_with_valid_hmac`.

---

## [0.1.536] — 2026-03-12

### Исправлено
- **UI-018**: Тултипы на графике теперь корректно позиционируются после прокрутки, смены размера окна, сворачивания/разворачивания. Причина: тултип использовал `position: absolute` на `<body>` с viewport-координатами из `getBoundingClientRect()` — при ненулевом `window.scrollY` возникало смещение на высоту прокрутки. Исправлено на `position: fixed` + живой вызов `getBoundingClientRect()` вместо кэша.

---

## [0.1.535] — 2026-03-10

### Исправлено
- **UI-017**: При переключении между вкладками («Калибровка» → «График» и др.) страница теперь корректно прокручивается к строке вкладок с учётом высоты шапки (72px). Ранее `scrollIntoView` не компенсировал sticky-шапку, и вкладки уходили за её край.

---

## [0.1.534] — 2026-03-10

### Исправлено
- **UI-016**: При открытии / загрузке файла страница теперь корректно прокручивается к строке вкладок. Кнопки «Таблица данных», «Рецептура», «Анализ воды», «Калибровка» сразу видны. Используется `window.scrollTo` с компенсацией высоты шапки (72px) вместо `scrollIntoView`, Ь`behavior: instant` вместо `smooth` (не прерывается рендерингом графика).

---

## [0.1.533] — 2026-03-09

### Исправлено
- **UI-016**: При открытии теста вкладка «График» теперь автоматически прокручивает страницу к строке вкладок — поведение идентично переключению между вкладками. Ранее после загрузки теста кнопки навигации (Таблица данных, Рецептура, Анализ воды, Калибровка) оставались выше экрана.

---

## [0.1.532] — 2026-03-09

### Изменено
- **UI-014**: При переключении вкладок (График / Таблица / Рецептура / Анализ воды / Калибровка) экран автоматически прокручивается к строке вкладок — контент всегда начинается с одной позиции.
- **UI-015**: Карточки метрик на вкладке «Калибровка» переработаны: все 5 карточек размещены в один ряд (`grid-cols-5`), уменьшены отступы и размер шрифта, убран описательный текст из тела карточки (доступен через «Подробнее»). Освобождено место для графиков.

---

## [0.1.531] — 2026-03-09

### Изменено
- **LIC-004**: В debug-сборках (`debug_assertions`) интервал онлайн-проверки лицензии сокращён до 0 дней (каждый запуск) и 300 секунд (5 минут в рамках сессии). Release-сборки без изменений: 7 дней / 3600 секунд. Ускоряет тестирование отзыва лицензии без ожидания 7 дней.
- **CHORE**: Удалён временный крейт `tools/rsa_test/`, отладочные скрипты и временные файлы в корне проекта.

---

## [0.1.530] — 2026-03-09

### Изменено
- **LIC-002**: Рефакторинг встраивания RSA публичного ключа. Вместо `include_str!` + ручного PEM→DER декодирования в рантайме используется `include_bytes!` с предварительно сгенерированным `.der`-файлом. Устранён временный костыль из v0.1.529. Тест-хелперы аналогично переведены на `dev_private.der` + `from_pkcs8_der`.
- **LIC-003**: Удалено диагностическое логирование полного содержимого `signedPayload` и `serverSignature` из `lic_diag.log` (утечка чувствительных данных). Оставлены: первые 80 символов payload и длина подписи.
- `generate-license-keys.ts` теперь также создаёт `license_public.der` для встраивания в Rust-бинарник.

---

## [0.1.529] — 2026-03-09

### Исправлено
- **LIC-001**: Исправлена верификация RSA-подписи лицензии (`verify_server_signature`). Функция `from_public_key_pem` из крейта `pem-rfc7468` 0.7 некорректно обрабатывала CRLF-окончания строк в встроенном PEM-файле на Windows, возвращая ошибку `PreEncapsulationBoundary`. Исправлено заменой на ручное декодирование PEM-тела в DER и последующим вызовом `from_public_key_der`. Теперь подпись лицензии успешно проверяется и при старте приложение корректно отображает статус активной лицензии.

---

## [0.1.528] — 2026-03-09

### Изменено
- **DIAG-002**: Диагностика лицензирования теперь пишет в файл `lic_diag.log` в директории данных приложения напрямую через `std::fs`, без зависимости от tracing/log pipeline. Гарантированно работает в release-сборках.

---

## [0.1.527] — 2026-03-09

### Изменено
- **DIAG-001**: Добавлено подробное диагностическое логирование лицензионного пайплайна (`[LIC-DIAG]`)
  в `app.log` для выяснения причин DEMO-бейджа при запуске.
  Лог: `%APPDATA%\com.rheolab.enterprise\logs\app.log`

---

## [0.1.526] — 2026-03-09

### Исправлено
- **LIC-011**: Устранено кратковременное отображение бейджа «ДЕМО» при каждом запуске приложения. При успешной онлайн-проверке (`validate.php`) DB-запись теперь обновляется свежим `signedPayload` от сервера, что позволяет RSA-верификации проходить локально на всех последующих запусках без обращения в интернет (офлайн-first, TTL 7 дней).
- **TST-001**: Исправлены два провальных unit-теста RSA — добавлен `dev_public.pem` (парный ключ к `dev_private.pem`), тестовые сборки используют dev-пару вместо продакшн ключа.

---

## [0.1.525] — 2026-03-09

### Исправлено
- **LIC-010**: После обновления приложения лицензия автоматически восстанавливается при первом запуске (ранее при сбое RSA-верификации кэш блокировал повторную активацию и пользователь видел DEMO-режим)

---

## [0.1.524] — 2026-03-09

### Безопасность
- **LIC-009**: Аудит системы лицензирования — исправлены 4 уязвимости: RSA-проверка в `check_license_gate`, точная передача `signedPayload` с сервера, лимит 10 записей в `legacyMachineIds`

---

## [0.1.523] — 2026-03-09

### Исправлено
- **LIC-008**: Исправлен RSA публичный ключ — лицензия теперь верифицируется локально без обращения к серверу при каждом запуске

---

## [0.1.519] — 2026-03-09

### Изменено
- Поле «Месторождение» стало необязательным для заполнения

---

## [0.1.511] — 2026-03-08

### Удалено
- **UI-001**: Поле «Автор» удалено из интерфейса, отчётов и фильтров — остался только «Оператор» (фактический исполнитель теста). Поле `createdBy`/`created_by`/`author_name` убрано из PDF-шаблона, Rust-типов, TypeScript-типов, UI-компонентов и тестов

### Инфраструктура
- **INF-001**: Добавлен `scripts/package.json` с `"type": "commonjs"` — устранена ошибка `require is not defined in ES module scope` в benchmark/deploy скриптах

---

## [0.1.510] — 2026-03-07

### Исправлено
- **CHART-001**: Перерисовка графика вязкости при изменении порога/целевого времени теперь происходит мгновенно (ранее требовала перезагрузки данных)
- **EXCEL-001**: В режиме «раздельные оси» настройки стороны осей (left/right) теперь применяются корректно — ранее все серии, кроме вязкости, принудительно уходили вправо
- **EXCEL-002**: Ширина диаграммы в Excel-отчёте приведена в соответствие с шириной таблицы (9 фиксированных колонок вместо 7)

### Инфраструктура
- **UPD-001**: Система авто-обновления переведена на канальную маршрутизацию: пользователи с лицензией Developer получают обновления по бета-каналу, остальные — по стабильному

---

## [0.1.507] — 2026-05-15

### Исправлено
- **PERF-001**: Удалён флаг `--disk-cache-size=1` из `tauri.conf.json` — V8 bytecode cache был полностью отключён, что замедляло каждый запуск (~2x на холодном старте)
- **PERF-002**: Увеличен `--max-old-space-size` с 256 до 512 MB
- **LIC-001**: Инициализация лицензии в `license-store.ts` теперь использует `licensing_get_status` (Rust in-memory cache, 0 I/O) вместо `licensing_check` (DB-запрос) — устранён двойной DB-запрос при каждом старте

### Тесты
- Добавлено 43 регрессионных теста для auto-updater: `tests/release/tauri-updater-config.test.ts` (7 новых), `tests/release/update-manifest-format.test.ts` (22), `tests/store/update-store.test.ts` (15)

---

## [0.1.506] — 2026-05-14

### Исправлено
- **UPD-004**: Ошибки ручной проверки обновлений (`checkUpdateNow()`) больше не маскируются через `store.reset()` — теперь используется `store.setError()`; пользователь видит причину сбоя
- Логирование ошибок updater на диск через `clientLogger.error`

---

## [0.1.505] — 2026-05-14

### Исправлено
- **UPD-003**: `pub_date` в `stable.json` больше не содержит миллисекунды (`.replace(/\.\d{3}Z$/, 'Z')`) — Rust RFC-3339 парсер отклонял манифест с `.000Z`

---

## [0.1.504] — 2026-05-13

### Исправлено
- **UPD-001**: Endpoint авто-обновлятора исправлен с `{{target}}` → `{{target}}-{{arch}}` (было `…/windows/stable.json` → 404; теперь `…/windows-x86_64/stable.json` ✅)
- **UPD-002**: Формат `pubkey` в `tauri.conf.json` исправлен: теперь base64 полного `.pub`-файла (включая заголовок `untrusted comment:`) вместо голого `RWT…`-ключа; устранено `from_utf8()` panic в Rust

---

## [0.1.496] — 2026-03-07

### Исправлено
- **MEM-001**: Устранены утечки DOM-узлов при навигации между вкладками (+421 узел/цикл → 0)
  - `tooltip.ts`: обнулены DOM-ссылки замыкания (`tooltip`, `titleEl`, `itemsEl`) в хуке `destroy`
  - `zoom.ts`: обнулено closure-состояние (`isZoomed`, `originalXMin/Max`, `applyingFromStore`) в `destroy`
  - `uplot-chart.tsx`: добавлено `chart = null` после `destroy()` — разрывает цепочку React fiber-alternate → DOM; очистка GPU-текстуры через обнуление размеров canvas
  - `DashboardLayoutClient.tsx`: вызов `clearAnalysisCache()` при уходе с `/dashboard` — освобождает модульный кэш (`analysisCache`) с данными анализа (~5–15 MB)

---

## [0.1.490] — 2026-03-04

### Добавлено
- **Автообновление**: Полная реализация механизма доставки обновлений через `tauri-plugin-updater`
  - `update-store.ts` — Zustand-стор с состояниями: `idle / checking / available / downloading / ready / error`
  - `UpdateChecker.tsx` — фоновый компонент: проверяет обновления через 30 с после старта, затем каждые 4 часа
  - `UpdateBanner.tsx` — ненавязчивый баннер под хедером: показывает версию, прогресс загрузки, кнопки «Установить» / «Перезапустить»
- **Подпись артефактов**: Новая пара ключей minisign; `build.ps1` автоматически загружает `src-tauri/keys/updater.key`
- **Деплой**: скрипты `scripts/deploy/publish-update.js` (загрузка на VPS) и `scripts/deploy/setup-vps-releases.sh` (разовая настройка сервера)
- **Capability**: добавлена `updater:default` в `src-tauri/capabilities/default.json`
- Endpoint обновлений: `https://license.vizbuka.ru/releases/v1/update/{{target}}/{{arch}}/{{current_version}}?channel=stable`

---

## [0.1.489] — 2026-03-04

### Безопасность
- **SEC-001**: Удалены все plaintext-пароли, токены и ключи из `license-server/docs/CREDENTIALS.md` — заменены на `<ROTATED>` с инструкцией по ротации
- Все ранее хранившиеся в репозитории секреты считаются скомпрометированными и требуют ротации на сервере

### Исправлено
- **REL-005**: Устранён дрейф версии — `src/lib/version.ts` синхронизирован с `package.json`/`Cargo.toml`/`tauri.conf.json`
- ESLint: удалён неиспользуемый импорт `FLUID_TYPE_SHORT` (save-experiment-dialog.tsx)
- ESLint: удалён неиспользуемый аргумент `e` → `()` (experiment-card.tsx)
- ESLint: удалён устаревший `eslint-disable-next-line` (useSaveDialogInit.ts)

---

## [0.1.488] — 2026-03-04

### Исправлено — UI Библиотека
- **Таблица экспериментов** теперь заполняет всю ширину окна (`width: 100%`, `minWidth: 1100px`), шрифты нормализованы (`text-xs`/`text-sm`)
- **Сортировка по столбцам** перенесена на сервер: `ORDER BY` строится динамически в Rust с whitelist-валидацией поля; сброс страницы при смене сортировки
- **Кнопка «Загрузить ещё»** стала `sticky bottom-4` — остаётся видимой при росте списка
- **Карточка рецепта** показывает до 5 реагентов (было 3)
- **Боковая панель фильтров** получила собственный scroll-контейнер (`overflow-y-auto`) — прокрутка над фильтрами больше не двигает список экспериментов

### Добавлено — Rust Backend
- `ExperimentsListQuery`: поля `sort_by: Option<String>` и `sort_dir: Option<String>`
- `query.rs`: динамический `ORDER BY {col} {dir}` с whitelist (11 полей) вместо хардкода `ORDER BY e.testDate DESC`

---

## [0.1.459] — 2026-02-28

### Добавлено
- `docs/audit/LICENSE-SERVER-AUDIT-2026-02-28.md` — глубокий аудит лицензионного сервера (1 CRITICAL, 6 security, 4 data quality, 5 ops debt)
- `docs/audit/localization-audit-english-strings.md` — аудит локализации (~80 английских строк в UI)
- Демо-тесты: сериализация через `static Mutex<()>` для исключения race condition на `INTEGRITY_SECRET_KEY`
- `@deprecated` JSDoc на устаревшие bridge/client обёртки (`exportData`, `exportExperiments`)
- Новые Rust-тесты: data_flows (5), security (1), TOTAL: 76 Rust / 479 Vitest

### Исправлено — Rust Backend
- **10× `filter_map(|r| r.ok())`** замолчанных SQL-ошибок → `.collect::<Result<Vec<_>,_>>()` с `map_err` (export.rs, helpers.rs, sync_engine.rs, reagents/commands.rs, list.rs, crud.rs, migration.rs)
- **OOM-риск** в `sync_export_delta` → полная перезапись на streaming `BufWriter`
- **Mutex `.unwrap()`** → `map_err` в `PARSE_CACHE` (parsing.rs) — исключён panic при poisoned mutex
- **`unreachable!()`** → `return Err(...)` в sync_engine.rs — defense-in-depth
- **`unwrap_err()`** anti-pattern → `.ok_or(e)` в online.rs
- **5× `eprintln!`** → `tracing::debug!`/`tracing::warn!` (reports.rs, hardware.rs, types.rs)
- **Dev keys** в release-бинарнике: `DEV_INTEGRITY_KEY`/`DEV_ENCRYPTION_KEY` теперь под `#[cfg(debug_assertions)]`; `assert_production_keys()` делает `panic!` вместо `tracing::warn!`
- Удалён deprecated `experiments_export` из регистрации Tauri-команд

### Исправлено — Frontend
- **License init failure** оставлял приложение навсегда в loading → `isInitialized: true` в catch-блоке
- **Race condition** в experiment-list: stale fetch-ответы перезаписывали свежие → abort-флаг
- **APIKeyManager**: ошибка сети при добавлении ключа → теперь показывает `setOpError`
- **Dashboard**: race condition при загрузке эксперимента из URL → cancelled-флаг
- **comparison-store**: transient DB-ошибки при rehydrate молча удаляли эксперименты → теперь сохраняют

### Исправлено — Импорт/Экспорт
- Оператор-приоритет в auto-detect (`||` vs `&&`) — ExperimentExportImport.tsx
- Диалог подтверждения импорта убрано ложное обещание «обновления» записей + добавлен счётчик
- `extraFields` добавлен в экспорт/импорт реагентов (reagents/commands.rs)
- `durationSeconds`/`avgTemperatureC` теперь вычисляются из rawPoints вместо `null`

### Исправлено — Локализация
- ~80 английских строк переведены на русский в 20 файлах (см. аудит)

---

## [0.1.439] — 2026-02-27

### Добавлено
- `docs/ARCHITECTURE.md` — полное описание архитектуры (стек, IPC, схема БД, сборочные цели)
- `docs/CONTRIBUTING.md` — руководство для разработчиков (конвенции, инструкции, чек-лист)
- `scripts/README.md` — справочник по скриптам разработки, сборки, релиза и тестирования
- `docs/adr/ADR-0001`, `ADR-0002` — ретроспективные ADR: выбор Tauri v2 и SQLite/rusqlite
- `.github/PULL_REQUEST_TEMPLATE.md`, `ISSUE_TEMPLATE/` — шаблоны GitHub
- `CHANGELOG.md` — этот файл

### Изменено
- Схема БД: `SCHEMA_VERSION` снижен с 12 до 1; все V2–V12 миграции객 сведены в единый `V1_DDL`  
  (21 таблица, FTS5, составные индексы, FK CASCADE — всё в одной DDL-транзакции)
- `run_migrations` упрощён до двух веток: новая установка / нормализация legacy-БД

### Исправлено
- README, `DEVELOPER_GUIDE.md`, `MAINTENANCE_RU.md`: устаревшие версии и `SCHEMA_VERSION`
- `TEST_METHODOLOGY.md`: сломанная ссылка на `AUDIT_REPORT_RU.md`
- Удалён дублирующий файл `FRONTEND-IPC-DEEP-AUDIT-LATEST.md`

### Удалено
- ~600 строк мёртвого кода миграций (функции `migrate_v2`–`migrate_v12`)
- Секция «Adding a WASM Function» из README (WASM устранён в v0.1.422)
- `.agent/workflows/build-wasm.md` помечен как архивный

---

## [0.1.438] — 2026-02-26

### Добавлено
- Описания реагентов из российских TDS-PDF (Mirrico, Econotech): ГУАМИН, ATREN, серии WG/WGXL
- Предупредительный баннер в `ReagentDetailDrawer` о непроверенных технических данных
- 4 новых теста Rust: `migration_v1_creates_all_tables`, `migration_is_idempotent`, `migration_normalises_legacy_version`, `experiment_data_fk_cascades_on_delete`

### Исправлено
- `fix(reagents)`: синтаксическая ошибка — точки с запятой вместо запятых в кортежах WGXL-8.1/8.2/9.1
- SQL P0: устранены `INSERT OR REPLACE` CASCADE, добавлены FK CASCADE, пошаговые checkpoint-и миграций
- V8 migration idempotency: повторный запуск миграции больше не создаёт дублей

### Улучшено
- Производительность: renderer/browser WS −8.7 MB, p95 total WS −239 MB (Baseline #17)
- IPC: устранена двойная JSON-сериализация (SoA input, типизированные команды)
- Zustand: атомарные селекторы на 9 сайтах, очистка 8 таймеров `setTimeout`

---

## [0.1.422] — 2026-02-23

### Изменено
- **Расчёты перенесены из WASM (WebAssembly) в нативный Rust через Tauri IPC** (ADR-0003)  
  Устранены: 40–80 MB WASM heap, двойная сериализация JSON, нестабильность WebView2 worker

### Удалено
- WASM крейт `src/rust/rheolab-wasm/` и WebWorker `src/workers/`
- Зависимости `wasm-pack`, `wasm-bindgen`
- `public/wasm/` директория

---

## [0.1.410] и ранее

Версии до 0.1.410 не документировались в CHANGELOG.  
Историческая информация: `git log --oneline`.

---

[0.1.459]: https://github.com/rheolab/reallab-enterprise/compare/v0.1.439...v0.1.459
[0.1.439]: https://github.com/rheolab/reallab-enterprise/compare/v0.1.438...v0.1.439
[0.1.438]: https://github.com/rheolab/reallab-enterprise/compare/v0.1.422...v0.1.438
[0.1.422]: https://github.com/rheolab/reallab-enterprise/compare/v0.1.410...v0.1.422
