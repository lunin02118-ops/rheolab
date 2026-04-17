/**
 * Playwright configuration for Tauri desktop E2E / performance tests.
 *
 * В отличие от playwright.workflow-perf.config.ts (web-режим, Vite-сервер),
 * этот конфиг запускает настоящее Tauri-приложение и подключается к нему
 * через Chrome DevTools Protocol (CDP).
 *
 * Как это работает:
 *   1. globalSetup — собирает frontend+Rust debug-бинарник (если нужно) и
 *      запускает приложение с переменной WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=
 *      --remote-debugging-port=<TAURI_CDP_PORT>.
 *   2. В тестах: chromium.connectOverCDP('http://127.0.0.1:<port>') подключается
 *      к существующему WebView2-процессу без запуска отдельного браузера.
 *   3. globalTeardown — завершает процесс Tauri через taskkill /T /F.
 *
 * Отличия от web-конфига:
 *   - Нет webServer (приложение стартует через globalSetup)
 *   - Нет моков Tauri IPC — анализ выполняется реальным Rust-кодом
 *   - Только Windows (WebView2 = Chromium-based → CDP работает)
 *
 * Переменные окружения:
 *   TAURI_CDP_PORT          — CDP-порт (по умолчанию 9222)
 *   TAURI_E2E_SKIP_BUILD    — "1" — пропустить cargo build + npm run build
 *   TAURI_E2E_SKIP_FRONTEND — "1" — пропустить только npm run build
 *
 * Запуск:
 *   npm run perf:workflow:tauri
 *   npx playwright test --config playwright.tauri.config.ts
 *
 * Первый запуск (нет бинарника):
 *   npx playwright test --config playwright.tauri.config.ts
 *   # globalSetup сам вызовет cargo build (~2-5 мин)
 *
 * Повторный запуск (бинарник уже есть, frontend не менялся):
 *   TAURI_E2E_SKIP_BUILD=1 npx playwright test --config playwright.tauri.config.ts
 */

import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
    testDir: './tests/e2e',
    testMatch: ['**/*.tauri.spec.ts'],

    fullyParallel: false,  // последовательно → стабильные метрики
    forbidOnly: !!process.env.CI,
    retries: 0,            // нет повторов — метрики должны быть детерминированы
    workers: 1,

    reporter: [
        ['list'],
        ['html', { outputFolder: 'playwright-report-tauri-perf' }],
    ],

    globalSetup: path.resolve('./scripts/test/tauri-e2e-setup.js'),
    globalTeardown: path.resolve('./scripts/test/tauri-e2e-teardown.js'),

    // Нет webServer — приложение управляется через globalSetup/Teardown.
    // baseURL = Tauri-приложение на Windows (WebView2) доступно по https://tauri.localhost
    // Это позволяет page.goto('/'), page.goto('/dashboard') работать корректно.

    use: {
        baseURL: 'https://tauri.localhost',

        // Длинные таймауты — реальный нативный анализ быстрее WASM, но
        // Tauri-процесс стартует дольше, чем Vite-сервер.
        actionTimeout:      30_000,
        navigationTimeout: 60_000,
    },

    timeout: 900_000, // 15 мин для всего теста (аналогично web-конфигу)
});
