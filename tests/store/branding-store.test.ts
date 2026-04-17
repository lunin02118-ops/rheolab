/**
 * Test: branding-store — showRawData / showCalibration toggles
 *
 * Covers the Zustand persisted store for report content toggles
 * and company branding settings.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useBrandingStore } from '@/lib/store/branding-store';

describe('branding-store', () => {
    beforeEach(() => {
        // Reset store to defaults before each test
        useBrandingStore.setState({
            companyName: 'RheoLab Enterprise',
            companyLogo: null,
            showCalibration: false,
            showRawData: false,
        });
    });

    describe('defaults', () => {
        it('has showRawData=false by default', () => {
            const state = useBrandingStore.getState();
            expect(state.showRawData).toBe(false);
        });

        it('has showCalibration=false by default', () => {
            const state = useBrandingStore.getState();
            expect(state.showCalibration).toBe(false);
        });

        it('has default company name', () => {
            const state = useBrandingStore.getState();
            expect(state.companyName).toBe('RheoLab Enterprise');
        });

        it('has null company logo by default', () => {
            const state = useBrandingStore.getState();
            expect(state.companyLogo).toBeNull();
        });
    });

    describe('setShowRawData', () => {
        it('enables raw data toggle', () => {
            useBrandingStore.getState().setShowRawData(true);
            expect(useBrandingStore.getState().showRawData).toBe(true);
        });

        it('disables raw data toggle', () => {
            useBrandingStore.getState().setShowRawData(true);
            useBrandingStore.getState().setShowRawData(false);
            expect(useBrandingStore.getState().showRawData).toBe(false);
        });

        it('does not affect showCalibration', () => {
            useBrandingStore.getState().setShowCalibration(true);
            useBrandingStore.getState().setShowRawData(true);
            expect(useBrandingStore.getState().showCalibration).toBe(true);
            expect(useBrandingStore.getState().showRawData).toBe(true);
        });
    });

    describe('setShowCalibration', () => {
        it('enables calibration toggle', () => {
            useBrandingStore.getState().setShowCalibration(true);
            expect(useBrandingStore.getState().showCalibration).toBe(true);
        });

        it('does not affect showRawData', () => {
            useBrandingStore.getState().setShowRawData(true);
            useBrandingStore.getState().setShowCalibration(true);
            expect(useBrandingStore.getState().showRawData).toBe(true);
            expect(useBrandingStore.getState().showCalibration).toBe(true);
        });
    });

    describe('independence — toggles are independent of branding', () => {
        it('changing company name does not affect toggles', () => {
            useBrandingStore.getState().setShowRawData(true);
            useBrandingStore.getState().setShowCalibration(true);
            useBrandingStore.getState().setCompanyName('New Company');

            const state = useBrandingStore.getState();
            expect(state.companyName).toBe('New Company');
            expect(state.showRawData).toBe(true);
            expect(state.showCalibration).toBe(true);
        });

        it('changing logo does not affect toggles', () => {
            useBrandingStore.getState().setShowRawData(true);
            useBrandingStore.getState().setCompanyLogo('data:image/png;base64,abc');

            const state = useBrandingStore.getState();
            expect(state.companyLogo).toBe('data:image/png;base64,abc');
            expect(state.showRawData).toBe(true);
        });
    });
});
