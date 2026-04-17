import { Plus, Trash2 } from 'lucide-react';
import { Logo } from '@/components/ui/logo';
import React, { useState, useEffect, useCallback } from 'react';
import { useCatalogStore } from '@/lib/store/catalog-store';

export interface RecipeComponent {
    abbreviation: string;
    concentration: number;
    unit: string;
    category?: string;
    reagentId?: string;
    reagentName?: string;
    batchNumber?: string;
    productionDate?: Date;
}

interface ReagentCatalogItem {
    id: string;
    name: string;
    category: string;
}

interface RecipePanelProps {
    recipe: RecipeComponent[];
    onRecipeChange?: (recipe: RecipeComponent[]) => void;
}

// Category translations
const CATEGORY_LABELS: Record<string, string> = {
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

export const RecipePanel = React.memo(function RecipePanel({ recipe: externalRecipe, onRecipeChange }: RecipePanelProps) {
    // Use external state directly if callback provided (controlled mode)
    // Otherwise, use internal state (uncontrolled mode)
    const [internalRecipe, setInternalRecipe] = useState<RecipeComponent[]>(externalRecipe || []);

    // Controlled vs uncontrolled pattern
    const recipe = onRecipeChange ? externalRecipe : internalRecipe;
    const setRecipe = onRecipeChange || setInternalRecipe;

    const reagentCatalog = useCatalogStore(s => s.reagents) as ReagentCatalogItem[];
    const isLoading = useCatalogStore(s => s.reagentsLoading);
    const fetchReagentsCatalog = useCatalogStore(s => s.fetchReagents);

    // Load reagent catalog (shared store deduplicates)
    useEffect(() => {
        fetchReagentsCatalog();
    }, [fetchReagentsCatalog]);

    // Group reagents by category
    const groupedReagents = reagentCatalog.reduce<Record<string, ReagentCatalogItem[]>>((acc, r) => {
        if (!acc[r.category]) acc[r.category] = [];
        acc[r.category].push(r);
        return acc;
    }, {});

    // Update recipe
    const updateRecipe = useCallback((newRecipe: RecipeComponent[]) => {
        setRecipe(newRecipe);
    }, [setRecipe]);

    // Update single row
    const updateRow = useCallback((idx: number, field: keyof RecipeComponent, value: unknown) => {
        const newRecipe = [...recipe];
        newRecipe[idx] = { ...newRecipe[idx], [field]: value };
        updateRecipe(newRecipe);
    }, [recipe, updateRecipe]);

    // Add new row
    const addRow = useCallback(() => {
        updateRecipe([...recipe, {
            abbreviation: '',
            concentration: 0,
            unit: 'kg/m3',
        }]);
    }, [recipe, updateRecipe]);

    // Remove row
    const removeRow = useCallback((idx: number) => {
        updateRecipe(recipe.filter((_, i) => i !== idx));
    }, [recipe, updateRecipe]);

    // Handle reagent select change
    const handleReagentChange = useCallback((idx: number, reagentId: string) => {
        const reagent = reagentCatalog.find(r => r.id === reagentId);
        const newRecipe = [...recipe];
        newRecipe[idx] = {
            ...newRecipe[idx],
            reagentId,
            reagentName: reagent?.name || '',
            abbreviation: reagent?.name || newRecipe[idx].abbreviation,
            category: reagent?.category,
        };
        updateRecipe(newRecipe);
    }, [recipe, reagentCatalog, updateRecipe]);

    if (!recipe || recipe.length === 0) {
        return (
            <div className="bg-card/50 border border-border rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg">
                        <Logo className="w-5 h-5" />
                    </div>
                    <h3 className="font-semibold text-foreground">Рецептура</h3>
                </div>
                <p className="text-muted-foreground text-sm text-center py-4">
                    Нет данных о рецептуре
                </p>
                <button
                    onClick={addRow}
                    data-testid="AddReagentButton"
                    className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 text-foreground rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
                >
                    <Plus className="w-4 h-4" />
                    Добавить реагент
                </button>
            </div>
        );
    }

    return (
        <div className="bg-card/50 border border-border rounded-xl overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg">
                        <Logo className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-foreground">Рецептура</h3>
                        <p className="text-xs text-muted-foreground">{recipe.length} компонентов</p>
                    </div>
                </div>
                <button
                    onClick={addRow}
                    data-testid="AddReagentButton"
                    className="flex items-center gap-1 px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-foreground rounded text-sm transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    Добавить
                </button>
            </div>

            {/* Table */}
            <table className="w-full">
                <thead>
                    <tr className="bg-secondary/50 text-xs text-muted-foreground font-medium">
                        <th className="px-3 py-2 text-left w-[30%]">Реагент</th>
                        <th className="px-3 py-2 text-left w-[15%]">Концентрация</th>
                        <th className="px-3 py-2 text-left w-[10%]">Ед.</th>
                        <th className="px-3 py-2 text-left w-[18%]">№ партии</th>
                        <th className="px-3 py-2 text-left w-[20%]">Дата пр-ва</th>
                        <th className="px-3 py-2 w-[7%]"></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                    {recipe.map((row, idx) => (
                        <tr key={idx} className="hover:bg-secondary/30">
                            {/* Reagent */}
                            <td className="px-3 py-2 align-top">
                                {isLoading ? (
                                    <div className="animate-pulse bg-input h-8 rounded"></div>
                                ) : (
                                    <div>
                                        <select
                                            value={row.reagentId || ''}
                                            onChange={(e) => handleReagentChange(idx, e.target.value)}
                                            className="w-full bg-input border border-border rounded px-2 py-1.5 text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                        >
                                            <option value="">{row.abbreviation || 'Выберите...'}</option>
                                            {Object.entries(groupedReagents)
                                                .sort(([a], [b]) => a.localeCompare(b))
                                                .map(([category, items]) => (
                                                    <optgroup key={category} label={CATEGORY_LABELS[category] || category}>
                                                        {items.map(r => (
                                                            <option key={r.id} value={r.id}>{r.name}</option>
                                                        ))}
                                                    </optgroup>
                                                ))}
                                        </select>
                                        {row.category && (
                                            <div className="text-xs text-muted-foreground mt-0.5">
                                                {CATEGORY_LABELS[row.category] || row.category}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </td>

                            {/* Concentration */}
                            <td className="px-3 py-2 align-top">
                                <input
                                    type="number"
                                    step="0.1"
                                    value={row.concentration}
                                    onChange={(e) => updateRow(idx, 'concentration', parseFloat(e.target.value) || 0)}
                                    className="w-full bg-input border border-border rounded px-2 py-1.5 text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                />
                            </td>

                            {/* Unit */}
                            <td className="px-3 py-2 align-top">
                                <select
                                    value={row.unit}
                                    onChange={(e) => updateRow(idx, 'unit', e.target.value)}
                                    data-testid="ReagentUnitComboBox"
                                    className="w-full bg-input border border-border rounded px-1 py-1.5 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                >
                                    <option value="kg/m3">кг/м³</option>
                                    <option value="gpt">gpt</option>
                                    <option value="L/m3">л/м³</option>
                                    <option value="%">%</option>
                                </select>
                            </td>

                            {/* Batch number */}
                            <td className="px-3 py-2 align-top">
                                <input
                                    type="text"
                                    value={row.batchNumber || ''}
                                    onChange={(e) => updateRow(idx, 'batchNumber', e.target.value || undefined)}
                                    className="w-full bg-input border border-border rounded px-2 py-1.5 text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                    placeholder="—"
                                />
                            </td>

                            {/* Production date */}
                            <td className="px-3 py-2 align-top">
                                <input
                                    type="date"
                                    value={row.productionDate ? new Date(row.productionDate).toISOString().split('T')[0] : ''}
                                    onChange={(e) => updateRow(idx, 'productionDate', e.target.value ? new Date(e.target.value) : undefined)}
                                    data-testid="ReagentProductionDatePicker"
                                    className="w-full bg-input border border-border rounded px-2 py-1.5 text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                />
                            </td>

                            {/* Remove button */}
                            <td className="px-3 py-2 text-center align-top">
                                <button
                                    onClick={() => removeRow(idx)}
                                    data-testid="RemoveReagentButton"
                                    className="p-1.5 text-red-400 hover:text-red-300 transition-colors"
                                    title="Удалить"
                                    aria-label="Удалить компонент"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
});
