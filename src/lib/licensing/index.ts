/**
 * Licensing Module — V2 (Rust Engine)
 *
 * All licensing logic runs in the Rust LicenseEngine.
 * This barrel re-exports types and dev-mode multi-license utilities only.
 */

// Types
export type {
    License,
    LicenseType,
    LicenseStatus,
    LicenseSource,
    LicenseResult,
    LicenseFeatures,
} from './types';

// Constants
export {
    DEMO_LIMITS,
    GRACE_PERIOD_DAYS,
} from './types';

// Multi-license store (dev mode only — used by LicenseSwitcher / LicenseActivationDialog)
export {
    isDevModeEnabled,
    setDevMode,
    getAllSlots,
    getActiveSlot,
    setActiveSlot,
    addLicenseSlot,
    removeLicenseSlot,
    clearMultiLicenseData,
    type LicenseSlot,
    type MultiLicenseState,
} from './multi-license-store';
