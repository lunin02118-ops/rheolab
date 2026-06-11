import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';
import { execSync } from 'node:child_process';

// Local copy of resolveCommitHash() from scripts/version/lib.js.
// lib.js is CommonJS and this config is ESM, so we duplicate the 8-line
// helper here instead of importing it. Keep the two in sync if either changes.
function resolveCommitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
  } catch {
    const ciHash = process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA;
    if (ciHash && ciHash.length >= 7) return ciHash.slice(0, 7);
    return 'dev';
  }
}

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  // BUILD_DATE / COMMIT_HASH are injected here so src/lib/version.ts stays
  // byte-for-byte stable between version bumps (no churn). Outside a Vite
  // build the consts fall back to 'dev' (see src/lib/version.ts).
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().split('T')[0]),
    __COMMIT_HASH__: JSON.stringify(resolveCommitHash()),
  },

  plugins: [
    react(),
    // Bundle size visualizer — generates runtime/refactor-baseline/bundle.html
    // when ANALYZE=true is set. Never runs during normal dev/build.
    ...(process.env.ANALYZE
      ? [
          visualizer({
            filename: 'runtime/refactor-baseline/bundle.html',
            open: false,
            gzipSize: true,
            brotliSize: true,
            template: 'treemap',
          }),
        ]
      : []),
  ],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // Vite options tailored for Tauri development
  clearScreen: false,


  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Ignore files that don't belong to the React bundle so editing them
      // doesn't trigger a full page reload (which would wipe dashboard
      // state — confusing during dev-mode QA):
      //   * `src-tauri/**`, `src/rust/**` — compiled by cargo, not Vite.
      //   * `tests/**` — Playwright / Vitest files executed out-of-band;
      //     HMR bundling them just forces reloads while editing E2E specs
      //     with the app already running for a manual smoke test.
      //   * `scripts/**`, `outputs/**` — dev helpers and CI artefacts.
      ignored: [
        '**/src-tauri/**',
        '**/src/rust/**',
        '**/tests/**',
        '**/scripts/**',
        '**/outputs/**',
      ],
    },
  },

  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS/Linux
    target:
      process.env.TAURI_ENV_PLATFORM === 'windows'
        ? 'chrome105'
        : 'safari13',
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rolldownOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
      output: {
        // Vite 8 + Rolldown.  Migrated off the deprecated function-form
        // `manualChunks` (kept around as a compat shim) onto Rolldown's
        // canonical `codeSplitting.groups` API — same vendor split,
        // declarative regex tests, no JS callback overhead.
        // Reference: https://rolldown.rs/in-depth/manual-code-splitting
        // openai is left alone — dynamic import() gives it its own
        // auto-generated chunk and we don't want to merge it here.
        codeSplitting: {
          groups: [
            // Framework — changes least often, maximizes cache hits.
            {
              test: /[/\\]node_modules[/\\](react|react-dom|react-router-dom|scheduler)[/\\]/,
              name: 'vendor-react',
            },
            // Charts — uplot is very small and fast.
            {
              test: /[/\\]node_modules[/\\]uplot[/\\]/,
              name: 'vendor-charts',
            },
            // Radix UI primitives — large but rarely change.
            {
              test: /[/\\]node_modules[/\\]@radix-ui[/\\]/,
              name: 'vendor-radix',
            },
            // date-fns — separate because it's locale-heavy.
            {
              test: /[/\\]node_modules[/\\]date-fns[/\\]/,
              name: 'vendor-date',
            },
          ],
        },
      },
    },
  },
}));
