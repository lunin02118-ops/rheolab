# External AI Network Policy

Date: 2026-06-14

## Scope

This note documents the opt-in gate for external AI requests after the release
merge train. It covers Groq-based AI parsing and API key validation only.

## Policy

- External AI network access is disabled by default.
- The user must explicitly enable `externalAiEnabled` before any Groq validation
  or forced AI parsing path may run.
- `forceAiParsing` is sanitized to `false` unless `externalAiEnabled` is also
  `true`.
- Demo fixture parsing remains local and deterministic unless the user enables
  external AI and force AI parsing.

## IPC Commands

The following IPC commands are external-network capable and are listed in
`src-tauri/src/ipc_policy.rs`:

- `api_keys_check_active`
- `api_keys_validate`
- `parsing_parse_file`

`api_keys_check_active` and `api_keys_validate` reject network validation unless
`allowExternalNetwork=true` is passed from the renderer.

`parsing_parse_file` resolves Groq API keys server-side only when
`externalAiEnabled=true`. It rejects `forceAi=true` without that opt-in before
attempting AI key resolution or Groq mapping.

## Trial And Licensing

This change does not modify `license-server/**`, license activation, trial
start/end calculation, feature entitlement, or the 30-day trial behavior.

## Validation

- Store sanitization tests cover the default-off state and force-AI dependency.
- Parsing client tests cover no key lookup by default and force-AI rejection
  before IPC without opt-in.
- API key client tests cover default `allowExternalNetwork=false` and explicit
  opt-in forwarding.
- Rust checks cover the Tauri command request shape and parsing command build.

## Rollback

Revert this PR. The previous behavior allowed API key validation and forced AI
parsing without a dedicated renderer opt-in.
