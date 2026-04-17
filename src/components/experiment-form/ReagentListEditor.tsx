import React from 'react';
import type { ExperimentReagentInput } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

export interface ReagentCatalogItem {
    id: string;
    name: string;
    category: string;
    manufacturer?: string;
    country?: string;
    description?: string;
    activeSubstance?: string;
    form?: string;
}

export interface ReagentRow extends ExperimentReagentInput {
    key: string;
}

interface ReagentListEditorProps {
    reagents: ReagentRow[];
    setReagents: React.Dispatch<React.SetStateAction<ReagentRow[]>>;
    reagentCatalog: ReagentCatalogItem[];
    recentReagentIds: string[];
    onReagentSelect: (reagentId: string) => void;
}

// Translation mappings
const CATEGORY_MAP: Record<string, string> = {
    'Viscosifier': 'Загуститель',
    'Crosslinker': 'Сшиватель',
    'Breaker': 'Деструктор',
    'Biocide': 'Биоцид',
    'Clay Control': 'Ингибитор глин',
    'Surfactant': 'ПАВ',
    'Gelling Agent': 'Гелеобразователь',
    'Buffer': 'Буфер',
    'Stabilizer': 'Стабилизатор',
    'Friction Reducer': 'Понизитель трения',
    'Scale Inhibitor': 'Ингибитор отложений',
};

const FORM_MAP: Record<string, string> = {
    'Powder': 'Порошок',
    'Liquid': 'Жидкость',
    'Solid': 'Твёрдое',
    'Gel': 'Гель',
    'Slurry': 'Суспензия',
};

const COUNTRY_MAP: Record<string, string> = {
    'USA': 'США',
    'Russia': 'Россия',
    'China': 'Китай',
    'Germany': 'Германия',
    'France': 'Франция',
    'UK': 'Великобритания',
    'Canada': 'Канада',
};

export function ReagentListEditor({
    reagents,
    setReagents,
    reagentCatalog,
    recentReagentIds,
    onReagentSelect
}: ReagentListEditorProps) {
    // Group reagents by category
    const groupedReagents = React.useMemo(() => {
        const groups: Record<string, ReagentCatalogItem[]> = {};
        for (const r of reagentCatalog) {
            if (!groups[r.category]) {
                groups[r.category] = [];
            }
            groups[r.category].push(r);
        }
        return groups;
    }, [reagentCatalog]);

    // Get recent reagent items
    const recentReagents = React.useMemo(() => {
        return recentReagentIds
            .map(id => reagentCatalog.find(r => r.id === id))
            .filter((r): r is ReagentCatalogItem => r !== undefined);
    }, [recentReagentIds, reagentCatalog]);

    const addReagentRow = () => {
        setReagents(prev => [...prev, {
            key: `new-${Date.now()}`,
            reagentId: '',
            reagentName: '',
            concentration: 0,
            unit: 'kg/m3',
            batchNumber: undefined,
            productionDate: undefined
        }]);
    };

    const removeReagentRow = (key: string) => {
        setReagents(prev => prev.filter(r => r.key !== key));
    };

    const updateReagentRow = (key: string, field: keyof ReagentRow, value: unknown) => {
        setReagents(prev => prev.map(r =>
            r.key === key ? { ...r, [field]: value } : r
        ));
    };

    const handleReagentChange = (row: ReagentRow, reagentId: string) => {
        const reagent = reagentCatalog.find(r => r.id === reagentId);
        updateReagentRow(row.key, 'reagentId', reagentId);
        if (reagent) {
            updateReagentRow(row.key, 'reagentName', reagent.name);
            onReagentSelect(reagentId);
        }
    };

    return (
        <div className="bg-card dark:bg-card rounded-xl border border-border overflow-hidden">
            {/* Section header */}
            <div className="flex items-center justify-between px-5 py-2.5 border-b border-border/50 bg-muted/30 dark:bg-secondary/40">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Рецептура</h3>
                <Button
                    onClick={addReagentRow}
                    data-testid="SaveDialogAddReagentButton"
                    className="bg-cyan-600 hover:bg-cyan-500 text-white h-7 px-3 text-xs"
                    size="sm"
                >
                    + Добавить реагент
                </Button>
            </div>

            {/* Section body */}
            <div className="p-5">
                {reagents.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-6 gap-2">
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground text-lg">🧪</div>
                        <p className="text-muted-foreground text-sm text-center">
                            Реагенты не добавлены
                        </p>
                        <p className="text-xs text-muted-foreground/70">
                            Нажмите «+ Добавить реагент», чтобы указать состав рецептуры
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {/* Column headers */}
                        <div className="grid grid-cols-12 gap-2 text-[11px] font-medium text-muted-foreground px-2 pb-1 border-b border-border/40">
                            <div className="col-span-4">Реагент</div>
                            <div className="col-span-2">Концентрация</div>
                            <div className="col-span-2">Ед.</div>
                            <div className="col-span-1">№ партии</div>
                            <div className="col-span-2">Дата пр-ва</div>
                            <div className="col-span-1" />
                        </div>

                        {reagents.map(row => (
                            <ReagentRowItem
                                key={row.key}
                                row={row}
                                reagentCatalog={reagentCatalog}
                                recentReagents={recentReagents}
                                groupedReagents={groupedReagents}
                                onReagentChange={handleReagentChange}
                                onUpdate={updateReagentRow}
                                onRemove={removeReagentRow}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// Sub-component for a single reagent row
interface ReagentRowItemProps {
    row: ReagentRow;
    reagentCatalog: ReagentCatalogItem[];
    recentReagents: ReagentCatalogItem[];
    groupedReagents: Record<string, ReagentCatalogItem[]>;
    onReagentChange: (row: ReagentRow, reagentId: string) => void;
    onUpdate: (key: string, field: keyof ReagentRow, value: unknown) => void;
    onRemove: (key: string) => void;
}

function ReagentRowItem({
    row,
    reagentCatalog,
    recentReagents,
    groupedReagents,
    onReagentChange,
    onUpdate,
    onRemove
}: ReagentRowItemProps) {
    const selectedReagent = row.reagentId
        ? reagentCatalog.find(r => r.id === row.reagentId)
        : null;

    return (
        <div className="grid grid-cols-12 gap-2 items-center rounded-lg hover:bg-muted/30 dark:hover:bg-secondary/20 px-1 py-0.5 transition-colors">
            <div className="col-span-4 flex items-center gap-1">
                <div className="flex-1">
                    <Select
                        value={row.reagentId}
                        onValueChange={(value) => onReagentChange(row, value)}
                    >
                        <SelectTrigger data-testid="SaveDialogReagentSelector" className="w-full bg-background dark:bg-secondary/30 border-border text-foreground h-8 text-sm">
                            <SelectValue placeholder="Выберите реагент..." />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                            {recentReagents.length > 0 && (
                                <SelectGroup>
                                    <SelectLabel>⏱️ Недавние</SelectLabel>
                                    {recentReagents.map(r => (
                                        <SelectItem key={`recent-${r.id}`} value={r.id}>
                                            {r.name}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            )}
                            {Object.entries(groupedReagents)
                                .sort(([a], [b]) => a.localeCompare(b))
                                .map(([category, items]) => (
                                    <SelectGroup key={category}>
                                        <SelectLabel>{CATEGORY_MAP[category] || category}</SelectLabel>
                                        {items.map(r => (
                                            <SelectItem key={r.id} value={r.id}>
                                                {r.name}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                ))}
                        </SelectContent>
                    </Select>
                </div>
                {selectedReagent && <ReagentInfoTooltip reagent={selectedReagent} />}
            </div>

            <div className="col-span-2">
                <Input
                    type="number"
                    step="0.1"
                    value={row.concentration}
                    onChange={e => onUpdate(row.key, 'concentration', parseFloat(e.target.value) || 0)}
                    data-testid="SaveDialogReagentConcentrationInput"
                    className="text-foreground h-8 text-sm dark:bg-secondary/30"
                />
            </div>

            <div className="col-span-2">
                <Select
                    value={row.unit}
                    onValueChange={(value) => onUpdate(row.key, 'unit', value)}
                >
                    <SelectTrigger data-testid="SaveDialogReagentUnitComboBox" className="w-full bg-background dark:bg-secondary/30 border-border text-foreground h-8 px-2 text-sm">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="kg/m3">кг/м³</SelectItem>
                        <SelectItem value="gpt">gpt</SelectItem>
                        <SelectItem value="L/m3">л/м³</SelectItem>
                        <SelectItem value="%">%</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="col-span-1">
                <Input
                    type="text"
                    value={row.batchNumber || ''}
                    onChange={e => onUpdate(row.key, 'batchNumber', e.target.value || undefined)}
                    data-testid="SaveDialogReagentBatchInput"
                    className="text-foreground h-8 text-xs dark:bg-secondary/30"
                    placeholder="Партия-001"
                />
            </div>

            <div className="col-span-2">
                <Input
                    type="date"
                    value={row.productionDate ? new Date(row.productionDate).toISOString().split('T')[0] : ''}
                    onChange={e => onUpdate(row.key, 'productionDate', e.target.value ? new Date(e.target.value) : undefined)}
                    data-testid="SaveDialogReagentDatePicker"
                    className="text-foreground h-8 px-1 text-xs dark:bg-secondary/30 [&::-webkit-calendar-picker-indicator]:w-3 [&::-webkit-calendar-picker-indicator]:h-3 [&::-webkit-calendar-picker-indicator]:opacity-60"
                />
            </div>

            <div className="col-span-1 flex justify-center">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onRemove(row.key)}
                    data-testid="SaveDialogRemoveReagentButton"
                    className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-400/10"
                    aria-label="Удалить реагент"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </Button>
            </div>
        </div>
    );
}

// Tooltip component for reagent info
function ReagentInfoTooltip({ reagent }: { reagent: ReagentCatalogItem }) {
    const translateCategory = (cat: string) => CATEGORY_MAP[cat] || cat;
    const translateForm = (form: string) => FORM_MAP[form] || form;
    const translateCountry = (country: string) => COUNTRY_MAP[country] || country;

    return (
        <div className="relative group">
            <svg
                className="w-4 h-4 text-muted-foreground hover:text-cyan-400 cursor-help"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
            >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-50 w-72">
                <div className="bg-card border border-border rounded-lg p-3 shadow-xl text-xs">
                    <div className="font-medium text-foreground mb-2">{reagent.name}</div>
                    <div className="text-foreground/80 space-y-1">
                        {reagent.category && (
                            <div>📂 <span className="text-muted-foreground">Категория:</span> {translateCategory(reagent.category)}</div>
                        )}
                        {reagent.manufacturer && (
                            <div>🏭 <span className="text-muted-foreground">Производитель:</span> {reagent.manufacturer}</div>
                        )}
                        {reagent.country && (
                            <div>🌍 <span className="text-muted-foreground">Страна:</span> {translateCountry(reagent.country)}</div>
                        )}
                        {reagent.form && (
                            <div>💊 <span className="text-muted-foreground">Форма:</span> {translateForm(reagent.form)}</div>
                        )}
                        {reagent.activeSubstance && (
                            <div>🧪 <span className="text-muted-foreground">Действ. вещество:</span> {reagent.activeSubstance}</div>
                        )}
                        {reagent.description && (
                            <div className="mt-2 pt-2 border-t border-border">
                                <span className="text-muted-foreground">📝 Описание:</span>
                                <div className="mt-1 text-muted-foreground">{reagent.description}</div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
