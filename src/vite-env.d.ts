/// <reference types="vite/client" />

/**
 * Injected by Vite at build time (see vite.config.ts `define`).
 * `true` for all builds — this is a Tauri-only desktop product.
 * Used to tree-shake browser-WASM loading code from the bundle.
 */
declare const __TAURI_ONLY__: boolean;

/**
 * Injected by Vite `define` at build time (see vite.config.ts).
 * `src/lib/version.ts` reads these and falls back to 'dev' when undefined
 * (e.g. in unit tests or any non-Vite context).
 */
declare const __BUILD_DATE__: string | undefined;
declare const __COMMIT_HASH__: string | undefined;
