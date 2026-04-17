import React from 'react';
import type { WaterParams } from '@/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface WaterSourceSectionProps {
    waterSource: string;
    setWaterSource: (value: string) => void;
    waterParams: WaterParams;
    setWaterParams: (value: WaterParams) => void;
    waterSources: string[];
}

const WATER_PARAM_FIELDS = [
    { key: 'ph', label: 'pH', unit: '', step: '0.1' },
    { key: 'fe', label: 'Fe', unit: 'мг/л', step: '1' },
    { key: 'ca', label: 'Ca', unit: 'мг/л', step: '1' },
    { key: 'mg', label: 'Mg', unit: 'мг/л', step: '1' },
    { key: 'cl', label: 'Cl', unit: 'мг/л', step: '1' },
    { key: 'so4', label: 'SO₄', unit: 'мг/л', step: '1' },
    { key: 'hco3', label: 'HCO₃', unit: 'мг/л', step: '1' }
] as const;

export function WaterSourceSection({
    waterSource,
    setWaterSource,
    waterParams,
    setWaterParams,
    waterSources
}: WaterSourceSectionProps) {
    const handleParamChange = (key: keyof WaterParams, value: string) => {
        const trimmed = value.trim();
        const parsed = trimmed === '' ? null : parseFloat(trimmed);
        setWaterParams({
            ...waterParams,
            [key]: (parsed === null || isNaN(parsed)) ? null : parsed,
        });
    };

    return (
        <div className="bg-card dark:bg-card rounded-xl border border-border overflow-hidden">
            {/* Section header */}
            <div className="px-5 py-2.5 border-b border-border/50 bg-muted/30 dark:bg-secondary/40">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Данные о воде</h3>
            </div>

            {/* Section body */}
            <div className="p-5 space-y-4">
                {/* Источник воды */}
                <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-foreground">
                        Источник воды <span className="text-destructive">*</span>
                    </Label>
                    <Input
                        type="text"
                        list="water-sources-list"
                        value={waterSource}
                        onChange={e => setWaterSource(e.target.value)}
                        data-testid="SaveDialogWaterSourceTextBox"
                        className={`text-foreground focus-visible:ring-cyan-500 dark:bg-secondary/30 ${
                            !waterSource.trim() ? 'border-2 border-destructive' : ''
                        }`}
                        placeholder="Озеро Самотлор, Пластовая вода скв. 123..."
                    />
                    <datalist id="water-sources-list">
                        {waterSources.map((source, idx) => (
                            <option key={idx} value={source} />
                        ))}
                    </datalist>
                </div>

                {/* Химический состав воды */}
                <div>
                    <p className="text-xs text-muted-foreground mb-2">Химический состав воды (необязательно)</p>
                    <div className="grid grid-cols-7 gap-2">
                        {WATER_PARAM_FIELDS.map(({ key, label, unit, step }) => (
                            <div key={key} className="space-y-1">
                                <Label className="text-[11px] text-muted-foreground font-semibold block text-center">{label}</Label>
                                <Input
                                    type="number"
                                    step={step}
                                    value={waterParams[key as keyof WaterParams] ?? ''}
                                    onChange={e => handleParamChange(key as keyof WaterParams, e.target.value)}
                                    data-testid={`SaveDialogWaterParam-${key}`}
                                    className="text-foreground text-sm h-8 px-2 focus-visible:ring-cyan-500 dark:bg-secondary/30 text-center"
                                />
                                {unit && <span className="text-[10px] text-muted-foreground block text-center">{unit}</span>}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
