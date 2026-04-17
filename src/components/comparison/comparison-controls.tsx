import React from 'react';

interface Metric {
    value: string;
    label: string;
}

interface AxisSelectorProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: Metric[];
    excludeValues?: string[];
    color: 'blue' | 'purple' | 'slate' | 'amber';
    allowNone?: boolean;
}

const colorMap = {
    blue: 'bg-blue-500/50',
    purple: 'bg-purple-500/50',
    slate: 'bg-muted/50',
    amber: 'bg-amber-500/50',
};

export function AxisSelector({
    label,
    value,
    onChange,
    options,
    excludeValues = [],
    color,
    allowNone = false
}: AxisSelectorProps) {
    const isActive = value !== 'none';
    const indicatorColor = isActive ? colorMap[color] : 'bg-transparent';

    const filteredOptions = options.filter(m => !excludeValues.includes(m.value));

    return (
        <div className="flex items-center gap-3">
            <div className={`w-1 h-8 rounded-full mr-1 transition-colors ${indicatorColor}`}></div>
            <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
                <select
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className={`bg-transparent border-none text-sm focus:ring-0 p-0 cursor-pointer transition-colors ${isActive ? 'text-foreground hover:text-blue-400' : 'text-foreground/80 hover:text-foreground'
                        }`}
                >
                    {allowNone && <option value="none" className="bg-card text-foreground">Выкл</option>}
                    {filteredOptions.map(m => (
                        <option key={m.value} value={m.value} className="bg-card text-foreground">{m.label}</option>
                    ))}
                </select>
            </div>
        </div>
    );
}

interface LegendToggleProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
}

export function LegendToggle({ checked, onChange }: LegendToggleProps) {
    return (
        <label className="flex items-center gap-2 cursor-pointer group select-none">
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="sr-only"
            />
            <span className={`text-xs transition-colors ${checked ? 'text-foreground/80' : 'text-muted-foreground'}`}>Легенда</span>
            <div className={`w-9 h-5 rounded-full relative transition-colors ${checked ? 'bg-blue-600/20 border border-blue-500/50' : 'bg-secondary border border-border'}`}>
                <div className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full transition-transform ${checked ? 'translate-x-4 shadow-sm' : 'translate-x-0 opacity-50'}`}></div>
            </div>
        </label>
    );
}

interface ExperimentChipProps {
    name: string;
    onRemove: () => void;
}

export function ExperimentChip({ name, onRemove }: ExperimentChipProps) {
    return (
        <div data-testid="ComparisonExperimentChip" className="group flex items-center gap-2 pl-3 pr-2 py-1 bg-secondary/50 hover:bg-secondary/50 rounded-full border border-border/50 hover:border-border transition-colors text-xs">
            <span className="text-foreground/80 max-w-[150px] truncate">{name}</span>
            <div data-testid="RemoveExperimentChip">
                <button
                    onClick={onRemove}
                    data-testid="ComparisonExperimentChipRemoveButton"
                    className="p-0.5 text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                    ×
                </button>
            </div>
        </div>
    );
}

// Touch Point Control - shows time to reach target viscosity and viscosity at specific time
interface ViscosityThresholdControlProps {
    enabled: boolean;
    onEnabledChange: (enabled: boolean) => void;
    threshold: number;
    onThresholdChange: (value: number) => void;
    showTargetTime: boolean;
    onShowTargetTimeChange: (show: boolean) => void;
    targetTime: number;
    onTargetTimeChange: (value: number) => void;
}

export function ViscosityThresholdControl({
    enabled,
    onEnabledChange,
    threshold,
    onThresholdChange,
    showTargetTime,
    onShowTargetTimeChange,
    targetTime,
    onTargetTimeChange
}: ViscosityThresholdControlProps) {
    return (
        <div className="flex items-center gap-4">
            {/* Main Toggle */}
            <label className="flex items-center gap-2 cursor-pointer group select-none">
                <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => onEnabledChange(e.target.checked)}
                    className="sr-only"
                />
                <div className={`w-9 h-5 rounded-full relative transition-colors ${enabled ? 'bg-green-600/20 border border-green-500/50' : 'bg-secondary border border-border'}`}>
                    <div className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full transition-transform ${enabled ? 'translate-x-4 shadow-sm' : 'translate-x-0 opacity-50'}`}></div>
                </div>
                <span className={`text-xs transition-colors whitespace-nowrap ${enabled ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground'}`}>Точка касания</span>
            </label>

            {/* Threshold Input */}
            {enabled && (
                <div className="flex items-center gap-2">
                    <input
                        type="number"
                        value={threshold}
                        onChange={(e) => onThresholdChange(Number(e.target.value))}
                        className="w-16 bg-card border border-border rounded px-2 py-1 text-xs text-foreground text-center focus:border-green-500 focus:ring-1 focus:ring-green-500/30 outline-none"
                    />
                    <span className="text-xs text-muted-foreground">сП</span>
                </div>
            )}

            {/* Target Time Toggle & Input */}
            {enabled && (
                <div className="flex items-center gap-2 ml-2 border-l border-border pl-4">
                    <label className="flex items-center gap-2 cursor-pointer group select-none">
                        <input
                            type="checkbox"
                            checked={showTargetTime}
                            onChange={(e) => onShowTargetTimeChange(e.target.checked)}
                            className="sr-only"
                        />
                        <div className={`w-7 h-4 rounded-full relative transition-colors ${showTargetTime ? 'bg-amber-600/20 border border-amber-500/50' : 'bg-secondary border border-border'}`}>
                            <div className={`absolute top-0.5 left-0.5 w-2.5 h-2.5 bg-white rounded-full transition-transform ${showTargetTime ? 'translate-x-3 shadow-sm' : 'translate-x-0 opacity-50'}`}></div>
                        </div>
                        <span className={`text-xs transition-colors whitespace-nowrap ${showTargetTime ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>Вязкость на</span>
                    </label>

                    {showTargetTime && (
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                value={targetTime}
                                onChange={(e) => onTargetTimeChange(Number(e.target.value))}
                                className="w-14 bg-card border border-border rounded px-2 py-1 text-xs text-foreground text-center focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 outline-none"
                            />
                            <span className="text-xs text-muted-foreground">мин</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
