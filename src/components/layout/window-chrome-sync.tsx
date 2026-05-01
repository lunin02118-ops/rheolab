import { useEffect } from 'react';
import { useTheme } from '@/contexts/theme-context';
import { setWindowThemeChrome } from '@/lib/tauri/window-chrome';

export function WindowChromeSync() {
    const { resolvedTheme } = useTheme();

    useEffect(() => {
        void setWindowThemeChrome(resolvedTheme).catch((error) => {
            console.warn('[WindowChromeSync] Failed to sync native titlebar theme', error);
        });
    }, [resolvedTheme]);

    return null;
}
