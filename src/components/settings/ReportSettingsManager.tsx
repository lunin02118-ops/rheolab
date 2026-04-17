import { LineChart, Hash, Grid3X3 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { useShallow } from 'zustand/react/shallow';
import {
    useChartSettingsStore,
    type DownsampleMode,
    type ComparisonAxisMode,
} from '@/lib/store/chart-settings-store';
import { LineConfigRow, SelectInput, LINE_CONFIGS, PRECISION_OPTIONS } from './settings-shared';

export function ReportSettingsManager() {
    const {
        reportSettings,
        setReportSettings,
        setReportLineSettings,
        setReportPrecision,
    } = useChartSettingsStore(useShallow(s => ({
        reportSettings: s.reportSettings,
        setReportSettings: s.setReportSettings,
        setReportLineSettings: s.setReportLineSettings,
        setReportPrecision: s.setReportPrecision,
    })));


    return (
        <div className="space-y-6">
            {/* Line Settings */}
            <Card className="bg-card/50 border-border">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-foreground" data-testid="ReportLineSettingsHeading">
                        <LineChart className="w-5 h-5 text-emerald-400" />
                        Настройки линий для отчётов
                    </CardTitle>
                    <CardDescription>Цвет, толщина и стиль (оптимизировано для печати)</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="mb-3 flex items-center gap-3 text-xs text-muted-foreground border-b border-border pb-2">
                        <span className="w-9">Вкл</span>
                        <span className="w-28">Параметр</span>
                        <span className="w-7">Цвет</span>
                        <span className="w-[104px]">Толщина</span>
                        <span className="w-[88px]">Стиль</span>
                        <span>Ось</span>
                    </div>
                    {LINE_CONFIGS.map(config => (
                        <LineConfigRow
                            key={config.key}
                            accent="emerald"
                            label={config.label}
                            color={reportSettings.lines[config.key].color}
                            width={reportSettings.lines[config.key].width}
                            style={reportSettings.lines[config.key].style}
                            axis={config.key === 'bathTemperature' ? reportSettings.lines.temperature.axis : reportSettings.lines[config.key].axis}
                            visible={config.disabled ? true : reportSettings.lines[config.key].visible}
                            disabled={config.disabled}
                            axisDisabled={config.key === 'viscosity' || config.key === 'bathTemperature'}
                            onColorChange={color => setReportLineSettings(config.key, { color })}
                            onWidthChange={width => setReportLineSettings(config.key, { width })}
                            onStyleChange={style => setReportLineSettings(config.key, { style })}
                            onAxisChange={axis => {
                                setReportLineSettings(config.key, { axis });
                                if (config.key === 'temperature') setReportLineSettings('bathTemperature', { axis });
                            }}
                            onVisibleChange={visible => setReportLineSettings(config.key, { visible })}
                        />
                    ))}
                </CardContent>
            </Card>

            {/* Precision Settings */}
            <Card className="bg-card/50 border-border">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-foreground">
                        <Hash className="w-5 h-5 text-amber-400" />
                        Точность в отчётах
                    </CardTitle>
                    <CardDescription>Знаки после запятой в PDF/Excel</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                        <SelectInput accent="emerald" label="Вязкость" options={PRECISION_OPTIONS} value={reportSettings.precision.viscosity} onChange={v => setReportPrecision({ viscosity: v as 0 | 1 | 2 | 3 })} />
                        <SelectInput accent="emerald" label="Температура" options={PRECISION_OPTIONS.slice(0, 3)} value={reportSettings.precision.temperature} onChange={v => setReportPrecision({ temperature: v as 0 | 1 | 2 })} />
                        <SelectInput accent="emerald" label="Давление" options={PRECISION_OPTIONS} value={reportSettings.precision.pressure} onChange={v => setReportPrecision({ pressure: v as 0 | 1 | 2 | 3 })} />
                        <SelectInput accent="emerald" label="Время" options={PRECISION_OPTIONS.slice(0, 3)} value={reportSettings.precision.time} onChange={v => setReportPrecision({ time: v as 0 | 1 | 2 })} />
                    </div>
                </CardContent>
            </Card>

            {/* Grid Settings */}
            <Card className="bg-card/50 border-border">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-foreground">
                        <Grid3X3 className="w-5 h-5 text-cyan-400" />
                        Сетка в отчётах
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-foreground/80">Показывать сетку</span>
                        <button
                            onClick={() => setReportSettings({ showGridLines: !reportSettings.showGridLines })}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                                reportSettings.showGridLines ? 'bg-emerald-600' : 'bg-secondary'
                            }`}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                reportSettings.showGridLines ? 'translate-x-6' : 'translate-x-1'
                            }`} />
                        </button>
                    </div>

                    {reportSettings.showGridLines && (
                        <div className="flex items-center gap-4">
                            <span className="text-sm text-muted-foreground w-28">Прозрачность:</span>
                            <Slider
                                value={[reportSettings.gridOpacity * 100]}
                                onValueChange={(v: number[]) => setReportSettings({ gridOpacity: v[0] / 100 })}
                                min={10}
                                max={100}
                                step={10}
                                className="flex-1"
                            />
                            <span className="text-sm text-muted-foreground w-12">{Math.round(reportSettings.gridOpacity * 100)}%</span>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Downsampling */}
            <Card className="bg-card/50 border-border">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-foreground">
                        <Hash className="w-5 h-5 text-purple-400" />
                        Прореживание точек
                    </CardTitle>
                    <CardDescription>Уменьшение числа точек для ускорения отрисовки предпросмотра</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-2">
                        {([
                            { value: 'off',        label: 'Выкл',        desc: 'Все точки' },
                            { value: 'smart',      label: 'Умный',       desc: 'Рампы целиком' },
                            { value: 'aggressive', label: 'Агрессивный', desc: 'LTTB везде' },
                        ] as { value: DownsampleMode; label: string; desc: string }[]).map(opt => (
                            <button
                                key={opt.value}
                                title={opt.desc}
                                onClick={() => setReportSettings({ downsampleMode: opt.value })}
                                className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                                    (reportSettings.downsampleMode ?? 'off') === opt.value
                                        ? 'bg-emerald-600 text-foreground'
                                        : 'bg-secondary text-muted-foreground hover:bg-secondary'
                                }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Axis Mode */}
            <Card className="bg-card/50 border-border">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-foreground">
                        <LineChart className="w-5 h-5 text-blue-400" />
                        Оси в отчётах
                    </CardTitle>
                    <CardDescription>Режим осей для PDF и Excel отчётов</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-2">
                        {([
                            { value: 'individual', label: 'Раздельные', desc: 'У каждой метрики своя шкала' },
                            { value: 'shared',     label: 'Общие',      desc: 'Метрики слева на одной оси, справа на другой' },
                        ] as { value: ComparisonAxisMode; label: string; desc: string }[]).map(opt => (
                            <button
                                key={opt.value}
                                title={opt.desc}
                                onClick={() => setReportSettings({ comparisonAxisMode: opt.value })}
                                className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                                    (reportSettings.comparisonAxisMode ?? 'individual') === opt.value
                                        ? 'bg-blue-600 text-foreground'
                                        : 'bg-secondary text-muted-foreground hover:bg-secondary'
                                }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </CardContent>
            </Card>

        </div>
    );
}
