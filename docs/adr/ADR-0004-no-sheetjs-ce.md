# ADR-0004 — Отказ от SheetJS Community Edition (`npm:xlsx`)

- **Статус:** ✅ Реализовано (Фаза 1 / WP-1.3, коммит `9dbf740` на `main`)
- **Дата принятия:** 2026-04-17
- **Ревизия:** 1
- **Связанные документы:**
  - План рефакторинга — [`REFACTORING_DEEP_PLAN.md`](../REFACTORING_DEEP_PLAN.md) § WP-1.3
  - Отчёт W1 — [`audit/W1-security-review.md`](../audit/W1-security-review.md) § 3.3, § 6 (D-5, D-7)

---

## Контекст

В RheoLab Enterprise V2 фикстуры для parsing-тестов и демо-сайта исторически читались через пакет `xlsx@0.18.5` (SheetJS Community Edition), распространяемый через npm. В апреле 2026 в рамках security-аудита GitHub Advisory Database были подтверждены две уязвимости **без апстрим-патча**:

| ID | Тип | Затронутые версии | Patched version |
|---|---|---|---|
| GHSA (SheetJS ReDoS) | Regular Expression DoS | `xlsx < 0.20.2` | **not available** |
| GHSA (SheetJS Prototype Pollution) | Prototype Pollution | `xlsx < 0.19.3` | **not available** |

Ключевой фактор: SheetJS CE **официально не публикует исправления в npm** с 2023 года. Автор проекта перенёс дистрибуцию на собственный CDN (`https://cdn.sheetjs.com`) и в коммерческий канал (SheetJS Pro). В npm-пакете `xlsx` обновлений **не будет** — это архитектурный, а не временный блок.

Пакет использовался только в двух местах:
1. `tests/utils/touch-point-fixture.test.ts` — парсинг бинарного Grace 3600 `.xls` (legacy BIFF-формат).
2. `website/src/data/fixtureProfiles.ts` — рендеринг тех же профилей на демо-сайте.

Пакет был в `devDependencies`, в production-bundle приложения **не попадал** — однако присутствие уязвимого кода в dev-окружении недопустимо для Critical-сертифицированного стека (licensing, лабораторные данные пользователей).

## Рассмотренные варианты

### Вариант A. Оставить `xlsx` как devDependency
- ✅ Минимум работы.
- ❌ Advisories остаются навсегда (patched: not available).
- ❌ `npm audit` будет постоянно сигналить — шум блокирует реальные алерты.
- ❌ Любой dev или CI-runner, запускающий тесты, исполняет уязвимый код.
- ❌ Не соответствует политике репо «0 high/critical в prod+dev audit» (REFACTORING_DEEP_PLAN § 12).

### Вариант B. Обновить до `xlsx@0.20.x` через CDN SheetJS
- ✅ Апстрим-фикс доступен.
- ❌ Требует нестандартной установки (`npm i https://cdn.sheetjs.com/xlsx-0.20.3/…`).
- ❌ `package-lock.json` теряет воспроизводимость — integrity-хэши CDN не гарантированы.
- ❌ Нарушает корпоративную политику (весь tooling тянется только из npm-registry).
- ❌ В будущем при renovate/dependabot — сложный процесс обновления.

### Вариант C. Заменить на `exceljs`
- ✅ Активно поддерживается, в npm, `npm audit` — чисто.
- ❌ **Не поддерживает legacy BIFF `.xls`** (Grace 3600 экспортирует именно `.xls`, не `.xlsx`).
- ❌ Требует конвертации фикстур в другом формате.

### Вариант D. Rust-сторона (`calamine` crate) через Tauri-команду
- ✅ Покрывает и `.xls`, и `.xlsx`.
- ✅ Один набор фикстур можно читать и из Rust-тестов, и из TS.
- ❌ Overkill для тест-фикстур, усложняет CI (требует `cargo build` перед `vitest`).
- ❌ Нарушает принцип минимальных изменений Фазы 1.

### Вариант E. ✅ Конвертировать `.xls` в JSON one-time и удалить пакет
- ✅ Полностью устраняет обе уязвимости (пакет отсутствует физически).
- ✅ Тесты становятся быстрее (JSON parse vs XLSX parse).
- ✅ Воспроизводимость: one-time скрипты закоммичены, можно перегенерировать при необходимости.
- ✅ Нет runtime-зависимости ни от одной xlsx-библиотеки.
- ⚠️ JSON-снапшот замораживает данные — если исходный `.xls` обновится, нужно вручную перезапустить конвертер.
- ⚠️ Объёмные файлы в git (~16 900 строк, ~700 KB) — смягчается через `.gitattributes linguist-generated=true`.

## Решение

**Выбран вариант E.**

- Бинарные фикстуры (`.xls`, `.xlsx`) в `tests/fixtures/` конвертируются в JSON-снапшоты.
- One-time конвертеры сохраняются в `scripts/utils/` для воспроизводимости.
- Пакет `xlsx` полностью удаляется из `package.json` и `package-lock.json`.
- В CI добавляется guardrail, запрещающий повторное появление `xlsx`.

## Последствия

### Положительные
1. **Security.** `npm audit --omit=dev=false` не содержит SheetJS advisories (0 high/critical по линии xlsx).
2. **Performance.** Тесты touch-point стали быстрее (JSON parse ≈ 10× быстрее BIFF).
3. **Reproducibility.** `package-lock.json` чище, без CDN-URL.
4. **Maintainability.** Нет блокировки дальнейших обновлений цепочки зависимостей из-за устаревшего `xlsx`.

### Отрицательные
1. **Ручной шаг** при изменении исходных `.xls`: нужно перезапустить `node scripts/utils/xls-to-json.mjs <path>` и закоммитить новый JSON.
2. **Размер git-истории.** ~16 900 строк JSON-фикстур добавлены в репо. Смягчается:
   - `.gitattributes`: `tests/fixtures/*.json linguist-generated=true -diff`
   - В будущем при росте набора — рассмотреть Git LFS.
3. **Нет runtime-парсинга `.xls`.** Если продуктовой фичей когда-либо потребуется чтение `.xls` **в рантайме** (импорт пользовательского файла), надо будет вернуться к варианту D (Rust `calamine`), а не возвращать `xlsx`.

## Регрессивная защита

Чтобы решение не было случайно отменено, введены или рекомендованы к введению:

### Уже на месте
- Пакет удалён физически (`package.json`, `package-lock.json`).
- Тесты переведены на JSON — нет причины добавлять `xlsx` обратно.

### Рекомендуется добавить (Quality debt `W1/D-7`)
1. **`package.json` override** (блокирует транзитивное появление):
   ```json
   "overrides": {
     "xlsx": "npm:@empty/noop@*"
   }
   ```
2. **CI-step** в основном workflow:
   ```yaml
   - name: Ban SheetJS CE
     run: |
       if npm ls xlsx 2>/dev/null; then
         echo "::error::xlsx is banned (see docs/adr/ADR-0004)"
         exit 1
       fi
   ```
3. **ESLint** `no-restricted-imports`:
   ```js
   {
     "patterns": [
       {
         "group": ["xlsx", "xlsx/*"],
         "message": "SheetJS CE is banned — see docs/adr/ADR-0004. For .xls fixtures use JSON snapshots in tests/fixtures/."
       }
     ]
   }
   ```

### Аварийный exit
Если будущая фича всё же потребует runtime-чтения `.xls`:
- Использовать **Rust `calamine`** через `#[tauri::command]` (Вариант D).
- Либо **SheetJS Pro** (коммерческая лицензия, не npm-registry — отдельное ADR).
- **Возврат к `xlsx@*` из npm запрещён** этим ADR.

## Подтверждение на HEAD `main`

```
$ git show origin/main:package.json | grep -c '"xlsx"'                 → 0
$ git show origin/main:package-lock.json | grep -c '"node_modules/xlsx"'→ 0
$ grep -rn "from 'xlsx'\|require('xlsx')" src tests website             → 0 matches
```

## Ссылки

- Коммит реализации: `9dbf7402bf8d4a7e62d6875b7f2892d2510bfc32`
- Advisory: SheetJS ReDoS, SheetJS Prototype Pollution (GitHub Advisory Database)
- Обсуждение дистрибуции SheetJS: <https://cdn.sheetjs.com/>
- План — [`REFACTORING_DEEP_PLAN.md`](../REFACTORING_DEEP_PLAN.md) § WP-1.3
- Отчёт — [`audit/W1-security-review.md`](../audit/W1-security-review.md) § 3.3
