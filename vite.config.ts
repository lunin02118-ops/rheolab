import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
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
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
      output: {
        // Vite 8 + Rolldown removed the object form of manualChunks
        // (`{ name: [pkg, ...] }`); only the function form is still
        // supported (and itself deprecated — the long-term move is to
        // Rolldown's `codeSplitting` option).  This function form
        // reproduces the previous chunk groups by id-inspection so
        // the cache-friendly vendor split survives the upgrade.
        // openai is left alone — dynamic import() gives it its own
        // auto-generated chunk and we don't want to merge it here.
        manualChunks: (id: string) => {
          if (!id.includes('node_modules')) return undefined;

          // Framework — changes least often, maximizes cache hits.
          if (
            /[/\\]node_modules[/\\](react|react-dom|react-router-dom|scheduler)[/\\]/.test(id)
          ) {
            return 'vendor-react';
          }
          // Charts — uplot is very small and fast.
          if (/[/\\]node_modules[/\\]uplot[/\\]/.test(id)) {
            return 'vendor-charts';
          }
          // Radix UI primitives — large but rarely change.
          if (/[/\\]node_modules[/\\]@radix-ui[/\\]/.test(id)) {
            return 'vendor-radix';
          }
          // date-fns — separate because it's locale-heavy.
          if (/[/\\]node_modules[/\\]date-fns[/\\]/.test(id)) {
            return 'vendor-date';
          }
          return undefined;
        },
      },
    },
  },
}));
