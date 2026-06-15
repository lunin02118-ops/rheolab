# RheoLab Enterprise — релиз и деплой обновлений

> Проверено по репозиторию 2026-04-22
> Версия на момент проверки: `0.2.0-beta.24`

Этот документ описывает текущий рабочий release/update-контур. Он заменяет старые инструкции, где фигурировали `npm run release`, жёсткая привязка к `stable.json` как единственному endpoint и устаревшие номера версий.

## 0. Обязательный Release Gate

Начиная с `0.2.0-beta.24` перед любым релизом **обязателен** прогон E2E-workflow на настоящем Tauri-бинарнике:

```pwsh
npm run test:release-gate
```

Gate встроен в `npm run release:prepare` и падает с exit=1, если что-то в Comparison Report цепочке сломалось (frontend ↔ IPC ↔ Rust/Typst/XLSX). Обойти можно только явно:

```pwsh
npm run release:prepare -- --skip-release-gate   # warning + releaseGateExecuted=false в манифесте
```

Детали, инварианты и базлайн — [docs/release/RELEASE_GATE.md](release/RELEASE_GATE.md).

## 1. Источники правды

Перед любыми релизными изменениями сверяйтесь с этими файлами:

- `package.json`
- `src-tauri/tauri.conf.json`
- `src/lib/version.ts`
- `scripts/release/prepare-production.js`
- `scripts/release/build.ps1`
- `scripts/deploy/publish-update.js`
- `src/components/shared/UpdateChecker.tsx`
- `license-server/releases.htaccess`
- `license-server/api/update-channel.php`

## 2. Текущий release flow

### Канонический путь

Для проверяемой сборки и release-policy используйте:

```bash
npm run release:prepare
```

Полезные варианты:

```bash
npm run release:prepare -- --channel beta --dry-run --allow-unsigned --skip-qa
npm run release:prepare -- --skip-qa
```

Signed-channel dry-runs now write a proof file to
`runtime/release/dry-run/signing-dry-run-proof-<channel>-v<version>.json`.
For release evidence, prefer the strict path without `--allow-unsigned`; an
allow-unsigned dry-run remains useful as advisory policy smoke only.

### Ручной Windows-путь

`scripts/release/build.ps1` по-прежнему актуален, но это отдельный интерактивный путь:

- читает ключи из `scripts/dev/.env.keys`
- делает version bump
- запускает `npm run tauri:build`
- переподписывает инсталлятор через `npx tauri signer sign`

Используйте его только когда вам действительно нужен ручной version bump на Windows.

### Важно

Скрипта `npm run release` в текущем `package.json` нет. Если вы видите такую инструкцию в старых заметках, считайте её устаревшей.

## 3. Входные секреты и файлы

### Desktop/release

`release:prepare` и `build.ps1` зависят от:

- `scripts/dev/.env.keys`
  - `INTEGRITY_SECRET_KEY`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` при необходимости
- `src-tauri/keys/updater.key`
- `src-tauri/keys/updater.key.pub`

### Server/deploy

Для доступа к VPS используйте:

- `scripts/deploy/.env.server`
- `scripts/deploy/known_hosts`
- `npm run server:doctor`

Подробная схема доступа: [SERVER_ACCESS.md](SERVER_ACCESS.md)

## 4. Актуальная архитектура updater-а

### Что знает клиент

Tauri настроен на endpoint-шаблон:

```text
https://license.vizbuka.ru/releases/v1/update/{{target}}-{{arch}}/update
```

Это значение задаётся в `src-tauri/tauri.conf.json`.

### Что отправляет клиент

`UpdateChecker.tsx` при проверке обновлений отправляет:

- `X-Update-Channel: stable|beta`
- `X-Update-Token: <hmac-token>` для beta-потока

### Что публикует сервер

`scripts/deploy/publish-update.js` публикует channel manifests:

- `stable.json`
- `beta.json`

Они лежат в:

```text
/var/www/license-server/releases/v1/update/windows-x86_64/
```

### Актуальный update-routing (унифицирован 2026-04-19)

Ранее в репо жили две параллельные модели (активный htaccess без token check + token-aware PHP на обочине).  2026-04-19 `license-server/releases.htaccess` был переписан так, что все update-запросы идут через token-aware PHP-роутер:

```apache
RewriteRule ^v1/update/([^/]+)/update$ /api/update-channel.php?target=$1 [L,QSA]
```

Результат:

- **`license-server/api/update-channel.php`** — **единственный легитимный update endpoint**.
  Валидирует `X-Update-Token` (HMAC-SHA256, 5-мин окно), выбирает alpha.json / beta.json / stable.json,  fail-closed downgrade на stable при токен-ошибке.
- **`license-server/releases.htaccess`** — онль передаёт запрос в PHP-роутер.  Сам никакого channel routing не делает — это делалось раньше и являлось bypass'ом токен проверки; убрано.
- Legacy-клиенты (≤ 0.1.497) отдельным rewrite отдают stable.json — это ok, эти версии предшествовали channel-routing полностью.

Операционное примечание: pre-channel-routing билды клиента (собранные ДО 2026-04-19, это commit `2b5ab94` в desktop-репо) не знают про `X-Update-Channel` / `X-Update-Token` и поэтому всегда будут получать stable.json (default fallback). Чтобы такой бинарь поднялся до канала beta/alpha, его нужно один раз переустановить вручную — после этого auto-update работает штатно.

## 5. Типовой сценарий релиза

### 5.1 Проверка готовности

```bash
npm run audit:enterprise:quick
npm test
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
npm --prefix website run build
```

Если вы меняли только release/update контур, минимальный dry-run:

```bash
npm run release:prepare -- --channel beta --dry-run --allow-unsigned --skip-qa
```

Для strict signing proof используйте:

```bash
npm run release:prepare -- --channel beta --dry-run --skip-qa
```

Ожидаемый proof-артефакт:
`runtime/release/dry-run/signing-dry-run-proof-beta-v<version>.json`.

### 5.2 Сборка

Default-канал — **`alpha`** (личный tier владельца проекта, только Superuser-лицензии). Любая незаквалифицированная сборка попадает сюда, не затрагивая внешних пользователей:

```bash
npm run release:prepare
# эквивалентно: npm run release:prepare -- --channel alpha
```

Перевод на beta (Developer-лицензии внутренней команды):

```bash
npm run release:prepare -- --channel beta
```

Перевод на stable (все прочие пользователи — Standard / Enterprise / Trial / Demo):

```bash
npm run release:prepare -- --channel stable
```

### 5.3 Публикация манифеста и артефакта

Дефолт `publish-update.js` тоже `alpha` — чтобы случайная команда не ушла в stable:

```bash
node scripts/deploy/publish-update.js
# эквивалентно: node scripts/deploy/publish-update.js --channel alpha
node scripts/deploy/publish-update.js --channel beta
node scripts/deploy/publish-update.js --channel stable
```

### 5.4 Проверка после публикации

`publish-update.js` сам вызывает `scripts/test/check-update-endpoint.mjs`, но для ручной проверки можно запустить явно:

```bash
node scripts/test/check-update-endpoint.mjs --version 0.2.0-beta.5 --channel beta
```

Для проверки локального `{channel}.json` перед публикацией:

```bash
npm run check:update -- --manifest outputs/release/beta.json --channel beta
```

Smoke проверяет:

- manifest schema (`version`, `pub_date`, `platforms.windows-x86_64`);
- подпись updater-а: strict base64 + minisign structure;
- download URL contract: HTTPS, host `license.vizbuka.ru`,
  `/releases/artifacts/<version>/..._x64-setup.exe`;
- HEAD-доступность download URL.

Серверные проверки:

```bash
npm run server:doctor
```

## 6. Настройка VPS

Начальная подготовка release-дерева на сервере:

```bash
bash scripts/deploy/setup-vps-releases.sh
```

После этого проверьте:

- каталог `releases/artifacts/`
- каталог `releases/v1/update/windows-x86_64/`
- rewrite/headers в `license-server/releases.htaccess`

Если вы перестраиваете доступ/SSH схему, сначала актуализируйте [SERVER_ACCESS.md](SERVER_ACCESS.md).

## 7. Rollback

Rollback-логика остаётся завязанной на ранее собранные manifests и `rollback-channel.js`:

```bash
node scripts/release/rollback-channel.js --channel beta --dry-run
node scripts/release/rollback-channel.js --channel beta --reason "bad beta release"
```

Rollback выполняется строго по каналу:

- `alpha` откатывает owner/superuser канал;
- `beta` откатывает Developer channel;
- `stable` откатывает публичный канал для Standard / Enterprise / Trial / Demo.

Не используйте `stable` rollback для beta/alpha инцидента: это изменит канал,
который получают trial/demo и внешние пользователи.

Если нужно перепубликовать уже известный manifest:

```bash
node scripts/deploy/publish-update.js --from-manifest outputs/release/stable.json --channel stable
```

## 8. Что ещё обновлять вместе с релизом

При изменении release/update-контура обычно нужно синхронно обновить:

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/testing/TEST_METHODOLOGY.md`
- `license-server/docs/README.md`
- `license-server/docs/INSTALLATION.md`

## 9. Диагностика: установщик ~1 MB вместо ~10 MB

**Симптом:**

- `RheoLab Enterprise_*_x64-setup.exe` ≈ 1 MB (вместо ожидаемых ~10 MB)
- `src-tauri/target/release/rheolab-enterprise.exe` ≈ 2 MB (вместо ~28 MB)
- При запуске установленного приложения окно пустое / ошибки загрузки

**Диагностика:**

```pwsh
$exe = "src-tauri\target\release\rheolab-enterprise.exe"
$bytes = [System.IO.File]::ReadAllBytes($exe)
$text = [System.Text.Encoding]::UTF8.GetString($bytes)
if ($text -match "index\.html") { "frontend embedded OK" } else { "frontend MISSING" }
```

**Причина:**

Сборка через `npm run tauri:build` напрямую не гарантирует загрузку **всех** compile-time ключей. Если `ALPHA_CHANNEL_SECRET` отсутствует в окружении Cargo, proc-macro `tauri::generate_context!()` может завершиться без встраивания `dist/` в бинарник. Результат — рабочий, но пустой stub-бинарь размером ~2 MB и установщик ~1 MB.

**Решение:**

Использовать канонический путь:

```pwsh
npm run release:prepare -- --channel stable
```

Этот скрипт (`scripts/release/prepare-production.js`) грузит все три ключа (`INTEGRITY_SECRET_KEY`, `BETA_CHANNEL_SECRET`, `ALPHA_CHANNEL_SECRET`) и прогоняет release gate.

Начиная с фикса 2026-04-23, `scripts/dev/run-tauri-cli.js` тоже загружает `ALPHA_CHANNEL_SECRET` из `scripts/dev/.env.keys`, так что ручной `npm run tauri:build` теперь даёт корректный по размеру бинарь. Но **официальный** release flow всё равно `release:prepare`, потому что он также валидирует версию, updater config, генерирует manifest и подписывает артефакт.

## 10. Нельзя полагаться на устаревшие инструкции

Считайте устаревшими любые заметки, которые утверждают одно из следующих:

- есть `npm run release`
- единственный клиентский endpoint — это прямой `stable.json`
- updater routing уже полностью токенизирован через PHP endpoint
- release-поток документирован только вокруг версии `0.1.507`
