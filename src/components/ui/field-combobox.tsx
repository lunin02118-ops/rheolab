/**
 * FieldCombobox — free-text input with autocomplete dropdown for oilfield names.
 *
 * Merges a static list of major Russian oil & gas fields with any extra
 * suggestions (e.g. distinct values already stored in the DB).
 * User can always type a completely custom value — the list is advisory only.
 */
import { useState, useEffect, useRef, useCallback, useMemo, KeyboardEvent } from 'react';
import { ChevronDown, X, MapPin } from 'lucide-react';
import { OIL_GAS_FIELDS } from '@/lib/constants/oil-fields';

interface FieldComboboxProps {
    /** Current controlled value */
    value: string;
    /** Called whenever the value changes (typing or list select) */
    onChange: (value: string) => void;
    /** Optional additional suggestions (e.g. DB-loaded unique values) */
    extraSuggestions?: string[];
    /**
     * When provided, replaces the built-in OIL_GAS_FIELDS static list.
     * Use this to turn FieldCombobox into a generic combobox with arbitrary options.
     */
    staticList?: string[];
    /** Entity label used in aria strings and the "new value" hint (default: "Месторождение") */
    entityLabel?: string;
    placeholder?: string;
    /** Tailwind classes for the inner <input> element */
    inputClassName?: string;
    /** data-testid passed to the input */
    testId?: string;
    /** Whether to show the MapPin icon on the left */
    showIcon?: boolean;
}

export function FieldCombobox({
    value,
    onChange,
    extraSuggestions = [],
    staticList,
    entityLabel = 'Месторождение',
    placeholder = 'Самотлорское',
    inputClassName = 'bg-input border-border text-foreground focus-visible:ring-cyan-500',
    testId,
    showIcon = false,
}: FieldComboboxProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    // Merge static list with DB suggestions, deduplicate, sort
    const allSuggestions = useMemo<string[]>(() => {
        const base = staticList ?? OIL_GAS_FIELDS;
        const set = new Set<string>([...base, ...extraSuggestions]);
        return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
    }, [staticList, extraSuggestions]);

    // Filter by current input value
    const filtered = useMemo<string[]>(() => {
        if (!value.trim()) return allSuggestions;
        const q = value.trim().toLowerCase();
        return allSuggestions.filter(s => s.toLowerCase().includes(q));
    }, [allSuggestions, value]);

    // Close when clicking outside
    useEffect(() => {
        function handler(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
                setActiveIndex(-1);
            }
        }
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // Scroll active item into view
    useEffect(() => {
        if (activeIndex >= 0 && listRef.current) {
            const item = listRef.current.children[activeIndex] as HTMLElement | undefined;
            item?.scrollIntoView({ block: 'nearest' });
        }
    }, [activeIndex]);

    const handleInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        onChange(e.target.value);
        setIsOpen(true);
        setActiveIndex(-1);
    }, [onChange]);

    const handleSelect = useCallback((option: string) => {
        onChange(option);
        setIsOpen(false);
        setActiveIndex(-1);
        inputRef.current?.focus();
    }, [onChange]);

    const handleClear = useCallback(() => {
        onChange('');
        setIsOpen(false);
        setActiveIndex(-1);
        inputRef.current?.focus();
    }, [onChange]);

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
        if (!isOpen) {
            if (e.key === 'ArrowDown' || e.key === 'Enter') {
                setIsOpen(true);
                return;
            }
            return;
        }
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setActiveIndex(i => Math.min(i + 1, filtered.length - 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setActiveIndex(i => Math.max(i - 1, -1));
                break;
            case 'Enter':
                e.preventDefault();
                if (activeIndex >= 0 && filtered[activeIndex]) {
                    handleSelect(filtered[activeIndex]);
                } else {
                    setIsOpen(false);
                }
                break;
            case 'Escape':
                setIsOpen(false);
                setActiveIndex(-1);
                break;
        }
    }, [isOpen, filtered, activeIndex, handleSelect]);

    const baseInputClasses = [
        'w-full rounded-md border px-3 py-2 text-sm ring-offset-background',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        showIcon ? 'pl-8' : '',
        'pr-14', // room for clear + chevron buttons
        inputClassName,
    ].filter(Boolean).join(' ');

    return (
        <div ref={containerRef} className="relative">
            {/* Icon */}
            {showIcon && (
                <MapPin className="w-4 h-4 text-muted-foreground absolute left-2.5 top-2.5 pointer-events-none z-10" aria-hidden="true" />
            )}

            {/* Input */}
            <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={handleInput}
                onFocus={() => setIsOpen(true)}
                onKeyDown={handleKeyDown}
                data-testid={testId}
                placeholder={placeholder}
                className={baseInputClasses}
                autoComplete="off"
                aria-autocomplete="list"
                aria-expanded={isOpen}
                aria-haspopup="listbox"
                role="combobox"
            />

            {/* Action buttons */}
            <div className="absolute right-1 top-0 h-full flex items-center gap-0.5">
                {value && (
                    <button
                        type="button"
                        onClick={handleClear}
                        aria-label={`Очистить ${entityLabel.toLowerCase()}`}
                        className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
                    >
                        <X className="w-3 h-3" />
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => { setIsOpen(o => !o); inputRef.current?.focus(); }}
                    aria-label={isOpen ? `Свернуть список (${entityLabel})` : `Открыть список (${entityLabel})`}
                    aria-expanded={isOpen}
                    className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
                >
                    <ChevronDown className={`w-4 h-4 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
                </button>
            </div>

            {/* Dropdown */}
            {isOpen && filtered.length > 0 && (
                <ul
                    ref={listRef}
                    role="listbox"
                    aria-label="Список месторождений"
                    className="absolute z-[200] w-full mt-1 bg-card border border-border rounded-lg shadow-2xl max-h-60 overflow-y-auto"
                >
                    {filtered.map((option, idx) => (
                        <li
                            key={option}
                            role="option"
                            aria-selected={option === value}
                            onMouseDown={(e) => { e.preventDefault(); handleSelect(option); }}
                            className={[
                                'px-3 py-2 text-sm cursor-pointer select-none',
                                option === value
                                    ? 'bg-cyan-600/30 text-cyan-200'
                                    : idx === activeIndex
                                        ? 'bg-secondary text-foreground'
                                        : 'text-foreground/80 hover:bg-secondary hover:text-foreground',
                            ].join(' ')}
                        >
                            {option}
                        </li>
                    ))}
                </ul>
            )}

            {/* Empty state */}
            {isOpen && value.trim() && filtered.length === 0 && (
                <div className="absolute z-[200] w-full mt-1 bg-card border border-border rounded-lg shadow-xl px-3 py-2 text-sm text-muted-foreground">
                    {entityLabel} «{value}» будет добавлено как новое
                </div>
            )}
        </div>
    );
}
