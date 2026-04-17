import { defineConfig, devices } from '@playwright/test';

if (!process.env.RHEOLAB_E2E_FAKE_PARSE) {
    process.env.RHEOLAB_E2E_FAKE_PARSE = '1';
}

const e2ePort = process.env.RHEOLAB_E2E_PORT || process.env.PORT || '3100';
const e2eHost = process.env.RHEOLAB_E2E_HOST || '127.0.0.1';
const e2eBaseUrl = `http://${e2eHost}:${e2ePort}`;

export default defineConfig({
    testDir: './tests/e2e/_archived',
    testMatch: ['workflow-critical.spec.ts'],
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
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
            RHEOLAB_E2E_FAKE_PARSE: '1',
        },
        timeout: 180 * 1000,
        reuseExistingServer: !process.env.CI,
    },
});