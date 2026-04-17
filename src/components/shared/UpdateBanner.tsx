/**
 * UpdateBanner.tsx
 *
 * Non-blocking notification bar that appears when a new version is available.
 * Placed just below the sticky header inside DashboardLayoutClient.
 *
 * States:
 *   available   → "Доступно обновление vX.Y.Z"  [Установить] [×]
 *   downloading → progress bar with %
 *   ready       → "Готово к установке"          [Перезапустить]
 *   error       → error message                  [×]
 */

import { Download, RefreshCw, X, ArrowDownToLine, ShieldCheck, FolderOpen } from 'lucide-react';
import { useUpdateStore } from '@/lib/store/update-store';
import { startUpdateInstall, relaunchApp } from './UpdateChecker';
import { backup } from '@/lib/tauri/backup';

export function UpdateBanner() {
    const status = useUpdateStore((state) => state.status);
    const version = useUpdateStore((state) => state.version);
    const notes = useUpdateStore((state) => state.notes);
    const downloadProgress = useUpdateStore((state) => state.downloadProgress);
    const error = useUpdateStore((state) => state.error);
    const dismiss = useUpdateStore((state) => state.dismiss);
    const postUpdate = useUpdateStore((state) => state.postUpdate);
    const dismissPostUpdate = useUpdateStore((state) => state.dismissPostUpdate);

    if (status === 'idle' || status === 'checking') {
        // Show post-update recovery banner even when update status is idle.
        if (!postUpdate) return null;
    }

    // ── Post-update recovery ──────────────────────────────────────────────
    // Shown on the first launch after an update.  The user can restore from
    // the backup that was created automatically before the update installed.
    if (postUpdate && (status === 'idle' || status === 'checking')) {
        return (
            <div
                role="status"
                aria-live="polite"
                className="w-full bg-teal-950/80 border-b border-teal-700/50 backdrop-blur-sm"
            >
                <div className="max-w-screen-2xl mx-auto px-6 py-2 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                        <ShieldCheck className="w-4 h-4 text-teal-400 shrink-0" />
                        <span className="text-sm text-teal-200">
                            Приложение обновлено:{' '}
                            <strong className="text-foreground font-semibold">
                                v{postUpdate.previousVersion}
                            </strong>
                            {' → '}
                            <strong className="text-foreground font-semibold">
                                v{postUpdate.currentVersion}
                            </strong>
                            <span className="hidden md:inline text-teal-400">
                                {' '}— резервная копия создана перед установкой
                            </span>
                        </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            type="button"
                            onClick={() => backup.openFolder()}
                            className="flex items-center gap-1.5 text-xs font-medium text-teal-300 hover:text-foreground px-3 py-1.5 rounded-md transition-colors border border-teal-700/50 hover:border-teal-500"
                        >
                            <FolderOpen className="w-3.5 h-3.5" />
                            Открыть backup
                        </button>
                        <button
                            type="button"
                            onClick={dismissPostUpdate}
                            aria-label="Закрыть"
                            className="text-teal-400 hover:text-teal-200 transition-colors p-1"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── Available ──────────────────────────────────────────────────────────
    if (status === 'available') {
        return (
            <div
                role="alert"
                aria-live="polite"
                className="w-full bg-purple-950/80 border-b border-purple-700/50 backdrop-blur-sm"
            >
                <div className="max-w-screen-2xl mx-auto px-6 py-2 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                        <ArrowDownToLine className="w-4 h-4 text-purple-400 shrink-0" />
                        <span className="text-sm text-purple-200">
                            Доступно обновление{' '}
                            <strong className="text-foreground font-semibold">
                                v{version}
                            </strong>
                        </span>
                        {notes && (
                            <span className="hidden md:inline text-xs text-purple-400 truncate max-w-xs">
                                — {notes.split('\n')[0].replace(/^#+\s*/, '').slice(0, 80)}
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            type="button"
                            onClick={startUpdateInstall}
                            className="flex items-center gap-1.5 text-xs font-medium bg-purple-600 hover:bg-purple-500 text-foreground px-3 py-1.5 rounded-md transition-colors"
                        >
                            <Download className="w-3.5 h-3.5" />
                            Установить
                        </button>
                        <button
                            type="button"
                            onClick={dismiss}
                            aria-label="Закрыть уведомление"
                            className="text-purple-400 hover:text-purple-200 transition-colors p-1"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── Downloading ────────────────────────────────────────────────────────
    if (status === 'downloading') {
        return (
            <div
                role="status"
                aria-live="polite"
                className="w-full bg-card/90 border-b border-border/50"
            >
                <div className="max-w-screen-2xl mx-auto px-6 py-2 flex items-center gap-4">
                    <Download className="w-4 h-4 text-blue-400 shrink-0 animate-pulse" />
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-sm text-foreground/80">
                                Загрузка обновления v{version}…
                            </span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                                {downloadProgress}%
                            </span>
                        </div>
                        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                            <div
                                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                style={{ width: `${downloadProgress}%` }}
                            />
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── Ready to install ───────────────────────────────────────────────────
    if (status === 'ready') {
        return (
            <div
                role="alert"
                aria-live="polite"
                className="w-full bg-emerald-950/80 border-b border-emerald-700/50 backdrop-blur-sm"
            >
                <div className="max-w-screen-2xl mx-auto px-6 py-2 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <RefreshCw className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span className="text-sm text-emerald-200">
                            Обновление v{version} установлено.
                            Перезапустите приложение, чтобы применить изменения.
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={relaunchApp}
                        className="flex items-center gap-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-foreground px-3 py-1.5 rounded-md transition-colors shrink-0"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Перезапустить
                    </button>
                </div>
            </div>
        );
    }

    // ── Error ──────────────────────────────────────────────────────────────
    if (status === 'error') {
        return (
            <div
                role="alert"
                aria-live="assertive"
                className="w-full bg-red-950/80 border-b border-red-700/50 backdrop-blur-sm"
            >
                <div className="max-w-screen-2xl mx-auto px-6 py-2 flex items-center justify-between gap-4">
                    <span className="text-sm text-red-300 truncate">
                        {error ?? 'Ошибка обновления'}
                    </span>
                    <button
                        type="button"
                        onClick={dismiss}
                        aria-label="Закрыть"
                        className="text-red-400 hover:text-red-200 transition-colors p-1 shrink-0"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>
        );
    }

    return null;
}
