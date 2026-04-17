/**
 * Playwright configuration for DB-scale performance tests.
 *
 * Запускает db-scale-perf.tauri.spec.ts против Tauri-приложения,
 * работающего с pre-seeded БД заданного размера.
 *
 * Два прогона:
 *   npm run perf:db:small  — ~12 экспериментов (smoke + baseline)
 *   npm run perf:db:large  — ~7000 экспериментов (нагрузочный)
 *
 * Быстрый повтор (без пересборки):
 *   npm run perf:db:small:fast
 *   npm run perf:db:large:fast
 *
 * Переменные окружения:
 *   RHEOLAB_DB_SCALE      — "small" | "large" (см. setup-скрипт)
 *   TAURI_CDP_PORT        — CDP-порт (default: 9223)
 *   TAURI_E2E_SKIP_BUILD  — "1" — пропустить сборку
 */

import { defineConfig } from '@playwright/test';
import path from 'path';

const scale = (process.env.RHEOLAB_DB_SCALE || 'small').toLowerCase();

export default defineConfig({
    testDir: './tests/e2e',
    testMatch: ['db-scale-perf.tauri.spec.ts'],

    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: 0,
    workers: 1,

    timeout: 600_000,  // 10 мин — большая БД может медленно загружаться

    reporter: [
        ['list'],
        ['html', { outputFolder: `playwright-report-db-scale-${scale}` }],
    ],

    globalSetup: path.resolve('./scripts/test/tauri-db-scale-setup.js'),
    globalTeardown: path.resolve('./scripts/test/tauri-db-scale-teardown.js'),

    use: {
        headless:   false,
        video:      'off',
        screenshot: 'only-on-failure',
    },
});
