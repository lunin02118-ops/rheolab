/**
 * Playwright base fixture для Tauri desktop E2E-тестов (CDP-режим).
 *
 * В отличие от base-test.ts (browser-только, всё через WASM-моки), этот модуль:
 *  — подключается к ЗАПУЩЕННОМУ Tauri-приложению через CDP (connectOverCDP)
 *  — НЕ запускает отдельный браузер Playwright
 *  — перехватывает auth/licensing/dialog/reports-команды через Proxy на __TAURI_INTERNALS__
 *
 * ВАЖНО — Tauri v2 IPC:
 *   window.__TAURI_INTERNALS__.invoke определён как { writable: false, configurable: false }.
 *   Прямое присваивание invoke = newFn и Object.defineProperty на invoke НЕ РАБОТАЮТ.
 *   Единственный рабочий способ — заменить весь window.__TAURI_INTERNALS__ Proxy-объектом,
 *   который перехватывает доступ к .invoke через get-ловушку (page.evaluate после загрузки).
 *
 * Внимание: работает только на Windows (WebView2 → CDP).
 */

import { test as base, expect, chromium } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { DashboardPage, LibraryPage, ComparisonPage, ReportsPage, SettingsPage } from './pages';

type RheoTauriFixtures = {
    browser: Browser;
    context: BrowserContext;
    page: Page;
    dashboard: DashboardPage;
    library: LibraryPage;
    comparison: ComparisonPage;
    reports: ReportsPage;
    settings: SettingsPage;
};

const CDP_PORT = parseInt(process.env.TAURI_CDP_PORT || '9222', 10);

export const test = base.extend<RheoTauriFixtures>({
    // ── Переопределяем browser: подключаемся к Tauri через CDP ───────────
     
    browser: async ({}, use) => {
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
        await use(browser);
        // close() на CDP-подключении отключает Playwright, но не убивает приложение
        // (приложение убивает teardown-скрипт)
        await browser.close();
    },

    context: async ({ browser }, use) => {
        // В Tauri уже есть один контекст — используем его
        const ctx = browser.contexts()[0];
        await use(ctx);
        // Не закрываем — контекст принадлежит Tauri-процессу
    },

    page: async ({ browser }, use) => {
        const ctx = browser.contexts()[0];
        // Используем уже открытую страницу Tauri
        const pg = ctx.pages()[0] ?? await ctx.newPage();
        await use(pg);
    },

    // ── Fixtures — делегируем в page ─────────────────────────────────────
    dashboard:  async ({ page }, use) => { await use(new DashboardPage(page)); },
    library:    async ({ page }, use) => { await use(new LibraryPage(page)); },
    comparison: async ({ page }, use) => { await use(new ComparisonPage(page)); },
    reports:    async ({ page }, use) => { await use(new ReportsPage(page)); },
    settings:   async ({ page }, use) => { await use(new SettingsPage(page)); },
});

/**
 * Хук beforeEach для Tauri-режима.
 *
 * Отличия от браузерного setupBeforeEach:
 *  - Инжектируется auth-шим (оборачивает реальный __TAURI_INTERNALS__)
 *  - Никакого мока WASM/анализа — всё идёт в реальный Rust
 *  - Небольшое ожидание после навигации (Tauri app может реагировать чуть медленнее)
 */
export function setupBeforeEach(t: typeof test): void {
    t.beforeEach(async ({ page }) => {
        // 0. Attach console listener FIRST to forward page-side [E2E] messages to Node stdout.
        page.on('console', (msg) => {
            if (msg.text().includes('[E2E]')) {
                console.log(`[PAGE ${msg.type()}] ${msg.text()}`);
            }
        });

        // Ждём, пока WebView2 загрузит приложение (переходит из about:blank в tauri.localhost).
        // CDP-подключение готово раньше, чем страница отрендерена.
        // Retry loop: page.waitForFunction may fail if the page is still on about:blank
        // where script evaluation is not allowed (SecurityError).
        const maxWaitMs = 30_000;
        const deadline = Date.now() + maxWaitMs;
        let ready = false;
        while (!ready && Date.now() < deadline) {
            try {
                await page.waitForFunction(
                    () => window.location.href.includes('tauri') || window.location.href.includes('localhost'),
                    { timeout: Math.min(5_000, deadline - Date.now()) },
                );
                ready = true;
            } catch {
                // Page might still be on about:blank (SecurityError) — retry after a short delay
                await page.waitForTimeout(500);
            }
        }
        if (!ready) {
            // Final fallback: wait a fixed delay and hope the page is ready
            await page.waitForTimeout(3_000);
        }
        await page.waitForLoadState('domcontentloaded');

        // 1. Устанавливаем токен в localStorage немедленно (страница уже загружена при CDP).
        // Wrap in retry: even after waitForFunction, the page may briefly be on an
        // opaque origin (Edge WebView2 navigation) where localStorage is denied.
        let lsOk = false;
        for (let attempt = 0; attempt < 6 && !lsOk; attempt++) {
            try {
                await page.evaluate((token: string) => {
                    localStorage.setItem('rheolab_session_token', token);
                    localStorage.removeItem('comparison-storage');
                    // sessionStorage so the flag clears on app restart (no cross-session contamination)
                    sessionStorage.setItem('__e2e_skip_dialogs', '1');
                    // Ensure library always starts in grid view (cards, not table)
                    localStorage.setItem('rheolab-library-viewMode', 'grid');
                }, 'tauri-e2e-session-token');
                lsOk = true;
            } catch {
                await page.waitForTimeout(500);
            }
        }
        if (!lsOk) {
            console.warn('[tauri-e2e] ⚠ Could not set localStorage — page origin may be restricted');
        }

        // 5→2. IPC-прокси инжектируется ДО навигации, чтобы стартовый licensing check
        //      видел мок (developer license) и не открывал модальный диалог.
        //      ВАЖНО: window.__TAURI_INTERNALS__.invoke имеет {writable:false, configurable:false}
        //      — заменяем весь __TAURI_INTERNALS__ через Object.defineProperty с configurable:true.
        const patchResult = await page.evaluate(() => {
             
            const internals: any = (window as any).__TAURI_INTERNALS__;
            if (!internals) return 'no-internals';

            // ── Try to proxy window.__TAURI_INTERNALS__ ────────────────────
            if (internals.__e2eProxy) return 'already-proxied';
            const proxy = new Proxy(internals, {
                 
                get(target: any, prop: string | symbol) {
                    if (prop === '__e2eProxy') return true;
                    if (prop !== 'invoke') return target[prop];
                     
                    return async function e2eMockedInvoke(...args: any[]) {
                        const [cmd] = args;
                        const user = { id: 'tauri-e2e-admin', name: 'Tauri E2E Admin', email: 'admin', role: 'admin', isActive: true, laboratoryId: null };
                        const token = 'tauri-e2e-session-token';
                        if (cmd === 'auth_session')  return { valid: true, user };
                        if (cmd === 'auth_sign_in')   return { success: true, sessionToken: token, user };
                        if (cmd === 'auth_sign_out')  return undefined;
                        if (cmd === 'licensing_check' || cmd === 'licensing_get_status') return { status:'active', source:'key', features:{maxExperiments:-1,maxComparisonExperiments:10,calibrationAnalysis:true,calibrationParsing:true,comparison:true,exportPdf:true,exportExcel:true,aiParsing:true,watermark:false,chandler5550Support:true,bslR1Support:true}, key:'tauri-e2e-key', licenseType:'developer', customerName:'E2E Tauri', expiresAt:new Date(Date.now()+365*86400_000).toISOString(), daysRemaining:365, experimentsRemaining:-1, message:null, showWarning:false };
                        if (cmd === 'licensing_activate_full') return { status:'active', source:'key', features:{maxExperiments:-1,maxComparisonExperiments:10,calibrationAnalysis:true,calibrationParsing:true,comparison:true,exportPdf:true,exportExcel:true,aiParsing:true,watermark:false,chandler5550Support:true,bslR1Support:true}, key:'tauri-e2e-key', licenseType:'developer', customerName:'E2E Tauri', expiresAt:new Date(Date.now()+365*86400_000).toISOString(), daysRemaining:365, experimentsRemaining:-1, message:'Лицензия активирована', showWarning:false };
                        if (cmd === 'licensing_deactivate') return { status:'demo', source:'demo', features:{maxExperiments:5,maxComparisonExperiments:2,calibrationAnalysis:false,calibrationParsing:false,comparison:true,exportPdf:false,exportExcel:false,aiParsing:false,watermark:true,chandler5550Support:false,bslR1Support:false}, daysRemaining:30, experimentsRemaining:5, message:null, showWarning:false };
                        if (cmd === 'licensing_can_save') return true;
                        if (cmd === 'licensing_register_experiment') return { status:'active', source:'key', features:{maxExperiments:-1,maxComparisonExperiments:10,calibrationAnalysis:true,calibrationParsing:true,comparison:true,exportPdf:true,exportExcel:true,aiParsing:true,watermark:false,chandler5550Support:true,bslR1Support:true}, showWarning:false };
                        if (cmd === 'licensing_machine_id')        return 'tauri-e2e-machine';
                        if (cmd === 'licensing_was_ever_licensed') return true;
                        // Suppress StartupCheck AlertDialog — no real API keys in E2E DB
                        if (cmd === 'api_keys_check_active')      return { isValid: true, provider: 'groq', key: 'e2e-stub' };
                        if (cmd === 'api_keys_list')               return [];
                        if (cmd === 'plugin:dialog|save' || cmd === 'plugin:dialog|open' ||
                            cmd === 'plugin:dialog|ask'  || cmd === 'plugin:dialog|confirm') return null;
                        if (cmd === 'reports_generate_pdf')   return new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x34]).buffer;
                        if (cmd === 'reports_generate_excel') return new Uint8Array([0x50,0x4b,0x03,0x04]).buffer;
                        return target.invoke(...args);
                    };
                },
            });
            try {
                Object.defineProperty(window, '__TAURI_INTERNALS__', {
                    configurable: true, enumerable: true, writable: true, value: proxy,
                });
                return 'proxied-ok';
            } catch (_e: unknown) {
                // Object.defineProperty failed — __TAURI_INTERNALS__ is non-configurable.
                // Fallback: try to patch internals.invoke directly.
                try {
                    const origInvoke = internals.invoke.bind(internals);
                    internals.invoke = async function e2eDirectPatch(...args: any[]) {
                        const [cmd] = args;
                        const user = { id: 'tauri-e2e-admin', name: 'Tauri E2E Admin', email: 'admin', role: 'admin', isActive: true, laboratoryId: null };
                        const token = 'tauri-e2e-session-token';
                        const devLicense = { status:'active', source:'key', features:{maxExperiments:-1,maxComparisonExperiments:10,calibrationAnalysis:true,calibrationParsing:true,comparison:true,exportPdf:true,exportExcel:true,aiParsing:true,watermark:false,chandler5550Support:true,bslR1Support:true}, key:'tauri-e2e-key', licenseType:'developer', customerName:'E2E Tauri', expiresAt:new Date(Date.now()+365*86400_000).toISOString(), daysRemaining:365, experimentsRemaining:-1, message:null, showWarning:false };
                        if (cmd === 'auth_session')  return { valid: true, user };
                        if (cmd === 'auth_sign_in')   return { success: true, sessionToken: token, user };
                        if (cmd === 'auth_sign_out')  return undefined;
                        if (cmd === 'licensing_check' || cmd === 'licensing_get_status') return devLicense;
                        if (cmd === 'licensing_activate_full') return { ...devLicense, message:'Лицензия активирована' };
                        if (cmd === 'licensing_deactivate') return { status:'demo', source:'demo', features:{maxExperiments:5,maxComparisonExperiments:2,calibrationAnalysis:false,calibrationParsing:false,comparison:true,exportPdf:false,exportExcel:false,aiParsing:false,watermark:true,chandler5550Support:false,bslR1Support:false}, daysRemaining:30, experimentsRemaining:5, message:null, showWarning:false };
                        if (cmd === 'licensing_can_save') return true;
                        if (cmd === 'licensing_register_experiment') return { ...devLicense, showWarning:false };
                        if (cmd === 'licensing_machine_id') return 'tauri-e2e-machine';
                        if (cmd === 'licensing_was_ever_licensed') return true;
                        if (cmd === 'api_keys_check_active') return { isValid: true, provider: 'groq', key: 'e2e-stub' };
                        if (cmd === 'api_keys_list') return [];
                        if (cmd === 'plugin:dialog|save' || cmd === 'plugin:dialog|open' ||
                            cmd === 'plugin:dialog|ask'  || cmd === 'plugin:dialog|confirm') return null;
                        if (cmd === 'reports_generate_pdf') return new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x34]).buffer;
                        if (cmd === 'reports_generate_excel') return new Uint8Array([0x50,0x4b,0x03,0x04]).buffer;
                        return origInvoke(...args);
                    };
                    return 'invoke-patched';
                } catch (e2: unknown) {
                    return `invoke-patch-failed: ${String(e2)}`;
                }
            }
        });
        console.log('[E2E] Tauri IPC proxy patch result:', patchResult);

        // 3. Навигация к корню приложения через React Router (history API).
        //    ВАЖНО: CDP page.goto('https://tauri.localhost/') НЕ РАБОТАЕТ с WebView2 —
        //    `tauri.localhost` — виртуальный хост, доступный только из рендерера WebView2.
        //    Используем window.history API для SPA-навигации внутри уже загруженного React-приложения.
        await page.evaluate(() => {
            window.history.replaceState(null, '', '/');
            window.dispatchEvent(new PopStateEvent('popstate'));
        });
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1_500);

        // 4. Убеждаемся, что мы на dashboard
        if (!page.url().includes('/dashboard')) {
            await page.evaluate(() => {
                window.history.pushState(null, '', '/dashboard');
                window.dispatchEvent(new PopStateEvent('popstate'));
            });
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(1_500);
        }

        // 5. Force license store refresh so it picks up the mocked IPC proxy response
        //    (the real backend may have already initialized the store before CDP connected).
        //    Retry up to 3 times: the store may not yet be exposed on window if React
        //    is still hydrating.
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const refreshed = await page.evaluate(() => {
                    const store = (window as any).__rheolab_license_store;
                    if (!store) return false;
                    // Direct state override — bypass IPC entirely since the proxy
                    // cannot intercept Tauri v2's frozen __TAURI_INTERNALS__.invoke.
                    const devFeatures = {
                        maxExperiments: -1,
                        maxComparisonExperiments: 10,
                        calibrationAnalysis: true,
                        calibrationParsing: true,
                        comparison: true,
                        exportPdf: true,
                        exportExcel: true,
                        aiParsing: true,
                        watermark: false,
                        chandler5550Support: true,
                        bslR1Support: true,
                    };
                    store.setState({
                        result: {
                            status: 'active',
                            source: 'key',
                            key: 'tauri-e2e-key',
                            license: {
                                id: '',
                                type: 'developer',
                                customerName: 'E2E Tauri',
                                issuedAt: new Date(),
                                expiresAt: new Date(Date.now() + 365 * 86400_000),
                                gracePeriodDays: 30,
                                features: devFeatures,
                            },
                            daysRemaining: 365,
                            experimentsRemaining: -1,
                            message: null,
                            showWarning: false,
                        },
                        isInitialized: true,
                        isLoading: false,
                        status: 'active',
                        isDemo: false,
                        isExpired: false,
                        isActive: true,
                        daysRemaining: 365,
                        experimentsRemaining: -1,
                    });
                    return true;
                });
                if (refreshed) {
                    console.log('[E2E] License store overridden with developer license');
                    break;
                }
            } catch { /* ignore */ }
            await page.waitForTimeout(500);
        }

        // 6. Закрываем любой открытый licensing/startup/AlertDialog диалог
        //    (на случай, если он появился до инжекции прокси при первом запуске приложения).
        try {
            // Match both Radix Dialog overlay and AlertDialog overlay
            const overlay = page.locator('[data-state="open"].fixed.inset-0').first();
            if (await overlay.isVisible({ timeout: 800 })) {
                // Try clicking the AlertDialogAction ("Понятно") button if present
                const actionBtn = page.locator('[role="alertdialog"] button, [data-state="open"] button').first();
                if (await actionBtn.isVisible({ timeout: 300 }).catch(() => false)) {
                    await actionBtn.click();
                    await page.waitForTimeout(500);
                } else {
                    await page.keyboard.press('Escape');
                    await page.waitForTimeout(500);
                }
            }
            // If LicenseGuard is still blocking (unclosable Dialog), force-dismiss via JS
            const stillBlocked = page.locator('[data-state="open"].fixed.inset-0').first();
            if (await stillBlocked.isVisible({ timeout: 300 }).catch(() => false)) {
                await page.evaluate(() => {
                    // Remove all Radix overlay portals
                    document.querySelectorAll('[data-radix-portal]').forEach(el => el.remove());
                });
                await page.waitForTimeout(300);
            }
        } catch {
            // ignore — диалога нет
        }
    });
}

export { expect };
