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
type TauriInvoke = (cmd: string, args?: unknown) => Promise<unknown>;

// Minimal fixture: connects to Tauri via CDP, injects only auth/dialog mocks.
// Licensing IPC flows through to real Rust.
const test = base.extend<{ page: Page }>({
     
    page: async ({}, use) => {
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
        const ctx = browser.contexts()[0];

        // Find the actual Tauri page (has __TAURI_INTERNALS__). In long combined
        // E2E runs WebView2 may spawn internal pages like `edge://downloads/hub`
        // (auto-updater triggers download UI), so `pages()[0]` is not reliable.
        async function findTauriPage(): Promise<Page> {
            const candidates = ctx.pages();
            console.log(`[E2E] Licensing fixture: found ${candidates.length} pages in context`);
            for (const candidate of candidates) {
                const url = candidate.url();
                console.log(`[E2E] Licensing fixture:   candidate URL=${url}`);
                // Skip internal WebView2 / Edge pages immediately.
                if (url.startsWith('edge://') || url.startsWith('chrome://') || url.startsWith('about:')) {
                    continue;
                }
                try {
                    const hasInternals = await candidate.evaluate(
                        () => typeof (window as any).__TAURI_INTERNALS__ !== 'undefined',
                    );
                    if (hasInternals) return candidate;
                } catch {
                    // Non-responsive page — skip.
                }
            }
            // Fallback: first non-internal page or a fresh page.
            const firstNonInternal = candidates.find((p) => {
                const u = p.url();
                return !u.startsWith('edge://') && !u.startsWith('chrome://') && !u.startsWith('about:');
            });
            return firstNonInternal ?? candidates[0] ?? (await ctx.newPage());
        }

        const pg = await findTauriPage();
        console.log(`[E2E] Licensing fixture: selected page URL=${pg.url()}`);

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

        // Capture the real, unmocked invoke and expose it on a stable slot.
        // If base-test.tauri.ts ran earlier, it already stored the original
        // bound invoke at `window.__e2eRealTauriInvoke`. Otherwise we capture
        // here *before* any proxy wraps __TAURI_INTERNALS__.
        //
        // We also register a minimal auth/dialog shim at `window.__e2eLicensingInvoke`
        // so the tests can call real Rust licensing commands while keeping
        // auth/dialog stubbed out (tests shouldn't trip the login gate).
        //
        // In combined E2E runs the page may have been navigated or reloaded
        // by previous specs. If __TAURI_INTERNALS__ is missing after an
        // initial wait, force a reload to re-inject the Tauri init script.
        const currentUrl = pg.url();
        console.log(`[E2E] Licensing fixture: current URL=${currentUrl}`);

        let setupResult: { ok: boolean; reason: string; [k: string]: unknown } = await pg.evaluate(async () => {
            // Poll for __TAURI_INTERNALS__ availability (up to 3s).
            const deadline = Date.now() + 3_000;
            while (Date.now() < deadline) {
                const it: any = (window as any).__TAURI_INTERNALS__;
                if (it && typeof it.invoke === 'function') break;
                await new Promise((r) => setTimeout(r, 100));
            }
            const internals: any = (window as any).__TAURI_INTERNALS__;
            return {
                ok: !!internals && typeof internals.invoke === 'function',
                reason: 'pre-check',
                url: window.location.href,
            };
        });

        // If internals are missing, reload the page to force re-injection.
        if (!setupResult.ok) {
            console.log('[E2E] Licensing fixture: __TAURI_INTERNALS__ missing, reloading page...');
            try {
                await pg.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
                // Give Tauri a moment to re-inject the init script.
                await pg.waitForTimeout(1_000);
            } catch (e) {
                console.log(`[E2E] Licensing fixture: reload failed — ${(e as Error).message}`);
            }
        }

        setupResult = await pg.evaluate(async () => {
            // Poll for __TAURI_INTERNALS__ availability (up to 10s post-reload).
            const deadline = Date.now() + 10_000;
            while (Date.now() < deadline) {
                const it: any = (window as any).__TAURI_INTERNALS__;
                if (it && typeof it.invoke === 'function') break;
                await new Promise((r) => setTimeout(r, 100));
            }

            const internals: any = (window as any).__TAURI_INTERNALS__;
            if (!internals || typeof internals.invoke !== 'function') {
                return {
                    ok: false,
                    reason: 'no-tauri-internals',
                    url: window.location.href,
                    hasInternals: !!internals,
                    invokeType: internals ? typeof internals.invoke : 'n/a',
                };
            }

            // Prefer the reference stashed by base-test.tauri.ts; otherwise capture now.
            // Note: if base-fixture already wrapped invoke with a mock, this could
            // capture the mock. So ALWAYS try to read the original invoke from the
            // prototype chain first (unmocked Tauri exposes it on the prototype).
            if (!(window as any).__e2eRealTauriInvoke) {
                let raw: unknown = internals.invoke;
                // If __e2eProxy is present, base-fixture already proxied. The
                // target of the proxy should still have original invoke on it.
                if (internals.__e2eProxy) {
                    const proto = Object.getPrototypeOf(internals);
                    const protoInvoke = proto && proto.invoke;
                    if (typeof protoInvoke === 'function') raw = protoInvoke;
                }
                if (typeof raw === 'function') {
                    (window as any).__e2eRealTauriInvoke = (raw as TauriInvoke).bind(internals);
                }
            }

            const realInvoke = (window as any).__e2eRealTauriInvoke;
            if (!realInvoke) return { ok: false, reason: 'no-real-invoke' };

            (window as any).__e2eLicensingInvoke = async function (cmd: string, args?: unknown) {
                const user = {
                    id: 'tauri-e2e-admin', name: 'E2E Admin', email: 'admin',
                    role: 'admin', isActive: true, laboratoryId: null,
                };
                if (cmd === 'auth_session') return { valid: true, user };
                if (cmd === 'auth_sign_in') return { success: true, sessionToken: 'e2e', user };
                if (cmd === 'auth_sign_out') return undefined;
                if (typeof cmd === 'string' && cmd.startsWith('plugin:dialog|')) return null;
                // Real Rust for everything else (including all licensing_* commands).
                return realInvoke(cmd, args);
            };

            return { ok: true, reason: 'installed' };
        });
        console.log(`[E2E] Licensing fixture setup: ${JSON.stringify(setupResult)}`);

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
            const invoke = (window as any).__e2eLicensingInvoke;
            if (typeof invoke !== 'function') return { error: 'no __e2eLicensingInvoke' };
            try {
                return await invoke('licensing_check');
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
            await (window as any).__e2eLicensingInvoke('licensing_check');
        });

        const result = await page.evaluate(async () => {
            const invoke = (window as any).__e2eLicensingInvoke;
            try {
                return await invoke('licensing_get_status');
            } catch (e: any) {
                return { error: e?.message || String(e) };
            }
        });

        expect(result).not.toBeNull();
        expect(result).toHaveProperty('status');
        expect(result).toHaveProperty('features');

        // Both commands should return the same status
        const checkResult = await page.evaluate(async () => {
            return await (window as any).__e2eLicensingInvoke('licensing_check');
        });
        expect((result as { status: string }).status).toBe((checkResult as { status: string }).status);
    });

    test('licensing_machine_id returns a non-empty string', async ({ page }) => {
        const machineId = await page.evaluate(async () => {
            try {
                return await (window as any).__e2eLicensingInvoke('licensing_machine_id');
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
            return await (window as any).__e2eLicensingInvoke('licensing_check');
        }) as { features: Record<string, unknown> };

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
                return await (window as any).__e2eLicensingInvoke('licensing_was_ever_licensed');
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
                return await (window as any).__e2eLicensingInvoke('licensing_can_save');
            } catch (e: any) {
                return { error: e?.message || String(e) };
            }
        });

        expect(typeof result).toBe('boolean');
    });
});
