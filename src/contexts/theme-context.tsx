import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

export type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
    theme: Theme;
    resolvedTheme: 'light' | 'dark';
    setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = 'rheolab-theme';

function getSystemTheme(): 'light' | 'dark' {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme): 'light' | 'dark' {
    const resolved = theme === 'system' ? getSystemTheme() : theme;
    const html = document.documentElement;
    if (resolved === 'dark') {
        html.classList.add('dark');
    } else {
        html.classList.remove('dark');
    }
    return resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setThemeState] = useState<Theme>('system');
    const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('dark');

    // Read saved preference on mount and apply
    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
        const initial: Theme = (saved === 'light' || saved === 'dark' || saved === 'system') ? saved : 'system';
        setThemeState(initial);
        setResolvedTheme(applyTheme(initial));
    }, []);

    // Listen for OS-level changes when in system mode
    useEffect(() => {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = () => {
            if (theme === 'system') {
                setResolvedTheme(applyTheme('system'));
            }
        };
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, [theme]);

    const setTheme = useCallback((next: Theme) => {
        setThemeState(next);
        localStorage.setItem(STORAGE_KEY, next);
        setResolvedTheme(applyTheme(next));
    }, []);

    return (
        <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme(): ThemeContextType {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
    return ctx;
}
