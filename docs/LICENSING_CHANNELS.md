# Licensing Tiers and Update Channels

_Introduced in `v0.2.0-beta.8`_

RheoLab has **three update-channel tiers**. Each licence type is mapped
to exactly one channel by the Rust command `get_update_channel`
(`src-tauri/src/commands/licensing/mod.rs`); the frontend's
`UpdateChecker` simply calls that command and forwards the resulting
channel + HMAC token to the update server.

## Channel → licence mapping

| Channel  | Licence types that receive it      | HMAC secret key           | Purpose                                      |
|----------|------------------------------------|---------------------------|----------------------------------------------|
| `alpha`  | `superuser`                        | `ALPHA_CHANNEL_SECRET`    | Project owner's personal QA tier — first line of manual testing |
| `beta`   | `developer`                        | `BETA_CHANNEL_SECRET`     | Internal dev team — second line of testing   |
| `stable` | `standard`, `enterprise`, `trial`, `demo`, unlicensed | — | End users                                    |

The pipeline is **manual**: every new build ships to `alpha` first,
where the project owner validates it on their personal machine. Only
after that does the artefact get promoted to `beta` (so the dev team
can smoke-test it) and finally to `stable` (general public).

## Building an alpha artefact

Set all three build-time secrets, then run the release script with
`--channel alpha`:

```powershell
$env:INTEGRITY_SECRET_KEY    = '…production integrity key…'
$env:BETA_CHANNEL_SECRET     = '…beta HMAC key…'
$env:ALPHA_CHANNEL_SECRET    = '…alpha HMAC key…'
npm run release:prepare -- --channel alpha --skip-qa
```

The release script will:

1. Verify that all three keys differ from their dev sentinels (startup
   assertion in `src-tauri/src/commands/licensing/types.rs`).
2. Patch the Tauri updater endpoint to append `?channel=alpha`.
3. Build the Tauri bundle and sign the installer with the Tauri updater
   key (`src-tauri/keys/updater.key`).
4. Produce a `release-manifest-v<version>-<ts>.json` under
   `runtime/release/channels/alpha/` plus a channel-scoped
   `latest-manifest.json`.

Signed artefacts are **required** for alpha (same as beta / stable) —
only `internal` skips the signature gate.

## Server-side requirements

The update server at `license.vizbuka.ru` must:

1. **Accept `superuser` as a valid `license_type`** when issuing licence
   keys. Existing check in `LicenseType::from_str_loose` already
   recognises the string `"superuser"` (case-insensitive), so the
   server only has to include it in its whitelist.

2. **Serve an alpha manifest** at
   `/releases/v1/update/{target}-{arch}/update?channel=alpha` that
   points at the latest alpha installer and its `.sig`. Mirror the
   existing `beta.json` layout.

3. **Validate the `X-Update-Token` header for alpha requests** using
   HMAC-SHA256 with `ALPHA_CHANNEL_SECRET` as the key and the message
   `alpha:{window}`, where `window = floor(unix_seconds / 300)`. Accept
   the current window and the previous one to tolerate ≤ 5 minutes of
   clock skew.

   This mirrors the existing beta-token logic — the helper is shared:
   see `make_channel_token` in
   `src-tauri/src/commands/licensing/mod.rs`.

4. **Reject alpha manifests for non-superuser licences.** A client with
   `license_type = "developer"` that forges `channel=alpha` in the URL
   cannot produce a valid alpha token (different HMAC secret), so the
   server can drop the request on token mismatch.

## Promotion workflow

```
┌────────┐   owner QA    ┌──────┐   dev team QA   ┌────────┐
│ alpha  │ ────────────► │ beta │ ──────────────► │ stable │
│ build  │               │ build│                 │ build  │
└────────┘               └──────┘                 └────────┘
     ▲                       ▲                        ▲
     │                       │                        │
  superuser              developer          standard / enterprise
  licences               licences           / trial / demo
```

Promotion is a build-server operation (out of scope for the client
app): republish the same installer + `.sig` under the higher channel
prefix, or re-run `npm run release:prepare -- --channel beta` against
the same commit.

## Security notes

- The HMAC token rotates every 5 minutes, so a stolen alpha token stops
  working within that window. This is deliberately stricter than a
  long-lived bearer token.
- The three secrets (`INTEGRITY_SECRET_KEY`, `BETA_CHANNEL_SECRET`,
  `ALPHA_CHANNEL_SECRET`) are embedded **at compile time** via
  `option_env!`. An alpha-capable binary can only be produced by
  someone who has `ALPHA_CHANNEL_SECRET` at build time.
- Release builds that still carry the dev sentinel value of
  `ALPHA_CHANNEL_SECRET` (`rheolab-alpha-channel-dev-key-00`) will
  **panic on startup** (`assert_production_keys`), preventing
  accidental distribution of a dev-keyed binary to users.

## Related source

- `src-tauri/src/commands/licensing/types.rs` — `LicenseType::Superuser`,
  `ALPHA_CHANNEL_KEY`, startup assertion.
- `src-tauri/src/commands/licensing/features.rs` — `superuser_features()`.
- `src-tauri/src/commands/licensing/mod.rs` — `make_alpha_channel_token`,
  `get_update_channel`.
- `scripts/release/lib/release-policy.js` — `RELEASE_CHANNELS`
  allowlist and signing requirements.
- `src/lib/licensing/types.ts` — `LicenseType` union on the frontend.
