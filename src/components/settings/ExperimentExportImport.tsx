import { useState } from 'react';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@/lib/tauri/core';
import { TauriError } from '@/lib/tauri/errors';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
    FileUp, FileDown, Check, AlertTriangle, Loader2,
    Database, Beaker
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getExperimentsCount } from '@/lib/experiments/client';
import { exportReagents, importReagents } from '@/lib/reagents/client';

interface ExportStats {
    total: number;
    exported: number;
    filename: string;
}

interface ImportResult {
    imported: number;
    updated?: number;
    skipped: number;
    errors: string[];
}

export function ExperimentExportImport() {
    const [activeTab, setActiveTab] = useState('experiments');
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [exportStats, setExportStats] = useState<ExportStats | null>(null);
    const [importResult, setImportResult] = useState<ImportResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    // ── Export: Experiments (as .db file via save dialog) ──────────────────
    const handleExportExperiments = async () => {
        setIsExporting(true);
        setError(null);
        setExportStats(null);

        try {
            const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm');
            const defaultName = `rheolab_export_${timestamp}.db`;

            const filePath = await save({
                defaultPath: defaultName,
                filters: [
                    { name: 'База данных RheoLab', extensions: ['db'] },
                ],
            });
            if (!filePath) return; // User cancelled

            const result = await invoke<{
                success: boolean;
                error?: string;
                name?: string;
            }>('backup_export_db', { targetPath: filePath });

            if (!result.success) {
                throw new Error(result.error || 'Ошибка экспорта');
            }

            const count = await getExperimentsCount();
            const filename = filePath.split(/[\\/]/).pop() || defaultName;
            setExportStats({ total: count, exported: count, filename });
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Ошибка экспорта');
        } finally {
            setIsExporting(false);
        }
    };

    // ── Export: Reagents (as .json file via save dialog) ───────────────────
    const handleExportReagents = async () => {
        setIsExporting(true);
        setError(null);
        setExportStats(null);

        try {
            const data = await exportReagents();
            if (!data.success) throw new Error(data.error || 'Ошибка экспорта');

            const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm');
            const defaultName = `rheolab_reagents_${timestamp}.json`;

            const filePath = await save({
                defaultPath: defaultName,
                filters: [
                    { name: 'JSON', extensions: ['json'] },
                ],
            });
            if (!filePath) return; // User cancelled

            const json = JSON.stringify(data, null, 2);
            await writeFile(filePath, new TextEncoder().encode(json));

            const filename = filePath.split(/[\\/]/).pop() || defaultName;
            setExportStats({
                total: data.total,
                exported: data.reagents.length,
                filename,
            });
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Ошибка экспорта');
        } finally {
            setIsExporting(false);
        }
    };

    // ── Handle export button click ────────────────────────────────────────
    const handleExport = async () => {
        if (activeTab === 'experiments') {
            await handleExportExperiments();
        } else {
            await handleExportReagents();
        }
    };

    // ── Import: native file dialog (.db or .json) ─────────────────────────
    const handleNativeImport = async () => {
        try {
            const isExperiments = activeTab === 'experiments';

            const filePath = await open({
                multiple: false,
                filters: isExperiments
                    ? [
                        { name: 'База данных RheoLab', extensions: ['db'] },
                        { name: 'JSON (устар.)', extensions: ['json'] },
                    ]
                    : [
                        { name: 'JSON', extensions: ['json'] },
                    ],
            });
            if (!filePath) return;

            const path = typeof filePath === 'string' ? filePath : filePath;

            if (path.endsWith('.db')) {
                // SQLite DB merge import
                setIsImporting(true);
                setError(null);
                setImportResult(null);

                const result = await invoke<{
                    success: boolean;
                    error?: string;
                    imported: number;
                    skipped: number;
                }>('backup_import_db', { filePath: path });

                if (!result.success) {
                    setError(result.error || 'Ошибка импорта базы данных');
                } else {
                    setImportResult({
                        imported: result.imported,
                        skipped: result.skipped,
                        errors: [],
                    });
                }
            } else {
                // JSON file import (reagents or legacy experiments)
                setIsImporting(true);
                setError(null);
                setImportResult(null);

                const bytes = await readFile(path);
                const text = new TextDecoder().decode(bytes);
                let jsonData;

                try {
                    jsonData = JSON.parse(text);
                } catch (_e) {
                    throw new Error('Невалидный JSON файл');
                }

                if (jsonData.reagents || (Array.isArray(jsonData) && jsonData[0]?.category)) {
                    const reagentsPayload = (jsonData.reagents || jsonData) as unknown[];
                    const result = await importReagents(reagentsPayload);
                    if (!result.success) throw new Error(result.error || 'Ошибка импорта');
                    setImportResult({
                        imported: result.imported,
                        updated: result.updated,
                        skipped: result.skipped,
                        errors: result.errors || [],
                    });
                } else {
                    throw new Error('Не удалось определить тип данных в файле. Используйте формат .db для экспериментов.');
                }
            }
        } catch (e) {
            // Tauri IPC errors (e.g. AppError::BadRequest from a refused
            // import after FK violations — see DB-002) come through as
            // a {kind, message} envelope, not as `Error` instances.
            // TauriError.from handles both shapes plus plain string errors.
            setError(TauriError.from(e).message || 'Ошибка импорта');
        } finally {
            setIsImporting(false);
        }
    };

    return (
        <div className="space-y-6">
            <Tabs defaultValue="experiments" onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2 bg-secondary/50">
                    <TabsTrigger value="experiments" className="gap-2">
                        <Database className="w-4 h-4" />
                        Эксперименты
                    </TabsTrigger>
                    <TabsTrigger value="reagents" className="gap-2">
                        <Beaker className="w-4 h-4" />
                        База реагентов
                    </TabsTrigger>
                </TabsList>

                {/* Experiments Tab Content */}
                <TabsContent value="experiments" className="space-y-4 pt-4">
                    <div>
                        <h3 className="text-sm font-medium text-foreground">Экспорт и импорт экспериментов</h3>
                        <p className="text-xs text-muted-foreground">Перенос базы данных между филиалами в формате SQLite (.db)</p>
                    </div>
                    <div className="p-4 bg-blue-50 dark:bg-blue-500/5 border border-blue-200 dark:border-blue-500/10 rounded-lg">
                        <p className="text-xs text-blue-700 dark:text-blue-200/70 leading-relaxed">
                            <Database className="w-3 h-3 inline mr-1 mb-0.5" />
                            Экспорт создаёт полную копию базы данных. При импорте новые эксперименты добавляются
                            в текущую базу, дубликаты пропускаются. Существующие данные не затрагиваются.
                        </p>
                    </div>
                </TabsContent>

                {/* Reagents Tab Content */}
                <TabsContent value="reagents" className="space-y-4 pt-4">
                    <div>
                        <h3 className="text-sm font-medium text-foreground">Справочник реагентов</h3>
                        <p className="text-xs text-muted-foreground">Экспорт и обновление глобального каталога химии</p>
                    </div>
                    <div className="p-4 bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/10 rounded-lg">
                        <p className="text-xs text-amber-700 dark:text-amber-200/70 leading-relaxed">
                            <AlertTriangle className="w-3 h-3 inline mr-1 mb-0.5" />
                            При импорте реагентов, если реагент с таким именем уже существует, его данные будут
                            обновлены (категория, производитель и т.д.). Это полезно для синхронизации справочников.
                        </p>
                    </div>
                </TabsContent>
            </Tabs>

            {/* Common Action Buttons */}
            <div className="flex gap-3">
                <Button
                    onClick={handleExport}
                    disabled={isExporting || isImporting}
                    variant="outline"
                    className="gap-2 flex-1"
                >
                    {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                    {activeTab === 'experiments' ? 'Экспорт базы данных' : 'Экспорт каталога'}
                </Button>

                <Button
                    onClick={handleNativeImport}
                    disabled={isExporting || isImporting}
                    variant="outline"
                    className="gap-2 flex-1"
                >
                    {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
                    Импорт из файла
                </Button>
            </div>

            {/* Status Messages */}
            {error && (
                <div className="p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded text-red-600 dark:text-red-400 text-sm flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {error}
                </div>
            )}

            {exportStats && (
                <div className="p-3 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded text-green-700 dark:text-green-400 text-sm flex items-center gap-2">
                    <Check className="w-4 h-4 shrink-0" />
                    <div>
                        <div>Экспортировано {exportStats.exported} записей</div>
                        <div className="text-xs opacity-70">Файл: {exportStats.filename}</div>
                    </div>
                </div>
            )}

            {importResult && (
                <div className={`p-3 border rounded text-sm ${importResult.errors.length > 0
                    ? 'bg-yellow-50 dark:bg-yellow-500/10 border-yellow-200 dark:border-yellow-500/20 text-yellow-700 dark:text-yellow-400'
                    : 'bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/20 text-green-700 dark:text-green-400'
                    }`}>
                    <div className="flex items-center gap-2">
                        <Check className="w-4 h-4 shrink-0" />
                        <div>
                            <div>
                                {importResult.imported > 0 && `Добавлено: ${importResult.imported}. `}
                                {importResult.updated !== undefined && importResult.updated > 0 && `Обновлено: ${importResult.updated}. `}
                                {importResult.skipped > 0 && `Пропущено (дубликаты): ${importResult.skipped}.`}
                            </div>
                            {importResult.errors.length > 0 && (
                                <div className="text-xs mt-1 opacity-70">
                                    Ошибки: {importResult.errors.slice(0, 3).join(', ')}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}