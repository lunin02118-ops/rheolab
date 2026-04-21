/**
 * PrecisionSettingsCard — decimal-place precision for display values.
 *
 * Affects the cycle results table, chart tooltips, and PDF/Excel reports.
 * Lives on the "Единицы и отображение" tab alongside UnitSystemCard —
 * they together form the single source of truth for how values are presented.
 */
import { Hash } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useShallow } from 'zustand/react/shallow';
import { useChartSettingsStore } from '@/lib/store/chart-settings-store';
import { SelectInput, PRECISION_OPTIONS } from './settings-shared';

export function PrecisionSettingsCard() {
    const { settings, setPrecision } = useChartSettingsStore(useShallow(s => ({
        settings: s.settings,
        setPrecision: s.setPrecision,
    })));

    return (
        <Card className="bg-card/50 border-border">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-foreground">
                    <Hash className="w-5 h-5 text-amber-400" />
                    Точность отображения
                </CardTitle>
                <CardDescription>Количество знаков после запятой в таблицах и отчётах</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                    <SelectInput accent="blue" label="Вязкость"    options={PRECISION_OPTIONS}            value={settings.precision.viscosity}   onChange={v => setPrecision({ viscosity:   v as 0 | 1 | 2 | 3 })} />
                    <SelectInput accent="blue" label="Температура" options={PRECISION_OPTIONS.slice(0, 3)} value={settings.precision.temperature} onChange={v => setPrecision({ temperature: v as 0 | 1 | 2 })} />
                    <SelectInput accent="blue" label="Давление"    options={PRECISION_OPTIONS}            value={settings.precision.pressure}    onChange={v => setPrecision({ pressure:    v as 0 | 1 | 2 | 3 })} />
                    <SelectInput accent="blue" label="Время"       options={PRECISION_OPTIONS.slice(0, 3)} value={settings.precision.time}        onChange={v => setPrecision({ time:        v as 0 | 1 | 2 })} />
                    <SelectInput accent="blue" label="Скор. сдвига" options={PRECISION_OPTIONS.slice(0, 3)} value={settings.precision.shearRate}   onChange={v => setPrecision({ shearRate:   v as 0 | 1 | 2 })} />
                    <SelectInput accent="blue" label="Обороты"     options={PRECISION_OPTIONS.slice(0, 2)} value={settings.precision.rpm}         onChange={v => setPrecision({ rpm:         v as 0 | 1 })} />
                </div>
            </CardContent>
        </Card>
    );
}
