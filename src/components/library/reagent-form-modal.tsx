/**
 * Reagent add/edit form modal.
 */

import { useState } from 'react';
import { CATEGORIES, COUNTRIES, FORMS, type Reagent } from './reagent-detail-drawer';
import { useFocusTrap } from '@/hooks/useFocusTrap';

// Translation maps for display
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

interface ReagentFormModalProps {
    reagent: Reagent | null;
    onSave: (data: Partial<Reagent>) => void;
    onClose: () => void;
    error: string | null;
}

export function ReagentFormModal({ reagent, onSave, onClose, error }: ReagentFormModalProps) {
    const [formData, setFormData] = useState({
        name: reagent?.name || '',
        category: reagent?.category || 'Gelling Agent',
        manufacturer: reagent?.manufacturer || '',
        country: reagent?.country || '',
        description: reagent?.description || '',
        activeSubstance: reagent?.activeSubstance || '',
        form: reagent?.form || '',
        isNewCategory: false,
    });

    const focusTrapRef = useFocusTrap<HTMLDivElement>(true);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(formData);
    };

    return (
        <div ref={focusTrapRef} role="dialog" aria-modal="true" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div
                aria-labelledby="reagent-form-title"
                className="bg-card border border-border rounded-xl p-6 w-full max-w-lg"
            >
                <h3 id="reagent-form-title" className="text-lg font-semibold mb-6">
                    {reagent ? 'Редактировать реагент' : 'Добавить реагент'}
                </h3>

                {error && (
                    <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Name */}
                    <div>
                        <label htmlFor="reagent-name" className="block text-xs text-muted-foreground mb-1">Название *</label>
                        <input
                            id="reagent-name"
                            type="text"
                            value={formData.name}
                            onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                            className="w-full bg-secondary border border-border rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-purple-500"
                            placeholder="Гуаровая камедь Премиум"
                            required
                        />
                    </div>

                    {/* Category - with option to add new */}
                    <div>
                        <label htmlFor="reagent-category" className="block text-xs text-muted-foreground mb-1">Категория *</label>
                        <div className="flex gap-2">
                            {formData.isNewCategory ? (
                                <input
                                    id="reagent-category"
                                    type="text"
                                    value={formData.category}
                                    onChange={e => setFormData(prev => ({ ...prev, category: e.target.value }))}
                                    className="flex-1 bg-secondary border border-border rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-purple-500"
                                    placeholder="Введите новую категорию..."
                                    required
                                />
                            ) : (
                                <select
                                    id="reagent-category"
                                    value={formData.category}
                                    onChange={e => setFormData(prev => ({ ...prev, category: e.target.value }))}
                                    className="flex-1 bg-secondary border border-border rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-purple-500"
                                    required
                                >
                                    {CATEGORIES.map(c => (
                                        <option key={c.value} value={c.value}>{c.label}</option>
                                    ))}
                                </select>
                            )}
                            <button
                                type="button"
                                onClick={() => setFormData(prev => ({
                                    ...prev,
                                    isNewCategory: !prev.isNewCategory,
                                    category: prev.isNewCategory ? 'Gelling Agent' : ''
                                }))}
                                className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${formData.isNewCategory
                                    ? 'bg-purple-600 hover:bg-purple-500 text-foreground'
                                    : 'bg-secondary hover:bg-muted text-foreground/80'
                                    }`}
                                title={formData.isNewCategory ? 'Выбрать из списка' : 'Добавить новую категорию'}
                            >
                                {formData.isNewCategory ? '← Список' : '+ Новая'}
                            </button>
                        </div>
                    </div>

                    {/* Manufacturer & Country */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1">Производитель</label>
                            <input
                                type="text"
                                value={formData.manufacturer}
                                onChange={e => setFormData(prev => ({ ...prev, manufacturer: e.target.value }))}
                                className="w-full bg-secondary border border-border rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-purple-500"
                                placeholder="НПО Химпром"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1">Страна</label>
                            <select
                                value={formData.country}
                                onChange={e => setFormData(prev => ({ ...prev, country: e.target.value }))}
                                className="w-full bg-secondary border border-border rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-purple-500"
                            >
                                <option value="">Не указана</option>
                                {COUNTRIES.map(c => (
                                    <option key={c} value={c}>{COUNTRY_LABELS[c] || c}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Form & Active Substance */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1">Форма</label>
                            <select
                                value={formData.form}
                                onChange={e => setFormData(prev => ({ ...prev, form: e.target.value }))}
                                className="w-full bg-secondary border border-border rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-purple-500"
                            >
                                <option value="">Не указана</option>
                                {FORMS.map(f => (
                                    <option key={f} value={f}>{FORM_LABELS[f] || f}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1">Активное вещество</label>
                            <input
                                type="text"
                                value={formData.activeSubstance}
                                onChange={e => setFormData(prev => ({ ...prev, activeSubstance: e.target.value }))}
                                className="w-full bg-secondary border border-border rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-purple-500"
                                placeholder="Гуар"
                            />
                        </div>
                    </div>

                    {/* Description */}
                    <div>
                        <label className="block text-xs text-muted-foreground mb-1">Описание</label>
                        <textarea
                            value={formData.description}
                            onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                            className="w-full bg-secondary border border-border rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-purple-500 resize-none"
                            rows={3}
                            placeholder="Дополнительная информация..."
                        />
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 justify-end pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-secondary hover:bg-secondary rounded-lg text-sm"
                        >
                            Отмена
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium"
                        >
                            {reagent ? 'Сохранить' : 'Добавить'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
