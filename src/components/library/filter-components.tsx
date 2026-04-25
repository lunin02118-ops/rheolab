import React from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

interface TextFilterProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    showSearch?: boolean;
    testId?: string;
}

export function TextFilter({ label, value, onChange, placeholder = '', showSearch = false, testId }: TextFilterProps) {
    return (
        <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">{label}</Label>
            <div className={showSearch ? 'relative' : ''}>
                <Input
                    type="text"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    data-testid={testId}
                    className="bg-card border-border text-foreground focus-visible:ring-blue-500 pl-3 pr-8"
                    placeholder={placeholder}
                />
                {showSearch && <Search className="w-3 h-3 text-muted-foreground absolute right-3 top-3" />}
            </div>
        </div>
    );
}

interface SelectFilterProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    icon?: React.ReactNode;
    borderColor?: string;
    testId?: string;
}

// Static class map — dynamic Tailwind interpolation (`focus:ring-${x}-500`) is
// stripped by the build-time purge step. Always use complete class strings.
const BORDER_COLOR_RING: Record<string, string> = {
    blue: 'focus:ring-blue-500',
    emerald: 'focus:ring-emerald-500',
    purple: 'focus:ring-purple-500',
    amber: 'focus:ring-amber-500',
    red: 'focus:ring-red-500',
    slate: 'focus:ring-slate-500',
};

export function SelectFilter({ label, value, onChange, options, icon, borderColor = 'blue', testId }: SelectFilterProps) {
    const ringClass = BORDER_COLOR_RING[borderColor] ?? 'focus:ring-blue-500';
    return (
        <div className="space-y-2">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
                {icon}
                {label}
            </Label>
            <Select value={value === "" ? "ALL" : value} onValueChange={(v) => onChange(v === "ALL" ? "" : v)}>
                <SelectTrigger className={`w-full bg-card border-border text-foreground ${ringClass}`} data-testid={testId}>
                    <SelectValue placeholder="Выберите..." />
                </SelectTrigger>
                <SelectContent>
                    {options.map(opt => (
                        <SelectItem key={opt.value} value={opt.value || "ALL"}>
                            {opt.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}

interface RangeFilterProps {
    label: string;
    minValue: string;
    maxValue: string;
    onMinChange: (value: string) => void;
    onMaxChange: (value: string) => void;
    type?: 'number' | 'date';
    minPlaceholder?: string;
    maxPlaceholder?: string;
    /** Optional stable test identifiers for Playwright / Vitest. */
    minTestId?: string;
    maxTestId?: string;
    /**
     * Optional context hint rendered beneath the inputs — used by the
     * touch-point filters to surface the actual min/max observed in the
     * library so users pick sensible values instead of filtering to zero.
     * Keep hints short: one line, <~50 chars.  Pass `null` / omit to
     * render nothing (same layout cost as before).
     */
    hint?: string | null;
    /** data-testid for the hint element, when present. */
    hintTestId?: string;
}

export function RangeFilter({
    label,
    minValue,
    maxValue,
    onMinChange,
    onMaxChange,
    type = 'number',
    minPlaceholder = 'От',
    maxPlaceholder = 'До',
    minTestId,
    maxTestId,
    hint,
    hintTestId,
}: RangeFilterProps) {
    return (
        <div className="pt-4 border-t border-border space-y-2">
            <Label className="text-xs text-muted-foreground font-medium">{label}</Label>
            <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                    {type === 'date' && <span className="text-[10px] text-muted-foreground">От</span>}
                    <Input
                        type={type}
                        value={minValue || ''}
                        onChange={e => onMinChange(e.target.value)}
                        data-testid={minTestId}
                        className={`bg-card border-border text-foreground text-xs h-8 w-full px-2 focus-visible:ring-blue-500 ${type === 'date' ? 'pr-1 [&::-webkit-calendar-picker-indicator]:w-4 [&::-webkit-calendar-picker-indicator]:h-4 [&::-webkit-calendar-picker-indicator]:opacity-80 [&::-webkit-calendar-picker-indicator]:cursor-pointer dark:[&::-webkit-calendar-picker-indicator]:invert' : 'pr-8'}`}
                        placeholder={type === 'number' ? minPlaceholder : undefined}
                    />
                </div>
                <div className="space-y-1">
                    {type === 'date' && <span className="text-[10px] text-muted-foreground">До</span>}
                    <Input
                        type={type}
                        value={maxValue || ''}
                        onChange={e => onMaxChange(e.target.value)}
                        data-testid={maxTestId}
                        className={`bg-card border-border text-foreground text-xs h-8 w-full px-2 focus-visible:ring-blue-500 ${type === 'date' ? 'pr-1 [&::-webkit-calendar-picker-indicator]:w-4 [&::-webkit-calendar-picker-indicator]:h-4 [&::-webkit-calendar-picker-indicator]:opacity-80 [&::-webkit-calendar-picker-indicator]:cursor-pointer dark:[&::-webkit-calendar-picker-indicator]:invert' : 'pr-8'}`}
                        placeholder={type === 'number' ? maxPlaceholder : undefined}
                    />
                </div>
            </div>
            {hint && (
                <p
                    data-testid={hintTestId}
                    className="text-[10px] leading-snug text-muted-foreground"
                >
                    {hint}
                </p>
            )}
        </div>
    );
}
