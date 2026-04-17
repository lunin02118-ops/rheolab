/**
 * Reagent detail drawer — slide-in panel showing full reagent info.
 */

import { useEffect } from 'react';
import { Pencil, X, AlertTriangle } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';

export interface Reagent {
    id: string;
    name: string;
    category: string;
    manufacturer?: string;
    country?: string;
    description?: string;
    activeSubstance?: string;
    form?: string;
}

export const CATEGORIES = [
    { value: 'Gelling Agent', label: 'Гелеобразователь' },
    { value: 'Crosslinker', label: 'Сшиватель' },
    { value: 'Breaker', label: 'Деструктор' },
    { value: 'Buffer', label: 'pH-буфер' },
    { value: 'Stabilizer', label: 'Стабилизатор' },
    { value: 'Clay Control', label: 'Контроль глин' },
    { value: 'Friction Reducer', label: 'Понизитель трения' },
    { value: 'Biocide', label: 'Бактерицид' },
    { value: 'Scale Inhibitor', label: 'Ингибитор отложений' },
    { value: 'Surfactant', label: 'ПАВ' },
    { value: 'Viscosifier', label: 'Загуститель' },
] as const;

export const COUNTRIES = ['Russia', 'USA', 'China', 'India', 'Germany', 'France'] as const;
export const FORMS = ['Powder', 'Liquid', 'Granules', 'Solid'] as const;

const COUNTRY_LABELS: Record<string, string> = {
    'Russia': 'Россия',
    'USA': 'США',
    'China': 'Китай',
    'India': 'Индия',
    'Germany': 'Германия',
    'France': 'Франция',
};

const FORM_LABELS: Record<string, string> = {
    'Powder': 'Порошок',
    'Liquid': 'Жидкость',
    'Granules': 'Гранулы',
    'Solid': 'Твёрдое',
};

interface ReagentDetailDrawerProps {
    reagent: Reagent;
    onClose: () => void;
    onEdit: () => void;
}

export function ReagentDetailDrawer({ reagent, onClose, onEdit }: ReagentDetailDrawerProps) {
    const focusTrapRef = useFocusTrap<HTMLDivElement>(true);
    const categoryLabel = CATEGORIES.find(c => c.value === reagent.category)?.label || reagent.category;

    // Close on Escape
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [onClose]);

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/40 z-40"
                onClick={onClose}
                aria-hidden="true"
            />
            {/* Panel */}
            <div
                ref={focusTrapRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="detail-drawer-title"
                className="fixed top-0 right-0 h-full w-full max-w-md bg-card border-l border-border z-50 flex flex-col shadow-2xl"
            >
                {/* Header */}
                <div className="flex items-start justify-between p-5 border-b border-border gap-3">
                    <div className="flex-1 min-w-0">
                        <h2 id="detail-drawer-title" className="text-lg font-semibold text-foreground truncate">
                            {reagent.name}
                        </h2>
                        <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-500/20 text-purple-300 border border-purple-500/30">
                            {categoryLabel}
                        </span>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-secondary rounded-lg transition-colors flex-shrink-0"
                        aria-label="Закрыть"
                    >
                        <X className="w-5 h-5 text-muted-foreground" />
                    </button>
                </div>

                {/* Scrollable body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-5">
                    {/* Metadata grid */}
                    <div className="grid grid-cols-2 gap-3">
                        {[
                            { label: 'Производитель', value: reagent.manufacturer },
                            { label: 'Страна', value: reagent.country ? (COUNTRY_LABELS[reagent.country] || reagent.country) : undefined },
                            { label: 'Форма выпуска', value: reagent.form ? (FORM_LABELS[reagent.form] || reagent.form) : undefined },
                            { label: 'Активное вещество', value: reagent.activeSubstance },
                        ].map(({ label, value }) => (
                            <div key={label} className="bg-secondary/60 rounded-lg p-3">
                                <div className="text-xs text-muted-foreground mb-1">{label}</div>
                                <div className="text-sm text-foreground font-medium">{value || '—'}</div>
                            </div>
                        ))}
                    </div>

                    {/* Description */}
                    {reagent.description ? (
                        <div>
                            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Техническое описание</div>
                            <div className="bg-secondary/60 rounded-lg p-4 text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
                                {reagent.description}
                            </div>
                        </div>
                    ) : (
                        <div className="bg-secondary/40 rounded-lg p-4 text-sm text-muted-foreground italic">
                            Описание отсутствует
                        </div>
                    )}

                    {/* Disclaimer */}
                    <div className="flex gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5">
                        <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-300/90 leading-relaxed">
                            Технические данные приведены по открытым источникам (ТДС, SDS, каталоги производителей) и{' '}
                            <span className="font-semibold">не подтверждены официально</span>. Для применения в расчётах уточняйте характеристики у производителя или поставщика химии.
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-border flex gap-3">
                    <button
                        onClick={onEdit}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium transition-colors"
                    >
                        <Pencil className="w-4 h-4" />
                        Редактировать
                    </button>
                    <button
                        onClick={onClose}
                        className="px-4 py-2.5 bg-secondary hover:bg-secondary rounded-lg text-sm transition-colors"
                    >
                        Закрыть
                    </button>
                </div>
            </div>
        </>
    );
}
