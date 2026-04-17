/**
 * Playwright configuration for performance benchmark tests.
 *
 * Runs only `tests/e2e/perf-benchmark.spec.ts`.
 * Excluded from the main playwright.config.ts so it never runs in regular CI.
 *
 * Usage:
 *   npx playwright test --config playwright.benchmark.config.ts
 *   npm run perf:benchmark
 */
import { defineConfig, devices } from '@playwright/test';

// Propagate fake-parse flag to test worker processes (same issue as playwright.config.ts).
// webServer.env is server-only; workers read process.env directly.
//
// This config runs against a Vite webServer — no Tauri binary is present, so
// parsing_parse_file IPC is unavailable. fakeParse=1 keeps the IPC mock happy
// for Scenario 1 + 3 (heap, DOM, navigation). Scenario 2 (real analysisMs)
// requires the Tauri binary: npm run perf:benchmark:tauri
if (!process.env.RHEOLAB_E2E_FAKE_PARSE) {
    process.env.RHEOLAB_E2E_FAKE_PARSE = '1';
}

const e2ePort = process.env.RHEOLAB_E2E_PORT || process.env.PORT || '3100';
const e2eHost = process.env.RHEOLAB_E2E_HOST || '127.0.0.1';
const e2eBaseUrl = `http://${e2eHost}:${e2ePort}`;

export default defineConfig({
    testDir: './tests/e2e',
    testMatch: ['perf-benchmark.spec.ts', 'memory-stress.spec.ts'],
    fullyParallel: false, // run scenarios sequentially to get stable metrics
    forbidOnly: !!process.env.CI,
    retries: 0,           // no retries — timing measurements must be deterministic
    workers: 1,
    reporter: [['html', { outputFolder: 'playwright-report-benchmark' }], ['list']],
    use: {
        baseURL: e2eBaseUrl,
        trace: 'off',      // traces add overhead, disable for accurate timing
        video: 'off',
        screenshot: 'off',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: 'npm run build && node scripts/test/run-e2e-webserver.js',
        url: e2eBaseUrl,
        env: {
            ...process.env,
            PORT: e2ePort,
            RHEOLAB_E2E_PORT: e2ePort,
            RHEOLAB_E2E_HOST: e2eHost,
            // Fake parse keeps the IPC mock happy in browser/Vite mode.
            // Real analysis timing: npm run perf:benchmark:tauri
            RHEOLAB_E2E_FAKE_PARSE: '1',
        },
        timeout: 180 * 1000,
        reuseExistingServer: !process.env.CI,
    },
});
