// @vitest-environment jsdom
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { CycleResultsTable } from '@/components/analysis/cycle-results-table';
import { UIModeProvider } from '@/contexts/ui-mode-context';
import type { GraceCycleResult, RheoCycle, RheoStep } from '@/lib/analysis/types';
import { useChartSettingsStore } from '@/lib/store/chart-settings-store';

const step: RheoStep = {
    id: 1,
    startTime: 0,
    endTime: 60,
    duration: 60,
    avgShearRate: 100,
    avgShearStress: 10,
    avgViscosity: 100,
    avgTemperature: 25,
    avgPressure: 1,
    points: [],
    calcPointsCount: 0,
    isRamp: false,
    startIndex: 0,
    endIndex: 0,
};

const cycle: RheoCycle = {
    id: 1,
    cycleIndex: 1,
    type: 'ISO',
    steps: [step],
    description: 'test cycle',
    duration: 60,
};

const result: GraceCycleResult = {
    cycleNo: 1,
    timeMin: 0,
    endTimeMin: 1,
    timeSec: 0,
    tempC: 25,
    pressure_bar: 1,
    n_prime: 0.5,
    Kv_PaSn: 1,
    K_prime_PaSn: 1,
    K_prime_slot_PaSn: 2,
    K_pipe_PaSn: 3,
    r2: 0.99,
    viscosities: { 40: 500, 100: 1000, 170: 1500 },
    viscAt40: 500,
    viscAt100: 1000,
    viscAt170: 1500,
    bingham_PV_PaS: 0.12,
    bingham_YP_Pa: 4.2,
    bingham_r2: 0.98,
    calcPoints: 10,
};

function renderTable() {
    return render(
        <UIModeProvider>
            <CycleResultsTable cycles={[cycle]} results={new Map([[1, result]])} />
        </UIModeProvider>,
    );
}

beforeEach(() => {
    localStorage.clear();
    act(() => {
        useChartSettingsStore.getState().applyUnitPreset('metric');
    });
});

describe('CycleResultsTable unit conversions', () => {
    it('converts K, PV and YP values when Imperial units are selected', () => {
        act(() => {
            useChartSettingsStore.getState().applyUnitPreset('imperial');
        });

        renderTable();

        expect(screen.getByText("K' (lbf·s^n/100ft²)")).toBeDefined();
        expect(screen.getByText('Ks (lbf·s^n/100ft²)')).toBeDefined();
        expect(screen.getByText('Kp (lbf·s^n/100ft²)')).toBeDefined();
        expect(screen.getByText('PV (cP)')).toBeDefined();
        expect(screen.getByText('YP (lbf/100ft²)')).toBeDefined();

        expect(screen.getByText('2.0885')).toBeDefined();
        expect(screen.getByText('4.1770')).toBeDefined();
        expect(screen.getByText('6.2655')).toBeDefined();
        expect(screen.getByText('120.0')).toBeDefined();
        expect(screen.getByText('8.77')).toBeDefined();
    });

    it('keeps custom mixed units independent instead of deriving everything from viscosity', () => {
        act(() => {
            useChartSettingsStore.getState().applyUnitPreset('imperial');
            useChartSettingsStore.getState().setRheologyUnit('consistency', 'Pa·s^n');
            useChartSettingsStore.getState().setRheologyUnit('yieldPoint', 'Pa');
        });

        renderTable();

        expect(screen.getByText("K' (Pa·s^n)")).toBeDefined();
        expect(screen.getByText('PV (cP)')).toBeDefined();
        expect(screen.getByText('YP (Pa)')).toBeDefined();
        expect(screen.getByText('1.0000')).toBeDefined();
        expect(screen.getByText('120.0')).toBeDefined();
        expect(screen.getByText('4.20')).toBeDefined();
    });
});
