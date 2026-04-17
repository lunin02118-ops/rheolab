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

export function ChartSettingsManager() {
    const {
        settings,
        setSettings,
        setLineSettings,
        setPrecision,
    } = useChartSettingsStore(useShallow(s => ({
        settings: s.settings,
        setSettings: s.setSettings,
        setLineSettings: s.setLineSettings,
        setPrecision: s.setPrecision,
    })));


    return (
        <div className="space-y-6">
            {/* Line Settings */}
            <Card className="bg-card/50 border-border">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-foreground">
                        <LineChart className="w-5 h-5 text-blue-400" />
                        Настройки линий
                    </CardTitle>
                    <CardDescription>Цвет, толщина и стиль для каждого параметра</CardDescription>
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
                            accent="blue"
                            label={config.label}
                            color={settings.lines[config.key].color}
                            width={settings.lines[config.key].width}
                            style={settings.lines[config.key].style}
                            axis={config.key === 'bathTemperature' ? settings.lines.temperature.axis : settings.lines[config.key].axis}
                            visible={config.disabled ? true : settings.lines[config.key].visible}
                            disabled={config.disabled}
                            axisDisabled={config.key === 'viscosity' || config.key === 'bathTemperature'}
                            onColorChange={color => setLineSettings(config.key, { color })}
                            onWidthChange={width => setLineSettings(config.key, { width })}
                            onStyleChange={style => setLineSettings(config.key, { style })}
                            onAxisChange={axis => {
                                setLineSettings(config.key, { axis });
                                if (config.key === 'temperature') setLineSettings('bathTemperature', { axis });
                            }}
                            onVisibleChange={visible => setLineSettings(config.key, { visible })}
                        />
                    ))}
                </CardContent>
            </Card>

            {/* Precision Settings */}
            <Card className="bg-card/50 border-border">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-foreground">
                        <Hash className="w-5 h-5 text-amber-400" />
                        Точность отображения
                    </CardTitle>
                    <CardDescription>Количество знаков после запятой</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                        <SelectInput accent="blue" label="Вязкость" options={PRECISION_OPTIONS} value={settings.precision.viscosity} onChange={v => setPrecision({ viscosity: v as 0 | 1 | 2 | 3 })} />
                        <SelectInput accent="blue" label="Температура" options={PRECISION_OPTIONS.slice(0, 3)} value={settings.precision.temperature} onChange={v => setPrecision({ temperature: v as 0 | 1 | 2 })} />
                        <SelectInput accent="blue" label="Давление" options={PRECISION_OPTIONS} value={settings.precision.pressure} onChange={v => setPrecision({ pressure: v as 0 | 1 | 2 | 3 })} />
                        <SelectInput accent="blue" label="Время" options={PRECISION_OPTIONS.slice(0, 3)} value={settings.precision.time} onChange={v => setPrecision({ time: v as 0 | 1 | 2 })} />
                        <SelectInput accent="blue" label="Скор. сдвига" options={PRECISION_OPTIONS.slice(0, 3)} value={settings.precision.shearRate} onChange={v => setPrecision({ shearRate: v as 0 | 1 | 2 })} />
                        <SelectInput accent="blue" label="Обороты" options={PRECISION_OPTIONS.slice(0, 2)} value={settings.precision.rpm} onChange={v => setPrecision({ rpm: v as 0 | 1 })} />
                    </div>
                </CardContent>
            </Card>

            {/* Additional Settings */}
            <Card className="bg-card/50 border-border">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-foreground">
                        <Grid3X3 className="w-5 h-5 text-cyan-400" />
                        Дополнительно
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-foreground/80">Сетка графика</span>
                        <button
                            onClick={() => setSettings({ showGridLines: !settings.showGridLines })}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                                settings.showGridLines ? 'bg-blue-600' : 'bg-secondary'
                            }`}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                settings.showGridLines ? 'translate-x-6' : 'translate-x-1'
                            }`} />
                        </button>
                    </div>

                    {settings.showGridLines && (
                        <div className="flex items-center gap-4">
                            <span className="text-sm text-muted-foreground w-28">Прозрачность:</span>
                            <Slider
                                value={[settings.gridOpacity * 100]}
                                onValueChange={(v: number[]) => setSettings({ gridOpacity: v[0] / 100 })}
                                min={10}
                                max={100}
                                step={10}
                                className="flex-1"
                            />
                            <span className="text-sm text-muted-foreground w-12">{Math.round(settings.gridOpacity * 100)}%</span>
                        </div>
                    )}

                    <div className="flex items-center justify-between">
                        <div>
                            <span className="text-sm text-muted-foreground">Анимации</span>
                            <p className="text-xs text-muted-foreground">Не поддерживается в uPlot</p>
                        </div>
                        <span className="text-xs text-muted-foreground italic px-2">N/A</span>
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <span className="text-sm text-foreground/80">Подсказки (Tooltips)</span>
                            <p className="text-xs text-muted-foreground">Показывать значения при наведении</p>
                        </div>
                        <button
                            onClick={() => setSettings({ tooltipEnabled: !settings.tooltipEnabled })}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                                settings.tooltipEnabled ? 'bg-blue-600' : 'bg-secondary'
                            }`}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                settings.tooltipEnabled ? 'translate-x-6' : 'translate-x-1'
                            }`} />
                        </button>
                    </div>

                    {/* Downsampling mode */}
                    <div className="pt-1">
                        <div className="mb-2">
                            <span className="text-sm text-foreground/80">Прореживание точек</span>
                            <p className="text-xs text-muted-foreground">Уменьшение числа точек для ускорения отрисовки</p>
                        </div>
                        <div className="flex gap-2">
                            {([
                                { value: 'off',        label: 'Выкл',       desc: 'Все точки' },
                                { value: 'smart',      label: 'Умный',      desc: 'Рампы целиком' },
                                { value: 'aggressive', label: 'Агрессивный',desc: 'LTTB везде' },
                            ] as { value: DownsampleMode; label: string; desc: string }[]).map(opt => (
                                <button
                                    key={opt.value}
                                    title={opt.desc}
                                    onClick={() => setSettings({ downsampleMode: opt.value })}
                                    className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                                        (settings.downsampleMode ?? 'smart') === opt.value
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-secondary text-muted-foreground hover:bg-secondary'
                                }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Comparison axis mode */}
                    <div className="pt-1">
                        <div className="mb-2">
                            <span className="text-sm text-foreground/80">Оси на графиках</span>
                            <p className="text-xs text-muted-foreground">Режим осей для графика анализа и сравнения</p>
                        </div>
                        <div className="flex gap-2">
                            {([
                                { value: 'individual', label: 'Раздельные', desc: 'У каждой метрики своя шкала' },
                                { value: 'shared',     label: 'Общие',      desc: 'Метрики слева на одной оси, справа на другой' },
                            ] as { value: ComparisonAxisMode; label: string; desc: string }[]).map(opt => (
                                <button
                                    key={opt.value}
                                    title={opt.desc}
                                    onClick={() => setSettings({ comparisonAxisMode: opt.value })}
                                    className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                                        (settings.comparisonAxisMode ?? 'individual') === opt.value
                                    ? 'bg-blue-600 text-white'
                                            : 'bg-secondary text-muted-foreground hover:bg-secondary'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>

                </CardContent>
            </Card>

        </div>
    );
}
