/**
 * Fluid/test classification taxonomy — re-exports from the constants module
 * plus legacy aliases kept for backward compatibility.
 */
import type { FluidType } from '@/lib/constants/fluid-types';
import type { TestCategory, TestType } from '@/lib/constants/test-types';

/**
 * Fluid type classification — 9 canonical values.
 * Re-exported from `@/lib/constants/fluid-types` for single source of truth.
 */
export type { FluidType };

/**
 * Test category (top-level) and test type (specific test within category).
 * Re-exported from `@/lib/constants/test-types`.
 */
export type { TestCategory, TestType };

/**
 * Test group classification (legacy — kept for backward compatibility with
 * existing stored experiments; new code should use TestCategory + TestType).
 */
export type TestGroup = 'Hydration' | 'Rheology';

/**
 * Test subgroup classification (legacy).
 */
export type TestSubGroup =
    | 'Cold Water 5°C'
    | 'Standard 25°C'
    | 'With Stabilizer'
    | 'Without Stabilizer'
    | 'With Proppant';
