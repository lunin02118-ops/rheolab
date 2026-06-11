# План 002: Закоммитить Windows-фикс Vitest-раннера и привести working tree в консистентное состояние

> **Инструкция исполнителю**: выполняй план строго по шагам. После каждого шага
> запускай команду верификации и сверяй результат, прежде чем идти дальше.
> При любом условии из «Условия STOP» — остановись и доложи. По завершении
> обнови строку статуса этого плана в `plans/README.md`.
>
> **Проверка дрейфа (выполнить первой)**:
> `git status --porcelain`
> Ожидаемое состояние working tree описано в «Текущее состояние». Если набор
> изменённых/untracked файлов ДРУГОЙ (файлы уже закоммичены, или появились
> новые правки в тех же файлах) — сверь diff с приведёнными фрагментами;
> при расхождении — STOP.

## Статус

- **Приоритет**: P1
- **Трудозатраты**: S
- **Риск**: LOW
- **Зависит от**: нет
- **Категория**: dx
- **Составлен на**: коммит `6d9035e`, 2026-06-11

## Почему это важно

В working tree лежит **незакоммиченный** фикс критичного DX-бага: на Windows
lowercase-буква диска в cwd (`d:\...` вместо `D:\...`) заставляет Node ESM
считать одни и те же файлы разными модулями — Vitest грузит две копии
`@vitest/runner`, и весь набор тестов падает с
«Vitest failed to find the runner». Закоммиченный `package.json` до сих пор
запускает `vitest run` напрямую, без обхода — свежий checkout на Windows
получает красные тесты. Фикс уже написан и проверен (полный прогон
1501/1501 зелёный на 2026-06-11), но существует только локально и рискует
потеряться. Дополнительно в working tree висят сопутствующие файлы
(`.gitignore`-правки, whitespace-дрейф генерированного `generated.d.ts`,
каталог `plans/`), из-за чего `git status` постоянно грязный и любой будущий
план не может полагаться на чистое дерево.

## Текущее состояние

`git status` на коммите `6d9035e` показывает.

Изменённые (unstaged):

- `package.json` — скрипты `test*` переключены с прямого `vitest` на обёртку:

  ```diff
  -    "test": "vitest run",
  -    "test:watch": "vitest",
  -    "test:ui": "vitest --ui",
  -    "test:coverage": "vitest run --coverage",
  -    "test:parsing": "vitest run tests/parsing",
  +    "test": "node scripts/test/run-vitest.mjs run",
  +    "test:watch": "node scripts/test/run-vitest.mjs",
  +    "test:ui": "node scripts/test/run-vitest.mjs --ui",
  +    "test:coverage": "node scripts/test/run-vitest.mjs run --coverage",
  +    "test:parsing": "node scripts/test/run-vitest.mjs run tests/parsing",
  ```

- `vitest.config.ts` — добавлен пиннинг канонического регистра пути
  (в начало файла, перед `export default defineConfig`):

  ```ts
  import fs from 'fs';

  // On Windows a lowercase drive letter in cwd (e.g. `d:\...` vs `D:\...`) makes
  // Node ESM treat the same files as different module URLs. Vitest then loads two
  // copies of @vitest/runner and every suite fails with
  // "Cannot read properties of undefined (reading 'config')" /
  // "Vitest failed to find the runner". Pin root/cwd to the canonical casing.
  const PROJECT_ROOT = fs.realpathSync.native(__dirname);
  if (process.platform === 'win32' && process.cwd() !== PROJECT_ROOT) {
      process.chdir(PROJECT_ROOT);
  }
  ```

  и `root: PROJECT_ROOT,` первым полем в объекте `defineConfig({ ... })`.

- `.gitignore` — две добавки: `.agents/` в секцию «Agent working files» и
  новая секция:

  ```
  # Local media (screen recordings etc.)
  /Видео/
  ```

- `src/types/generated.d.ts` — **только whitespace** (trailing spaces на трёх
  строках и финальный перевод строки) — дрейф формата генератора specta.
  Семантических изменений нет.

Untracked:

- `scripts/test/run-vitest.mjs` — обёртка-раннер, на которую ссылается новый
  `package.json`. Без коммита этого файла новые скрипты сломаны.
- `plans/` — журнал планов (001 — DONE, плюс этот и последующие).
- `skills-lock.json` — локальный lock агентских скиллов.
- `.codex/` — локальный конфиг агентского инструмента.

Конвенции репозитория:

- Conventional commits на английском (примеры из `git log`:
  `fix(test): ...`, `chore(repo): ...`, `docs(progress): ...`).
- `src/types/generated.d.ts` — генерируется Rust-сборкой (specta); его
  whitespace-дрейф коммитят, чтобы дерево не было вечно грязным после
  каждого `tauri:dev`.

## Команды, которые понадобятся

| Назначение | Команда | Ожидаемо при успехе |
|---|---|---|
| Полный Vitest | `npm run test` | exit 0, `Tests  1501 passed` (или больше) |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0, пустой вывод |
| SSoT-проверка | `npm run version:validate` | exit 0 |

## Объём

**В объёме** (только эти файлы):
- `package.json` (коммит существующего diff — НЕ новые правки)
- `vitest.config.ts` (то же)
- `scripts/test/run-vitest.mjs` (добавить в git)
- `.gitignore` (существующий diff + добавить `/.codex/` и `/skills-lock.json`)
- `src/types/generated.d.ts` (коммит whitespace-дрейфа)
- `plans/` (добавить в git целиком)
- `plans/README.md` (статус)

**Вне объёма** (НЕ трогать):
- Любые содержательные правки `vitest.config.ts`/`package.json` сверх уже
  лежащего в working tree diff — план фиксирует существующий фикс, не
  улучшает его.
- `src-tauri/**`, `src/**` (кроме generated.d.ts) — кода это не касается.
- `version.json` — версию не бампать.

## Git-процесс

- Ветка: текущая `advisor/001-repo-hygiene` (продолжение repo-hygiene работ)
  либо `advisor/002-vitest-windows-fix` от неё — по указанию оператора.
- Отдельный коммит на логическую единицу (см. шаги), conventional commits.
- Не пушить и не открывать MR без указания оператора.

## Шаги

### Шаг 1: Проверить, что фикс работает до коммита

`npm run test`

**Verify**: exit 0, в конце вывода `Tests  1501 passed` (число может быть
больше, но не меньше).

### Шаг 2: Закоммитить функциональный фикс раннера

```
git add package.json vitest.config.ts scripts/test/run-vitest.mjs
git commit -m "fix(test): pin canonical drive-letter casing for vitest on Windows"
```

**Verify**: `git status --porcelain package.json vitest.config.ts scripts/test/run-vitest.mjs` → пусто.

### Шаг 3: Дополнить .gitignore локальными агентскими файлами и закоммитить

В `.gitignore` рядом с уже добавленной строкой `.agents/` (секция
«Agent working files») добавить две строки:

```
/.codex/
/skills-lock.json
```

Затем:

```
git add .gitignore
git commit -m "chore(repo): ignore local agent tooling and media dirs"
```

**Verify**: `git status --porcelain` больше НЕ показывает `.codex/`,
`skills-lock.json`, `Видео/`; `.gitignore` чист.

### Шаг 4: Закоммитить whitespace-дрейф генерированных типов

```
git add src/types/generated.d.ts
git commit -m "chore(types): sync generated.d.ts whitespace with current generator output"
```

**Verify**: `git status --porcelain src/types/generated.d.ts` → пусто.

### Шаг 5: Добавить журнал планов в git

```
git add plans/
git commit -m "docs(plans): add advisor plan journal (001 done, 002-004 queued)"
```

**Verify**: `git status --porcelain` → пусто (рабочее дерево полностью чистое).

### Шаг 6: Финальная регрессия

`npm run test && npm run typecheck && npm run lint && npm run version:validate`

**Verify**: все четыре — exit 0.

## Тест-план

Новые автотесты не пишутся (коммит существующего фикса + гигиена).
Регрессия: полный Vitest-прогон в шагах 1 и 6 — сам предмет фикса
(раннер) проверяется фактом успешного запуска 1501 теста.

## Критерии готовности

- [ ] `git status --porcelain` → пусто
- [ ] `git ls-files scripts/test/run-vitest.mjs` → файл отслеживается
- [ ] `npm run test` → exit 0, ≥1501 passed
- [ ] `npm run typecheck`, `npm run lint`, `npm run version:validate` → exit 0
- [ ] В `git log --oneline -5` видны коммиты из шагов 2–5
- [ ] Строка статуса в `plans/README.md` обновлена

## Условия STOP

- `git status` показывает иной набор файлов, чем в «Текущее состояние»
  (дерево дрейфануло — например, фикс уже закоммичен или появились новые
  правки в тех же файлах).
- Шаг 1 красный: фикс в working tree не работает — коммитить нечего,
  нужен разбор человеком.
- Diff `src/types/generated.d.ts` содержит НЕ только whitespace
  (семантические изменения типов) — это сигнал рассинхрона с Rust-кодом.
- Любая верификация падает дважды.

## Заметки на сопровождение

- `scripts/test/run-vitest.mjs` теперь обязательная точка входа для тестов;
  если кто-то вернёт в `package.json` прямой вызов `vitest`, Windows-баг
  вернётся. Ревьюеру: следить за скриптами `test*`.
- `generated.d.ts` продолжит регенерироваться сборкой; если whitespace-дрейф
  повторится — это формат генератора, коммитить как chore.
