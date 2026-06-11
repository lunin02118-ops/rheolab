# План 003: Закрыть moderate-advisory uuid (GHSA-w5hq-g745-h8pq) в dev-зависимостях через npm overrides

> **Инструкция исполнителю**: выполняй план строго по шагам. После каждого шага
> запускай команду верификации и сверяй результат, прежде чем идти дальше.
> При любом условии из «Условия STOP» — остановись и доложи. По завершении
> обнови строку статуса этого плана в `plans/README.md`.
>
> **Проверка дрейфа (выполнить первой)**:
> `npm ls uuid`
> Ожидаемо: `exceljs@4.4.0` → `uuid@8.3.2`. Если uuid уже ≥11.1.1 или exceljs
> исчез из дерева — план устарел, STOP и пометить REJECTED в индексе.

## Статус

- **Приоритет**: P2
- **Трудозатраты**: S
- **Риск**: MED (совместимость uuid v8 → v11 внутри exceljs)
- **Зависит от**: plans/002-commit-windows-vitest-runner-fix.md (нужно чистое дерево и рабочий `npm run test`)
- **Категория**: security
- **Составлен на**: коммит `6d9035e`, 2026-06-11

## Почему это важно

`npm audit` (с dev-зависимостями) показывает 2 moderate-записи: транзитивный
`uuid@8.3.2 < 11.1.1` через `exceljs@4.4.0` (advisory GHSA-w5hq-g745-h8pq —
отсутствие проверки границ буфера в v3/v5/v6 при переданном `buf`).
`exceljs` — **только devDependency** (используется в тестах для проверки
XLSX-экспорта), прод-аудит чист (`npm audit --omit=dev` → 0). Риск реальной
эксплуатации низкий, но запись шумит в каждом аудите с мая 2026
(в `docs/audit/2026-05-04-deep-audit-triage.md` помечена «update when
convenient»). Предлагаемый `npm audit fix --force` ломает всё (даунгрейд
exceljs до 3.4.0) — правильный путь это `overrides`.

## Текущее состояние

- `package.json` — `"exceljs": "^4.4.0"` в `devDependencies`; секции
  `overrides` в файле **нет**.
- `npm ls uuid` →

  ```
  rheolab-enterprise@0.2.3-alpha.19
  `-- exceljs@4.4.0
    `-- uuid@8.3.2
  ```

- `npm audit` → `2 moderate severity vulnerabilities`, обе про uuid;
  `fix available via npm audit fix --force / Will install exceljs@3.4.0,
  which is a breaking change` — этот путь НЕ использовать.
- exceljs вызывает uuid как CJS: `require('uuid')` c именованным экспортом
  `v4`. В uuid v11 CJS-require и именованный `v4` сохранены, поэтому
  override ожидаемо совместим — но это и есть главный риск плана,
  проверяется тестами.
- Потребители exceljs — только тесты (поиск по репо: импорты `exceljs`
  встречаются в `tests/**`, в `src/**` отсутствуют).

## Команды, которые понадобятся

| Назначение | Команда | Ожидаемо при успехе |
|---|---|---|
| Установка | `npm install` | exit 0, lockfile обновлён |
| Дерево uuid | `npm ls uuid` | единственный uuid ≥ 11.1.1 |
| Аудит (полный) | `npm audit` | `found 0 vulnerabilities` |
| Аудит (prod) | `npm audit --omit=dev` | `found 0 vulnerabilities` |
| Полный Vitest | `npm run test` | exit 0, ≥1501 passed |
| Только XLSX-тесты | `npm run test -- tests/reports` | exit 0 (если каталог другой — найти тесты по `grep -r "exceljs" tests/`) |

## Объём

**В объёме**:
- `package.json` (только добавление секции `overrides`)
- `package-lock.json` (регенерация через `npm install`)
- `plans/README.md` (статус)

**Вне объёма** (НЕ трогать):
- Версию самого `exceljs` — не апгрейдить и не даунгрейдить.
- Любые тестовые файлы — если тесты падают из-за override, это STOP,
  а не повод править тесты.
- `src/**`, `src-tauri/**` — прод-код не затрагивается вообще.
- `version.json` — не бампать.

## Git-процесс

- Ветка: `advisor/003-uuid-override` от текущей.
- Один коммит: `fix(deps): override transitive uuid to >=11.1.1 (GHSA-w5hq-g745-h8pq)`.
- Не пушить и не открывать MR без указания оператора.

## Шаги

### Шаг 1: Добавить override

В `package.json` на верхнем уровне (рядом с `devDependencies`) добавить:

```json
"overrides": {
  "exceljs": {
    "uuid": "^11.1.1"
  }
}
```

**Verify**: `node -e "console.log(require('./package.json').overrides.exceljs.uuid)"` → `^11.1.1`

### Шаг 2: Переустановить зависимости

`npm install`

**Verify**: exit 0; `npm ls uuid` → `uuid@11.x` под exceljs, записей
`uuid@8` нет.

### Шаг 3: Подтвердить чистый аудит

`npm audit && npm audit --omit=dev`

**Verify**: оба → `found 0 vulnerabilities`.

### Шаг 4: Полная регрессия тестов (exceljs живёт в тестах)

`npm run test`

**Verify**: exit 0, ≥1501 passed. Особое внимание выводу тестов, читающих
XLSX-фикстуры/экспорт — они и есть потребители exceljs→uuid.

## Тест-план

Новые тесты не пишутся: изменение — пиннинг транзитивной зависимости.
Регрессия — полный Vitest-прогон (шаг 4); XLSX-тесты покрывают
интеграцию exceljs с замененным uuid.

## Критерии готовности

- [ ] `npm ls uuid` → только версии ≥11.1.1
- [ ] `npm audit` → `found 0 vulnerabilities`
- [ ] `npm run test` → exit 0, ≥1501 passed
- [ ] Изменены только `package.json` и `package-lock.json` (`git status`)
- [ ] Строка статуса в `plans/README.md` обновлена

## Условия STOP

- После шага 2 в дереве остаётся uuid@8 (override не применился — вероятно,
  старый npm; зафиксировать версию `npm -v` и доложить).
- Шаг 4: любой тест, использующий exceljs, падает — uuid v11 несовместим
  с exceljs@4.4.0 в этом контуре. Откатить override (`git checkout
  package.json package-lock.json && npm install`) и доложить; альтернативы
  (минорный апгрейд exceljs, замена на маинтейнящийся форк) — решение
  человека, не исполнителя.
- `npm install` меняет в lockfile что-либо кроме uuid-поддерева
  (массовый дрейф lockfile) — STOP, нужен чистый `npm ci` baseline.

## Заметки на сопровождение

- Override живёт, пока exceljs сам не обновит uuid; при будущем апгрейде
  exceljs проверить `npm ls uuid` и удалить override, если он стал лишним.
- Ревьюеру: diff должен быть строго `package.json` (+overrides) и
  lockfile-поддерево uuid.
