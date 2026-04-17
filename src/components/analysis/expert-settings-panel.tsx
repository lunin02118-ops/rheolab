import React, { useCallback } from 'react';
import { Settings, RotateCcw, Plus, X } from 'lucide-react';
import { useAnalysisSettingsStore } from '@/lib/store/analysis-settings-store';
import { useShallow } from 'zustand/react/shallow';

const MAX_SHEAR_RATES = 10;

export function ExpertSettingsPanel() {
    const { expertSettings, setExpertSettings, resetToDefaults } = useAnalysisSettingsStore(
        useShallow(s => ({ expertSettings: s.expertSettings, setExpertSettings: s.setExpertSettings, resetToDefaults: s.resetToDefaults }))
    );

    const updateRate = useCallback((idx: number, value: number) => {
        const newRates = [...expertSettings.viscosityShearRates];
        newRates[idx] = value;
        setExpertSettings({ viscosityShearRates: newRates });
    }, [expertSettings.viscosityShearRates, setExpertSettings]);

    const addRate = useCallback(() => {
        if (expertSettings.viscosityShearRates.length >= MAX_SHEAR_RATES) return;
        // Default new value: next reasonable shear rate
        const lastRate = expertSettings.viscosityShearRates[expertSettings.viscosityShearRates.length - 1] ?? 100;
        const newRate = Math.round(lastRate + 50);
        setExpertSettings({ viscosityShearRates: [...expertSettings.viscosityShearRates, newRate] });
    }, [expertSettings.viscosityShearRates, setExpertSettings]);

    const removeRate = useCallback((idx: number) => {
        if (expertSettings.viscosityShearRates.length <= 1) return; // Keep at least 1
        const newRates = expertSettings.viscosityShearRates.filter((_, i) => i !== idx);
        setExpertSettings({ viscosityShearRates: newRates });
    }, [expertSettings.viscosityShearRates, setExpertSettings]);

    return (
        <div className="bg-card/50 border border-border rounded-xl p-5">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Settings className="w-5 h-5 text-orange-400" />
                    Настройки расчёта
                </h2>
                <button
                    onClick={resetToDefaults}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    title="Сбросить к дефолтам"
                >
                    <RotateCcw className="w-3 h-3" />
                    Сброс
                </button>
            </div>

            {/* Row 1: Selects + Shear Rates — all in one row */}
            <div className="grid grid-cols-[1fr_1fr_auto] gap-4 items-end">
                {/* Points to Average */}
                <div>
                    <label className="block text-xs text-muted-foreground mb-1">Точки для расчёта</label>
                    <select
                        value={expertSettings.pointsToAverage}
                        onChange={(e) => setExpertSettings({ pointsToAverage: Number(e.target.value) })}
                        className="w-full bg-secondary border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-orange-500"
                    >
                        <option value={0}>Все точки</option>
                        <option value={1}>Последняя точка</option>
                        <option value={3}>Последние 3</option>
                        <option value={5}>Последние 5</option>
                        <option value={10}>Последние 10</option>
                    </select>
                </div>

                {/* Viscosity Shear Rates — inline chips */}
                <div>
                    <label className="block text-xs text-muted-foreground mb-1">
                        Скорости сдвига для вязкости (1/с)
                    </label>
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {expertSettings.viscosityShearRates.map((rate, idx) => (
                            <div key={idx} className="flex items-center bg-secondary border border-border rounded-lg overflow-hidden group">
                                <input
                                    type="number"
                                    value={rate}
                                    onChange={(e) => updateRate(idx, Number(e.target.value))}
                                    className="w-16 bg-transparent px-2 py-1 text-sm text-foreground text-center focus:outline-none focus:ring-1 focus:ring-orange-500 rounded-l-lg [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    min={1}
                                />
                                {expertSettings.viscosityShearRates.length > 1 && (
                                    <button
                                        onClick={() => removeRate(idx)}
                                        className="px-1 py-1 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                        title="Удалить"
                                        aria-label="Удалить скорость сдвига"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                        ))}
                        {expertSettings.viscosityShearRates.length < MAX_SHEAR_RATES && (
                            <button
                                onClick={addRate}
                                className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-orange-400 bg-secondary/50 hover:bg-secondary border border-dashed border-border hover:border-orange-500/50 rounded-lg transition-colors"
                                title="Добавить скорость сдвига"
                                aria-label="Добавить скорость сдвига"
                            >
                                <Plus className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
