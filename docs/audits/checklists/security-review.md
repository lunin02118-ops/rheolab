# Security review checklist

Use this checklist for PRs that touch IPC, Tauri capabilities, file access, network access, licensing, updater, backup/restore, logs, or external APIs.

## Secrets

- [ ] No production `.env`
- [ ] No private keys
- [ ] No API keys
- [ ] No license signing secrets
- [ ] No real user data dumps

## IPC

- [ ] Command has policy metadata
- [ ] Risk level correct
- [ ] High-risk command requires audit log or documented exception
- [ ] License/auth gate preserved
- [ ] Payload size acceptable
- [ ] Binary responses used for large bytes
- [ ] No direct heavy JSON payload path in production

## File access

- [ ] Path canonicalized
- [ ] Symlink traversal rejected
- [ ] Extension checked
- [ ] Magic/header checked if applicable
- [ ] Max file size checked
- [ ] No arbitrary overwrite
- [ ] Restore/import creates rollback backup

## Network

- [ ] External endpoint documented
- [ ] Timeout present
- [ ] Retry policy safe/idempotent
- [ ] API key redacted
- [ ] External AI/API is opt-in
- [ ] Offline mode behavior documented

## Logs/errors

- [ ] IPC errors use safe messages
- [ ] Raw errors not returned to frontend
- [ ] Logs redact secrets/API keys
- [ ] Logs have length limits
- [ ] Support bundle redaction applied

## Updater/signing

- [ ] Private updater key absent
- [ ] Public key expected
- [ ] Package signature verified
- [ ] Windows signing/timestamp checked
