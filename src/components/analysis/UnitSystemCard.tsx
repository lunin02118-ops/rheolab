/**
 * UnitSystemCard — global viscosity unit selector (Analysis settings).
 *
 * Single source of truth: `chartSettings.lines.viscosity.unit`.
 * Changing this affects:
 *   - cycle-results-table (K', PV, YP, η@γ̇ labels + values)
 *   - PDF/Excel reports (via unitSystem derived in ReportTab / ReportsPanel)
 *   - chart Y-axis label for viscosity line
 */
import { Ruler } from 'lucide-react';
import { useChartSettingsStore } from '@/lib/store/chart-settings-store';
import type { ViscosityUnit } from '@/lib/store/chart-settings-types';

const OPTIONS: { value: ViscosityUnit; label: string; hint: string }[] = [
    { value: 'mPa·s', label: 'SI (мПа·с)',  hint: 'Метрическая, вязкость в миллипаскаль-секундах' },
    { value: 'Pa·s',  label: 'SI (Па·с)',   hint: 'Метрическая, вязкость в паскаль-секундах' },
    { value: 'cP',    label: 'Imperial (сП)', hint: 'Имперская, K\'/YP в lbf/100ft², PV в cP' },
];

export function UnitSystemCard() {
    const unit = useChartSettingsStore(s => s.settings.lines.viscosity.unit) as ViscosityUnit;
    const setLineSettings = useChartSettingsStore(s => s.setLineSettings);

    const handleChange = (next: ViscosityUnit) => {
        setLineSettings('viscosity', { unit: next });
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
                Применяется к таблице результатов, отчётам PDF/Excel и оси вязкости графика.
                Единый источник истины — значения и заголовки всегда консистентны.
            </p>
            <div className="grid grid-cols-3 gap-2">
                {OPTIONS.map(opt => {
                    const active = unit === opt.value;
                    return (
                        <button
                            key={opt.value}
                            onClick={() => handleChange(opt.value)}
                            title={opt.hint}
                            aria-pressed={active}
                            className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors text-center ${
                                active
                                    ? 'bg-orange-600 border-orange-500 text-white'
                                    : 'bg-secondary border-border text-muted-foreground hover:text-foreground hover:border-orange-500/40'
                            }`}
                        >
                            {opt.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
