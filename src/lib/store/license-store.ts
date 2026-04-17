/**
 * License Zustand Store — V2 (Rust Engine)
 *
 * All licensing logic now runs in Rust (LicenseEngine). This store is a thin
 * reactive wrapper that calls Tauri commands and exposes the result to React.
 *
 * Commands used:
 *   licensing_check           → full check (startup, refresh)
 *   licensing_activate_full   → activate key via server + DB
 *   licensing_deactivate      → deactivate + remove from DB
 *   licensing_register_experiment → increment demo counter
 */

import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@/lib/tauri/core';
import type {
    LicenseType,
    LicenseResult,
    LicenseStatus,
    LicenseFeatures,
    License,
} from '@/lib/licensing';
import { getExperimentsCount } from '@/lib/experiments/client';
import { debugLog } from '@/lib/utils/debug-logger';
import { licenseEvents } from '@/lib/store/license-events';

// ── Rust LicenseCheckResult (matches serde camelCase output) ─────────────────

interface RustLicenseCheckResult {
    status: LicenseStatus;
    source: 'key' | 'demo';
    features: LicenseFeatures;
    key?: string;
    licenseType?: string;
    customerName?: string;
    expiresAt?: string;
    daysRemaining?: number;
    experimentsRemaining?: number;
    message?: string;
    showWarning: boolean;
}

/**
 * Adapt the flat Rust result into the legacy nested `LicenseResult` shape
 * so that all existing consumers (useLicense hook, components) continue to work.
 */
function adaptResult(r: RustLicenseCheckResult): LicenseResult {
    const license: License | undefined =
        r.customerName || r.licenseType
            ? {
                  id: '',
                  type: (r.licenseType ?? 'standard') as LicenseType,
                  customerName: r.customerName ?? '',
                  issuedAt: new Date(),
                  expiresAt: r.expiresAt ? new Date(r.expiresAt) : new Date(),
                  gracePeriodDays: 30,
                  features: r.features,
              }
            : undefined;

    return {
        status: r.status,
        source: r.source,
        key: r.key,
        license,
        daysRemaining: r.daysRemaining,
        experimentsRemaining: r.experimentsRemaining,
        message: r.message,
        showWarning: r.showWarning,
    };
}

// ── Store interface ──────────────────────────────────────────────────────────

export interface LicenseState {
    // ── Raw state ──
    result: LicenseResult | null;
    isLoading: boolean;
    isInitialized: boolean;
    experimentsInDB: number;

    // ── Derived from result (updated in same set() call — always consistent) ──
    status: LicenseStatus;
    isDemo: boolean;
    isExpired: boolean;
    isActive: boolean;
    daysRemaining: number;
    experimentsRemaining: number;

    // ── Actions ──
    init: () => Promise<void>;
    refresh: () => Promise<void>;
    refreshExperimentsCount: () => Promise<void>;
    activate: (key: string) => Promise<{ success: boolean; message: string }>;
    deactivate: () => Promise<void>;
    canSaveExperiment: () => { allowed: boolean; message?: string };
    isWatermarkRequired: () => boolean;
}

// ── Helper to compute derived fields ────────────────────────────────────────

function deriveFromResult(result: LicenseResult | null) {
    const status: LicenseStatus = result?.status ?? 'invalid';
    const isDemo = status === 'demo';
    const isExpired = status === 'expired' || status === 'demo_expired';
    const isActive = status === 'active' || status === 'grace';
    const daysRemaining = Math.max(0, result?.daysRemaining ?? 0);
    const experimentsRemaining = result?.experimentsRemaining ?? (isDemo ? 0 : -1);
    return { status, isDemo, isExpired, isActive, daysRemaining, experimentsRemaining };
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useLicenseStore = create<LicenseState>()((set, get) => ({
    result: null,
    isLoading: true,
    isInitialized: false,
    experimentsInDB: 0,
    // Derived defaults
    status: 'invalid' as LicenseStatus,
    isDemo: false,
    isExpired: false,
    isActive: false,
    daysRemaining: 0,
    experimentsRemaining: -1,

    // ── refreshExperimentsCount ──────────────────────────────────────────────
    refreshExperimentsCount: async () => {
        try {
            const count = await getExperimentsCount();
            debugLog('LicenseStore', 'Updated experiments count from storage:', count);
            set({ experimentsInDB: count });
        } catch (error) {
            console.error('[LicenseStore] Error fetching experiments count:', error);
        }
    },

    // ── init ──────────────────────────────────────────────────────────────────
    init: async () => {
        // Guard: only run once
        if (get().isInitialized) return;

        // Subscribe to the background online-check result emitted by lib.rs ~300 ms
        // after startup. This updates the store once the HTTP validation completes
        // without requiring a polling loop or a second IPC call from the frontend.
        // Fire-and-forget: the listener lives for the app's lifetime.
        listen<RustLicenseCheckResult>('license_status_updated', ({ payload }) => {
            debugLog('LicenseStore', 'Background check received:', payload.status, payload.source);
            const result = adaptResult(payload);
            set({ result, ...deriveFromResult(result) });
        }).catch((err) => {
            console.warn('[LicenseStore] Failed to register license_status_updated listener:', err);
        });

        try {
            // Rust pre-populates the license cache during AppState::new() via
            // check_local_startup() (local DB only — no HTTP), so licensing_get_status()
            // returns a cached result without any network I/O.
            // The full online validation runs in background and updates the store via
            // the license_status_updated event registered above.
            // Fall back to the full licensing_check command only if the cache is empty.
            const [cachedResult, ] = await Promise.all([
                invoke<RustLicenseCheckResult | null>('licensing_get_status'),
                get().refreshExperimentsCount(),
            ]);

            const rustResult: RustLicenseCheckResult = cachedResult
                ?? await invoke<RustLicenseCheckResult>('licensing_check');

            const result = adaptResult(rustResult);
            debugLog('LicenseStore', `Initialized via Rust engine (${cachedResult ? 'cache' : 'full check'}):`, result.status, result.source);

            set({
                result,
                isInitialized: true,
                isLoading: false,
                ...deriveFromResult(result),
            });
        } catch (error) {
            console.error('[LicenseStore] Init error:', error);
            // Mark initialized even on failure — otherwise LicenseGuard stays
            // in loading state forever and the user sees a blank screen.
            set({
                isLoading: false,
                isInitialized: true,
                ...deriveFromResult(null),
            });
        }
    },

    // ── refresh ───────────────────────────────────────────────────────────────
    refresh: async () => {
        set({ isLoading: true });
        try {
            const [rustResult] = await Promise.all([
                invoke<RustLicenseCheckResult>('licensing_check'),
                get().refreshExperimentsCount(),
            ]);
            const result = adaptResult(rustResult);
            set({
                result,
                ...deriveFromResult(result),
            });
        } finally {
            set({ isLoading: false });
        }
    },

    // ── activate ──────────────────────────────────────────────────────────────
    activate: async (key: string) => {
        try {
            const rustResult = await invoke<RustLicenseCheckResult>(
                'licensing_activate_full',
                { key },
            );
            const result = adaptResult(rustResult);
            set({ result, ...deriveFromResult(result) });
            return { success: true, message: result.message || 'Лицензия активирована' };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message };
        }
    },

    // ── deactivate ────────────────────────────────────────────────────────────
    deactivate: async () => {
        try {
            const rustResult = await invoke<RustLicenseCheckResult>('licensing_deactivate');
            const result = adaptResult(rustResult);
            set({ result, ...deriveFromResult(result) });
            // Cross-store: notify subscribers that the license was deactivated
            licenseEvents.emit('license-deactivated');
        } catch (error) {
            console.error('[LicenseStore] Deactivate error:', error);
        }
    },

    // ── canSaveExperiment ─────────────────────────────────────────────────────
    canSaveExperiment: () => {
        const { result, status, isInitialized, isLoading } = get();
        // While the license check is in flight, allow optimistically.
        // The Rust gate (check_license_gate) is the authoritative enforcement layer.
        if (!isInitialized || isLoading) {
            return { allowed: true };
        }
        if (status === 'invalid') {
            return {
                allowed: false,
                message:
                    result?.message ||
                    'Лицензия не активирована. Требуется подключение к интернету.',
            };
        }
        if (status === 'expired' || status === 'demo_expired') {
            return {
                allowed: false,
                message: 'Срок лицензии истёк. Активируйте полную версию.',
            };
        }
        if (status === 'demo') {
            const remaining = result?.experimentsRemaining ?? 0;
            if (remaining <= 0) {
                return {
                    allowed: false,
                    message:
                        'Достигнут лимит Demo версии. Удалите старые или активируйте полную версию.',
                };
            }
        }
        return { allowed: true };
    },

    // ── isWatermarkRequired ───────────────────────────────────────────────────
    isWatermarkRequired: () => {
        const { result } = get();
        // features.watermark is authoritative (computed in Rust)
        if (!result?.license?.features) return true; // No result yet → watermark as safety
        return result.license.features.watermark;
    },
}));

// Expose store globally for E2E test harness (allows forced refresh after IPC proxy injection)
if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).__rheolab_license_store = useLicenseStore;
}
