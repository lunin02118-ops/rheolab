import { Droplets } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { useCatalogStore } from '@/lib/store/catalog-store';

export interface WaterParams {
    ph?: number | null;
    fe?: number | null;    // Iron in mg/L
    ca?: number | null;    // Calcium in mg/L
    mg?: number | null;    // Magnesium in mg/L
    cl?: number | null;    // Chloride in mg/L
    so4?: number | null;   // Sulfate in mg/L
    hco3?: number | null;  // Bicarbonate in mg/L
    salinity?: number | null; // Salinity in mg/L
    hardness?: number | null; // Hardness in mg/L
}

interface WaterAnalysisPanelProps {
    waterSource?: string;
    waterParams?: WaterParams;
    onWaterSourceChange?: (source: string) => void;
    onParamsChange?: (params: WaterParams) => void;
}

// Component parameter definitions
const WATER_COMPONENTS = [
    { key: 'ph', label: 'pH', unit: '', step: '0.1' },
    { key: 'fe', label: 'Fe', unit: 'мг/л', step: '0.1' },
    { key: 'ca', label: 'Ca', unit: 'мг/л', step: '1' },
    { key: 'mg', label: 'Mg', unit: 'мг/л', step: '1' },
    { key: 'cl', label: 'Cl', unit: 'мг/л', step: '1' },
    { key: 'so4', label: 'SO₄', unit: 'мг/л', step: '1' },
    { key: 'hco3', label: 'HCO₃', unit: 'мг/л', step: '1' },
] as const;

export const WaterAnalysisPanel = React.memo(function WaterAnalysisPanel({
    waterSource: externalWaterSource,
    waterParams: externalWaterParams,
    onWaterSourceChange,
    onParamsChange
}: WaterAnalysisPanelProps) {
    // Controlled vs uncontrolled pattern
    const [internalWaterSource, setInternalWaterSource] = useState(externalWaterSource || '');
    const [internalWaterParams, setInternalWaterParams] = useState<WaterParams>(externalWaterParams || {
        ph: null, fe: null, ca: null, mg: null, cl: null, so4: null, hco3: null
    });

    // Use external state if callbacks provided (controlled mode)
    const waterSource = onWaterSourceChange ? (externalWaterSource || '') : internalWaterSource;
    const waterParams = onParamsChange ? (externalWaterParams || {}) : internalWaterParams;

    const waterSourceSuggestions = useCatalogStore(s => s.waterSources);
    const fetchCatalogWaterSources = useCatalogStore(s => s.fetchWaterSources);

    // Load water source suggestions (shared store deduplicates)
    useEffect(() => {
        void fetchCatalogWaterSources();
    }, [fetchCatalogWaterSources]);

    // Handle water source change
    const handleWaterSourceChange = (value: string) => {
        if (onWaterSourceChange) {
            onWaterSourceChange(value);
        } else {
            setInternalWaterSource(value);
        }
    };

    // Handle params change
    const handleParamChange = (key: string, value: number | undefined) => {
        const newParams = { ...waterParams, [key]: value };
        if (onParamsChange) {
            onParamsChange(newParams);
        } else {
            setInternalWaterParams(newParams);
        }
    };

    return (
        <div className="bg-card/50 border border-border rounded-xl overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-border flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-cyan-600 to-blue-600 rounded-lg">
                    <Droplets className="w-5 h-5 text-foreground" />
                </div>
                <div>
                    <h3 className="font-semibold text-foreground">Анализ воды</h3>
                    <p className="text-xs text-muted-foreground">7-компонентный анализ</p>
                </div>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4">
                {/* Water source input */}
                <div>
                    <label className="block text-sm text-muted-foreground mb-1">
                        Источник воды <span className="text-red-400">*</span>
                    </label>
                    <input
                        type="text"
                        list="water-sources-list"
                        value={waterSource}
                        onChange={(e) => handleWaterSourceChange(e.target.value)}
                        className={`w-full bg-input border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 ${!waterSource.trim() ? 'border-red-500/50' : 'border-border'
                            }`}
                        placeholder="Озеро Самотлор, Пластовая вода скв. 123..."
                    />
                    <datalist id="water-sources-list">
                        {waterSourceSuggestions.map((source, idx) => (
                            <option key={idx} value={source} />
                        ))}
                    </datalist>
                </div>

                {/* 7-component analysis grid */}
                <div>
                    <label className="block text-sm text-muted-foreground mb-2">Показатели</label>
                    <div className="grid grid-cols-7 gap-2">
                        {WATER_COMPONENTS.map((comp) => (
                            <div key={comp.key}>
                                <label className="block text-xs text-muted-foreground mb-1 text-center">{comp.label}</label>
                                <input
                                    type="number"
                                    step={comp.step}
                                    value={waterParams[comp.key as keyof WaterParams] ?? ''}
                                    onChange={(e) => {
                                        const val = e.target.value === '' ? undefined : parseFloat(e.target.value);
                                        handleParamChange(comp.key, val);
                                    }}
                                    className="w-full bg-input border border-border rounded px-2 py-1.5 text-foreground text-sm text-center focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                    placeholder="—"
                                />
                                {comp.unit && (
                                    <span className="block text-xs text-muted-foreground text-center mt-0.5">{comp.unit}</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
});
