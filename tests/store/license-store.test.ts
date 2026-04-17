/**
 * Tests for src/lib/store/license-store.ts
 *
 * Covers:
 *   - adaptResult()  — Rust flat shape → nested LicenseResult
 *   - deriveFromResult() — computed status fields
 *   - canSaveExperiment() — gate logic for all license states
 *   - isWatermarkRequired() — feature flag derivation
 *   - init()  — one-time guard, success + error paths
 *   - refresh() — loading flag lifecycle
 *   - activate() / deactivate() — IPC wrappers + event emission
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks (must be before the imports that trigger module init) ─────────────

const mockInvoke = vi.fn();
const mockListen = vi.fn().mockResolvedValue(() => {});
const mockGetExperimentsCount = vi.fn().mockResolvedValue(0);
const mockLicenseEventsEmit = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
    listen: (...args: unknown[]) => mockListen(...args),
}));

vi.mock('@/lib/tauri/core', () => ({
    invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('@/lib/experiments/client', () => ({
    getExperimentsCount: () => mockGetExperimentsCount(),
}));

vi.mock('@/lib/utils/debug-logger', () => ({
    debugLog: vi.fn(),
}));

vi.mock('@/lib/store/license-events', () => ({
    licenseEvents: {
        on: vi.fn(),
        emit: (...args: unknown[]) => mockLicenseEventsEmit(...args),
    },
}));

import { useLicenseStore } from '@/lib/store/license-store';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeRustResult(overrides: Record<string, unknown> = {}) {
    return {
        status: 'active',
        source: 'key',
        features: { watermark: false, maxExperiments: -1, exportPdf: true, exportExcel: true },
        key: 'TEST-KEY-0000',
        licenseType: 'full',
        customerName: 'Acme Corp',
        expiresAt: '2027-01-01T00:00:00.000Z',
        daysRemaining: 365,
        experimentsRemaining: -1,
        message: undefined,
        showWarning: false,
        ...overrides,
    };
}

function resetStore() {
    useLicenseStore.setState({
        result: null,
        isLoading: true,
        isInitialized: false,
        experimentsInDB: 0,
        status: 'invalid',
        isDemo: false,
        isExpired: false,
        isActive: false,
        daysRemaining: 0,
        experimentsRemaining: -1,
    });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useLicenseStore — initial state', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStore();
    });

    it('starts with status=invalid and isLoading=true', () => {
        const s = useLicenseStore.getState();
        expect(s.status).toBe('invalid');
        expect(s.isLoading).toBe(true);
        expect(s.isInitialized).toBe(false);
    });
});

// ── adaptResult (tested indirectly via init) ─────────────────────────────────

describe('adaptResult — license shape mapping', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStore();
        mockGetExperimentsCount.mockResolvedValue(5);
    });

    it('maps full license fields into nested License object', async () => {
        mockInvoke.mockImplementation((cmd: string) => {
            if (cmd === 'licensing_get_status') return Promise.resolve(makeRustResult());
            return Promise.resolve(null);
        });
        await useLicenseStore.getState().init();
        const { result } = useLicenseStore.getState();
        expect(result).not.toBeNull();
        expect(result!.license?.customerName).toBe('Acme Corp');
        expect(result!.license?.type).toBe('full');
        expect(result!.license?.features.watermark).toBe(false);
    });

    it('produces undefined license when customerName and licenseType absent', async () => {
        const rustResult = makeRustResult({ customerName: undefined, licenseType: undefined });
        mockInvoke.mockResolvedValue(rustResult);
        await useLicenseStore.getState().init();
        const { result } = useLicenseStore.getState();
        expect(result!.license).toBeUndefined();
    });

    it('maps daysRemaining and experimentsRemaining through', async () => {
        mockInvoke.mockResolvedValue(makeRustResult({ daysRemaining: 42, experimentsRemaining: 5 }));
        await useLicenseStore.getState().init();
        const { result } = useLicenseStore.getState();
        expect(result!.daysRemaining).toBe(42);
        expect(result!.experimentsRemaining).toBe(5);
    });
});

// ── deriveFromResult (tested indirectly via init) ────────────────────────────

describe('deriveFromResult — derived state fields', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStore();
        mockGetExperimentsCount.mockResolvedValue(0);
    });

    async function initWithStatus(status: string) {
        mockInvoke.mockResolvedValue(makeRustResult({ status }));
        await useLicenseStore.getState().init();
        return useLicenseStore.getState();
    }

    it('status=active → isActive=true, isDemo=false, isExpired=false', async () => {
        const s = await initWithStatus('active');
        expect(s.isActive).toBe(true);
        expect(s.isDemo).toBe(false);
        expect(s.isExpired).toBe(false);
    });

    it('status=grace → isActive=true', async () => {
        const s = await initWithStatus('grace');
        expect(s.isActive).toBe(true);
    });

    it('status=demo → isDemo=true, isActive=false', async () => {
        const s = await initWithStatus('demo');
        expect(s.isDemo).toBe(true);
        expect(s.isActive).toBe(false);
    });

    it('status=expired → isExpired=true', async () => {
        const s = await initWithStatus('expired');
        expect(s.isExpired).toBe(true);
    });

    it('status=demo_expired → isExpired=true', async () => {
        const s = await initWithStatus('demo_expired');
        expect(s.isExpired).toBe(true);
    });

    it('status=invalid → isActive=false, isExpired=false', async () => {
        const s = await initWithStatus('invalid');
        expect(s.isActive).toBe(false);
        expect(s.isExpired).toBe(false);
    });

    it('daysRemaining is clamped to 0 when negative from Rust', async () => {
        mockInvoke.mockResolvedValue(makeRustResult({ daysRemaining: -1 }));
        await useLicenseStore.getState().init();
        expect(useLicenseStore.getState().daysRemaining).toBe(0);
    });
});

// ── canSaveExperiment ────────────────────────────────────────────────────────

describe('canSaveExperiment()', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('allows saving when not yet initialized (optimistic)', () => {
        useLicenseStore.setState({ isInitialized: false, isLoading: true, status: 'invalid', result: null });
        expect(useLicenseStore.getState().canSaveExperiment().allowed).toBe(true);
    });

    it('allows saving when initialized and loading (optimistic)', () => {
        useLicenseStore.setState({ isInitialized: true, isLoading: true, status: 'invalid', result: null });
        expect(useLicenseStore.getState().canSaveExperiment().allowed).toBe(true);
    });

    it('blocks saving when status=invalid', () => {
        useLicenseStore.setState({ isInitialized: true, isLoading: false, status: 'invalid', result: null });
        const r = useLicenseStore.getState().canSaveExperiment();
        expect(r.allowed).toBe(false);
        expect(r.message).toBeTruthy();
    });

    it('blocks saving when status=expired', () => {
        useLicenseStore.setState({ isInitialized: true, isLoading: false, status: 'expired', result: null });
        const r = useLicenseStore.getState().canSaveExperiment();
        expect(r.allowed).toBe(false);
    });

    it('blocks saving when status=demo_expired', () => {
        useLicenseStore.setState({ isInitialized: true, isLoading: false, status: 'demo_expired', result: null });
        expect(useLicenseStore.getState().canSaveExperiment().allowed).toBe(false);
    });

    it('blocks demo saving when experimentsRemaining=0', () => {
        useLicenseStore.setState({
            isInitialized: true,
            isLoading: false,
            status: 'demo',
            result: { status: 'demo', source: 'demo', experimentsRemaining: 0, showWarning: false },
        });
        const r = useLicenseStore.getState().canSaveExperiment();
        expect(r.allowed).toBe(false);
        expect(r.message).toBeTruthy();
    });

    it('allows demo saving when experimentsRemaining>0', () => {
        useLicenseStore.setState({
            isInitialized: true,
            isLoading: false,
            status: 'demo',
            result: { status: 'demo', source: 'demo', experimentsRemaining: 3, showWarning: false },
        });
        expect(useLicenseStore.getState().canSaveExperiment().allowed).toBe(true);
    });

    it('allows saving when status=active', () => {
        useLicenseStore.setState({ isInitialized: true, isLoading: false, status: 'active', result: makeRustResult() as never });
        expect(useLicenseStore.getState().canSaveExperiment().allowed).toBe(true);
    });
});

// ── isWatermarkRequired ──────────────────────────────────────────────────────

describe('isWatermarkRequired()', () => {
    it('returns true when result is null (safety default)', () => {
        useLicenseStore.setState({ result: null });
        expect(useLicenseStore.getState().isWatermarkRequired()).toBe(true);
    });

    it('returns true when features.watermark=true', () => {
        useLicenseStore.setState({
            result: {
                status: 'active', source: 'key', showWarning: false,
                license: { id: '', type: 'standard', customerName: '', issuedAt: new Date(), expiresAt: new Date(), gracePeriodDays: 30, features: { watermark: true, maxExperiments: -1, maxComparisonExperiments: 4, exportPdf: true, exportExcel: true, aiParsing: false, comparison: false, calibrationAnalysis: false, calibrationParsing: false, chandler5550Support: false, bslR1Support: false } },
            },
        });
        expect(useLicenseStore.getState().isWatermarkRequired()).toBe(true);
    });

    it('returns false when features.watermark=false', () => {
        useLicenseStore.setState({
            result: {
                status: 'active', source: 'key', showWarning: false,
                license: { id: '', type: 'standard', customerName: '', issuedAt: new Date(), expiresAt: new Date(), gracePeriodDays: 30, features: { watermark: false, maxExperiments: -1, maxComparisonExperiments: 4, exportPdf: true, exportExcel: true, aiParsing: false, comparison: false, calibrationAnalysis: false, calibrationParsing: false, chandler5550Support: false, bslR1Support: false } },
            },
        });
        expect(useLicenseStore.getState().isWatermarkRequired()).toBe(false);
    });
});

// ── init() ───────────────────────────────────────────────────────────────────

describe('init()', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStore();
        mockGetExperimentsCount.mockResolvedValue(0);
    });

    it('sets isInitialized=true after success', async () => {
        mockInvoke.mockResolvedValue(makeRustResult());
        await useLicenseStore.getState().init();
        expect(useLicenseStore.getState().isInitialized).toBe(true);
    });

    it('sets isLoading=false after success', async () => {
        mockInvoke.mockResolvedValue(makeRustResult());
        await useLicenseStore.getState().init();
        expect(useLicenseStore.getState().isLoading).toBe(false);
    });

    it('is a one-time guard — second call is a no-op', async () => {
        mockInvoke.mockResolvedValue(makeRustResult());
        await useLicenseStore.getState().init();
        await useLicenseStore.getState().init();
        // invoke should only have been called once per command
        const invocations = mockInvoke.mock.calls.filter((c) => c[0] === 'licensing_get_status');
        expect(invocations.length).toBe(1);
    });

    it('falls back to licensing_check when licensing_get_status returns null', async () => {
        mockInvoke.mockImplementation((cmd: string) => {
            if (cmd === 'licensing_get_status') return Promise.resolve(null);
            if (cmd === 'licensing_check') return Promise.resolve(makeRustResult());
            return Promise.resolve(null);
        });
        await useLicenseStore.getState().init();
        const checkCalls = mockInvoke.mock.calls.filter((c) => c[0] === 'licensing_check');
        expect(checkCalls.length).toBe(1);
    });

    it('sets isInitialized=true even when invoke throws', async () => {
        mockInvoke.mockRejectedValue(new Error('IPC timeout'));
        await useLicenseStore.getState().init();
        expect(useLicenseStore.getState().isInitialized).toBe(true);
        expect(useLicenseStore.getState().isLoading).toBe(false);
    });

    it('sets status=invalid when invoke throws', async () => {
        mockInvoke.mockRejectedValue(new Error('IPC timeout'));
        await useLicenseStore.getState().init();
        expect(useLicenseStore.getState().status).toBe('invalid');
    });

    it('subscribes to license_status_updated event', async () => {
        mockInvoke.mockResolvedValue(makeRustResult());
        await useLicenseStore.getState().init();
        const listenCalls = mockListen.mock.calls.filter((c) => c[0] === 'license_status_updated');
        expect(listenCalls.length).toBe(1);
    });

    it('registers experiments count from storage', async () => {
        mockGetExperimentsCount.mockResolvedValue(12);
        mockInvoke.mockResolvedValue(makeRustResult());
        await useLicenseStore.getState().init();
        expect(useLicenseStore.getState().experimentsInDB).toBe(12);
    });
});

// ── activate() ───────────────────────────────────────────────────────────────

describe('activate()', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStore();
    });

    it('returns success=true and updates store on valid key', async () => {
        mockInvoke.mockResolvedValue(makeRustResult({ status: 'active' }));
        const r = await useLicenseStore.getState().activate('VALID-KEY');
        expect(r.success).toBe(true);
        expect(useLicenseStore.getState().status).toBe('active');
    });

    it('returns success=false on IPC error', async () => {
        mockInvoke.mockRejectedValue(new Error('Invalid key'));
        const r = await useLicenseStore.getState().activate('BAD-KEY');
        expect(r.success).toBe(false);
        expect(r.message).toContain('Invalid key');
    });
});

// ── deactivate() ─────────────────────────────────────────────────────────────

describe('deactivate()', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStore();
    });

    it('updates store after successful deactivation', async () => {
        mockInvoke.mockResolvedValue(makeRustResult({ status: 'invalid', source: 'demo' }));
        await useLicenseStore.getState().deactivate();
        expect(useLicenseStore.getState().status).toBe('invalid');
    });

    it('emits license-deactivated event', async () => {
        mockInvoke.mockResolvedValue(makeRustResult({ status: 'demo' }));
        await useLicenseStore.getState().deactivate();
        expect(mockLicenseEventsEmit).toHaveBeenCalledWith('license-deactivated');
    });
});

// ── refreshExperimentsCount() ─────────────────────────────────────────────────

describe('refreshExperimentsCount()', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStore();
    });

    it('updates experimentsInDB', async () => {
        mockGetExperimentsCount.mockResolvedValue(7);
        await useLicenseStore.getState().refreshExperimentsCount();
        expect(useLicenseStore.getState().experimentsInDB).toBe(7);
    });

    it('does not throw when IPC fails', async () => {
        mockGetExperimentsCount.mockRejectedValue(new Error('DB error'));
        await expect(useLicenseStore.getState().refreshExperimentsCount()).resolves.toBeUndefined();
    });
});
