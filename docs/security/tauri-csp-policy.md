# Tauri CSP Policy

Date: 2026-06-14
Status: current desktop CSP baseline after phase-1 tightening.

## Policy

The production desktop CSP is defined in `src-tauri/tauri.conf.json`.

Current allowed network endpoints:

| Endpoint | Reason | Owner |
| --- | --- | --- |
| `http://ipc.localhost` | Internal Tauri IPC bridge used by plugin calls from the WebView. | Platform |
| `https://license.vizbuka.ru` | Licensing and updater metadata host. | Licensing / Release |
| `https://api.groq.com` | Optional external AI parsing endpoint. | AI / Product |

## Tightening Applied

| Directive | Current value | Reason |
| --- | --- | --- |
| `default-src` | `'self'` | Default fallback no longer grants `blob:`. |
| `script-src` | `'self'` | No `unsafe-inline` or `unsafe-eval` script execution. |
| `object-src` | `'none'` | Blocks plugin/object/embed content. |
| `base-uri` | `'none'` | Blocks base URL injection. |
| `frame-ancestors` | `'none'` | Blocks embedding the desktop UI. |
| `form-action` | `'none'` | Blocks form submission targets. |
| `worker-src` | `'self' blob:` | Keeps any worker/blob requirement explicit instead of inherited from `default-src`. |
| `manifest-src` | `'self'` | Restricts web app manifest loading. |
| `media-src` | `'self' blob:` | Keeps media/blob allowance explicit. |

## Deferred Tightening

| Directive | Current value | Why deferred |
| --- | --- | --- |
| `style-src` | `'self' 'unsafe-inline'` | The React UI still uses many inline style props for chart sizing, virtualized rows, progress bars, and dynamic positioning. Removing this needs a dedicated UI/CSP migration and browser-console smoke. |
| `img-src` | `'self' data: blob:` | User branding logos are stored as data URLs and report downloads use blob object URLs. |
| `font-src` | `'self' data:` | Kept for bundled or embedded font compatibility until a font asset audit proves `data:` is unnecessary. |
| `connect-src` | `'self' http://ipc.localhost https://license.vizbuka.ru https://api.groq.com` | Host list is explicit. `http://ipc.localhost` is the internal Tauri IPC bridge; feature-level external network opt-in belongs to the external AI/network policy follow-up. |

## Validation

Run:

```powershell
npm test -- --run tests/release/tauri-csp-policy.test.ts
npm run build
cargo check --manifest-path src-tauri/Cargo.toml --all-targets --all-features
```

For release readiness, also run a desktop smoke or release gate and check for
CSP console errors.

## Rollback

Revert the CSP string in `src-tauri/tauri.conf.json` and remove the matching
release test/doc changes.
