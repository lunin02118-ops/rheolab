/**
 * E2E — Real Native PDF & Excel Export (no mocks)
 *
 * Runs against a LIVE Tauri app with real Typst/Excel generation.
 * Unlike reports-export.spec.ts (browser mode, mocked IPC), this test
 * exercises the full Rust report pipeline end-to-end.
 *
 * Prerequisites:
 *   - Tauri app launched WITHOUT RHEOLAB_E2E_MOCK_REPORTS
 *   - CDP port accessible (default 9222)
 *
 * Run:
 *   FULL_EXPORT=1 npx playwright test --config playwright.tauri.config.ts \
 *     tests/e2e/reports/real-native-export.tauri.spec.ts
 */

import { test, expect } from '../base-test.tauri';
import { CHANDLER_SST_63 } from '../fixtures';
import fs from 'fs';

// Skip unless FULL_EXPORT=1 — real Typst compilation takes 5+ minutes at debug opt-level
test.skip(() => process.env.FULL_EXPORT !== '1', 'FULL_EXPORT=1 required for real native export');

// Each test can take several minutes (Typst compilation at opt-level=0)
test.setTimeout(600_000);

/**
 * Setup: navigate to app, inject auth/licensing mocks (but NOT reports),
 * then load a fixture file.
 */
test.beforeEach(async ({ page }) => {
  // Wait for Tauri app to be ready
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (!ready && Date.now() < deadline) {
    try {
      await page.waitForFunction(
        () => window.location.href.includes('tauri') || window.location.href.includes('localhost'),
        { timeout: Math.min(5_000, deadline - Date.now()) },
      );
      ready = true;
    } catch {
      await page.waitForTimeout(500);
    }
  }
  await page.waitForLoadState('domcontentloaded');

  // Set session token
  await page.evaluate((token: string) => {
    localStorage.setItem('rheolab_session_token', token);
    localStorage.removeItem('comparison-storage');
    // sessionStorage so the flag clears on app restart (no cross-session contamination)
    sessionStorage.setItem('__e2e_skip_dialogs', '1');
  }, 'tauri-e2e-session-token');

  // IPC proxy: mock auth/licensing/dialog but let reports through to real Rust
  await page.evaluate(() => {
    const internals: any = (window as any).__TAURI_INTERNALS__;
    if (!internals || internals.__e2eProxy) return;

    const proxy = new Proxy(internals, {
      get(target: any, prop: string | symbol) {
        if (prop === '__e2eProxy') return true;
        if (prop !== 'invoke') return target[prop];

        return async function realExportInvoke(...args: any[]) {
          const [cmd] = args;
          const user = { id: 'tauri-e2e-admin', name: 'E2E Admin', email: 'admin', role: 'admin', isActive: true, laboratoryId: null };
          const devLicense = { status: 'active', source: 'key', features: { maxExperiments: -1, maxComparisonExperiments: 10, calibrationAnalysis: true, calibrationParsing: true, comparison: true, exportPdf: true, exportExcel: true, aiParsing: true, watermark: false, chandler5550Support: true, bslR1Support: true }, key: 'e2e-key', licenseType: 'developer', customerName: 'E2E', expiresAt: new Date(Date.now() + 365 * 86400_000).toISOString(), daysRemaining: 365, experimentsRemaining: -1, message: null, showWarning: false };

          if (cmd === 'auth_session') return { valid: true, user };
          if (cmd === 'auth_sign_in') return { success: true, sessionToken: 'tauri-e2e-session-token', user };
          if (cmd === 'auth_sign_out') return undefined;
          if (cmd === 'licensing_check' || cmd === 'licensing_get_status') return devLicense;
          if (cmd === 'licensing_activate_full') return { ...devLicense, message: 'Activated' };
          if (cmd === 'licensing_deactivate') return { status: 'demo', source: 'demo', features: { maxExperiments: 5, maxComparisonExperiments: 2, calibrationAnalysis: false, calibrationParsing: false, comparison: true, exportPdf: false, exportExcel: false, aiParsing: false, watermark: true, chandler5550Support: false, bslR1Support: false }, daysRemaining: 30, experimentsRemaining: 5, message: null, showWarning: false };
          if (cmd === 'licensing_can_save') return true;
          if (cmd === 'licensing_register_experiment') return { ...devLicense, showWarning: false };
          if (cmd === 'licensing_machine_id') return 'tauri-e2e-machine';
          if (cmd === 'licensing_was_ever_licensed') return true;
          if (cmd === 'api_keys_check_active') return { isValid: true, provider: 'groq', key: 'e2e-stub' };
          if (cmd === 'api_keys_list') return [];
          if (cmd === 'plugin:dialog|save' || cmd === 'plugin:dialog|open' ||
              cmd === 'plugin:dialog|ask'  || cmd === 'plugin:dialog|confirm') return null;

          // Reports commands are NOT mocked — real Rust generation
          return target.invoke(...args);
        };
      },
    });

    try {
      Object.defineProperty(window, '__TAURI_INTERNALS__', {
        configurable: true, enumerable: true, writable: true, value: proxy,
      });
    } catch {
      // Fallback not needed for real export test — skip
    }
  });

  // Navigate to app root
  await page.goto('https://tauri.localhost/', { waitUntil: 'domcontentloaded' });
});

test.describe('Real Native Export', () => {
  test('PDF has valid size and magic bytes', async ({ page, dashboard, reports }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await reports.goto();
    await reports.expectPdfButtonVisible();

    const download = await reports.downloadPdf();
    const filePath = await download.path();
    expect(filePath).toBeTruthy();

    const buffer = fs.readFileSync(filePath!);
    // Real PDF must be > 1 KB (mock returns only 8 bytes)
    expect(buffer.length).toBeGreaterThan(1024);
    // Magic bytes: %PDF
    expect(buffer.slice(0, 4).toString('ascii')).toBe('%PDF');
  });

  test('Excel has valid size and magic bytes', async ({ page, dashboard, reports }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await reports.goto();
    await reports.expectExcelButtonVisible();

    const download = await reports.downloadExcel();
    const filePath = await download.path();
    expect(filePath).toBeTruthy();

    const buffer = fs.readFileSync(filePath!);
    // Real XLSX must be > 1 KB (mock returns only 4 bytes)
    expect(buffer.length).toBeGreaterThan(1024);
    // Magic bytes: PK (ZIP container)
    expect(buffer.slice(0, 2).toString('ascii')).toBe('PK');
  });
});
