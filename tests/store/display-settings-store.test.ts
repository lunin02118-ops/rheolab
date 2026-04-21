/**
 * Tests for src/lib/store/display-settings-store.ts
 *
 * Pure-helper + in-memory store tests (no direct localStorage access:
 * Zustand's `persist` middleware handles the storage adapter internally and
 * works in node via its error-swallowing fallback).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    useDisplaySettingsStore,
    getViscosityUnit,
    convertViscosity,
    getViscosityDecimals,
    toRustUnitSystem,
} from '@/lib/store/display-settings-store';

describe('useDisplaySettingsStore', () => {
    beforeEach(() => {
        useDisplaySettingsStore.setState({ unitSystem: 'SI' });
    });

    describe('default state', () => {
        it('unitSystem defaults to SI', () => {
            expect(useDisplaySettingsStore.getState().unitSystem).toBe('SI');
        });
    });

    describe('setUnitSystem', () => {
        it('updates to SI_Pas', () => {
            useDisplaySettingsStore.getState().setUnitSystem('SI_Pas');
            expect(useDisplaySettingsStore.getState().unitSystem).toBe('SI_Pas');
        });

        it('updates to Imperial', () => {
            useDisplaySettingsStore.getState().setUnitSystem('Imperial');
            expect(useDisplaySettingsStore.getState().unitSystem).toBe('Imperial');
        });

        it('round-trips through all three systems', () => {
            const store = useDisplaySettingsStore.getState();
            store.setUnitSystem('SI_Pas');
            expect(useDisplaySettingsStore.getState().unitSystem).toBe('SI_Pas');
            store.setUnitSystem('Imperial');
            expect(useDisplaySettingsStore.getState().unitSystem).toBe('Imperial');
            store.setUnitSystem('SI');
            expect(useDisplaySettingsStore.getState().unitSystem).toBe('SI');
        });
    });

    describe('getViscosityUnit', () => {
        it('returns mPa·s for SI', () => {
            expect(getViscosityUnit('SI')).toBe('mPa·s');
        });
        it('returns Pa·s for SI_Pas', () => {
            expect(getViscosityUnit('SI_Pas')).toBe('Pa·s');
        });
        it('returns cP for Imperial', () => {
            expect(getViscosityUnit('Imperial')).toBe('cP');
        });
    });

    describe('convertViscosity', () => {
        it('keeps mPa·s unchanged for SI', () => {
            expect(convertViscosity(150, 'SI')).toBe(150);
        });
        it('converts mPa·s → Pa·s by dividing by 1000', () => {
            expect(convertViscosity(150, 'SI_Pas')).toBeCloseTo(0.15, 10);
        });
        it('keeps numerical value unchanged for Imperial (cP == mPa·s)', () => {
            expect(convertViscosity(150, 'Imperial')).toBe(150);
        });
        it('handles zero', () => {
            expect(convertViscosity(0, 'SI_Pas')).toBe(0);
        });
        it('handles large values', () => {
            expect(convertViscosity(1_000_000, 'SI_Pas')).toBe(1_000);
        });
    });

    describe('getViscosityDecimals', () => {
        it('returns 1 for SI (mPa·s)', () => {
            expect(getViscosityDecimals('SI')).toBe(1);
        });
        it('returns 4 for SI_Pas (Pa·s) — sub-unit precision', () => {
            expect(getViscosityDecimals('SI_Pas')).toBe(4);
        });
        it('returns 1 for Imperial (cP)', () => {
            expect(getViscosityDecimals('Imperial')).toBe(1);
        });
    });

    describe('toRustUnitSystem', () => {
        it('maps 1:1 for all three unit systems', () => {
            expect(toRustUnitSystem('SI')).toBe('SI');
            expect(toRustUnitSystem('SI_Pas')).toBe('SI_Pas');
            expect(toRustUnitSystem('Imperial')).toBe('Imperial');
        });
    });

    describe('pipeline integrity', () => {
        it('unit label matches conversion result for SI_Pas', () => {
            const u = 'SI_Pas' as const;
            // A 250 mPa·s reading should display as "0.2500 Pa·s" with 4 decimals.
            expect(getViscosityUnit(u)).toBe('Pa·s');
            expect(convertViscosity(250, u).toFixed(getViscosityDecimals(u))).toBe('0.2500');
        });

        it('unit label matches conversion result for Imperial', () => {
            const u = 'Imperial' as const;
            // A 250 mPa·s reading should display as "250.0 cP" with 1 decimal.
            expect(getViscosityUnit(u)).toBe('cP');
            expect(convertViscosity(250, u).toFixed(getViscosityDecimals(u))).toBe('250.0');
        });
    });
});
