import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
    testDir: './tests/e2e',
    testMatch: ['full-workflow.tauri.spec.ts'],

    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: 0,
    workers: 1,

    reporter: [
        ['list'],
        ['html', { outputFolder: 'playwright-report-full-workflow-tauri' }],
    ],

    globalSetup: path.resolve('./scripts/test/tauri-e2e-setup.js'),
    globalTeardown: path.resolve('./scripts/test/tauri-e2e-teardown.js'),

    use: {
        baseURL: 'https://tauri.localhost',
        actionTimeout: 30_000,
        navigationTimeout: 60_000,
    },

    timeout: 900_000,
});