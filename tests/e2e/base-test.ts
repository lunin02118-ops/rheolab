/**
 * Shared Playwright test fixture for RealLab Enterprise V2 E2E tests.
 *
 * Strategy:
 * - File parsing uses **real WASM** engine (no mocks) — tests upload real
 *   fixture files from `tests/fixtures/` via `input[type="file"]`.
 * - Tauri IPC is mocked only for commands that need a Rust backend:
 *   auth, experiments CRUD, reagents, settings, backups, etc.
 * - Demo file buttons won't work (they need `/api/test-fixtures`).
 *   All tests use `dashboard.uploadFile(fixture)` instead.
 *
 * Usage:
 *   import { test, expect } from '../base-test';
 *   test('my test', async ({ dashboard }) => {
 *     await dashboard.uploadFile(CHANDLER_SST_63);
 *     await dashboard.waitForAnalysis();
 *   });
 */

import { test as base, expect } from '@playwright/test';
import { setupTestLicense } from './utils';
import { DashboardPage, LibraryPage, ComparisonPage, ReportsPage, SettingsPage } from './pages';

/** Extended test context with page objects */
type RheoTestFixtures = {
  dashboard: DashboardPage;
  library: LibraryPage;
  comparison: ComparisonPage;
  reports: ReportsPage;
  settings: SettingsPage;
};

export const test = base.extend<RheoTestFixtures>({
  dashboard: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },
  library: async ({ page }, use) => {
    await use(new LibraryPage(page));
  },
  comparison: async ({ page }, use) => {
    await use(new ComparisonPage(page));
  },
  reports: async ({ page }, use) => {
    await use(new ReportsPage(page));
  },
  settings: async ({ page }, use) => {
    await use(new SettingsPage(page));
  },
});

// ── Tauri IPC mock for browser-based E2E tests ──────────────────────

const E2E_MOCK_USER = {
  id: 'e2e-admin-id',
  name: 'E2E Admin',
  email: 'admin',
  role: 'admin',
  isActive: true,
  laboratoryId: null,
};

// No mock fixture list or parse function — parsing is done by the native Rust engine via Tauri IPC.

/**
 * Inject a mock `window.__TAURI_INTERNALS__` so that `@tauri-apps/api/core`
 * `invoke()` resolves for experiment CRUD and infrastructure commands.
 * Parsing/fixture commands are intentionally REJECTED — the app falls through
 * to the native Rust engine via Tauri IPC.
 */
async function mockTauriIPC(page: import('@playwright/test').Page) {
  await page.addInitScript(
    (data) => {
      const { user, fakeParse } = data;

      // Persisted experiment store — survives page.goto() navigations
      // Uses localStorage so experiments saved in beforeEach survive
      // client-side and server-side navigations within the same test.
      const STORE_KEY = '__e2e_experiments__';
      const loadExperiments = (): any[] => {
        try {
          const raw = localStorage.getItem(STORE_KEY);
          return raw ? JSON.parse(raw) : [];
        } catch { return []; }
      };
      const saveExperiments = (exps: any[]) => {
        localStorage.setItem(STORE_KEY, JSON.stringify(exps));
      };
      const experiments: any[] = loadExperiments();

      // Signal to saveBlob to use browser download instead of Tauri save dialog.
      // sessionStorage so the flag clears on app restart (no cross-session contamination).
      sessionStorage.setItem('__e2e_skip_dialogs', '1');

      const callbacks: Record<number, (...args: unknown[]) => unknown> = {};
      let nextId = 1;

      (window as any).__TAURI_INTERNALS__ = {
        transformCallback(cb: (...args: unknown[]) => unknown, _once?: boolean) {
          const id = nextId++;
          callbacks[id] = cb;
          return id;
        },
        unregisterCallback(id: number) {
          delete callbacks[id];
        },
        invoke(cmd: string, args?: any) {
          // ── Parsing — REJECT so app falls through to WASM ──
          if (cmd === 'parsing_parse_file') {
            if (fakeParse) {
              const filename = args?.request?.filename || args?.filename || 'e2e-fixture.csv';
              const isForceAi = !!(args?.request?.forceAi || args?.forceAi);
              const pointCount = 180;
              const dataPoints = Array.from({ length: pointCount }, (_unused, index) => {
                const time = index * 5;
                const wave = Math.sin(index / 18) * 8;
                return {
                  time_sec: time,
                  viscosity_cp: Math.max(10, 120 - index * 0.35 + wave),
                  temperature_c: 25 + Math.sin(index / 25),
                  speed_rpm: 300,
                  shear_rate_s1: 180 + index * 0.6,
                  shear_stress_pa: 40 + index * 0.4,
                  pressure_bar: 1.5,
                };
              });
              return Promise.resolve({
                success: true,
                source: isForceAi ? 'ai' : 'regex',
                data: dataPoints,
                metadata: {
                  filename,
                  sheetName: 'E2E',
                  instrumentType: 'Mocked',
                  geometry: 'R1B1',
                  usedAI: isForceAi,
                  testDate: new Date().toISOString(),
                },
                summary: {
                  pointCount,
                  timeRange: {
                    start: 0,
                    end: (pointCount - 1) * 5,
                    durationMinutes: ((pointCount - 1) * 5) / 60,
                  },
                  viscosityRange: {
                    min: 40,
                    max: 130,
                    avg: 86,
                  },
                  temperatureRange: {
                    min: 24,
                    max: 26,
                    avg: 25,
                  },
                  pressureRange: {
                    min: 1.5,
                    max: 1.5,
                  },
                },
              });
            }
            return Promise.reject(new Error('Not running in Tauri – use WASM'));
          }
          if (cmd === 'test_fixtures_list')
            return Promise.resolve({ success: true, fixtures: [], count: 0 });
          if (cmd === 'test_fixtures_read')
            return Promise.reject(new Error('Not running in Tauri – use WASM'));
          if (cmd === 'test_fixtures_parse')
            return Promise.reject(new Error('Not running in Tauri – use WASM'));

          // ── Experiments (in-memory store with sessionStorage persistence) ──
          if (cmd === 'experiments_list' || cmd === 'load_all_experiments' || cmd === 'list_experiments') {
            const items = experiments.map((e: any) => ({
              id: e.id,
              name: e.name || '',
              testDate: e.testDate || e.test_date || new Date().toISOString(),
              fluidType: e.fluidType || e.fluid_type || 'Linear',
              fieldName: e.fieldName || e.field_name || '',
              operatorName: e.operatorName || e.operator_name || '',
              wellNumber: e.wellNumber || e.well_number || '',
              waterSource: e.waterSource || e.water_source || '',
              instrumentType: e.instrumentType || e.instrument_type || 'Unknown',
              geometry: e.geometry || 'R1B1',
              maxViscosity: e.maxViscosity ?? e.max_viscosity ?? null,
              reagents: e.reagents || [],
              user: { id: user.id, name: user.name },
              laboratory: null,
              createdAt: e.createdAt || e.created_at || new Date().toISOString(),
            }));
            return Promise.resolve({
              experiments: items,
              pagination: { page: 1, limit: 50, total: items.length, totalPages: 1 },
            });
          }
          if (cmd === 'experiments_count')
            return Promise.resolve({ count: experiments.length });
          if (cmd === 'experiments_get' || cmd === 'load_experiment') {
            const id = args?.id || args?.experimentId;
            const found = experiments.find((e: any) => e.id === id);
            return found
              ? Promise.resolve({ success: true, experiment: found })
              : Promise.resolve({ success: false, error: 'Not found' });
          }
          if (cmd === 'experiments_save' || cmd === 'save_experiment') {
            const id = 'e2e-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
            const payload = args?.payload || args?.experiment || args?.request || args || {};
            // When WASM returns columnarData, parseResult.data is [] to save memory.
            // Inject minimal fake rawPoints so the comparison chart has data to render.
            if (!Array.isArray(payload.rawPoints) || payload.rawPoints.length === 0) {
              payload.rawPoints = Array.from({ length: 20 }, (_: unknown, i: number) => ({
                time_sec: i * 30,
                viscosity_cp: Math.max(10, 120 - i * 4 + Math.sin(i) * 8),
                temperature_c: 25 + i * 0.5,
                speed_rpm: 300,
                shear_rate_s1: 180 + i * 2,
                shear_stress_pa: 40 + i * 1.5,
                pressure_bar: 1.5,
              }));
            }
            experiments.push({ ...payload, id, created_at: new Date().toISOString() });
            try { saveExperiments(experiments); } catch (e) { console.warn('[E2E] saveExperiments failed:', e); }
            return Promise.resolve({ success: true, experimentId: id });
          }
          if (cmd === 'experiments_delete' || cmd === 'delete_experiment') {
            const id = args?.id || args?.experimentId;
            const idx = experiments.findIndex((e: any) => e.id === id);
            if (idx >= 0) experiments.splice(idx, 1);
            saveExperiments(experiments);
            return Promise.resolve({ success: true });
          }
          if (cmd === 'experiments_filter_metadata')
            return Promise.resolve({ instrumentTypes: [], fluidTypes: [], geometries: [], reagentNames: [], laboratoryNames: [], fieldNames: [], waterSources: [] });
          if (cmd === 'experiments_last_context')
            return Promise.resolve(null);
          if (cmd === 'experiments_export_laboratories')
            return Promise.resolve([]);
          if (cmd === 'experiments_export_to_file')
            return Promise.resolve({ success: true, filePath: '/tmp/mock.json', fileName: 'mock.json', total: 0, exportedAt: new Date().toISOString() });
          if (cmd === 'experiments_import')
            return Promise.resolve({ success: true, imported: 0 });
          if (cmd === 'experiments_water_sources')
            return Promise.resolve([]);

          // ── Reagents ──
          if (cmd === 'reagents_list' || cmd === 'load_reagents')
            return Promise.resolve([]);
          if (cmd === 'reagents_create' || cmd === 'save_reagent')
            return Promise.resolve({ success: true, id: 'reagent-e2e' });
          if (cmd === 'reagents_update')
            return Promise.resolve({ success: true });
          if (cmd === 'reagents_delete')
            return Promise.resolve({ success: true });
          if (cmd === 'reagents_export')
            return Promise.resolve({ success: true, data: '[]' });
          if (cmd === 'reagents_import')
            return Promise.resolve({ success: true, imported: 0 });
          if (cmd === 'reagents_seed')
            return Promise.resolve({ success: true });

          // ── API Keys ──
          if (cmd === 'api_keys_list')
            return Promise.resolve([]);
          if (cmd === 'api_keys_active')
            return Promise.resolve(null);
          if (cmd === 'api_keys_check_active')
            return Promise.resolve({ hasActive: false });
          if (cmd === 'api_keys_create')
            return Promise.resolve({ success: true, id: 'key-e2e' });
          if (cmd === 'api_keys_set_active' || cmd === 'api_keys_delete')
            return Promise.resolve({ success: true });
          if (cmd === 'api_keys_validate')
            return Promise.resolve({ valid: false });

          // ── Reports — return fake PDF/Excel bytes so the app can complete download ──
          if (cmd === 'reports_generate_pdf') {
            const fakePdf = new Uint8Array(6000);
            fakePdf[0] = 0x25; fakePdf[1] = 0x50; fakePdf[2] = 0x44; fakePdf[3] = 0x46; // %PDF
            return Promise.resolve(fakePdf);
          }
          if (cmd === 'reports_generate_excel') {
            const fakeXlsx = new Uint8Array(6000);
            fakeXlsx[0] = 0x50; fakeXlsx[1] = 0x4B; fakeXlsx[2] = 0x03; fakeXlsx[3] = 0x04; // PK (ZIP)
            return Promise.resolve(fakeXlsx);
          }

          // ── Analysis — return a minimal valid result so chart renders and cycle
          // count appears in the UI (tests that check "N циклов" need ≥ 1 cycle).
          // Return plain JS objects — the invoke wrapper already deserialises Tauri
          // responses before handing them to callers; wrapping in JSON.stringify
          // causes mapAnalysisOutput to receive a string → "i.results is not iterable".
          if (cmd === 'analysis_analyze_full' ||
              cmd === 'analysis_regroup_by_pattern' ||
              cmd === 'analysis_calculate_models')
            return Promise.resolve({
              cycles: [{ id: 1, type: 'ISO', steps: [], description: 'E2E mock cycle', duration: 300 }],
              results: [],
              allSteps: [],
            });
          if (cmd === 'analysis_detect_steps')
            return Promise.resolve({ steps: [] });

          // ── Backups ──
          if (cmd === 'backup_list')
            return Promise.resolve([]);
          if (cmd === 'backup_create')
            return Promise.resolve({ success: true, filename: 'backup-e2e.db' });
          if (cmd === 'backup_restore' || cmd === 'backup_delete')
            return Promise.resolve({ success: true });

          // ── Logger (no-op) ──
          if (cmd === 'log_info' || cmd === 'log_error')
            return Promise.resolve();

          // ── Settings ──
          if (cmd === 'get_settings')
            return Promise.resolve(null);
          if (cmd === 'save_settings')
            return Promise.resolve({ success: true });

          // ── V2 Data Flow ──
          if (cmd === 'import_batches_list' || cmd === 'experiment_payloads_list' ||
              cmd === 'parser_artifacts_list' || cmd === 'report_artifacts_list' ||
              cmd === 'search_projections_list' || cmd === 'sync_outbox_list' ||
              cmd === 'sync_inbox_list' || cmd === 'conflicts_list')
            return Promise.resolve([]);
          if (cmd === 'sync_status')
            return Promise.resolve({ syncing: false, lastSync: null });

          // ── Licensing (V2 engine commands) ──
          // licensing_check is the authoritative startup command.
          // It returns a flat RustLicenseCheckResult that the Zustand store adapts.
          if (cmd === 'licensing_check')
            return Promise.resolve({
              status: 'active',
              source: 'key',
              features: {
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
              },
              key: 'E2E-TEST-KEY',
              licenseType: 'developer',
              customerName: 'E2E Test',
              expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
              daysRemaining: 365,
              experimentsRemaining: -1,
              message: null,
              showWarning: false,
            });
          if (cmd === 'licensing_get_status')
            return Promise.resolve({
              status: 'active',
              source: 'key',
              features: {
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
              },
              key: 'E2E-TEST-KEY',
              licenseType: 'developer',
              customerName: 'E2E Test',
              expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
              daysRemaining: 365,
              experimentsRemaining: -1,
              message: null,
              showWarning: false,
            });
          if (cmd === 'licensing_activate_full')
            return Promise.resolve({
              status: 'active',
              source: 'key',
              features: { maxExperiments: -1, maxComparisonExperiments: 10, calibrationAnalysis: true, calibrationParsing: true, comparison: true, exportPdf: true, exportExcel: true, aiParsing: true, watermark: false, chandler5550Support: true, bslR1Support: true },
              key: args?.key || 'E2E-ACTIVATED-KEY',
              licenseType: 'developer',
              customerName: 'E2E Test',
              expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
              daysRemaining: 365,
              experimentsRemaining: -1,
              message: 'Лицензия активирована',
              showWarning: false,
            });
          if (cmd === 'licensing_deactivate')
            return Promise.resolve({
              status: 'demo',
              source: 'demo',
              features: { maxExperiments: 5, maxComparisonExperiments: 2, calibrationAnalysis: false, calibrationParsing: false, comparison: true, exportPdf: false, exportExcel: false, aiParsing: false, watermark: true, chandler5550Support: false, bslR1Support: false },
              daysRemaining: 30,
              experimentsRemaining: 5,
              message: null,
              showWarning: false,
            });
          if (cmd === 'licensing_can_save')
            return Promise.resolve(true);
          if (cmd === 'licensing_register_experiment')
            return Promise.resolve({
              status: 'active',
              source: 'key',
              features: { maxExperiments: -1, maxComparisonExperiments: 10, calibrationAnalysis: true, calibrationParsing: true, comparison: true, exportPdf: true, exportExcel: true, aiParsing: true, watermark: false, chandler5550Support: true, bslR1Support: true },
              showWarning: false,
            });
          if (cmd === 'licensing_was_ever_licensed')
            return Promise.resolve(false);
          if (cmd === 'licensing_machine_id')
            return Promise.resolve('e2e-machine-id');
          if (cmd === 'licensing_checkpoint_db')
            return Promise.resolve({ success: true });

          // ── Fallback ──
          console.warn(`[E2E Mock] unhandled Tauri command: ${cmd}`, args);
          return Promise.reject(new Error(`[E2E] Tauri command "${cmd}" not mocked`));
        },
      };
    },
    {
      user: E2E_MOCK_USER,
      fakeParse: process.env.RHEOLAB_E2E_FAKE_PARSE === '1',
    },
  );
}

/**
 * beforeEach hook: mock Tauri IPC + inject test license + navigate to dashboard.
 *
 * To use, call `setupBeforeEach(test)` in your test file.
 */
export function setupBeforeEach(t: typeof test) {
  t.beforeEach(async ({ page }) => {
    // 1. Mock Tauri IPC BEFORE any navigation
    await mockTauriIPC(page);

    // 2. Inject license
    await setupTestLicense(page);

    // 3. Navigate — since auth is mocked, should land on /dashboard directly
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    // 4. Wait for the page to stabilize (auth context resolves, WASM may start)
    await page.waitForTimeout(2_000);

    // 5. If somehow still on login, try form login as fallback
    if (page.url().includes('/login')) {
      const emailInput = page.getByPlaceholder(/Email|логин/i);
      if (await emailInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await emailInput.fill('admin');
        const passwordInput = page.getByPlaceholder(/пароль|password|••••/i);
        await passwordInput.fill('admin');
        const loginButton = page.getByRole('button', { name: /Sign in|Log in|Войти/i });
        await loginButton.click();
        await page.waitForURL('**/dashboard', { timeout: 30_000, waitUntil: 'domcontentloaded' });
      }
    }
  });
}

export { expect, mockTauriIPC };
