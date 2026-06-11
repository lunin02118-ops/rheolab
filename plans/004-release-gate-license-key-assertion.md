# План 004: Release-gate проверка, что в сборку вшит боевой license_public.der, а не dev-ключ

> **Инструкция исполнителю**: выполняй план строго по шагам. После каждого шага
> запускай команду верификации и сверяй результат, прежде чем идти дальше.
> При любом условии из «Условия STOP» — остановись и доложи. По завершении
> обнови строку статуса этого плана в `plans/README.md`.
>
> **Проверка дрейфа (выполнить первой)**:
> `git diff --stat 6d9035e..HEAD -- scripts/release/prepare-production.js src-tauri/keys/ src-tauri/src/commands/licensing/crypto.rs`
> Если эти файлы менялись после составления плана — сверь фрагменты из
> «Текущее состояние» с живым кодом; при расхождении — STOP.

## Статус

- **Приоритет**: P2
- **Трудозатраты**: S
- **Риск**: LOW
- **Зависит от**: нет (но удобнее после plans/002 — чистое дерево)
- **Категория**: security
- **Составлен на**: коммит `6d9035e`, 2026-06-11

## Почему это важно

Верификация лицензий в приложении опирается на RSA-публичный ключ, вшиваемый
при компиляции из `src-tauri/keys/license_public.der`. Для разработки
существует dev-keypair, и его **приватная** половина лежит у каждого
разработчика локально (`src-tauri/keys/dev_private.der`, в git не входит).
Cfg-гейтинг корректен (`#[cfg(test)]` → dev-ключ, иначе — боевой), но сам
файл `license_public.der` — заменяемый артефакт: если при подготовке релиза
он окажется подменён dev-публичным ключом (ошибка скрипта, ручное
копирование «чтобы проверить»), то любой обладатель dev-приватного ключа
сможет форжить лицензии для боевых сборок, и ни один существующий гейт
этого не заметит. Эта мера была помечена ещё в аудите 2026-05-04 как
«good low-cost hardening candidate» (`docs/audit/2026-05-04-deep-audit-triage.md`,
раздел P3) и до сих пор не реализована. Стоимость — один SHA-256-чек в
релизном скрипте.

## Текущее состояние

- `src-tauri/src/commands/licensing/crypto.rs:54-60` — выбор ключа:

  ```rust
  #[cfg(not(test))]
  const RSA_PUBLIC_KEY_DER: &[u8] = include_bytes!("../../../keys/license_public.der");

  /// In unit-test builds use the dev keypair so tests can sign payloads themselves
  /// without access to the production private key.
  #[cfg(test)]
  const RSA_PUBLIC_KEY_DER: &[u8] = include_bytes!("../../../keys/dev_public.der");
  ```

- `src-tauri/keys/` (рабочая копия): `license_public.der` (294 байта,
  отслеживается git), `dev_public.der` (294 байта, в git **не** входит —
  каталог `keys/` игнорируется, исключения только для `license_public.der`
  и `updater.key.pub`). На свежем checkout `dev_public.der` может
  отсутствовать — проверка не должна на него полагаться.
- Эталонные SHA-256 (вычислены 2026-06-11; нижний регистр hex):
  - `dev_public.der`: `909caada43b28364371c9d63341b4c86c386ae7bb3ab4c5842cb6d4853ff02d7`
  - `license_public.der` (боевой, текущий): `2eac2da1f9cb048f77691764a9b2b9187cc5273c49578dcda343d3d31f7bf955`
- `scripts/release/prepare-production.js` — релизный скрипт; уже содержит
  проверочную функцию-образец `verifyVersionSync()` (строки ~241–265),
  бросающую `throw new Error(...)` при рассинхроне версий. Новая проверка
  должна следовать этому же паттерну. Вспомогательные функции
  `readText(relativePath)` / `repoRoot` уже определены там же
  (строки ~217–220).
- Конвенции: скрипты — CommonJS (`require`), комментарии на английском,
  conventional commits.

## Команды, которые понадобятся

| Назначение | Команда | Ожидаемо при успехе |
|---|---|---|
| Позитивный прогон | `node scripts/release/check-license-key.js` | exit 0, `license key check: OK` |
| Негативный прогон | `node scripts/release/check-license-key.js --key-path src-tauri/keys/dev_public.der` | exit 1, сообщение про dev key |
| Lint | `npm run lint` | exit 0 |
| Релизный pre-hook | `npm run prerelease:prepare` | exit 0 |

## Объём

**В объёме**:
- `scripts/release/check-license-key.js` (создать)
- `scripts/release/prepare-production.js` (один вызов новой проверки)
- `plans/README.md` (статус)

**Вне объёма** (НЕ трогать):
- `src-tauri/keys/**` — ключи не трогать, не перегенерировать, не коммитить
  новые.
- `src-tauri/src/commands/licensing/**` — Rust-гейтинг корректен, менять
  нечего.
- `scripts/dev/run-tauri-cli.js` — добавление defense-in-depth туда возможно
  отдельным планом; здесь не делать, чтобы diff остался минимальным.
- `version.json` — не бампать.

## Git-процесс

- Ветка: `advisor/004-license-key-gate` от текущей.
- Один коммит: `feat(release): assert production license public key at release gate`.
- Не пушить и не открывать MR без указания оператора.

## Шаги

### Шаг 1: Создать scripts/release/check-license-key.js

CommonJS-модуль: экспортирует `checkLicensePublicKey({ keyPath })` и
работает как CLI. Логика:

1. Путь к ключу: аргумент `--key-path <p>` либо дефолт
   `src-tauri/keys/license_public.der` (относительно корня репо —
   определить корень как `path.resolve(__dirname, '..', '..')`).
2. Если файл отсутствует → exit 1, `license key check: FAILED —
   <path> not found`.
3. SHA-256 файла (`crypto.createHash('sha256')`, hex, lowercase).
4. Если хеш равен `909caada43b28364371c9d63341b4c86c386ae7bb3ab4c5842cb6d4853ff02d7`
   (константа `DEV_PUBLIC_KEY_SHA256` с комментарием, что это хеш
   `dev_public.der` и что это НЕ секрет — публичный ключ) → exit 1,
   `license key check: FAILED — license_public.der is the DEV public key;
   a release built with it accepts dev-signed licenses. Restore the
   production key before building.`
5. Иначе → exit 0, `license key check: OK (sha256=<первые 12 символов>…)`.

При запуске как CLI (`require.main === module`) — выполнить и выйти с
соответствующим кодом; при импорте — только экспорт функции.

**Verify**: `node scripts/release/check-license-key.js` → exit 0,
`license key check: OK (sha256=2eac2da1f9cb…)`.

### Шаг 2: Негативная проверка через локальный dev-ключ

(Только если `src-tauri/keys/dev_public.der` существует локально; на чистом
checkout пропустить и отметить в отчёте.)

`node scripts/release/check-license-key.js --key-path src-tauri/keys/dev_public.der`

**Verify**: exit 1, сообщение содержит `DEV public key`.

### Шаг 3: Встроить в релизный скрипт

В `scripts/release/prepare-production.js` рядом с вызовом
`verifyVersionSync()` (в начале основного потока) добавить:

```js
const { checkLicensePublicKey } = require('./check-license-key');
// ...
checkLicensePublicKey(); // throws on dev key / missing file
```

Функция при программном вызове должна БРОСАТЬ `Error` (не `process.exit`),
чтобы поведение совпадало с паттерном `verifyVersionSync()` — отделить
CLI-обёртку (exit code) от библиотечной функции (throw).

**Verify**: `node -e "require('./scripts/release/check-license-key').checkLicensePublicKey(); console.log('ok')"` → `ok`.

### Шаг 4: Финальные гейты

`npm run lint && npm run prerelease:prepare`

**Verify**: оба exit 0 (prerelease:prepare прогоняет validate+lint+typecheck
и не должен сломаться от нового require).

## Тест-план

Отдельный тест-харнес для `scripts/` в репо отсутствует — верификация
выполняется CLI-прогонами из шагов 1–2 (позитив и негатив) и интеграционным
шагом 4. Негативный сценарий «битый/отсутствующий файл» проверить вручную:
`node scripts/release/check-license-key.js --key-path nonexistent.der` →
exit 1.

## Критерии готовности

- [ ] `node scripts/release/check-license-key.js` → exit 0, `OK`
- [ ] `node scripts/release/check-license-key.js --key-path src-tauri/keys/dev_public.der` → exit 1 (локально, при наличии файла)
- [ ] `node scripts/release/check-license-key.js --key-path nonexistent.der` → exit 1
- [ ] `grep -n "checkLicensePublicKey" scripts/release/prepare-production.js` → ≥1 совпадение
- [ ] `npm run lint` и `npm run prerelease:prepare` → exit 0
- [ ] Изменены только файлы из «В объёме» (`git status`)
- [ ] Строка статуса в `plans/README.md` обновлена

## Условия STOP

- SHA-256 текущего `src-tauri/keys/license_public.der` равен dev-хешу
  `909caada…` УЖЕ на шаге 1 — значит, боевой ключ в репо ПОДМЕНЁН прямо
  сейчас. Это инцидент, не задача скрипта: немедленно доложить оператору.
- `prepare-production.js` в живом коде не содержит `verifyVersionSync`
  (файл переписан после составления плана) — сверить структуру заново.
- Шаг 4 падает из-за нового кода дважды после исправления.

## Заметки на сопровождение

- При плановой ротации боевого ключа проверка продолжит работать (она
  сравнивает только с dev-хешем), но эталонный хеш в этом плане устареет —
  это нормально, план исторический документ.
- Если когда-нибудь появится второй dev-keypair, его хеш нужно добавить в
  константу-список внутри `check-license-key.js`.
- Кандидат на follow-up (сознательно вне объёма): тот же вызов в
  `scripts/dev/run-tauri-cli.js` для пути `tauri:build`, по образцу
  существующей там defense-in-depth версии-проверки.
