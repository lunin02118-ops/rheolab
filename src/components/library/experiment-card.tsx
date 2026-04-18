import { Calendar, User, MapPin, Layers, Trash2, Loader2, FlaskConical, TestTube, Activity, CreditCard, Download, ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { memo, useState } from 'react';
import { useComparisonStore } from '@/lib/store/comparison-store';
import { getExperimentById } from '@/lib/experiments/client';
import { useToast } from '@/hooks/useToast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { isFluidType, FLUID_TYPE_LABELS } from '@/lib/constants/fluid-types';
import { CYCLE_TYPE_STYLES, DOMINANT_PATTERN_LABELS, type CycleTypeName } from '@/lib/analysis/constants';
import { TEST_TYPE_LABELS, type TestType } from '@/lib/constants/test-types';
import type { ExperimentCardItem, WaterParams } from '@/types/experiment-list-item';

const REAGENT_CATEGORY_LABELS: Record<string, string> = {
    'Gelling Agent': 'Гелеобразователь',
    'Crosslinker': 'Сшиватель',
    'Breaker': 'Деструктор',
    'Buffer': 'Буфер pH',
    'Stabilizer': 'Стабилизатор',
    'Clay Control': 'Ингибитор глин',
    'Friction Reducer': 'Понизитель трения',
    'Viscosifier': 'Загуститель',
    'Biocide': 'Биоцид',
    'Scale Inhibitor': 'Ингибитор отложений',
    'Surfactant': 'ПАВ',
};
import { storedToComparisonExperiment } from '@/lib/store/comparison-helpers';
import { shortInstrumentLabel } from '@/lib/utils/instrument-labels';

interface ExperimentCardProps {
    experiment: ExperimentCardItem;
    /** Called when user clicks the trash icon — parent is responsible for showing the confirmation dialog */
    onDeleteRequest?: (id: string, name: string) => void;
    /** Whether this card's reagent list is expanded */
    isExpanded?: boolean;
    /** Toggle expand state for this card */
    onExpandToggle?: (id: string) => void;
}

// ─── Compact section header ──────────────────────────────────────────────────
function SectionBar({
    icon,
    label,
    accent = 'cyan',
    extra,
}: {
    icon: React.ReactNode;
    label: string;
    accent?: 'cyan' | 'green' | 'orange';
    extra?: React.ReactNode;
}) {
    const border = {
        cyan:   'border-l-cyan-500/70',
        green:  'border-l-emerald-500/70',
        orange: 'border-l-orange-500/70',
    }[accent];
    const iconColor = {
        cyan:   'text-cyan-700 dark:text-cyan-400',
        green:  'text-emerald-700 dark:text-emerald-400',
        orange: 'text-orange-700 dark:text-orange-400',
    }[accent];
    return (
        <div className={`flex items-center gap-1.5 px-2.5 py-1 bg-card/60 border-l-2 ${border} border-b border-border/40`}>
            <span className={`${iconColor} shrink-0`}>{icon}</span>
            <span className="text-[8px] font-bold tracking-widest uppercase text-muted-foreground flex-1">{label}</span>
            {extra}
        </div>
    );
}

// ─── KPI row (label · value) ─────────────────────────────────────────────────
function KpiRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-1">
            <span className="text-[8px] text-muted-foreground uppercase tracking-wide shrink-0">{label}</span>
            {children}
        </div>
    );
}

function ExperimentCardInner({ experiment, onDeleteRequest, isExpanded = false, onExpandToggle }: ExperimentCardProps) {
    const { showToast } = useToast();
    const [isComparing, setIsComparing] = useState(false);

    // ── Derived data ────────────────────────────────────────────────
    const fluidLabel = isFluidType(experiment.fluidType)
        ? FLUID_TYPE_LABELS[experiment.fluidType]
        : experiment.fluidType;

    const maxVisc = experiment.maxViscosity != null
        ? Math.round(experiment.maxViscosity)
        : (experiment.metrics?.maxViscosity
            ? Math.round(experiment.metrics.maxViscosity)
            : (experiment.metrics?.initialViscosity_5_10 ? Math.round(experiment.metrics.initialViscosity_5_10) : null));

    const avgVisc = experiment.avgViscosity != null ? Math.round(experiment.avgViscosity) : null;

    const fmtTemp = (t?: number | null) => t != null ? `${t.toFixed(1)}°C` : null;
    const fmtDuration = (s?: number | null) => {
        if (s == null) return null;
        return `${Math.round(s / 60)} мин`;
    };

    const typeLabel = experiment.testType && experiment.testType in TEST_TYPE_LABELS
        ? TEST_TYPE_LABELS[experiment.testType as TestType]
        : experiment.testType ?? null;

    // Methodology badge — derived from dominant pattern
    const dp = experiment.dominantPattern;
    const dpStyle = dp && dp in CYCLE_TYPE_STYLES ? CYCLE_TYPE_STYLES[dp as CycleTypeName] : null;
    const dpLabel = dp && dp in DOMINANT_PATTERN_LABELS ? DOMINANT_PATTERN_LABELS[dp as CycleTypeName] : dp;

    // Water chemistry — 7 core parameters matching PDF report order
    const wp = experiment.waterParams ? experiment.waterParams as WaterParams : null;
    const wv0 = (a: number | null | undefined, b: number | null | undefined) => a ?? b ?? 0;
    const chemData = [
        { abbrev: 'pH',   val: wv0(wp?.ph,   wp?.pH),   unit: 'ед.'  },
        { abbrev: 'Fe',   val: wv0(wp?.fe,   wp?.Fe),   unit: 'мг/л' },
        { abbrev: 'Ca',   val: wv0(wp?.ca,   wp?.Ca),   unit: 'мг/л' },
        { abbrev: 'Mg',   val: wv0(wp?.mg,   wp?.Mg),   unit: 'мг/л' },
        { abbrev: 'Cl',   val: wv0(wp?.cl,   wp?.Cl),   unit: 'мг/л' },
        { abbrev: 'SO₄',  val: wv0(wp?.so4,  wp?.SO4),  unit: 'мг/л' },
        { abbrev: 'HCO₃', val: wv0(wp?.hco3, wp?.HCO3), unit: 'мг/л' },
    ];

    const dateStr: string = (() => {
        try { return format(new Date(experiment.testDate), 'dd MMM yyyy', { locale: ru }); }
        catch { return String(experiment.testDate); }
    })();

    const reagents = experiment.reagents ?? [];
    const MAX_VISIBLE = 5;
    const visibleReagents = reagents.slice(0, MAX_VISIBLE);
    const hiddenCount = Math.max(0, reagents.length - MAX_VISIBLE);

    return (
        <Card
            data-testid={`ExperimentCard_${experiment.id}`}
            className="bg-secondary/50 border-border hover:border-border transition-colors overflow-hidden flex flex-col w-full"
        >
            {/* ── HEADER ─────────────────────────────────────────────── */}
            <div className="bg-card/60 px-3 py-2 border-b border-border/60">
                <div className="flex items-center gap-1.5 text-foreground font-mono text-sm font-semibold mb-0.5">
                    <CreditCard className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{experiment.name}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1 shrink-0">
                        <Calendar className="w-3 h-3 text-muted-foreground shrink-0" />
                        {dateStr}
                    </span>
                    {experiment.fieldName && (
                        <span className="flex items-center gap-1 truncate max-w-[45%]">
                            <MapPin className="w-3 h-3 text-muted-foreground shrink-0" />
                            {experiment.fieldName}
                        </span>
                    )}
                    {experiment.operatorName && (
                        <span className="flex items-center gap-1 truncate max-w-[45%]">
                            <User className="w-3 h-3 text-muted-foreground shrink-0" />
                            {experiment.operatorName}
                        </span>
                    )}

                </div>
            </div>

            {/* ── RECIPE TABLE — PDF-style (Название · Партия · Тип · ЕИ · Конц.) ─ */}
            {reagents.length > 0 && (
                <>
                    <SectionBar icon={<FlaskConical className="w-3 h-3" />} label="Рецептура" accent="green" extra={fluidLabel ? <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 normal-case tracking-normal">{fluidLabel}</span> : undefined} />
                    <div className="overflow-x-auto">
                    <table className="w-full table-fixed text-[10px] border-collapse">
                        <colgroup>
                            <col style={{ width: '32%' }} />
                            <col style={{ width: '14%' }} />
                            <col style={{ width: '24%' }} />
                            <col style={{ width: '14%' }} />
                            <col style={{ width: '16%' }} />
                        </colgroup>
                        <thead>
                            <tr className="bg-card/40">
                                <th className="text-left px-2 py-0.5 font-semibold text-muted-foreground">Название</th>
                                <th className="text-center px-1 py-0.5 font-semibold text-muted-foreground">Партия</th>
                                <th className="text-left px-1 py-0.5 font-semibold text-muted-foreground">Тип</th>
                                <th className="text-center px-1 py-0.5 font-semibold text-muted-foreground">ЕИ</th>
                                <th className="text-right px-2 py-0.5 font-semibold text-muted-foreground">Конц.</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(isExpanded ? reagents : visibleReagents).map((r, i) => (
                                <tr key={i} className="border-t border-border/30 hover:bg-muted/20">
                                    <td className="px-2 py-[3px] text-foreground font-medium truncate">{r.reagentName ?? '?'}</td>
                                    <td className="px-1 py-[3px] text-center text-muted-foreground tabular-nums">{r.batchNumber || '—'}</td>
                                    <td className="px-1 py-[3px] text-muted-foreground truncate">{r.category ? (REAGENT_CATEGORY_LABELS[r.category] || r.category) : '—'}</td>
                                    <td className="px-1 py-[3px] text-center text-muted-foreground">{r.unit || '—'}</td>
                                    <td className="px-2 py-[3px] text-right text-foreground font-semibold tabular-nums">{r.concentration ?? 0}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                    {hiddenCount > 0 && (
                        <button
                            type="button"
                            onClick={() => onExpandToggle?.(experiment.id)}
                            className="w-full px-2 py-1 text-[10px] text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 hover:bg-emerald-500/5 border-t border-border/30 flex items-center gap-1 transition-colors"
                        >
                            <ChevronDown className={`w-3 h-3 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                            {isExpanded ? 'Скрыть' : `+${hiddenCount} ещё`}
                        </button>
                    )}
                </>
            )}

            {/* ── WATER CHEMISTRY TABLE — PDF-style horizontal (3 rows × 7 cols) ── */}
            <div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-card/60 border-l-2 border-l-cyan-500/70 border-y border-border/40">
                    <TestTube className="w-3 h-3 text-cyan-700 dark:text-cyan-400 shrink-0" />
                    <span className="text-[8px] font-bold tracking-widest uppercase text-muted-foreground">Химия воды</span>
                    {experiment.waterSource && (
                        <span className="text-[10px] font-bold text-orange-700 dark:text-orange-400 normal-case tracking-normal">{experiment.waterSource}</span>
                    )}
                </div>
                <table className="w-full table-fixed text-center border-collapse">
                    <colgroup>
                        {chemData.map(c => <col key={c.abbrev} />)}
                    </colgroup>
                    {/* Row 1: Parameter names */}
                    <thead>
                        <tr className="bg-card/30">
                            {chemData.map(c => (
                                <th key={c.abbrev} className="px-0.5 py-0.5 text-[9px] font-bold text-cyan-700 dark:text-cyan-400">{c.abbrev}</th>
                            ))}
                        </tr>
                        {/* Row 2: Units */}
                        <tr className="bg-card/15">
                            {chemData.map(c => (
                                <td key={c.abbrev} className="px-0.5 py-0 text-[7px] text-muted-foreground leading-tight">{c.unit}</td>
                            ))}
                        </tr>
                    </thead>
                    {/* Row 3: Values */}
                    <tbody>
                        <tr>
                            {chemData.map(c => (
                                <td key={c.abbrev} className="px-0.5 py-1 text-xs font-semibold text-foreground tabular-nums">{c.val}</td>
                            ))}
                        </tr>
                    </tbody>
                </table>
            </div>

            {/* ── CONDITIONS + RESULTS (two-column bottom) ───────────── */}
            <div className="flex flex-1 min-h-0 min-w-0 border-t border-border/40">
                {/* Left: Conditions */}
                <div className="flex-1 min-w-0 border-r border-border/40">
                    <SectionBar icon={<FlaskConical className="w-3 h-3" />} label="Условия" accent="cyan" />
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1 px-2.5 py-1.5">
                        <div className="min-w-0">
                            <div className="text-[8px] text-muted-foreground uppercase tracking-wide">Прибор</div>
                            <div className="text-[11px] font-medium text-foreground leading-snug truncate">{shortInstrumentLabel(experiment.instrumentType)}</div>
                        </div>
                        <div className="min-w-0">
                            <div className="text-[8px] text-muted-foreground uppercase tracking-wide">Геометрия</div>
                            <div className="text-[11px] font-medium text-foreground truncate">{experiment.geometry ?? <span className="text-muted-foreground">—</span>}</div>
                        </div>
                        <div className="min-w-0">
                            <div className="text-[8px] text-muted-foreground uppercase tracking-wide">Тип испытания</div>
                            <div className="text-[11px] font-medium text-foreground truncate">{typeLabel ?? <span className="text-muted-foreground">—</span>}</div>
                        </div>
                        <div className="min-w-0">
                            <div className="text-[8px] text-muted-foreground uppercase tracking-wide">Методика</div>
                            {dpStyle
                                ? <span className={`inline-block px-1 py-0.5 rounded text-[10px] font-bold leading-none ${dpStyle.bg} ${dpStyle.text}`}>{dpLabel}</span>
                                : <span className="text-[11px] text-muted-foreground italic">Нестандартная</span>}
                        </div>
                    </div>
                </div>

                {/* Right: Results / KPIs */}
                <div className="w-[140px] shrink-0 min-w-0">
                    <SectionBar icon={<Activity className="w-3 h-3" />} label="Результаты" accent="orange" />
                    <div className="px-2.5 py-1.5 space-y-0.5">
                        <KpiRow label="Макс.">
                            <span className="text-base font-bold text-orange-600 dark:text-orange-400 tabular-nums leading-tight">
                                {maxVisc != null
                                    ? <>{maxVisc}<span className="text-[8px] font-normal text-muted-foreground ml-0.5">сП</span></>
                                    : <span className="text-muted-foreground text-xs">—</span>}
                            </span>
                        </KpiRow>
                        <KpiRow label="Средн.">
                            <span className="text-sm font-bold text-orange-600 dark:text-orange-300 tabular-nums leading-tight">
                                {avgVisc != null
                                    ? <>{avgVisc}<span className="text-[8px] font-normal text-muted-foreground ml-0.5">сП</span></>
                                    : <span className="text-muted-foreground text-xs">—</span>}
                            </span>
                        </KpiRow>
                        <div className="border-t border-border/40 pt-0.5 space-y-0.5">
                            <KpiRow label="t° ср.">
                                <span className="text-sm font-bold text-foreground tabular-nums leading-tight">
                                    {fmtTemp(experiment.avgTemperatureC) ?? <span className="text-muted-foreground text-xs">—</span>}
                                </span>
                            </KpiRow>
                            <KpiRow label="t° макс.">
                                <span className="text-sm font-bold text-foreground tabular-nums leading-tight">
                                    {fmtTemp(experiment.maxTemperatureC) ?? <span className="text-muted-foreground text-xs">—</span>}
                                </span>
                            </KpiRow>
                        </div>
                        <div className="border-t border-border/40 pt-0.5">
                            <KpiRow label="Длит.">
                                <span className="text-sm font-bold text-foreground tabular-nums leading-tight">
                                    {fmtDuration(experiment.durationSeconds) ?? <span className="text-muted-foreground text-xs">—</span>}
                                </span>
                            </KpiRow>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── FOOTER ─────────────────────────────────────────────── */}
            <div className="flex justify-between items-center px-3 py-1.5 border-t border-border/50 bg-card/30">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                        e.stopPropagation();
                        onDeleteRequest?.(experiment.id, experiment.name);
                    }}
                    className="h-7 w-7 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                    aria-label="Удалить отчёт"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </Button>

                <div className="flex gap-2">
                    <div data-testid="OpenLibraryComparisonButton">
                        <Button
                            variant="outline"
                            size="sm"
                            data-testid="AddExperimentButton"
                            onClick={async () => {
                                const store = useComparisonStore.getState();
                                if (store.isInComparison(experiment.id)) return;
                                setIsComparing(true);
                                try {
                                    const response = await getExperimentById(experiment.id);
                                    if (response.success && response.experiment) {
                                        store.addExperiment(storedToComparisonExperiment(response.experiment));
                                        showToast('Добавлено в сравнение', 'success', 2000);
                                    } else {
                                        showToast('Ошибка загрузки данных эксперимента', 'error', 3000);
                                    }
                                } catch {
                                    showToast('Ошибка загрузки данных эксперимента', 'error', 3000);
                                } finally {
                                    setIsComparing(false);
                                }
                            }}
                            className="h-7 bg-secondary border-border text-foreground/80 hover:bg-secondary hover:text-foreground text-[11px]"
                            disabled={isComparing}
                        >
                            {isComparing
                                ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                : <Layers className="w-3 h-3 mr-1" />}
                            Сравнить
                        </Button>
                    </div>
                    <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        data-testid="LoadExperimentButton"
                        className="h-7 bg-blue-100 dark:bg-blue-600/20 hover:bg-blue-200 dark:hover:bg-blue-600/30 text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 border border-blue-300 dark:border-transparent text-[11px]"
                    >
                        <Link to={`/dashboard?loadExperimentId=${experiment.id}`}>
                            <Download className="w-3 h-3 mr-1" />
                            Загрузить
                        </Link>
                    </Button>
                </div>
            </div>
        </Card>
    );
}

/**
 * Memoised export — parent re-renders (e.g. expandedCardId changes) do not
 * cause all visible cards to re-render; only the two affected cards update.
 */
export const ExperimentCard = memo(ExperimentCardInner);
