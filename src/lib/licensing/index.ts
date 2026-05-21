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

// Note: multi-license-store APIs are imported directly by
// `components/licensing/DevModeSection.tsx` (single consumer);
// no need to re-export them through this barrel.
