// @vitest-environment jsdom
/**
 * Tests for src/contexts/ui-mode-context.tsx
 *
 * Covers:
 *   - UIModeProvider reads/persists mode in localStorage
 *   - setMode('beginner') calls analysisSettingsStore.resetToDefaults()
 *   - setMode('expert') does NOT call resetToDefaults()
 *   - toggleMode() alternates between beginner/expert
 *   - isExpert reflects current mode
 *   - useUIMode() throws when used outside provider
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mock analysis-settings-store ─────────────────────────────────────────────

const mockResetToDefaults = vi.fn();

vi.mock('@/lib/store/analysis-settings-store', () => ({
    useAnalysisSettingsStore: {
        getState: () => ({ resetToDefaults: mockResetToDefaults }),
    },
}));

import { UIModeProvider, useUIMode } from '@/contexts/ui-mode-context';

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
});

afterEach(() => {
    localStorage.clear();
});

const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(UIModeProvider, null, children);

// ── Tests ────────────────────────────────────────────────────────────────────

describe('UIModeProvider — initial state', () => {
    it('defaults to beginner mode when no localStorage entry', () => {
        const { result } = renderHook(() => useUIMode(), { wrapper });
        expect(result.current.mode).toBe('beginner');
    });

    it('reads "expert" from localStorage on mount', () => {
        localStorage.setItem('rheolab-ui-mode', 'expert');
        const { result } = renderHook(() => useUIMode(), { wrapper });
        expect(result.current.mode).toBe('expert');
    });

    it('reads "beginner" from localStorage on mount', () => {
        localStorage.setItem('rheolab-ui-mode', 'beginner');
        const { result } = renderHook(() => useUIMode(), { wrapper });
        expect(result.current.mode).toBe('beginner');
    });

    it('ignores unknown localStorage values and keeps beginner', () => {
        localStorage.setItem('rheolab-ui-mode', 'advanced');
        const { result } = renderHook(() => useUIMode(), { wrapper });
        expect(result.current.mode).toBe('beginner');
    });

    it('isExpert is false in initial beginner mode', () => {
        const { result } = renderHook(() => useUIMode(), { wrapper });
        expect(result.current.isExpert).toBe(false);
    });
});

describe('setMode()', () => {
    it('switches to expert mode', () => {
        const { result } = renderHook(() => useUIMode(), { wrapper });
        act(() => { result.current.setMode('expert'); });
        expect(result.current.mode).toBe('expert');
    });

    it('isExpert becomes true when mode=expert', () => {
        const { result } = renderHook(() => useUIMode(), { wrapper });
        act(() => { result.current.setMode('expert'); });
        expect(result.current.isExpert).toBe(true);
    });

    it('persists mode to localStorage', () => {
        const { result } = renderHook(() => useUIMode(), { wrapper });
        act(() => { result.current.setMode('expert'); });
        expect(localStorage.getItem('rheolab-ui-mode')).toBe('expert');
    });

    it('setMode("beginner") calls resetToDefaults() in analysisSettingsStore', () => {
        const { result } = renderHook(() => useUIMode(), { wrapper });
        // First go expert, then come back to beginner
        act(() => { result.current.setMode('expert'); });
        act(() => { result.current.setMode('beginner'); });
        expect(mockResetToDefaults).toHaveBeenCalledTimes(1);
    });

    it('setMode("expert") does NOT call resetToDefaults()', () => {
        const { result } = renderHook(() => useUIMode(), { wrapper });
        act(() => { result.current.setMode('expert'); });
        expect(mockResetToDefaults).not.toHaveBeenCalled();
    });

    it('setting beginner from beginner still calls resetToDefaults()', () => {
        const { result } = renderHook(() => useUIMode(), { wrapper });
        act(() => { result.current.setMode('beginner'); });
        expect(mockResetToDefaults).toHaveBeenCalledTimes(1);
    });
});

describe('toggleMode()', () => {
    it('toggles from beginner to expert', () => {
        const { result } = renderHook(() => useUIMode(), { wrapper });
        act(() => { result.current.toggleMode(); });
        expect(result.current.mode).toBe('expert');
    });

    it('toggles from expert back to beginner', () => {
        localStorage.setItem('rheolab-ui-mode', 'expert');
        const { result } = renderHook(() => useUIMode(), { wrapper });
        act(() => { result.current.toggleMode(); });
        expect(result.current.mode).toBe('beginner');
    });

    it('toggles twice returns to original mode', () => {
        const { result } = renderHook(() => useUIMode(), { wrapper });
        act(() => { result.current.toggleMode(); }); // → expert
        act(() => { result.current.toggleMode(); }); // → beginner
        expect(result.current.mode).toBe('beginner');
    });

    it('toggle to beginner calls resetToDefaults()', () => {
        localStorage.setItem('rheolab-ui-mode', 'expert');
        const { result } = renderHook(() => useUIMode(), { wrapper });
        act(() => { result.current.toggleMode(); }); // expert → beginner
        expect(mockResetToDefaults).toHaveBeenCalledTimes(1);
    });

    it('toggle to expert does NOT call resetToDefaults()', () => {
        const { result } = renderHook(() => useUIMode(), { wrapper });
        act(() => { result.current.toggleMode(); }); // beginner → expert
        expect(mockResetToDefaults).not.toHaveBeenCalled();
    });
});

describe('useUIMode() outside provider', () => {
    it('throws when used without UIModeProvider', () => {
        expect(() => {
            renderHook(() => useUIMode());
        }).toThrow('useUIMode must be used within a UIModeProvider');
    });
});
