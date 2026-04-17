import { useState, useEffect, useRef } from 'react';
import { ChevronDown, X, Beaker } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useCatalogStore } from '@/lib/store/catalog-store';

interface Reagent {
    id: string;
    name: string;
    category: string;
    manufacturer?: string | null;
    country?: string | null;
}

interface ReagentAutocompleteProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}

// Group reagents by category
function groupByCategory(reagents: Reagent[]): Map<string, Reagent[]> {
    const groups = new Map<string, Reagent[]>();
    for (const r of reagents) {
        if (!groups.has(r.category)) {
            groups.set(r.category, []);
        }
        groups.get(r.category)!.push(r);
    }
    return groups;
}

// Category display names
const categoryLabels: Record<string, string> = {
    'Gelling Agent': 'Гелеобразователи',
    'Crosslinker': 'Сшиватели',
    'Breaker': 'Деструкторы',
    'Buffer': 'pH-буферы',
    'Stabilizer': 'Стабилизаторы',
    'Clay Control': 'Контроль глин',
    'Friction Reducer': 'Понизители трения',
    'Biocide': 'Бактерициды',
    'Scale Inhibitor': 'Ингибиторы отложений',
    'Surfactant': 'ПАВ',
    'Viscosifier': 'Загустители',
};

const countryLabels: Record<string, string> = {
    'Russia': 'Россия',
    'USA': 'США',
    'China': 'Китай',
    'India': 'Индия',
    'Germany': 'Германия',
    'France': 'Франция',
    'UK': 'Великобритания',
    'Canada': 'Канада',
};

export function ReagentAutocomplete({ value, onChange, placeholder = 'Выберите реагент...' }: ReagentAutocompleteProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const reagents = useCatalogStore(s => s.reagents);
    const isLoading = useCatalogStore(s => s.reagentsLoading);
    const fetchReagents = useCatalogStore(s => s.fetchReagents);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Fetch reagents on mount (shared store deduplicates)
    useEffect(() => {
        fetchReagents();
    }, [fetchReagents]);

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Filter reagents by search query
    const filteredReagents = reagents.filter(r =>
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        r.category.toLowerCase().includes(search.toLowerCase()) ||
        (r.manufacturer?.toLowerCase().includes(search.toLowerCase())) ||
        (r.country?.toLowerCase().includes(search.toLowerCase()))
    );

    const groupedReagents = groupByCategory(filteredReagents);

    const handleSelect = (reagentName: string) => {
        onChange(reagentName);
        setSearch('');
        setIsOpen(false);
    };

    const handleClear = () => {
        onChange('');
        setSearch('');
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearch(e.target.value);
        onChange(e.target.value); // Also filter as user types
        if (!isOpen) setIsOpen(true);
    };

    return (
        <div ref={containerRef} className="relative">
            {/* Input Field */}
            <div className="relative">
                <Input
                    ref={inputRef}
                    type="text"
                    value={search || value}
                    onChange={handleInputChange}
                    onFocus={() => setIsOpen(true)}
                    className="bg-card border-purple-500/30 text-foreground pl-8 pr-16 focus-visible:ring-purple-500"
                    placeholder={placeholder}
                />
                <Beaker className="w-4 h-4 text-purple-400 absolute left-2.5 top-2.5" />
                <div className="absolute right-1 top-0.5 flex items-center gap-0.5 h-full">
                    {value && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleClear}
                            aria-label="Очистить"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        >
                            <X className="w-3 h-3" />
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setIsOpen(!isOpen)}
                        aria-label={isOpen ? 'Свернуть список' : 'Открыть список'}
                        aria-expanded={isOpen}
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    >
                        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </Button>
                </div>
            </div>

            {/* Dropdown */}
            {isOpen && (
                <div className="absolute z-50 w-full mt-1 bg-card border border-border rounded-lg shadow-xl max-h-80 overflow-y-auto">
                    {isLoading ? (
                        <div className="p-4 text-center text-muted-foreground text-sm">
                            Загрузка...
                        </div>
                    ) : filteredReagents.length === 0 ? (
                        <div className="p-4 text-center text-muted-foreground text-sm">
                            {search ? `Ничего не найдено по "${search}"` : 'Нет реагентов в каталоге'}
                        </div>
                    ) : (
                        <div className="py-1">
                            {Array.from(groupedReagents.entries()).map(([category, items]) => (
                                <div key={category}>
                                    {/* Category Header */}
                                    <div className="px-3 py-1.5 text-xs font-semibold text-purple-400 bg-secondary/50 sticky top-0">
                                        {categoryLabels[category] || category}
                                    </div>
                                    {/* Reagent Items */}
                                    {items.map(reagent => (
                                        <button
                                            key={reagent.id}
                                            onClick={() => handleSelect(reagent.name)}
                                            className={`w-full text-left px-4 py-2 text-sm hover:bg-secondary transition-colors ${value === reagent.name ? 'bg-purple-500/20 text-purple-300' : 'text-foreground/80'
                                                }`}
                                        >
                                            <span className="font-medium">{reagent.name}</span>
                                            {reagent.country && (
                                                <span className="ml-2 text-xs text-muted-foreground">({countryLabels[reagent.country] || reagent.country})</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
