# Release quality gate checklist

Production release must not proceed until every applicable item is satisfied.

## Versioning

- [ ] `package.json` version correct
- [ ] Tauri config version correct
- [ ] Rust crate version correct if applicable
- [ ] Website/license-server version or compatibility note updated
- [ ] Changelog updated
- [ ] Git tree clean

## Frontend

- [ ] `npm ci`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] E2E smoke passed or documented CI-only

## Rust/Tauri

- [ ] `cargo check --manifest-path src-tauri/Cargo.toml`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
- [ ] Tauri build passed

## IPC/security

- [ ] IPC inventory complete
- [ ] High-risk commands reviewed
- [ ] Large IPC audit passed
- [ ] No direct heavy JSON payloads in production
- [ ] Tauri capabilities reviewed
- [ ] External network endpoints documented
- [ ] Secret scan passed
- [ ] Updater private key absent from repo

## DB/data safety

- [ ] Migrations tested
- [ ] Backup/restore smoke tested
- [ ] DB import rejects corrupt/wrong schema
- [ ] Rollback plan documented

## Signing/updater

- [ ] Windows installer signed
- [ ] Timestamp present
- [ ] Updater package signed
- [ ] Update manifest valid
- [ ] Public key matches expected
- [ ] Update smoke test passed

## Artifacts

- [ ] Installer uploaded
- [ ] Updater package uploaded
- [ ] Symbols archived privately
- [ ] Release notes uploaded
- [ ] Rollback artifact available
