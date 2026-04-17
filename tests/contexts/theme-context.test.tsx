// @vitest-environment jsdom
/**
 * Tests for src/contexts/theme-context.tsx
 *
 * Covers:
 *   - ThemeProvider reads localStorage on mount and applies theme
 *   - setTheme() persists to localStorage + applies CSS class
 *   - resolvedTheme reflects dark/light CSS state
 *   - system theme queries window.matchMedia
 *   - useTheme() throws when used outside provider
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from '@/contexts/theme-context';

// ── matchMedia mock ──────────────────────────────────────────────────────────

function mockMatchMedia(prefersDark: boolean) {
    const listeners: Array<(e: MediaQueryListEvent) => void> = [];
    const mq: MediaQueryList = {
        matches: prefersDark,
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: (_type: string, handler: EventListenerOrEventListenerObject) => {
            listeners.push(handler as (e: MediaQueryListEvent) => void);
        },
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    };
    window.matchMedia = vi.fn().mockReturnValue(mq);
    return { mq, listeners };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    mockMatchMedia(false); // default: light system
});

afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    vi.restoreAllMocks();
});

const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(ThemeProvider, null, children);

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ThemeProvider', () => {
    it('provides a theme context to children', () => {
        const { result } = renderHook(() => useTheme(), { wrapper });
        expect(result.current).toBeDefined();
        expect(typeof result.current.setTheme).toBe('function');
    });

    it('starts with system theme when no localStorage entry', () => {
        const { result } = renderHook(() => useTheme(), { wrapper });
        expect(result.current.theme).toBe('system');
    });

    it('reads "light" from localStorage on mount', () => {
        localStorage.setItem('rheolab-theme', 'light');
        const { result } = renderHook(() => useTheme(), { wrapper });
        // After effect runs:
        expect(result.current.theme).toBe('light');
    });

    it('reads "dark" from localStorage on mount', () => {
        localStorage.setItem('rheolab-theme', 'dark');
        const { result } = renderHook(() => useTheme(), { wrapper });
        expect(result.current.theme).toBe('dark');
    });

    it('ignores invalid localStorage values and defaults to system', () => {
        localStorage.setItem('rheolab-theme', 'invalid-value');
        const { result } = renderHook(() => useTheme(), { wrapper });
        expect(result.current.theme).toBe('system');
    });
});

describe('setTheme()', () => {
    it('updates the theme state', () => {
        const { result } = renderHook(() => useTheme(), { wrapper });
        act(() => { result.current.setTheme('dark'); });
        expect(result.current.theme).toBe('dark');
    });

    it('persists the theme to localStorage', () => {
        const { result } = renderHook(() => useTheme(), { wrapper });
        act(() => { result.current.setTheme('light'); });
        expect(localStorage.getItem('rheolab-theme')).toBe('light');
    });

    it('adds "dark" class to documentElement when setting dark theme', () => {
        const { result } = renderHook(() => useTheme(), { wrapper });
        act(() => { result.current.setTheme('dark'); });
        expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('removes "dark" class from documentElement when setting light theme', () => {
        document.documentElement.classList.add('dark'); // start dark
        const { result } = renderHook(() => useTheme(), { wrapper });
        act(() => { result.current.setTheme('light'); });
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('sets resolvedTheme to "dark" when theme=dark', () => {
        const { result } = renderHook(() => useTheme(), { wrapper });
        act(() => { result.current.setTheme('dark'); });
        expect(result.current.resolvedTheme).toBe('dark');
    });

    it('sets resolvedTheme to "light" when theme=light', () => {
        const { result } = renderHook(() => useTheme(), { wrapper });
        act(() => { result.current.setTheme('light'); });
        expect(result.current.resolvedTheme).toBe('light');
    });
});

describe('system theme resolution', () => {
    it('resolves to "dark" when system prefers dark', () => {
        mockMatchMedia(true);
        const { result } = renderHook(() => useTheme(), { wrapper });
        act(() => { result.current.setTheme('system'); });
        expect(result.current.resolvedTheme).toBe('dark');
    });

    it('resolves to "light" when system prefers light', () => {
        mockMatchMedia(false);
        const { result } = renderHook(() => useTheme(), { wrapper });
        act(() => { result.current.setTheme('system'); });
        expect(result.current.resolvedTheme).toBe('light');
    });
});

describe('useTheme() outside provider', () => {
    it('throws an error when used without ThemeProvider', () => {
        expect(() => {
            renderHook(() => useTheme());
        }).toThrow('useTheme must be used within ThemeProvider');
    });
});
