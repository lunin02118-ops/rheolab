import { logger as clientLogger } from '@/lib/client-logger';

import React, { useState, useEffect, useRef } from 'react';
import { X, Check, RotateCcw, AlertCircle, CheckCircle2, Copy } from 'lucide-react';
import type { RheoStep, RheoCycle } from '@/lib/analysis/types';
import type { GraceCycleResult } from '@/lib/analysis/types';
import { useFocusTrap } from '@/hooks/useFocusTrap';

interface CycleEditorDialogProps {
    isOpen: boolean;
    onClose: () => void;
    cycle: RheoCycle | null;
    allSteps: RheoStep[];
    currentResult: GraceCycleResult | null;
    overriddenStepIds: number[] | null;
    onApply: (cycleId: number, selectedStepIds: number[]) => void;
    onApplyPatternToAll?: (pattern: number[]) => void; // Shear rates pattern
}

export function CycleEditorDialog({
    isOpen,
    onClose,
    cycle,
    allSteps,
    currentResult,
    overriddenStepIds,
    onApply,
    onApplyPatternToAll
}: CycleEditorDialogProps) {
    // Initialize selectedIds: match cycle steps to allSteps by startTime (like C# WPF),
    // because step IDs may not survive WASM round-trips consistently.
    const focusTrapRef = useFocusTrap<HTMLDivElement>(isOpen);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const initializedRef = useRef(false);

    useEffect(() => {
        if (!cycle || allSteps.length === 0) return;

        // Only initialize once per dialog open (relies on conditional rendering to unmount/remount)
        if (initializedRef.current) return;
        initializedRef.current = true;

        // Priority 1: Use previously overridden step IDs
        if (overriddenStepIds && overriddenStepIds.length > 0) {
            setSelectedIds(new Set(overriddenStepIds));
            return;
        }

        // Priority 2: Match cycle's steps to allSteps by startTime (C# pattern)
        // The C# WPF version uses: cycle.Steps.Any(cs => Math.Abs(cs.StartTime - s.StartTime) < 0.1)
        const cycleStepTimes = cycle.steps.map(s => s.startTime);
        const matchedIds = allSteps
            .filter(s => cycleStepTimes.some(t => Math.abs(t - s.startTime) < 0.1))
            .map(s => s.id);

        if (matchedIds.length > 0) {
            setSelectedIds(new Set(matchedIds));
        } else {
            // Fallback: try direct ID match
            const cycleIds = new Set(cycle.steps.map(s => s.id));
            const directMatch = allSteps.filter(s => cycleIds.has(s.id)).map(s => s.id);
            setSelectedIds(new Set(directMatch));
        }
    }, [cycle, allSteps, overriddenStepIds]);

    const toggleStep = (stepId: number) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(stepId)) {
                next.delete(stepId);
            } else {
                next.add(stepId);
            }
            return next;
        });
    };

    const toggleAll = () => {
        if (selectedIds.size === allSteps.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(allSteps.map(s => s.id)));
        }
    };

    const handleApply = () => {
        if (cycle && selectedIds.size > 0) {
            onApply(cycle.id, Array.from(selectedIds));
            onClose();
        }
    };

    const resetToOriginal = () => {
        if (cycle) {
            // Reset to cycle's original steps by startTime matching
            const cycleStepTimes = cycle.steps.map(s => s.startTime);
            const matchedIds = allSteps
                .filter(s => cycleStepTimes.some(t => Math.abs(t - s.startTime) < 0.1))
                .map(s => s.id);
            setSelectedIds(new Set(matchedIds.length > 0 ? matchedIds : cycle.steps.map(s => s.id)));
        }
    };

    // Get shear rate pattern from selected steps
    const getSelectedPattern = (): number[] => {
        const selectedSteps = allSteps.filter(s => selectedIds.has(s.id));
        return selectedSteps.map(s => Math.round(s.avgShearRate));
    };

    const handleApplyToAll = () => {
        if (onApplyPatternToAll && selectedIds.size > 0) {
            const pattern = getSelectedPattern();
            clientLogger.info('[CycleEditor] Applying pattern:', pattern, 'from', selectedIds.size, 'selected steps');
            onApplyPatternToAll(pattern);
            onClose();
        }
    };

    if (!isOpen || !cycle) return null;

    const isGoodFit = currentResult && currentResult.r2 > 0.9;

    return (
        <div ref={focusTrapRef} role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border">
                    <div>
                        <h2 className="text-lg font-semibold text-foreground">
                            Редактирование цикла #{cycle.cycleIndex || cycle.id}
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            Выберите шаги для включения в цикл. Выбрано: {selectedIds.size}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-secondary rounded-lg transition-colors"
                        aria-label="Закрыть диалог"
                    >
                        <X className="w-5 h-5 text-muted-foreground" />
                    </button>
                </div>

                {/* Current Model Display */}
                {currentResult && (
                    <div className="p-4 bg-secondary/50 border-b border-border">
                        <h4 className="text-sm font-medium text-foreground/80 mb-2">Текущие параметры модели</h4>
                        <div className="grid grid-cols-4 gap-4 text-sm">
                            <div>
                                <span className="text-muted-foreground">n' (Индекс течения):</span>
                                <span className="ml-2 font-mono text-foreground">{currentResult.n_prime != null ? currentResult.n_prime.toFixed(4) : '—'}</span>
                            </div>
                            <div>
                                <span className="text-muted-foreground">K' (Консистенция):</span>
                                <span className="ml-2 font-mono text-foreground">{currentResult.K_prime_PaSn != null ? currentResult.K_prime_PaSn.toFixed(4) : '—'}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-muted-foreground">R²:</span>
                                <span className={`font-mono ${isGoodFit ? 'text-green-400' : 'text-orange-400'}`}>
                                    {currentResult.r2 != null ? currentResult.r2.toFixed(4) : '—'}
                                </span>
                                {isGoodFit ? (
                                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                                ) : (
                                    <AlertCircle className="w-4 h-4 text-orange-400" />
                                )}
                            </div>
                            <div>
                                <span className="text-muted-foreground">Точек:</span>
                                <span className="ml-2 font-mono text-foreground">{currentResult.calcPoints}</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Steps Table */}
                <div className="flex-1 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-secondary/80 sticky top-0">
                            <tr className="border-b border-border">
                                <th className="text-left p-3 w-12">
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.size === allSteps.length}
                                        onChange={toggleAll}
                                        className="w-4 h-4 rounded border-border bg-input text-blue-500 focus:ring-blue-500"
                                    />
                                </th>
                                <th className="text-left p-3">Шаг #</th>
                                <th className="text-right p-3">Время (с)</th>
                                <th className="text-right p-3">Длительность</th>
                                <th className="text-right p-3">γ̇ (1/с)</th>
                                <th className="text-right p-3">τ (Па)</th>
                                <th className="text-right p-3">η (сП)</th>
                                <th className="text-right p-3">T (°C)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {allSteps.map((step, idx) => {
                                const isSelected = selectedIds.has(step.id);
                                const isOriginal = cycle.steps.some(s => Math.abs(s.startTime - step.startTime) < 0.1);

                                return (
                                    <tr
                                        key={step.id}
                                        onClick={() => toggleStep(step.id)}
                                        className={`border-b border-border/50 cursor-pointer transition-colors
                                            ${isSelected ? 'bg-blue-900/30' : 'hover:bg-secondary/30'}
                                            ${isOriginal ? 'border-l-4 border-l-blue-500' : ''}`}
                                    >
                                        <td className="p-3">
                                            <label className="flex items-center justify-center w-full h-full cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={(e) => {
                                                        e.stopPropagation();
                                                        toggleStep(step.id);
                                                    }}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="w-4 h-4 rounded border-border bg-input text-blue-500 focus:ring-blue-500 cursor-pointer"
                                                />
                                            </label>
                                        </td>
                                        <td className="p-3 font-medium text-foreground">{idx + 1}</td>
                                        <td className="p-3 text-right font-mono text-foreground/80">{step.startTime != null ? step.startTime.toFixed(0) : '—'}</td>
                                        <td className="p-3 text-right font-mono text-foreground/80">{step.duration != null ? step.duration.toFixed(0) + 's' : '—'}</td>
                                        <td className="p-3 text-right font-mono text-foreground/80">{step.avgShearRate != null ? step.avgShearRate.toFixed(1) : '—'}</td>
                                        <td className="p-3 text-right font-mono text-foreground/80">{step.avgShearStress != null ? step.avgShearStress.toFixed(2) : '—'}</td>
                                        <td className="p-3 text-right font-mono text-foreground/80">{step.avgViscosity != null ? step.avgViscosity.toFixed(1) : '—'}</td>
                                        <td className="p-3 text-right font-mono text-foreground/80">{step.avgTemperature != null ? step.avgTemperature.toFixed(1) : '—'}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between p-4 border-t border-border">
                    <div className="flex gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
                        >
                            Отмена
                        </button>
                        <button
                            onClick={resetToOriginal}
                            className="flex items-center gap-2 px-4 py-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
                        >
                            <RotateCcw className="w-4 h-4" />
                            Сбросить
                        </button>
                    </div>
                    <div className="flex gap-2">
                        {onApplyPatternToAll && (
                            <button
                                onClick={handleApplyToAll}
                                disabled={selectedIds.size === 0}
                                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-secondary disabled:text-muted-foreground text-foreground rounded-lg font-medium transition-colors"
                                title={`Паттерн: ${getSelectedPattern().join(' → ')}`}
                            >
                                <Copy className="w-4 h-4" />
                                Применить ко всем
                            </button>
                        )}
                        <button
                            onClick={handleApply}
                            disabled={selectedIds.size === 0}
                            className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-secondary disabled:text-muted-foreground text-foreground rounded-lg font-medium transition-colors"
                        >
                            <Check className="w-4 h-4" />
                            Применить ({selectedIds.size} шагов)
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
