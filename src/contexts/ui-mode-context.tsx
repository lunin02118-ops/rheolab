import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useAnalysisSettingsStore } from '@/lib/store/analysis-settings-store';

type UIMode = 'beginner' | 'expert';

interface UIModeContextType {
    mode: UIMode;
    toggleMode: () => void;
    setMode: (mode: UIMode) => void;
    isExpert: boolean;
}

const UIModeContext = createContext<UIModeContextType | undefined>(undefined);

export function UIModeProvider({ children }: { children: React.ReactNode }) {
    const [mode, setModeState] = useState<UIMode>('beginner');

    // Persist to localStorage
    useEffect(() => {
        const saved = localStorage.getItem('rheolab-ui-mode');
        if (saved === 'expert' || saved === 'beginner') {
            setModeState(saved);
        }
    }, []);

    const setMode = useCallback((newMode: UIMode) => {
        setModeState(newMode);
        localStorage.setItem('rheolab-ui-mode', newMode);
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
