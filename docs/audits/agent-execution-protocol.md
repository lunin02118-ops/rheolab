# Agent execution protocol for RheoLab refactoring

Этот документ предназначен для агента, который будет выполнять аудит/рефакторинг по PR.

---

## 1. Общие правила

1. Работай маленькими PR.
2. Один PR = одна цель.
3. Не делай массовое форматирование вместе с логикой.
4. Не коммить секреты, private keys, production `.env`, реальные дампы DB.
5. Не скрывай failing tests.
6. Не объявляй команду успешной, если она не запускалась.
7. Не меняй public IPC contract без отдельного указания.
8. Не расширяй Tauri permissions/capabilities без security note.
9. Не коммить большие raw logs/generated artifacts.
10. Всегда оставляй rollback note.

---

## 2. Перед началом каждого PR

```bash
git checkout main
git pull --ff-only
git status --short
```

Создать ветку:

```bash
git checkout -b audit/<NN>-<short-name>
```

Сделать preflight:

```bash
npm ci
npm run lint
npm run typecheck
npm test
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
```

Если preflight уже падает на main, не чинить всё подряд. Зафиксировать baseline failure в отчёте и продолжить только если задача не зависит от этого failure.

---

## 3. Формат отчёта агента

```markdown
# Agent progress report

Branch:
Commit:
PR:
Phase:
Date:

## Objective

## Changes

## Files changed

## Behavior changes
- None / described here

## Commands run
| Command | Exit code | Notes |
|---|---:|---|

## Test failures

## Security notes

## Performance notes

## Risk assessment

## Rollback plan

## Questions for reviewer
```

---

## 4. Required checks by change type

### Frontend-only

```bash
npm run lint
npm run typecheck
npm test
```

### Rust/Tauri backend

```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
npm run typecheck
```

### IPC changes

```bash
npm run typecheck
npm run audit:frontend-ipc
npm run audit:large-ipc
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
```

### DB/migrations

```bash
cargo test --manifest-path src-tauri/Cargo.toml migration -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml backup -- --test-threads=1
npm run perf:db:regression
```

### Release/signing

```bash
npm run check:release
npm run tauri:build
npm run check:update
```

### Website/license-server

```bash
npm --prefix website run build
composer --working-dir=license-server validate
composer --working-dir=license-server test
```

Если команда отсутствует — сообщить. Не заменять молча.

---

## 5. PR size policy

Идеальный PR:

```text
< 500 changed lines для logic PR
< 1500 changed lines для mechanical move PR
0 unrelated formatting files
0 generated raw artifacts
```

Если PR больше:

```text
- объяснить почему;
- разбить, если возможно;
- использовать mechanical commit отдельно от behavior commit.
```

---

## 6. Commit message format

```text
audit: add baseline quality gate report
security: move IPC error logging out of serialization
ipc: add command policy inventory
perf: remove direct comparison payload IPC in production
refactor(reports): split reports command module
release: add canonical release gate
```

---

## 7. Stop conditions

Остановиться и запросить проверку, если:

```text
- появился secret/private key;
- нужно изменить license behavior;
- нужно изменить updater/signing behavior;
- DB migration может повлиять на реальные данные;
- direct IPC command removal ломает frontend;
- tests показывают data loss risk;
- full build перестал собираться по непонятной причине;
- нужно удалить публичную API/IPC команду.
```
