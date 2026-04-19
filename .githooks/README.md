# Git hooks

Custom hooks for RheoLab. Enable them **once per clone**:

```bash
git config core.hooksPath .githooks
```

After this, Git runs the scripts from `.githooks/` instead of `.git/hooks/`.
The directory is versioned, so every developer on the repo picks up the
same checks automatically the next time they update their config.

## `pre-commit`

Runs on every `git commit`. Refuses the commit if either:

1. A staged file path matches a forbidden credential-file pattern
   (`.env*`, `*.secret`, `*.key`, `*.pem`, `secrets.env*`, …), unless
   the file is explicitly an `.example` / `.sample` / `.tmpl` template.
2. The staged diff contains a high-signal secret marker: PEM private
   keys, AWS / Google / GitHub / OpenAI keys, or a non-empty value
   assigned to one of RheoLab's own secret env vars
   (`INTEGRITY_SECRET_KEY`, `BETA_CHANNEL_SECRET`, `ALPHA_CHANNEL_SECRET`,
   `LICENSE_ENCRYPTION_KEY`, `LICENSE_SECRET`,
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `DB_PASSWORD`,
   `VPS_ROOT_PASSWORD`, `DASHBOARD_ADMIN_PASSWORD`,
   `RHEOLAB_ALPHA_CHANNEL_SECRET`, `RHEOLAB_BETA_CHANNEL_SECRET`).

If you **know** the match is benign (e.g. committing a new `*.example`
template), bypass with:

```bash
git commit --no-verify -m "…"
```

…but do investigate first: almost every bypass in practice turns out
to be a real near-miss.

## Extending the rules

Add new forbidden path patterns to `FORBIDDEN_PATH_REGEX` in
`pre-commit`. Add new content markers to the `CONTENT_PATTERNS` array.
Keep the patterns **narrow** — over-broad regexes cause false-positive
fatigue and train everyone to bypass the hook.
