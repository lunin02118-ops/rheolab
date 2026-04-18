/**
 * Real Licensing IPC E2E Tests (A.4)
 *
 * Unlike all other Tauri E2E tests, this spec does NOT mock licensing IPC commands.
 * It exercises the real Rust LicenseEngine pipeline (HMAC + RSA verification)
 * to verify the license status returned by the actual backend.
 *
 * The app is started with RHEOLAB_E2E_SKIP_LICENSE_GATE=1 (standard e2e setup)
 * so save/export operations are not blocked, but licensing_check/licensing_get_status
 * commands go through the full verification pipeline including:
 *   - HMAC signature verification of the DB record
 *   - RSA server-signature verification (if signedPayload present)
 *   - Legacy grace period checks (activatedAt age validation)
 *   - Expiry and grace period calculations
 *
 * Run: npx playwright test tests/e2e/licensing/ --config playwright.tauri.config.ts
 */

import { test as base, expect, chromium } from '@playwright/test';
import type { Page } from '@playwright/test';

const CDP_PORT = parseInt(process.env.TAURI_CDP_PORT || '9222', 10);

// Minimal fixture: connects to Tauri via CDP, injects only auth/dialog mocks.
// Licensing IPC flows through to real Rust.
const test = base.extend<{ page: Page }>({
     
    page: async ({}, use) => {
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
        const ctx = browser.contexts()[0];
        const pg = ctx.pages()[0] ?? await ctx.newPage();

        // Wait for Tauri page to load
        const maxWaitMs = 30_000;
        const deadline = Date.now() + maxWaitMs;
        let ready = false;
        while (!ready && Date.now() < deadline) {
            try {
                await pg.waitForFunction(
                    () => window.location.href.includes('tauri') || window.location.href.includes('localhost'),
                    { timeout: Math.min(5_000, deadline - Date.now()) },
                );
                ready = true;
            } catch {
                await pg.waitForTimeout(500);
            }
        }
        await pg.waitForLoadState('domcontentloaded');

        // Inject PARTIAL IPC proxy: only auth + dialogs — licensing passes through to Rust.
        await pg.evaluate(() => {
            const internals: any = (window as any).__TAURI_INTERNALS__;
            if (!internals || internals.__e2eLicenseTestProxy) return;

            const proxy = new Proxy(internals, {
                get(target: any, prop: string | symbol) {
                    if (prop === '__e2eLicenseTestProxy') return true;
                    if (prop !== 'invoke') return target[prop];

                    return async function e2eLicenseTestInvoke(...args: any[]) {
                        const [cmd] = args;
                        const user = {
                            id: 'tauri-e2e-admin', name: 'E2E Admin', email: 'admin',
                            role: 'admin', isActive: true, laboratoryId: null,
                        };
                        // Only mock auth and dialogs — everything else goes to real Rust
                        if (cmd === 'auth_session') return { valid: true, user };
                        if (cmd === 'auth_sign_in') return { success: true, sessionToken: 'e2e', user };
                        if (cmd === 'auth_sign_out') return undefined;
                        if (cmd?.startsWith('plugin:dialog|')) return null;

                        // ALL licensing commands pass through to real Rust IPC
                        return target.invoke(...args);
                    };
                },
            });

            try {
                Object.defineProperty(window, '__TAURI_INTERNALS__', {
                    configurable: true, enumerable: true, writable: true, value: proxy,
                });
            } catch {
                // Fallback: direct patch (same pattern as base-test.tauri.ts)
                const origInvoke = internals.invoke.bind(internals);
                internals.invoke = async function (...args: any[]) {
                    const [cmd] = args;
                    const user = {
                        id: 'tauri-e2e-admin', name: 'E2E Admin', email: 'admin',
                        role: 'admin', isActive: true, laboratoryId: null,
                    };
                    if (cmd === 'auth_session') return { valid: true, user };
                    if (cmd === 'auth_sign_in') return { success: true, sessionToken: 'e2e', user };
                    if (cmd === 'auth_sign_out') return undefined;
                    if (cmd?.startsWith('plugin:dialog|')) return null;
                    return origInvoke(...args);
                };
            }
        });

        await use(pg);
        await browser.close();
    },
});

test.describe('Real Licensing IPC (no mocks)', () => {

    test('licensing_check returns valid response from Rust', async ({ page }) => {
        // Call the real licensing_check command via Tauri IPC.
        // This exercises the full LicenseEngine::check() pipeline:
        //   DB read → HMAC verify → RSA verify → expiry check → feature resolution
        // We use licensing_check (not licensing_get_status) because it is the
        // authoritative source that always reads from DB, while get_status may
        // return null if no cache is populated yet.
        const result = await page.evaluate(async () => {
            const internals = (window as any).__TAURI_INTERNALS__;
            if (!internals?.invoke) return { error: 'no __TAURI_INTERNALS__' };
            try {
                return await internals.invoke('licensing_check');
            } catch (e: any) {
                return { error: e?.message || String(e) };
            }
        });

        // Verify response structure matches LicenseCheckResult from Rust
        expect(result).toBeDefined();
        expect(result).toHaveProperty('status');
        expect(result).toHaveProperty('features');

        // Status must be one of the valid enum values
        const validStatuses = ['active', 'expired', 'grace', 'demo', 'demo_expired', 'invalid', 'revoked'];
        expect(validStatuses).toContain(result.status);

        // Features must be an object with expected boolean fields
        const features = result.features;
        expect(features).toHaveProperty('exportPdf');
        expect(features).toHaveProperty('exportExcel');
        expect(features).toHaveProperty('watermark');
        expect(features).toHaveProperty('comparison');
        expect(typeof features.exportPdf).toBe('boolean');
        expect(typeof features.watermark).toBe('boolean');

        console.log(`[E2E] Real licensing status: ${result.status}, type: ${result.licenseType || 'N/A'}`);
    });

    test('licensing_get_status is populated after licensing_check', async ({ page }) => {
        // licensing_get_status returns the cached result. After licensing_check
        // has been called, the cache should be populated and return the same status.
        // First ensure cache is populated:
        await page.evaluate(async () => {
            await (window as any).__TAURI_INTERNALS__.invoke('licensing_check');
        });

        const result = await page.evaluate(async () => {
            const internals = (window as any).__TAURI_INTERNALS__;
            try {
                return await internals.invoke('licensing_get_status');
            } catch (e: any) {
                return { error: e?.message || String(e) };
            }
        });

        expect(result).not.toBeNull();
        expect(result).toHaveProperty('status');
        expect(result).toHaveProperty('features');

        // Both commands should return the same status
        const checkResult = await page.evaluate(async () => {
            return await (window as any).__TAURI_INTERNALS__.invoke('licensing_check');
        });
        expect(result.status).toBe(checkResult.status);
    });

    test('licensing_machine_id returns a non-empty string', async ({ page }) => {
        const machineId = await page.evaluate(async () => {
            try {
                return await (window as any).__TAURI_INTERNALS__.invoke('licensing_machine_id');
            } catch (e: any) {
                return { error: e?.message || String(e) };
            }
        });

        expect(typeof machineId).toBe('string');
        expect((machineId as string).length).toBeGreaterThan(0);
        console.log(`[E2E] Machine ID: ${machineId}`);
    });

    test('licensing features shape matches TypeScript types', async ({ page }) => {
        // Verify the features object has ALL expected fields — catches Rust/TS drift.
        const result = await page.evaluate(async () => {
            return await (window as any).__TAURI_INTERNALS__.invoke('licensing_check');
        });

        const features = result.features;
        const expectedKeys = [
            'maxExperiments',
            'maxComparisonExperiments',
            'calibrationAnalysis',
            'calibrationParsing',
            'comparison',
            'exportPdf',
            'exportExcel',
            'aiParsing',
            'watermark',
            'chandler5550Support',
            'bslR1Support',
        ];

        for (const key of expectedKeys) {
            expect(features).toHaveProperty(key);
        }

        // Numeric fields
        expect(typeof features.maxExperiments).toBe('number');
        expect(typeof features.maxComparisonExperiments).toBe('number');

        // Boolean fields
        for (const key of expectedKeys.filter(k => k !== 'maxExperiments' && k !== 'maxComparisonExperiments')) {
            expect(typeof features[key]).toBe('boolean');
        }
    });

    test('licensing_was_ever_licensed returns boolean', async ({ page }) => {
        const result = await page.evaluate(async () => {
            try {
                return await (window as any).__TAURI_INTERNALS__.invoke('licensing_was_ever_licensed');
            } catch (e: any) {
                return { error: e?.message || String(e) };
            }
        });

        expect(typeof result).toBe('boolean');
    });

    test('licensing_can_save returns boolean', async ({ page }) => {
        // This command checks whether the user can save an experiment.
        // With RHEOLAB_E2E_SKIP_LICENSE_GATE=1, it should return true.
        const result = await page.evaluate(async () => {
            try {
                return await (window as any).__TAURI_INTERNALS__.invoke('licensing_can_save');
            } catch (e: any) {
                return { error: e?.message || String(e) };
            }
        });

        expect(typeof result).toBe('boolean');
    });
});
