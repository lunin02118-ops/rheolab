/**
 * useLicense Hook
 *
 * Thin proxy that returns the license store state via Zustand.
 * Using useShallow ensures the component only re-renders when the selected
 * slice actually changes — actions (activate, refresh, …) are stable store
 * references and never trigger re-renders by themselves.
 *
 * All 8 consumers continue to work without changes.
 */

import { useLicenseStore } from '@/lib/store/license-store';
import { useShallow } from 'zustand/react/shallow';

export const useLicense = () =>
    useLicenseStore(
        useShallow(s => ({
            status: s.status,
            result: s.result,
            isLoading: s.isLoading,
            isInitialized: s.isInitialized,
            isDemo: s.isDemo,
            isExpired: s.isExpired,
            isActive: s.isActive,
            daysRemaining: s.daysRemaining,
            experimentsRemaining: s.experimentsRemaining,
            experimentsInDB: s.experimentsInDB,
            refresh: s.refresh,
            refreshExperimentsCount: s.refreshExperimentsCount,
            activate: s.activate,
            createOfflineActivationRequest: s.createOfflineActivationRequest,
            activateOffline: s.activateOffline,
            deactivate: s.deactivate,
            canSaveExperiment: s.canSaveExperiment,
            isWatermarkRequired: s.isWatermarkRequired,
        }))
    );

// Re-export types for convenience
export type { LicenseStatus, LicenseResult } from '@/lib/licensing';
