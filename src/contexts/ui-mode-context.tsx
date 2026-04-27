import React, { createContext, useContext, useState, useCallback } from 'react';
import { useAnalysisSettingsStore } from '@/lib/store/analysis-settings-store';

type UIMode = 'beginner' | 'expert';

interface UIModeContextType {
    mode: UIMode;
    toggleMode: () => void;
    setMode: (mode: UIMode) => void;
    isExpert: boolean;
}

const UIModeContext = createContext<UIModeContextType | undefined>(undefined);

const STORAGE_KEY = 'rheolab-ui-mode';

function readSavedMode(): UIMode {
    if (typeof window === 'undefined') return 'beginner';
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'expert' || saved === 'beginner' ? saved : 'beginner';
}

export function UIModeProvider({ children }: { children: React.ReactNode }) {
    // Lazy init reads localStorage once during mount — no setState-in-effect
    // round-trip and no first-paint flash with the wrong mode.
    const [mode, setModeState] = useState<UIMode>(readSavedMode);

    const setMode = useCallback((newMode: UIMode) => {
        setModeState(newMode);
        localStorage.setItem(STORAGE_KEY, newMode);
        // When switching to basic mode, reset analysis settings to safe defaults
        // so beginners always get a predictable configuration
        if (newMode === 'beginner') {
            useAnalysisSettingsStore.getState().resetToDefaults();
        }
    }, []);

    const toggleMode = useCallback(() => {
        setMode(mode === 'beginner' ? 'expert' : 'beginner');
    }, [mode, setMode]);

    return (
        <UIModeContext.Provider value={{
            mode,
            toggleMode,
            setMode,
            isExpert: mode === 'expert'
        }}>
            {children}
        </UIModeContext.Provider>
    );
}

export function useUIMode() {
    const context = useContext(UIModeContext);
    if (!context) {
        throw new Error('useUIMode must be used within a UIModeProvider');
    }
    return context;
}
