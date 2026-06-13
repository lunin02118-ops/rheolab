# Agent refactor PR

## Objective


## Scope

- [ ] Frontend
- [ ] Rust/Tauri backend
- [ ] IPC
- [ ] DB/migrations
- [ ] Security/capabilities
- [ ] Release/CI
- [ ] Website
- [ ] License server
- [ ] Docs only

## Changes

-

## Behavior changes

- [ ] No behavior changes
- [ ] Behavior changes described below

Description:


## Commands run

| Command | Exit code | Notes |
|---|---:|---|
| npm run lint |  |  |
| npm run typecheck |  |  |
| npm test |  |  |
| cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1 |  |  |
| npm run audit:frontend-ipc |  |  |
| npm run audit:large-ipc |  |  |

## Test failures / known issues


## Security review

- [ ] No security-sensitive changes
- [ ] IPC surface changed
- [ ] Tauri capabilities changed
- [ ] File access changed
- [ ] Network access changed
- [ ] License/auth behavior changed
- [ ] Secrets checked

Notes:


## Performance review

- [ ] No performance-sensitive changes
- [ ] Perf baseline included
- [ ] Budget/audit run included

Notes:


## Rollback plan


## Reviewer checklist

- [ ] PR has one clear purpose
- [ ] No unrelated formatting
- [ ] No secrets/private keys
- [ ] Failing tests are documented
- [ ] IPC policy/docs updated if IPC changed
- [ ] Migration rollback documented if DB changed
- [ ] Release/check scripts updated if release path changed
