/**
 * Shared UI primitives for ChartSettingsManager and ReportSettingsManager.
 *
 * Centralises LineConfigRow, SelectInput and the LINE_CONFIGS / PRECISION_OPTIONS
 * constants so neither manager duplicates them.
 */

import type { LineWidth, LineStyle, LineAxis, LineKey } from '@/lib/store/chart-settings-store';

// ── Accent colour token ──────────────────────────────────────────────────────
// Two variants: 'blue' (interactive charts) and 'emerald' (print reports).
// Full class strings are declared statically so Tailwind does not purge them.
export type SettingsAccent = 'blue' | 'emerald';

const ACCENT_CLASSES: Record<SettingsAccent, { toggle: string; btn: string }> = {
    blue:    { toggle: 'bg-blue-600',    btn: 'bg-blue-600' },
    emerald: { toggle: 'bg-emerald-600', btn: 'bg-emerald-600' },
};

const SELECT_RING: Record<SettingsAccent, string> = {
    blue:    'focus:ring-blue-500',
    emerald: 'focus:ring-emerald-500',
};

// ── LineConfigRow ────────────────────────────────────────────────────────────

export interface LineConfigRowProps {
    label: string;
    color: string;
    width: LineWidth;
    style: LineStyle;
    axis: LineAxis;
    visible: boolean;
    disabled?: boolean;
    axisDisabled?: boolean;
    /** 'blue' for interactive charts, 'emerald' for print reports. Defaults to 'blue'. */
    accent?: SettingsAccent;
    onColorChange: (color: string) => void;
    onWidthChange: (width: LineWidth) => void;
    onStyleChange: (style: LineStyle) => void;
    onAxisChange: (axis: LineAxis) => void;
    onVisibleChange: (visible: boolean) => void;
}

const STYLE_LABELS: Record<LineStyle, string> = {
    solid:  'сплошная',
    dashed: 'пунктир',
    dotted: 'точечная',
};

const STYLE_OPTIONS: { value: LineStyle; label: string }[] = [
    { value: 'solid',  label: '━━' },
    { value: 'dashed', label: '┅┅' },
    { value: 'dotted', label: '┈┈' },
];

const WIDTH_OPTIONS: LineWidth[] = [1, 2, 3, 4];

export function LineConfigRow({
    label,
    color,
    width,
    style,
    axis,
    visible,
    disabled,
    axisDisabled,
    accent = 'blue',
    onColorChange,
    onWidthChange,
    onStyleChange,
    onAxisChange,
    onVisibleChange,
}: LineConfigRowProps) {
    const { toggle: toggleCls, btn: btnCls } = ACCENT_CLASSES[accent];

    return (
        <div className={`flex items-center gap-3 py-3 border-b border-border last:border-0 ${!visible && !disabled ? 'opacity-50' : ''}`}>
            {/* Visibility toggle */}
            <button
                onClick={() => !disabled && onVisibleChange(!visible)}
                disabled={disabled}
                aria-label={`${visible ? 'Скрыть' : 'Показать'} ${label}`}
                aria-pressed={visible}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${visible ? toggleCls : 'bg-secondary'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${visible ? 'translate-x-5' : 'translate-x-1'}`} />
            </button>

            {/* Label */}
            <span className="text-sm text-foreground/80 w-28">{label}</span>

            {/* Color picker */}
            <input
                type="color"
                value={color}
                onChange={e => onColorChange(e.target.value)}
                className="w-7 h-7 rounded cursor-pointer border border-border bg-transparent"
            />

            {/* Width */}
            <div className="flex gap-1">
                {WIDTH_OPTIONS.map(w => (
                    <button
                        key={w}
                        onClick={() => onWidthChange(w)}
                        aria-label={`Толщина линии ${w}`}
                        aria-pressed={width === w}
                        className={`w-6 h-6 rounded text-xs font-medium transition-colors ${width === w ? `${btnCls} text-foreground` : 'bg-secondary text-muted-foreground hover:bg-secondary'}`}
                    >
                        {w}
                    </button>
                ))}
            </div>

            {/* Style */}
            <div className="flex gap-1">
                {STYLE_OPTIONS.map(s => (
                    <button
                        key={s.value}
                        onClick={() => onStyleChange(s.value)}
                        aria-label={`Стиль линии: ${STYLE_LABELS[s.value]}`}
                        aria-pressed={style === s.value}
                        className={`w-7 h-6 rounded text-xs font-mono transition-colors ${style === s.value ? `${btnCls} text-foreground` : 'bg-secondary text-muted-foreground hover:bg-secondary'}`}
                    >
                        {s.label}
                    </button>
                ))}
            </div>

            {/* Axis (L/R) — always emerald/amber to match single-chart semantics */}
            <div className={`flex gap-1 ${axisDisabled ? 'opacity-40' : ''}`}>
                <button
                    onClick={() => !axisDisabled && onAxisChange('left')}
                    disabled={axisDisabled}
                    aria-label="Левая ось"
                    aria-pressed={axis === 'left'}
                    title="Левая ось"
                    className={`w-6 h-6 rounded text-xs font-medium transition-colors ${axis === 'left' ? 'bg-emerald-600 text-foreground' : 'bg-secondary text-muted-foreground hover:bg-secondary'} ${axisDisabled ? 'cursor-not-allowed' : ''}`}
                >
                    L
                </button>
                <button
                    onClick={() => !axisDisabled && onAxisChange('right')}
                    disabled={axisDisabled}
                    aria-label="Правая ось"
                    aria-pressed={axis === 'right'}
                    title="Правая ось"
                    className={`w-6 h-6 rounded text-xs font-medium transition-colors ${axis === 'right' ? 'bg-amber-600 text-foreground' : 'bg-secondary text-muted-foreground hover:bg-secondary'} ${axisDisabled ? 'cursor-not-allowed' : ''}`}
                >
                    R
                </button>
            </div>
        </div>
    );
}

// ── SelectInput ──────────────────────────────────────────────────────────────

export interface SelectInputProps {
    label: string;
    options: { value: number; label: string }[];
    value: number;
    onChange: (value: number) => void;
    /** 'blue' for interactive charts, 'emerald' for print reports. Defaults to 'blue'. */
    accent?: SettingsAccent;
}

export function SelectInput({ label, options, value, onChange, accent = 'blue' }: SelectInputProps) {
    return (
        <div className="flex items-center justify-between py-1">
            <span className="text-sm text-foreground/80">{label}</span>
            <select
                value={value}
                onChange={e => onChange(Number(e.target.value))}
                className={`px-2 py-1 text-sm bg-secondary border border-border rounded text-foreground/80 focus:outline-none focus:ring-1 ${SELECT_RING[accent]}`}
            >
                {options.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
        </div>
    );
}

// ── Shared constants ─────────────────────────────────────────────────────────

export const LINE_CONFIGS: { key: LineKey; label: string; disabled?: boolean }[] = [
    { key: 'viscosity',       label: 'Вязкость (η)',        disabled: true },
    { key: 'temperature',     label: 'Температура (T)' },
    { key: 'bathTemperature', label: 'Темп. бани (Tᵇ)' },
    { key: 'shearRate',       label: 'Скорость сдвига (γ̇)' },
    { key: 'pressure',        label: 'Давление (P)' },
    { key: 'rpm',             label: 'Обороты (RPM)' },
];

export const PRECISION_OPTIONS = [
    { value: 0, label: '0' },
    { value: 1, label: '1' },
    { value: 2, label: '2' },
    { value: 3, label: '3' },
];
