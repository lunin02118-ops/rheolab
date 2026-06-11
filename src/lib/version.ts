/**
 * Auto-generated version file
 * Do not edit manually
 *
 * Source of truth: /version.json
 * Run `npm run version:sync` to regenerate this file.
 *
 * BUILD_DATE / COMMIT_HASH are injected at build time by Vite `define`
 * (see vite.config.ts). Outside a Vite build they fall back to 'dev'.
 */

declare const __BUILD_DATE__: string | undefined;
declare const __COMMIT_HASH__: string | undefined;

export const APP_VERSION = '0.2.3-beta.1';
export const BUILD_DATE: string =
    typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'dev';
export const COMMIT_HASH: string =
    typeof __COMMIT_HASH__ !== 'undefined' ? __COMMIT_HASH__ : 'dev';
