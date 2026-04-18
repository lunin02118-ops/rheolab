import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Providers } from '@/components/providers/providers';
import { AppRoutes } from './routes';
import './app/globals.css';
import '@/lib/perf-monitor'; // registers window.__perfMon global for benchmark tooling

// ─── Global error capture ─────────────────────────────────────────────────
// Log uncaught JS errors and unhandled promise rejections to the Tauri log
// so crashes in the renderer are visible in the on-disk app.log file.
async function logCrashToTauri(message: string): Promise<void> {
    try {
        const { error: tauriError } = await import('@tauri-apps/plugin-log');
        await tauriError(`[renderer crash] ${message}`);
    } catch (_e) {
        // Tauri log not available (e.g. in unit tests) — swallow silently
    }
}

window.addEventListener('error', (event) => {
    const msg = `Uncaught error: ${event.message} @ ${event.filename}:${event.lineno}:${event.colno}\n${event.error?.stack ?? ''}`;
    console.error('[GlobalErrorHandler]', msg);
    void logCrashToTauri(msg);
});

window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error
        ? event.reason.stack ?? event.reason.message
        : String(event.reason);
    const msg = `Unhandled promise rejection: ${reason}`;
    console.error('[GlobalErrorHandler]', msg);
    void logCrashToTauri(msg);
});
// ─────────────────────────────────────────────────────────────────────────────

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Providers>
        <AppRoutes />
      </Providers>
    </BrowserRouter>
  </React.StrictMode>,
);
