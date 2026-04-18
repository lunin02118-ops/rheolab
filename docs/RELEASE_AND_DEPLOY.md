# RheoLab Enterprise — релиз и деплой обновлений

> Проверено по репозиторию 2026-04-17  
> Версия на момент проверки: `0.2.0-beta.5`

Этот документ описывает текущий рабочий release/update-контур. Он заменяет старые инструкции, где фигурировали `npm run release`, жёсткая привязка к `stable.json` как единственному endpoint и устаревшие номера версий.

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

### Важное расхождение, которое нужно знать

Сейчас в репозитории существуют две модели маршрутизации:

1. `license-server/releases.htaccess`
   - активный Apache rewrite
   - выбирает `stable.json`/`beta.json` по `X-Update-Channel`
   - токен не проверяет

2. `license-server/api/update-channel.php`
   - умеет валидировать `X-Update-Token`
   - умеет fail-closed downgrade с beta на stable
   - но не является текущим дефолтным rewrite-путём

Пока это не унифицировано, документация должна отражать реальное поведение сервера, а не желаемое.

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

### 5.2 Сборка

```bash
npm run release:prepare -- --channel stable
```

или для beta:

```bash
npm run release:prepare -- --channel beta
```

### 5.3 Публикация манифеста и артефакта

```bash
node scripts/deploy/publish-update.js --channel stable
node scripts/deploy/publish-update.js --channel beta
```

### 5.4 Проверка после публикации

`publish-update.js` сам вызывает `scripts/test/check-update-endpoint.mjs`, но для ручной проверки можно запустить явно:

```bash
node scripts/test/check-update-endpoint.mjs --version 0.2.0-beta.5 --channel beta
```

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
node scripts/release/rollback-channel.js
```

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

## 9. Нельзя полагаться на устаревшие инструкции

Считайте устаревшими любые заметки, которые утверждают одно из следующих:

- есть `npm run release`
- единственный клиентский endpoint — это прямой `stable.json`
- updater routing уже полностью токенизирован через PHP endpoint
- release-поток документирован только вокруг версии `0.1.507`
