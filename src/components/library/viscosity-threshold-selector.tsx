import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

/**
 * Preset thresholds (cP) the library surfaces as one-click pills.
 *
 * Covers the common lab break-points:
 *   -   5  → ultra-low viscosity (water-like, slickwater base)
 *   -  10  → low-viscosity fluids (slickwater, foam)
 *   -  50  → default library contract / non-crosslinked gels
 *   - 100, 200, 300 → intermediate gels
 *   - 500  → heavy crosslinked gels (typical for the white-line break-point)
 *   - 700  → high-viscosity crosslinked systems (HPHT, completion fluids)
 *
 * **Must stay in lock-step** with `LIBRARY_TOUCH_THRESHOLDS_CP` on the
 * Rust side (`v0003_multi_threshold_touch_point.rs`).  Presets that hit
 * the side table get the fast path; anything else triggers a dynamic
 * recompute.
 *
 * Exported so the "Clear filters" path and tests can reason about the same
 * list without duplication.
 */
export const VISCOSITY_THRESHOLD_PRESETS_CP = [5, 10, 50, 100, 200, 300, 500, 700] as const;

/**
 * Library-filter touch-point threshold control.
 *
 * Produces the `viscosityThreshold` filter string:
 *   - `''`        → **filter OFF** — backend ignores all touch-point
 *                  subfilters entirely, no crossing check is applied.
 *                  Rendered as the "выкл" pill — the default state so
 *                  the library never silently filters results the user
 *                  didn't ask for.  The parent component treats this
 *                  sentinel by also hiding the downstream "только
 *                  достигшие порога" / "время касания" / "вязкость на
 *                  10 мин" controls — they would be meaningless without
 *                  a threshold to compare against.
 *   - any number  → filter ON — backend re-runs the touch-point
 *                  algorithm against that cP value per query.
 *
 * The component exposes two parallel inputs:
 *   1. **Preset pills** — "выкл" + 5/10/50/100/200/300/500/700 cP.
 *   2. **Free-form number input** — for lab-specific values that don't
 *      land on a preset (custom fluid types, research sweeps).
 *
 * Changes from either control write back through the same `onChange`
 * callback so the parent sees a single source of truth.
 */
export function ViscosityThresholdSelector({
    value,
    onChange,
}: {
    /** Current threshold as a string (empty = default). */
    value: string;
    /** Called with the new string value; empty string clears the override. */
    onChange: (value: string) => void;
}) {
    // Local draft state for the free-form input.  We only commit to the
    // parent's `onChange` on blur or Enter so intermediate characters
    // (e.g. "1" while the user types "10") never reach the backend and
    // accidentally trigger the expensive slow-path query.  Preset pill
    // clicks bypass the draft entirely — they set the full value
    // atomically via `commitValue`.
    const [draft, setDraft] = React.useState(value);

    // Sync draft ← parent when the parent value changes externally
    // (e.g. preset click, filter reset).  Guard against stale closures
    // by only updating when the canonical value actually differs.
    React.useEffect(() => {
        setDraft(value);
    }, [value]);

    /** Push a finalized value to the parent and sync draft. */
    const commitValue = (v: string) => {
        setDraft(v);
        onChange(v);
    };

    /** Commit the current draft on blur or Enter. */
    const commitDraft = () => {
        if (draft !== value) {
            onChange(draft);
        }
    };

    const activePreset = VISCOSITY_THRESHOLD_PRESETS_CP.find(
        (p) => p.toString() === value.trim(),
    );
    const isOff = value.trim() === '';

    return (
        <div className="space-y-2" data-testid="ViscosityThresholdSelector">
            <Label className="text-xs text-muted-foreground font-medium">
                Порог вязкости (сП)
            </Label>
            <div className="flex flex-wrap gap-1">
                {/* "выкл" pill — clears the threshold, which also tells the
                    parent filter panel to hide the downstream touch-point
                    controls (toggle, time range, viscosity-at-target range).
                    This is the only honest "OFF" state: without a threshold
                    the crossing filter simply has nothing to compare. */}
                <button
                    type="button"
                    data-testid="ViscosityThresholdPreset-off"
                    onClick={() => commitValue('')}
                    className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                        isOff
                            ? 'bg-slate-600/40 border-slate-500/60 text-slate-100'
                            : 'bg-card border-border text-muted-foreground hover:text-foreground'
                    }`}
                    aria-pressed={isOff}
                    title="Отключить фильтр по точке касания"
                >
                    выкл
                </button>
                {VISCOSITY_THRESHOLD_PRESETS_CP.map((preset) => (
                    <button
                        type="button"
                        key={preset}
                        data-testid={`ViscosityThresholdPreset-${preset}`}
                        onClick={() => commitValue(preset.toString())}
                        className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                            activePreset === preset
                                ? 'bg-cyan-600/30 border-cyan-500/60 text-cyan-200'
                                : 'bg-card border-border text-muted-foreground hover:text-foreground'
                        }`}
                        aria-pressed={activePreset === preset}
                    >
                        {preset}
                    </button>
                ))}
            </div>
            <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="1"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitDraft}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.currentTarget.blur();
                    }
                }}
                data-testid="ViscosityThresholdCustomInput"
                className="bg-card border-border text-foreground text-xs h-8 w-full px-2 focus-visible:ring-cyan-500"
                placeholder="Другое значение..."
            />
            <p
                data-testid="ViscosityThresholdHint"
                className="text-[10px] leading-snug text-muted-foreground"
            >
                {isOff
                    ? 'Фильтр по точке касания отключён. Выберите порог, чтобы включить.'
                    : `Фильтр активен при пороге ${value.trim()} сП.`}
            </p>
        </div>
    );
}
