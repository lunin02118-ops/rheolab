/**
 * Playwright configuration for Tauri memory leak soak tests.
 *
 * Запускает memory-leak-soak.tauri.spec.ts против реального Tauri-приложения
 * через CDP (те же globalSetup/Teardown что у playwright.tauri.config.ts).
 *
 * Запуск:
 *   npm run perf:soak:tauri
 *   npx playwright test --config playwright.tauri-soak.config.ts
 *
 *   Быстрый (без пересборки бинарника):
 *   TAURI_E2E_SKIP_BUILD=1 npm run perf:soak:tauri
 *
 * Тест занимает ~5-10 мин (8 upload-раундов + 6 comparison-раундов).
 */

import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
    testDir: './tests/e2e',
    testMatch: ['memory-leak-soak.tauri.spec.ts'],

    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: 0,
    workers: 1,

    timeout: 600_000,   // 10 мин — один тест (8 × анализ)

    reporter: [
        ['list'],
        ['html', { outputFolder: 'playwright-report-tauri-soak' }],
    ],

    globalSetup: path.resolve('./scripts/test/tauri-e2e-setup.js'),
    globalTeardown: path.resolve('./scripts/test/tauri-e2e-teardown.js'),

    use: {
        headless:   false,
        video:      'off',
        screenshot: 'only-on-failure',
    },
});
