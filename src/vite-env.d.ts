/// <reference types="vite/client" />

/**
 * Injected by Vite at build time (see vite.config.ts `define`).
 * `true` for all builds — this is a Tauri-only desktop product.
 * Used to tree-shake browser-WASM loading code from the bundle.
 */
declare const __TAURI_ONLY__: boolean;
