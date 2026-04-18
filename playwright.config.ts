import { defineConfig, devices } from '@playwright/test';

// Propagate fake-parse flag to all test worker processes.
// webServer.env is server-only; test workers read process.env directly.
// Without this line workers see fakeParse=false, the Tauri IPC mock rejects
// parsing_parse_file, the WASM fallback is dead (isTauri()=true from the mock),
// and waitForAnalysis() times out → E2E-001 / E2E-002 root cause.
if (!process.env.RHEOLAB_E2E_FAKE_PARSE) {
    process.env.RHEOLAB_E2E_FAKE_PARSE = '1';
}

const e2ePort = process.env.RHEOLAB_E2E_PORT || process.env.PORT || '3100';
const e2eHost = process.env.RHEOLAB_E2E_HOST || '127.0.0.1';
const e2eBaseUrl = `http://${e2eHost}:${e2ePort}`;

export default defineConfig({
    testDir: './tests/e2e',
    /* Superseded tests archived in _archived/ — pending migration to base-test.ts infrastructure */
    testIgnore: [
        '_archived/**',
        '**/*.tauri.spec.ts',               // Tauri-only: require real binary via CDP (playwright.tauri.config.ts)
        'perf-benchmark.spec.ts',           // use: npx playwright test --config playwright.benchmark.config.ts
        'memory-stress.spec.ts',            // use: npx playwright test --config playwright.benchmark.config.ts
    ],
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: [['html', { open: 'never' }], ['list']],
    use: {
        baseURL: e2eBaseUrl,
        trace: 'on-first-retry',
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
            // Use fake parse so file-upload E2E tests pass without a real WASM binary.
            // The WASM pipeline is separately validated by Rust ai_parsing tests.
            RHEOLAB_E2E_FAKE_PARSE: '1',
        },
        timeout: 180 * 1000,
        reuseExistingServer: !process.env.CI,
    },
});
