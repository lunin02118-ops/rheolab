/**
 * UnitSystemCard — configurable unit system for the rheology analysis table.
 *
 * Three modes:
 *   1. Metric  — mPa·s, °C, bar, Pa·s^n, Pa·s, Pa
 *   2. Imperial — cP, °F, psi, lbf·s^n/100ft², cP, lbf/100ft²
 *   3. Custom  — user picks each unit independently
 *
 * Single source of truth: `chartSettings.rheologyUnits` + `chartSettings.unitPreset`.
 * Affects: cycle-results-table, PDF/Excel reports, chart axes.
 */
import { Ruler, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { useChartSettingsStore } from '@/lib/store/chart-settings-store';
import type {
    UnitPreset, RheologyUnits,
    ViscosityUnit, TemperatureUnit, PressureUnit,
    ConsistencyUnit, PlasticViscosityUnit, YieldPointUnit,
} from '@/lib/store/chart-settings-types';

const PRESETS: { value: UnitPreset; label: string; hint: string }[] = [
    { value: 'metric',   label: 'Метрический (СИ)', hint: 'мПа·с, °C, бар, Па·с^n, Па·с, Па' },
    { value: 'imperial', label: 'Имперский',        hint: 'cP, °F, psi, lbf·s^n/100ft², cP, lbf/100ft²' },
    { value: 'custom',   label: 'Ручная настройка', hint: 'Выбрать единицы для каждого параметра' },
];

interface UnitRow<T extends string> {
    key: keyof RheologyUnits;
    label: string;
    options: { value: T; label: string }[];
}

const UNIT_ROWS: UnitRow<string>[] = [
    {
        key: 'viscosity', label: 'Вязкость (η)',
        options: [
            { value: 'mPa·s', label: 'мПа·с' },
            { value: 'Pa·s',  label: 'Па·с' },
            { value: 'cP',    label: 'сП (cP)' },
        ] satisfies { value: ViscosityUnit; label: string }[],
    },
    {
        key: 'temperature', label: 'Температура',
        options: [
            { value: '°C', label: '°C' },
            { value: '°F', label: '°F' },
            { value: 'K',  label: 'K' },
        ] satisfies { value: TemperatureUnit; label: string }[],
    },
    {
        key: 'pressure', label: 'Давление',
        options: [
            { value: 'bar', label: 'бар' },
            { value: 'psi', label: 'psi' },
            { value: 'MPa', label: 'МПа' },
            { value: 'kPa', label: 'кПа' },
        ] satisfies { value: PressureUnit; label: string }[],
    },
    {
        key: 'consistency', label: 'K\' / Ks / Kp',
        options: [
            { value: 'Pa·s^n',           label: 'Па·с^n' },
            { value: 'eq.cP',            label: 'eq.cP' },
            { value: 'lbf·s^n/100ft²',   label: 'lbf·s^n/100ft²' },
        ] satisfies { value: ConsistencyUnit; label: string }[],
    },
    {
        key: 'plasticViscosity', label: 'PV (пласт. вязк.)',
        options: [
            { value: 'Pa·s', label: 'Па·с' },
            { value: 'cP',   label: 'сП (cP)' },
        ] satisfies { value: PlasticViscosityUnit; label: string }[],
    },
    {
        key: 'yieldPoint', label: 'YP (предел текуч.)',
        options: [
            { value: 'Pa',           label: 'Па' },
            { value: 'lbf/100ft²',   label: 'lbf/100ft²' },
        ] satisfies { value: YieldPointUnit; label: string }[],
    },
];

export function UnitSystemCard() {
    const preset = useChartSettingsStore(s => s.settings.unitPreset);
    const units = useChartSettingsStore(s => s.settings.rheologyUnits);
    const applyUnitPreset = useChartSettingsStore(s => s.applyUnitPreset);
    const setRheologyUnit = useChartSettingsStore(s => s.setRheologyUnit);
    const [expanded, setExpanded] = useState(preset === 'custom');

    const handlePreset = (p: UnitPreset) => {
        applyUnitPreset(p);
        if (p === 'custom') setExpanded(true);
    };

    return (
        <div className="bg-card/50 border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Ruler className="w-5 h-5 text-orange-400" />
                    Система единиц
                </h2>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
                Применяется к таблице результатов, графикам дашборда и отчётам PDF/Excel.
                Единый источник истины — значения и заголовки всегда консистентны.
            </p>

            {/* Preset buttons */}
            <div className="grid grid-cols-3 gap-2 mb-4">
                {PRESETS.map(p => {
                    const active = preset === p.value;
                    return (
                        <button
                            key={p.value}
                            onClick={() => handlePreset(p.value)}
                            title={p.hint}
                            aria-pressed={active}
                            className={`px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors text-center ${
                                active
                                    ? 'bg-orange-600 border-orange-500 text-white'
                                    : 'bg-secondary border-border text-muted-foreground hover:text-foreground hover:border-orange-500/40'
                            }`}
                        >
                            {p.label}
                        </button>
                    );
                })}
            </div>

            {/* Expand/collapse toggle for per-parameter settings */}
            <button
                onClick={() => setExpanded(v => !v)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
            >
                {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {expanded ? 'Свернуть' : 'Настройка по параметрам'}
            </button>

            {/* Per-parameter unit selectors */}
            {expanded && (
                <div className="space-y-2 pt-2 border-t border-border/50">
                    {UNIT_ROWS.map(row => (
                        <div key={row.key} className="flex items-center gap-3">
                            <span className="text-xs text-muted-foreground w-36 shrink-0">{row.label}</span>
                            <div className="flex gap-1 flex-wrap">
                                {row.options.map(opt => {
                                    const active = units[row.key] === opt.value;
                                    return (
                                        <button
                                            key={opt.value}
                                            onClick={() => setRheologyUnit(row.key, opt.value as RheologyUnits[typeof row.key])}
                                            aria-pressed={active}
                                            className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                                                active
                                                    ? 'bg-orange-600/90 border-orange-500 text-white'
                                                    : 'bg-secondary/60 border-border/60 text-muted-foreground hover:text-foreground hover:border-orange-500/40'
                                            }`}
                                        >
                                            {opt.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
