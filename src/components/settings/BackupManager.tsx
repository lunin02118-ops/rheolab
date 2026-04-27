import { logger } from '@/lib/logger';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Download, RotateCcw, Trash2, AlertTriangle, Check, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { invoke } from '@/lib/tauri/core';
import { getBridge } from '@/lib/tauri/bridge';
import type { BackupInfo } from '@/types/tauri';

type ConfirmAction =
    | { type: 'restore'; filename: string }
    | { type: 'delete'; filename: string };

export function BackupManager() {
    const [backups, setBackups] = useState<BackupInfo[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

    const bridge = getBridge();
    // bridge.isDesktop is the source of truth — use it directly rather than
    // mirroring into React state via a setState-in-effect round-trip.
    const isDesktop = bridge.isDesktop;

    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const loadBackups = useCallback(async () => {
        if (!bridge.isDesktop) return;
        try {
            const list = await bridge.backup.list();
            if (mountedRef.current) setBackups(list);
        } catch (e) {
            logger.error('Failed to load backups', e);
        }
    }, [bridge]);

    useEffect(() => {
        if (!isDesktop) return;
        // Defer through a microtask so any synchronous setState at the head
        // of loadBackups runs after this effect body returns.
        void Promise.resolve().then(loadBackups);
    }, [isDesktop, loadBackups]);

    const handleCreate = async () => {
        setIsLoading(true);
        setError(null);
        setSuccessMsg(null);
        try {
            // 1. Force DB checkpoint — non-fatal, VACUUM INTO handles WAL anyway
            try {
                await invoke('licensing_checkpoint_db');
            } catch (e) {
                logger.error('WAL checkpoint failed (non-fatal)', e);
            }

            // 2. Create backup via platform bridge
            const res = await bridge.backup.create();
            if (res.success) {
                setSuccessMsg('Резервная копия создана');
                await loadBackups();
            } else {
                setError(res.error || 'Ошибка создания');
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.error('Backup creation failed', e);
            setError(`Ошибка создания: ${msg}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleRestore = async (filename: string) => {
        setConfirmAction({ type: 'restore', filename });
    };

    const handleDelete = async (filename: string) => {
        setConfirmAction({ type: 'delete', filename });
    };

    const handleConfirm = async () => {
        if (!confirmAction) return;
        const action = confirmAction;
        setConfirmAction(null);

        if (action.type === 'restore') {
            setIsLoading(true);
            try {
                const res = await bridge.backup.restore(action.filename);
                if (!res.success) {
                    setError(res.error || 'Ошибка восстановления');
                    setIsLoading(false);
                }
                // If success, app will restart
            } catch (_e) {
                setError('Ошибка восстановления');
                setIsLoading(false);
            }
        } else if (action.type === 'delete') {
            try {
                await bridge.backup.delete(action.filename);
                await loadBackups();
            } catch (e) {
                logger.error('Failed to delete backup:', e);
            }
        }
    };

    const handleOpenFolder = async () => {
        try {
            await bridge.backup.openFolder();
        } catch (e) {
            logger.error('Failed to open backup folder', e);
        }
    };

    if (!isDesktop) {
        return (
            <div className="p-4 text-muted-foreground text-sm">
                Управление резервными копиями доступно только в десктопном приложении.
            </div>
        );
    }

    return (
        <>
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium text-foreground">Резервные копии</h3>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleOpenFolder}
                            aria-label="Открыть папку с бэкапами"
                            className="h-6 w-6 text-muted-foreground hover:text-blue-400"
                        >
                            <FolderOpen className="w-3.5 h-3.5" />
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Локальные копии базы данных (SQLite)</p>
                </div>
                <div className="flex gap-2">
                    <Button
                        onClick={handleCreate}
                        disabled={isLoading}
                        variant="outline"
                        size="sm"
                        className="gap-2"
                    >
                        <Download className="w-4 h-4" />
                        Создать копию
                    </Button>
                </div>
            </div>

            {error && (
                <div className="p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded text-red-600 dark:text-red-400 text-sm flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    {error}
                </div>
            )}

            {successMsg && (
                <div className="p-3 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded text-green-700 dark:text-green-400 text-sm flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    {successMsg}
                </div>
            )}

            <div className="border border-border rounded-lg overflow-hidden">
                {backups.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground text-sm">
                        Нет резервных копий
                    </div>
                ) : (
                    <table className="w-full text-sm text-left">
                        <thead className="bg-secondary text-muted-foreground">
                            <tr>
                                <th className="px-4 py-2 font-medium">Дата</th>
                                <th className="px-4 py-2 font-medium">Размер</th>
                                <th className="px-4 py-2 font-medium text-right">Действия</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {backups.map((backup) => (
                                <tr key={backup.name} className="hover:bg-secondary/50">
                                    <td className="px-4 py-3 text-foreground/80">
                                        {format(new Date(backup.date), 'dd MMM yyyy, HH:mm', { locale: ru })}
                                    </td>
                                    <td className="px-4 py-3 text-muted-foreground">
                                        {(backup.size / 1024 / 1024).toFixed(2)} MB
                                    </td>
                                    <td className="px-4 py-3 text-right flex justify-end gap-2">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleRestore(backup.name)}
                                            className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                                            title="Восстановить"
                                        >
                                            <RotateCcw className="w-4 h-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleDelete(backup.name)}
                                            className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                            title="Удалить"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>

        <AlertDialog open={!!confirmAction} onOpenChange={open => { if (!open) setConfirmAction(null); }}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {confirmAction?.type === 'delete' ? 'Удалить резервную копию?' : 'Начать восстановление?'}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {confirmAction?.type === 'delete'
                            ? 'Этот файл резервной копии будет удалён безвозвратно.'
                            : 'ВНИМАНИЕ! Текущая база данных будет заменена выбранной копией. Приложение перезапустится. Продолжить?'}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Отмена</AlertDialogCancel>
                    <AlertDialogAction
                        className={confirmAction?.type === 'delete' ? 'bg-red-600 hover:bg-red-500' : 'bg-amber-600 hover:bg-amber-500'}
                        onClick={handleConfirm}
                    >
                        {confirmAction?.type === 'delete' ? 'Удалить' : 'Восстановить'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
        </>
    );
}
