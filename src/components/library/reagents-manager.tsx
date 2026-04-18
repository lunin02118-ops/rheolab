import { useState, useEffect, useMemo, memo, useRef, useDeferredValue } from 'react';
import { Plus, Beaker, Search, ChevronDown, Loader2, AlertTriangle, Eye, Pencil, Trash2 } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useCatalogStore } from '@/lib/store/catalog-store';
import { ReagentDetailDrawer, CATEGORIES, type Reagent } from './reagent-detail-drawer';
import { ReagentFormModal } from './reagent-form-modal';
import { useReagentActions } from './useReagentActions';

const FORM_LABELS: Record<string, string> = {
    'Powder': 'Порошок',
    'Liquid': 'Жидкость',
    'Granules': 'Гранулы',
    'Solid': 'Твёрдое',
};

const COUNTRY_LABELS: Record<string, string> = {
    'Russia': 'Россия',
    'USA': 'США',
    'China': 'Китай',
    'India': 'Индия',
    'Germany': 'Германия',
    'France': 'Франция',
    'UK': 'Великобритания',
    'Canada': 'Канада',
};

type FlatItem =
    | { type: 'header'; group: { category: { value: string; label: string }; items: Reagent[] } }
    | { type: 'row'; group: { category: { value: string; label: string }; items: Reagent[] }; reagent: Reagent };

/** Virtualize the list only when the catalog grows beyond this threshold. */
const VIRTUAL_THRESHOLD = 50;

function ReagentsManagerComponent() {
    const reagents = useCatalogStore(s => s.reagents) as Reagent[];
    const isLoading = useCatalogStore(s => s.reagentsLoading);
    const fetchReagents = useCatalogStore(s => s.fetchReagents);
    const invalidateReagents = useCatalogStore(s => s.invalidateReagents);
    const [searchQuery, setSearchQuery] = useState('');
    const deferredSearch = useDeferredValue(searchQuery);
    const [categoryFilter, setCategoryFilter] = useState('');

    const {
        isModalOpen, editingReagent, setIsModalOpen,
        deleteConfirm, setDeleteConfirm,
        detailReagent, setDetailReagent,
        error, setError,
        handleOpenAdd, handleOpenEdit, handleOpenDetail, handleDelete, handleSave,
    } = useReagentActions({ invalidateReagents, fetchReagents });

    const deleteFocusTrapRef = useFocusTrap<HTMLDivElement>(!!deleteConfirm);

    useEffect(() => { void fetchReagents(); }, [fetchReagents]);

    // Filter reagents (deferredSearch avoids blocking the input keystroke)
    const filteredReagents = useMemo(() => reagents.filter(r => {
        const matchesSearch = deferredSearch === '' ||
            r.name.toLowerCase().includes(deferredSearch.toLowerCase()) ||
            r.manufacturer?.toLowerCase().includes(deferredSearch.toLowerCase());
        const matchesCategory = categoryFilter === '' || r.category === categoryFilter;
        return matchesSearch && matchesCategory;
    }), [reagents, deferredSearch, categoryFilter]);

    // Group by category (including custom categories from reagents)
    const groupedReagents = useMemo(() => {
        const allCategories = new Set([
            ...CATEGORIES.map(c => c.value),
            ...filteredReagents.map(r => r.category)
        ]);

        return Array.from(allCategories).map(categoryValue => {
            const items = filteredReagents.filter(r => r.category === categoryValue);
            const predefined = CATEGORIES.find(c => c.value === categoryValue);
            return {
                category: { value: categoryValue, label: predefined?.label || categoryValue },
                items
            };
        }).filter(group => group.items.length > 0);
    }, [filteredReagents]);

    // -- Virtualizer for large catalogs (>VIRTUAL_THRESHOLD items) ------------
    const scrollParentRef = useRef<HTMLDivElement>(null);

    const flatItems = useMemo<FlatItem[]>(() => {
        if (filteredReagents.length <= VIRTUAL_THRESHOLD) return [];
        const items: FlatItem[] = [];
        for (const group of groupedReagents) {
            items.push({ type: 'header', group });
            for (const reagent of group.items) {
                items.push({ type: 'row', group, reagent });
            }
        }
        return items;
    }, [groupedReagents, filteredReagents.length]);

    const virtualizer = useVirtualizer({
        count: flatItems.length,
        getScrollElement: () => scrollParentRef.current,
        estimateSize: (i) => (flatItems[i]?.type === 'header' ? 44 : 48),
        overscan: 5,
    });


    return (
        <div className="text-foreground">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h2 className="text-xl font-bold flex items-center gap-3">
                        <Beaker className="w-6 h-6 text-purple-400" />
                        Каталог реагентов
                    </h2>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Управляйте реагентами и настройками каталога
                    </p>
                </div>
                <button
                    onClick={handleOpenAdd}
                    data-testid="AddReagentButton"
                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg font-medium transition-colors text-sm"
                >
                    <Plus className="w-4 h-4" />
                    Добавить реагент
                </button>
            </div>

            {/* Error Banner */}
            {error && (
                <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                    <span className="text-red-300">{error}</span>
                    <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-foreground">×</button>
                </div>
            )}

            {/* Filters */}
            <div className="flex gap-4 mb-6">
                <div className="relative flex-1">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        data-testid="ReagentsSearchInput"
                        placeholder="Поиск по названию или производителю..."
                        className="w-full bg-secondary border border-border rounded-lg py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:border-purple-500"
                    />
                    <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-3" />
                </div>
                <div className="relative">
                    <select
                        value={categoryFilter}
                        onChange={e => setCategoryFilter(e.target.value)}
                        data-testid="ReagentCategoryFilter"
                        className="appearance-none bg-secondary border border-border rounded-lg py-2.5 pl-4 pr-10 text-sm focus:outline-none focus:border-purple-500"
                    >
                        <option value="">Все категории</option>
                        {/* Predefined categories */}
                        {CATEGORIES.map(c => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                        {/* Custom categories from reagents */}
                        {Array.from(new Set(reagents.map(r => r.category)))
                            .filter(cat => !CATEGORIES.find(c => c.value === cat))
                            .map(cat => (
                                <option key={cat} value={cat}>{cat} (пользовательская)</option>
                            ))
                        }
                    </select>
                    <ChevronDown className="w-4 h-4 text-muted-foreground absolute right-3 top-3 pointer-events-none" />
                </div>
                <button
                    type="button"
                    data-testid="ClearReagentFiltersButton"
                    onClick={() => {
                        setSearchQuery('');
                        setCategoryFilter('');
                    }}
                    className="px-3 py-2.5 text-xs rounded-lg border bg-card/60 border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={searchQuery === '' && categoryFilter === ''}
                >
                    Сбросить
                </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="bg-secondary/50 border border-border rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-foreground">{reagents.length}</div>
                    <div className="text-xs text-muted-foreground">Всего реагентов</div>
                </div>
                <div className="bg-secondary/50 border border-border rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-purple-400">
                        {new Set(reagents.map(r => r.category)).size}
                    </div>
                    <div className="text-xs text-muted-foreground">Категорий</div>
                </div>
                <div className="bg-secondary/50 border border-border rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-blue-400">
                        {new Set(reagents.map(r => r.manufacturer).filter(Boolean)).size}
                    </div>
                    <div className="text-xs text-muted-foreground">Производителей</div>
                </div>
                <div className="bg-secondary/50 border border-border rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-green-400">
                        {new Set(reagents.map(r => r.country).filter(Boolean)).size}
                    </div>
                    <div className="text-xs text-muted-foreground">Стран</div>
                </div>
            </div>

            {/* Content */}
            {isLoading ? (
                <div className="flex justify-center py-20">
                    <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
                </div>
            ) : filteredReagents.length === 0 ? (
                <div className="text-center py-20 bg-secondary/30 rounded-xl border border-border">
                    <Beaker className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">Реагенты не найдены</p>
                    <p className="text-xs text-muted-foreground mt-2">Попробуйте изменить фильтр или добавьте новый реагент</p>
                </div>
            ) : (
                filteredReagents.length > VIRTUAL_THRESHOLD ? (
                    // -- Virtual list for large catalogs ------------------------------
                    <div
                        ref={scrollParentRef}
                        role="table"
                        aria-label="Каталог реагентов"
                        className="overflow-auto rounded-xl border border-border bg-secondary/50"
                        style={{ maxHeight: '60vh' }}
                    >
                        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                            {virtualizer.getVirtualItems().map(virtualItem => {
                                const item = flatItems[virtualItem.index];
                                return (
                                    <div
                                        key={virtualItem.key}
                                        style={{
                                            position: 'absolute',
                                            top: virtualItem.start,
                                            left: 0,
                                            right: 0,
                                            height: virtualItem.size,
                                        }}
                                    >
                                        {item.type === 'header' ? (
                                            <div role="row" className="px-4 flex items-center gap-2 h-full bg-secondary border-b border-border">
                                                <span role="columnheader" className="text-purple-400 font-semibold">{item.group.category.label}</span>
                                                <span className="text-xs text-muted-foreground">({item.group.items.length})</span>
                                            </div>
                                        ) : (
                                            <div
                                                role="row"
                                                tabIndex={0}
                                                onKeyDown={(e) => { if (e.key === 'Enter') handleOpenDetail(item.reagent); }}
                                                className="flex items-center px-3 border-b border-border/30 hover:bg-secondary/30 text-sm h-full gap-2">
                                                <span className="flex-1 font-medium text-foreground truncate">{item.reagent.name}</span>
                                                <span className="w-40 text-muted-foreground truncate">{item.reagent.manufacturer || '�'}</span>
                                                <span className="w-28 text-muted-foreground">{item.reagent.country ? (COUNTRY_LABELS[item.reagent.country] || item.reagent.country) : '—'}</span>
                                                <span className="w-24 text-muted-foreground">{item.reagent.form ? (FORM_LABELS[item.reagent.form] || item.reagent.form) : '—'}</span>
                                                <div className="w-28 flex justify-center gap-1 flex-shrink-0">
                                                    <button onClick={() => handleOpenDetail(item.reagent)} className="p-1.5 hover:bg-secondary rounded-lg transition-colors" title="Просмотр" aria-label="Просмотр реагента">
                                                        <Eye className="w-4 h-4 text-muted-foreground hover:text-purple-400" />
                                                    </button>
                                                    <button onClick={() => handleOpenEdit(item.reagent)} className="p-1.5 hover:bg-secondary rounded-lg transition-colors" title="Редактировать" aria-label="Редактировать реагента">
                                                        <Pencil className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                                                    </button>
                                                    <button onClick={() => setDeleteConfirm(item.reagent.id)} className="p-1.5 hover:bg-red-500/20 rounded-lg transition-colors" title="Удалить" aria-label="Удалить реагент">
                                                        <Trash2 className="w-4 h-4 text-muted-foreground hover:text-red-400" />
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                <div className="space-y-6">
                    {groupedReagents.map(group => (
                        <div key={group.category.value} className="bg-secondary/50 border border-border rounded-xl overflow-hidden">
                            <div className="px-4 py-3 bg-secondary border-b border-border flex items-center gap-2">
                                <span className="text-purple-400 font-semibold">{group.category.label}</span>
                                <span className="text-xs text-muted-foreground">({group.items.length})</span>
                            </div>
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border/50 text-muted-foreground text-xs">
                                        <th className="text-left p-3">Название</th>
                                        <th className="text-left p-3">Производитель</th>
                                        <th className="text-left p-3">Страна</th>
                                        <th className="text-left p-3">Форма</th>
                                        <th className="text-center p-3 w-24">Действия</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {group.items.map(reagent => (
                                        <tr key={reagent.id} className="border-b border-border/30 hover:bg-secondary/30">
                                            <td className="p-3 font-medium text-foreground">{reagent.name}</td>
                                            <td className="p-3 text-muted-foreground">{reagent.manufacturer || '—'}</td>
                                            <td className="p-3 text-muted-foreground">{reagent.country ? (COUNTRY_LABELS[reagent.country] || reagent.country) : '—'}</td>
                                            <td className="p-3 text-muted-foreground">{reagent.form ? (FORM_LABELS[reagent.form] || reagent.form) : '—'}</td>
                                            <td className="p-3">
                                                <div className="flex justify-center gap-1">
                                                    <button
                                                        onClick={() => handleOpenDetail(reagent)}
                                                        className="p-1.5 hover:bg-secondary rounded-lg transition-colors"
                                                        title="Просмотр"                                                        aria-label="Просмотр реагента"                                                    >
                                                        <Eye className="w-4 h-4 text-muted-foreground hover:text-purple-400" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleOpenEdit(reagent)}
                                                        className="p-1.5 hover:bg-secondary rounded-lg transition-colors"
                                                        title="Редактировать"                                                        aria-label="Редактировать реагент"                                                    >
                                                        <Pencil className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                                                    </button>
                                                    <button
                                                        onClick={() => setDeleteConfirm(reagent.id)}
                                                        className="p-1.5 hover:bg-red-500/20 rounded-lg transition-colors"
                                                        title="Удалить"                                                        aria-label="Удалить реагент"                                                    >
                                                        <Trash2 className="w-4 h-4 text-muted-foreground hover:text-red-400" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ))}
                </div>
                )
            )}

            {/* Add/Edit Modal */}
            {isModalOpen && (
                <ReagentFormModal
                    reagent={editingReagent}
                    onSave={handleSave}
                    onClose={() => setIsModalOpen(false)}
                    error={error}
                />
            )}

            {/* Reagent Detail Drawer */}
            {detailReagent && (
                <ReagentDetailDrawer
                    reagent={detailReagent}
                    onClose={() => setDetailReagent(null)}
                    onEdit={() => { setDetailReagent(null); handleOpenEdit(detailReagent); }}
                />
            )}

            {/* Delete Confirmation */}
            {deleteConfirm && (
                <div
                    ref={deleteFocusTrapRef}
                    role="dialog"
                    aria-modal="true"
                    className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
                    onKeyDown={(e) => { if (e.key === 'Escape') setDeleteConfirm(null); }}
                >
                    <div
                        aria-labelledby="delete-reagent-title"
                        className="bg-card border border-border rounded-xl p-6 max-w-sm"
                    >
                        <h3 id="delete-reagent-title" className="text-lg font-semibold mb-4">Удалить реагент?</h3>
                        <p className="text-muted-foreground text-sm mb-6">
                            Это действие нельзя отменить. Реагент будет удалён из каталога.
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                autoFocus
                                onClick={() => setDeleteConfirm(null)}
                                className="px-4 py-2 bg-secondary hover:bg-secondary rounded-lg text-sm"
                            >
                                Отмена
                            </button>
                            <button
                                onClick={() => handleDelete(deleteConfirm)}
                                className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm"
                            >
                                Удалить
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export const ReagentsManager = memo(ReagentsManagerComponent);
