import { logger } from '@/lib/logger';

import { UIModeProvider } from '@/contexts/ui-mode-context';
import { ThemeProvider } from '@/contexts/theme-context';
import { lazy, Suspense, useEffect } from 'react';
import { isTauri } from '@/lib/tauri';
import { WindowChromeSync } from '@/components/layout/window-chrome-sync';

// Lazy-loaded: LogViewer is a debug panel that has no above-the-fold role.
// Deferring its bundle load reduces initial parse cost and removes its DOM
// nodes from the startup paint.
const LogViewer = lazy(() =>
    import('@/components/debug/LogViewer').then(m => ({ default: m.LogViewer }))
);

export function Providers({ children }: { children: React.ReactNode }) {
    useEffect(() => {
        if (isTauri()) {
            logger.info('[Providers] Desktop runtime detected');
        }

        // WASM is loaded lazily on first use (e.g., when analysis or reports are needed).
        // This avoids ~40-80 MB of memory allocation on app startup for users
        // who may only be browsing the library or comparison page.
        // The worker loads its own WASM instance independently.
        logger.info('[Providers] WASM Engine loading deferred to first use');
    }, []);

    return (
        <ThemeProvider>
            <WindowChromeSync />
            <UIModeProvider>
                {children}
                {/* null fallback: debug panel is non-critical; no visible loading state needed */}
                <Suspense fallback={null}>
                    <LogViewer />
                </Suspense>
            </UIModeProvider>
        </ThemeProvider>
    );
}

