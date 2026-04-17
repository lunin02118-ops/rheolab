/**
 * App Settings Exporter
 * UI component for exporting, importing and resetting all application settings
 */

import { useState, useRef } from 'react';
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import { isTauri } from '@/lib/tauri';
import {
    Download,
    Upload,
    RotateCcw,
    Check,
    AlertTriangle,
    X,
    FileJson,
    Settings2,
    LineChart,
    Building2
} from 'lucide-react';
import { Logo } from '@/components/ui/logo';
import {
    downloadSettingsFile,
    exportSettingsToJson,
    importSettingsFromJson,
    resetAllSettings,
    type ImportResult
} from '@/lib/settings/app-settings-manager';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function AppSettingsExporter() {
    const [isImporting, setIsImporting] = useState(false);
    const [importResult, setImportResult] = useState<ImportResult | null>(null);
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Handle export
    const handleExport = async () => {
        if (isTauri()) {
            try {
                const filePath = await save({
                    defaultPath: `rheolab-settings-${new Date().toISOString().split('T')[0]}.json`,
                    filters: [{ name: 'JSON', extensions: ['json'] }],
                });
                if (filePath) {
                    const json = exportSettingsToJson();
                    await writeTextFile(filePath, json);
                }
            } catch (e) {
                console.error('Export failed:', e);
            }
        } else {
            downloadSettingsFile();
        }
    };

    // Handle import
    const handleImportClick = async () => {
        if (isTauri()) {
            try {
                const filePath = await open({
                    multiple: false,
                    filters: [{ name: 'JSON', extensions: ['json'] }],
                });
                if (filePath && typeof filePath === 'string') {
                    setIsImporting(true);
                    setImportResult(null);
                    try {
                        const text = await readTextFile(filePath);
                        const result = importSettingsFromJson(text);
                        setImportResult(result);
                    } catch (_e) {
                        setImportResult({
                            success: false,
                            errors: ['Не удалось прочитать файл'],
                            warnings: [],
                            imported: { chart: false, branding: false, analysis: false }
                        });
                    } finally {
                        setIsImporting(false);
                    }
                }
            } catch (e) {
                console.error('Import failed:', e);
            }
        } else {
            fileInputRef.current?.click();
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsImporting(true);
        setImportResult(null);

        try {
            const text = await file.text();
            const result = importSettingsFromJson(text);
            setImportResult(result);
        } catch (_e) {
            setImportResult({
                success: false,
                errors: ['Не удалось прочитать файл'],
                warnings: [],
                imported: { chart: false, branding: false, analysis: false }
            });
        } finally {
            setIsImporting(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    // Handle reset
    const handleReset = () => {
        resetAllSettings();
        setShowResetConfirm(false);
        setImportResult(null);
    };

    return (
        <Card className="bg-card/50 border-border">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-foreground">
                    <Settings2 className="w-5 h-5 text-blue-400" />
                    Экспорт и импорт настроек
                </CardTitle>
                <CardDescription>
                    Сохраните все настройки приложения в файл или восстановите из резервной копии
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Settings Summary */}
                <div className="grid grid-cols-3 gap-4">
                    <div className="p-3 bg-secondary/50 rounded-lg border border-border">
                        <div className="flex items-center gap-2 mb-2">
                            <LineChart className="w-4 h-4 text-cyan-400" />
                            <span className="text-sm font-medium text-foreground/80">Графики</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Цвета, стили, оси, точность
                        </p>
                    </div>
                    <div className="p-3 bg-secondary/50 rounded-lg border border-border">
                        <div className="flex items-center gap-2 mb-2">
                            <Building2 className="w-4 h-4 text-purple-400" />
                            <span className="text-sm font-medium text-foreground/80">Брендинг</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Название, логотип компании
                        </p>
                    </div>
                    <div className="p-3 bg-secondary/50 rounded-lg border border-border">
                        <div className="flex items-center gap-2 mb-2">
                            <Logo className="w-4 h-4 text-amber-400" />
                            <span className="text-sm font-medium text-foreground/80">Анализ</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            K-индекс, скорости сдвига
                        </p>
                    </div>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-3 gap-4">
                    {/* Export Button */}
                    <button
                        onClick={handleExport}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-500 text-foreground rounded-lg font-medium transition-colors"
                    >
                        <Download className="w-5 h-5" />
                        Экспорт
                    </button>

                    {/* Import Button */}
                    <button
                        onClick={handleImportClick}
                        disabled={isImporting}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-500 text-foreground rounded-lg font-medium transition-colors disabled:opacity-50"
                    >
                        {isImporting ? (
                            <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <Upload className="w-5 h-5" />
                        )}
                        Импорт
                    </button>

                    {/* Reset Button */}
                    <button
                        onClick={() => setShowResetConfirm(true)}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-secondary hover:bg-muted text-foreground rounded-lg font-medium transition-colors"
                    >
                        <RotateCcw className="w-5 h-5" />
                        Сбросить
                    </button>

                    {/* Hidden file input */}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json"
                        onChange={handleFileChange}
                        className="hidden"
                    />
                </div>

                {/* Import Result */}
                {importResult && (
                    <div className={`p-4 rounded-lg border ${importResult.success
                            ? 'bg-green-500/10 border-green-500/30'
                            : 'bg-red-500/10 border-red-500/30'
                        }`}>
                        <div className="flex items-start gap-3">
                            {importResult.success ? (
                                <Check className="w-5 h-5 text-green-400 mt-0.5" />
                            ) : (
                                <X className="w-5 h-5 text-red-400 mt-0.5" />
                            )}
                            <div className="flex-1">
                                <p className={`font-medium ${importResult.success ? 'text-green-400' : 'text-red-400'
                                    }`}>
                                    {importResult.success ? 'Настройки успешно импортированы' : 'Ошибка импорта'}
                                </p>

                                {/* Imported sections */}
                                {importResult.success && (
                                    <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                                        {importResult.imported.chart && (
                                            <span className="flex items-center gap-1">
                                                <LineChart className="w-3 h-3" /> Графики
                                            </span>
                                        )}
                                        {importResult.imported.branding && (
                                            <span className="flex items-center gap-1">
                                                <Building2 className="w-3 h-3" /> Брендинг
                                            </span>
                                        )}
                                        {importResult.imported.analysis && (
                                            <span className="flex items-center gap-1">
                                                <Logo className="w-3 h-3" /> Анализ
                                            </span>
                                        )}
                                    </div>
                                )}

                                {/* Errors */}
                                {importResult.errors.length > 0 && (
                                    <ul className="mt-2 text-sm text-red-400">
                                        {importResult.errors.map((err, i) => (
                                            <li key={i}>• {err}</li>
                                        ))}
                                    </ul>
                                )}

                                {/* Warnings */}
                                {importResult.warnings.length > 0 && (
                                    <ul className="mt-2 text-sm text-amber-400">
                                        {importResult.warnings.map((warn, i) => (
                                            <li key={i} className="flex items-start gap-1">
                                                <AlertTriangle className="w-3 h-3 mt-1" /> {warn}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>

                            <button
                                onClick={() => setImportResult(null)}
                                className="text-muted-foreground hover:text-foreground"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}

                {/* Reset Confirmation */}
                {showResetConfirm && (
                    <div className="p-4 rounded-lg border bg-amber-500/10 border-amber-500/30">
                        <div className="flex items-start gap-3">
                            <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5" />
                            <div className="flex-1">
                                <p className="font-medium text-amber-400">
                                    Сбросить все настройки?
                                </p>
                                <p className="text-sm text-muted-foreground mt-1">
                                    Все настройки графиков, брендинга и анализа будут возвращены к значениям по умолчанию.
                                    Это действие нельзя отменить.
                                </p>
                                <div className="flex gap-3 mt-4">
                                    <button
                                        onClick={handleReset}
                                        className="px-4 py-2 bg-red-600 hover:bg-red-500 text-foreground rounded-lg text-sm font-medium"
                                    >
                                        Да, сбросить
                                    </button>
                                    <button
                                        onClick={() => setShowResetConfirm(false)}
                                        className="px-4 py-2 bg-secondary hover:bg-muted text-foreground rounded-lg text-sm font-medium"
                                    >
                                        Отмена
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* File format info */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FileJson className="w-4 h-4" />
                    <span>Формат файла: JSON • Имя: rheolab-settings-YYYY-MM-DD.json</span>
                </div>
            </CardContent>
        </Card>
    );
}
