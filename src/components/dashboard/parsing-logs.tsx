import * as React from 'react';

import { Info, AlertTriangle, CheckCircle2, Cpu, FileSpreadsheet, Ruler, Clock, Calendar } from 'lucide-react';
import { CollapsibleCard } from '@/components/ui/collapsible-card';

interface ParsingLogsProps {
    metadata: {
        filename: string;
        sheetName?: string;
        instrumentType?: string;
        geometry?: string;
        geometrySource?: 'context' | 'loose' | 'physics' | 'default';
        shearRateRecovered?: boolean;
        usedAI?: boolean;
        aiLogs?: string[];
        aiDetails?: {
            keyUsed?: string;
            tokenUsage?: {
                prompt: number;
                completion: number;
                total: number;
            };
            model?: string;
            error?: string;
            cached?: boolean;
        };
        testDate?: Date;
    } | null;
    summary: {
        pointCount: number;
        timeRange?: { start: number; end: number; durationMinutes: number };
        viscosityRange?: { min: number; max: number; avg?: number };
        temperatureRange?: { min: number; max: number; avg?: number };
        pressureRange?: { min: number; max: number };
    } | null;
    source: 'regex' | 'ai' | null;
    parsedBy?: 'native' | 'wasm' | 'legacy-api';
}

export const ParsingLogs = React.memo(function ParsingLogs({ metadata, summary, source: _source, parsedBy }: ParsingLogsProps) {
    if (!metadata || !summary) {
        return null;
    }

    const logs: { level: 'info' | 'success' | 'warning'; message: string; icon: React.ReactNode }[] = [];

    // File info
    logs.push({
        level: 'info',
        message: `Файл: ${metadata.filename}`,
        icon: <FileSpreadsheet className="w-4 h-4" />
    });

    // Sheet name
    if (metadata.sheetName) {
        logs.push({
            level: 'info',
            message: `Лист: "${metadata.sheetName}"`,
            icon: <FileSpreadsheet className="w-4 h-4" />
        });
    }

    // Instrument type
    if (metadata.instrumentType) {
        logs.push({
            level: metadata.instrumentType !== 'Rheometer' ? 'success' : 'info',
            message: `Прибор: ${metadata.instrumentType}`,
            icon: <Cpu className="w-4 h-4" />
        });
    } else {
        logs.push({
            level: 'warning',
            message: 'Прибор: не определён (нет ключевых слов в файле)',
            icon: <Cpu className="w-4 h-4" />
        });
    }

    // Parser type
    const pathLabel = parsedBy === 'wasm' ? 'WASM' : parsedBy === 'native' ? 'Нативный' : parsedBy ?? '?';
    logs.push({
        level: metadata.usedAI ? 'warning' : 'success',
        message: metadata.usedAI
            ? `Парсер: AI (Groq LLM) [${pathLabel}]`
            : `Парсер: Regex Fast-Track [${pathLabel}]`,
        icon: <Cpu className="w-4 h-4" />
    });

    // Geometry - now handled by GeometrySelector component in parent
    // We still log it for informational purposes
    if (metadata.geometry) {
        const sourceText = {
            context: 'контекст',
            loose: 'поиск',
            physics: 'физика (K-фактор)',
            default: 'по умолчанию — требуется подтверждение!'
        }[metadata.geometrySource || 'default'];

        logs.push({
            level: metadata.geometrySource === 'default' ? 'warning' : 'success',
            message: `Геометрия: ${metadata.geometry} (источник: ${sourceText})`,
            icon: <Ruler className="w-4 h-4" />
        });
    }

    // Shear rate recovery
    if (metadata.shearRateRecovered) {
        logs.push({
            level: 'warning',
            message: 'Скорость сдвига восстановлена из RPM (SRS 3.5.2)',
            icon: <AlertTriangle className="w-4 h-4" />
        });
    }

    // Data points
    logs.push({
        level: 'success',
        message: `Распознано точек: ${summary.pointCount}`,
        icon: <CheckCircle2 className="w-4 h-4" />
    });

    // Test Date
    if (metadata.testDate) {
        logs.push({
            level: 'success',
            message: `Дата теста: ${new Date(metadata.testDate).toLocaleDateString('ru-RU')}`,
            icon: <Calendar className="w-4 h-4" />
        });
    } else {
        logs.push({
            level: 'warning',
            message: 'Дата теста: не найдена (используется текущая)',
            icon: <Calendar className="w-4 h-4" />
        });
    }

    // Time range
    if (summary.timeRange) {
        logs.push({
            level: 'info',
            message: `Диапазон времени: ${summary.timeRange.durationMinutes} мин (${Math.round(summary.timeRange.start)}—${Math.round(summary.timeRange.end)} сек)`,
            icon: <Clock className="w-4 h-4" />
        });
    }

    // Temperature range
    if (summary.temperatureRange) {
        logs.push({
            level: 'info',
            message: `Температура: ${summary.temperatureRange.min}°C — ${summary.temperatureRange.max}°C (ср. ${summary.temperatureRange.avg}°C)`,
            icon: <Info className="w-4 h-4" />
        });
    }

    // Pressure range
    if (summary.pressureRange) {
        logs.push({
            level: 'info',
            message: `Давление: ${summary.pressureRange.min} — ${summary.pressureRange.max} бар`,
            icon: <Info className="w-4 h-4" />
        });
    }

    // AI Logs

    // AI Logs
    if (metadata.usedAI && metadata.aiLogs && metadata.aiLogs.length > 0) {
        logs.push({
            level: 'warning',
            message: 'Детали AI парсинга (см. ниже)',
            icon: <Cpu className="w-4 h-4" />
        });
    }

    return (
        <CollapsibleCard
            title={
                <div className="flex items-center justify-between w-full">
                    <span className="flex items-center gap-2">
                        <Info className="w-5 h-5 text-blue-400" />
                        Логи парсинга
                    </span>
                </div>
            }
            defaultOpen={!!metadata.usedAI}
        >
            <div className="p-4 space-y-2 font-mono text-sm border-t border-border">
                {logs.map((log, idx) => (
                    <div
                        key={idx}
                        className={`flex items-start gap-3 p-2 rounded ${log.level === 'success'
                            ? 'bg-green-500/10 text-green-400'
                            : log.level === 'warning'
                                ? 'bg-amber-500/10 text-amber-400'
                                : 'bg-muted/30 text-foreground/80'
                            }`}
                    >
                        <span className="mt-0.5 flex-shrink-0">{log.icon}</span>
                        <span>{log.message}</span>
                    </div>
                ))}
            </div>

            {/* Extended AI Logs */}
            {metadata.usedAI && metadata.aiDetails && (
                <div className="px-4 pb-4">
                    <div className="p-3 rounded bg-secondary/50 border border-border text-xs font-mono text-muted-foreground overflow-x-auto">
                        <div className="font-semibold text-foreground/80 mb-2 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <Cpu className="w-3 h-3 text-purple-400" />
                                Детали AI парсинга:
                            </div>
                            {metadata.aiDetails.cached && (
                                <span className="px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 text-[10px] border border-blue-500/30">
                                    ИЗ КЭША
                                </span>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-2 mb-2">
                            {metadata.aiDetails.model && (
                                <div className="col-span-2">
                                    <span className="text-muted-foreground">Модель:</span> <span className="text-purple-300">{metadata.aiDetails.model}</span>
                                </div>
                            )}
                            {metadata.aiDetails.keyUsed && (
                                <div className="col-span-2">
                                    <span className="text-muted-foreground">API Ключ:</span> <span className="text-green-300">{metadata.aiDetails.keyUsed}</span>
                                </div>
                            )}
                            {metadata.aiDetails.tokenUsage && (
                                <>
                                    <div>
                                        <span className="text-muted-foreground">Входные токены:</span> <span className="text-foreground/80">{metadata.aiDetails.tokenUsage.prompt}</span>
                                    </div>
                                    <div>
                                        <span className="text-muted-foreground">Выходные токены:</span> <span className="text-foreground/80">{metadata.aiDetails.tokenUsage.completion}</span>
                                    </div>
                                    <div className="col-span-2 border-t border-border/50 pt-1 mt-1">
                                        <span className="text-muted-foreground">Всего токенов:</span> <span className="text-yellow-300 font-bold">{metadata.aiDetails.tokenUsage.total}</span>
                                    </div>
                                </>
                            )}
                        </div>

                        {metadata.aiDetails.error && (
                            <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-red-300">
                                ⚠️ Ошибка: {metadata.aiDetails.error}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Viscosity range as simple text */}
            {summary.viscosityRange && (
                <div className="px-4 pb-4">
                    <div className="flex items-start gap-3 p-2 rounded bg-blue-500/10 text-blue-400">
                        <span className="mt-0.5 flex-shrink-0"><Info className="w-4 h-4" /></span>
                        <span>
                            Вязкость: {summary.viscosityRange.min} — {summary.viscosityRange.max} сП
                            {summary.viscosityRange.avg && ` (ср. ${summary.viscosityRange.avg} сП)`}
                        </span>
                    </div>
                </div>
            )}
        </CollapsibleCard>
    );
});
