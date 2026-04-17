// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CalibrationPanel } from '@/components/calibration/CalibrationPanel';

// Mock ResizeObserver for uPlot (used inside CalibrationPanel -> CalibrationChartsUplot)
global.ResizeObserver = class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
};

// Mock matchMedia for uPlot
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {}, // deprecated
        removeListener: () => {}, // deprecated
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    }),
});

const mockCalibrationPass = {
    deviceType: 'bslR1',
    rSquared: 0.999995,
    slope: 1.05,
    intercept: 0.001,
    hysteresis: 10,
    stdev: 5,
    status: 'PASS' as const,
    lastCalDate: '2025-01-01',
    issues: [],
    rawData: '[]'
};

const mockCalibrationFail = {
    deviceType: 'chandler5550',
    rSquared: 0.9,
    slope: 1.0,
    intercept: 0.5,
    hysteresis: 100, // Bad
    stdev: 50, // Bad
    status: 'FAIL' as const,
    lastCalDate: '2025-01-01',
    issues: ['Too much hysteresis'],
    rawData: '[]'
};

describe('CalibrationPanel', () => {
    it('renders "Calibration Not Found" when no data provided', () => {
        render(<CalibrationPanel calibration={null} />);
        expect(screen.getByText(/Калибровка не найдена/i)).toBeDefined();
    });

    it('renders PASS status correctly', () => {
        render(<CalibrationPanel calibration={mockCalibrationPass} />);
        expect(screen.getByText(/Калибровка пройдена/i)).toBeDefined();
        // Check numeric values
        expect(screen.getByText('0.999995')).toBeDefined();
        expect(screen.getByText('1.0500')).toBeDefined();
    });

    it('renders FAIL status and issues', () => {
        render(<CalibrationPanel calibration={mockCalibrationFail} />);
        expect(screen.getByText(/Калибровка не пройдена/i)).toBeDefined();
        expect(screen.getByText('Too much hysteresis')).toBeDefined();
    });
});
