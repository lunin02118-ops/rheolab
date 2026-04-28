// @vitest-environment jsdom
/**
 * Touch-point filter UI coverage (PR2 Phase D).
 *
 * The sidebar gained a dedicated "Точка касания" block backed by five
 * `FilterState` fields that map 1:1 onto Rust-side `ExperimentsListQuery`
 * columns populated by `db::touch_point_precompute`.  The component is the
 * sole UI surface for those filters, so regressions here silently disable
 * the precomputed fast-path on the backend — hence a focused DOM test.
 *
 * We exercise plain `<input>` elements (RangeFilter) via `fireEvent.change`
 * rather than driving Radix's `<Select>` in jsdom — Radix's pointer-capture
 * / portal code paths are unreliable without `@testing-library/user-event`,
 * which this repo doesn't pull in.  The `hasCrossing` control is now a
 * native `<button role="switch">` so we read it back through
 * `aria-checked` and click it directly via `fireEvent.click`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExperimentFilters } from '@/components/library/experiment-filters';
import type { ExperimentFilters as FilterState } from '@/types/experiment-filters';
import { EMPTY_FILTERS } from '@/types/experiment-filters';
import { resetExperimentFilterMetadataCache } from '@/hooks/useExperimentFilterMetadata';

vi.mock('@/lib/experiments/client', () => ({
    getExperimentFilterMetadata: vi.fn().mockResolvedValue({
        instrumentTypes: [],
        fluidTypes: [],
        geometries: [],
        waterSources: [],
        fieldNames: [],
        testCategories: [],
        testTypes: [],
        reagentNames: [],
        laboratoryNames: [],
        // Explicit touch-point snapshot — matches the shape the component
        // now consumes to derive range hints.  An empty library (all zeros /
        // nulls) keeps the existing assertions focused on field propagation
        // while satisfying the updated TypeScript contract.
        touchPointStats: {
            totalExperiments: 0,
            withCrossingCount: 0,
            withTargetViscosityCount: 0,
            crossingTimeMinMinutes: null,
            crossingTimeMaxMinutes: null,
            crossingViscosityMinCp: null,
            crossingViscosityMaxCp: null,
            viscosityAtTargetMinCp: null,
            viscosityAtTargetMaxCp: null,
        },
    }),
}));

// FieldCombobox + ReagentAutocomplete hit unrelated client code and would
// otherwise try to fetch metadata / reagents — stub them out so this suite
// stays focused on the touch-point block.
vi.mock('@/components/ui/reagent-autocomplete', () => ({
    ReagentAutocomplete: () => <div data-testid="MockReagentAutocomplete" />,
}));
vi.mock('@/components/ui/field-combobox', () => ({
    FieldCombobox: () => <div data-testid="MockFieldCombobox" />,
}));

describe('ExperimentFilters — touch-point section', () => {
    // Vitest v3 uses a single type parameter for `vi.fn<F>()` where F is the
    // full function signature — without this narrow, `Mock<any>` defaults
    // fail the strict `onChange: (filters: FilterState) => void` prop.
    type OnChangeFn = (filters: FilterState) => void;
    let onChange: ReturnType<typeof vi.fn<OnChangeFn>>;

    beforeEach(() => {
        onChange = vi.fn<OnChangeFn>();
        // Drop the module-level promise cache so each `it()` starts from
        // a clean slate.  Without this the first test's fetched metadata
        // survives into every subsequent one, which would mask the mock.
        resetExperimentFilterMetadataCache();
    });

    const renderWith = async (overrides: Partial<FilterState> = {}) => {
        const utils = render(
            <ExperimentFilters
                filters={{ ...EMPTY_FILTERS, ...overrides }}
                onChange={onChange}
            />,
        );
        // Flush the metadata `.then(setMetadataOptions)` microtask chain so
        // the post-mount state update is committed inside an act() window
        // instead of bleeding into the next test.
        await act(async () => {
            await Promise.resolve();
        });
        // The touch-point block lives inside the "Диапазоны" FilterGroup,
        // which is collapsed by default (`<FilterGroup>` only mounts its
        // children while open) — every assertion below would otherwise
        // miss the elements entirely. Mirror what a real user does and
        // expand the group before exercising the test body. Wrapped in
        // act() so the post-click state lands before assertions run.
        const rangesHeader = Array.from(document.querySelectorAll('button'))
            .find((btn) => btn.textContent?.includes('Диапазоны'));
        if (rangesHeader) {
            await act(async () => {
                fireEvent.click(rangesHeader);
            });
        }
        return utils;
    };

    it('renders the touch-point section with threshold selector and disclaimer', async () => {
        await renderWith();
        // Section wrapper + header
        const section = screen.getByTestId('TouchPointFiltersSection');
        expect(section).toBeDefined();
        expect(screen.getByText('Точка касания')).toBeDefined();
        // The threshold selector (with presets) is always rendered — it's
        // the primary control for the per-query touch-point algorithm.
        expect(screen.getByTestId('ViscosityThresholdSelector')).toBeDefined();
        // Disclaimer still references the fixed 10 min target-time contract.
        // Scope the text match to the section wrapper so the 10-min mention
        // doesn't also match the "Вязкость на 10 мин (сП)" RangeFilter label.
        const disclaimer = Array.from(section.querySelectorAll('p'))
            .find((p) => p.textContent?.includes('10 мин'));
        expect(disclaimer).toBeDefined();
    });

    // ── "OFF" sentinel (empty `viscosityThreshold`) ──────────────────
    // The "выкл" pill is the default and it collapses every downstream
    // touch-point control so the sidebar stays quiet until the user
    // opts in.  These tests guard that collapse behaviour along with
    // the state-clearing that makes the OFF claim honest.

    it('touch-point subfilters are hidden by default (threshold OFF)', async () => {
        await renderWith();
        // Section header + selector always visible so the user can opt in.
        expect(screen.getByTestId('TouchPointFiltersSection')).toBeDefined();
        expect(screen.getByTestId('ViscosityThresholdSelector')).toBeDefined();
        // But the downstream wrapper must NOT be in the DOM — no toggle,
        // no range inputs, no crossing-time / viscosity-at-target fields.
        expect(screen.queryByTestId('TouchPointSubfilters')).toBeNull();
        expect(screen.queryByTestId('HasCrossingFilterToggle')).toBeNull();
        expect(screen.queryByTestId('CrossingTimeMinInput')).toBeNull();
        expect(screen.queryByTestId('ViscosityAtTargetMinInput')).toBeNull();
    });

    it('"выкл" pill is visible and aria-pressed by default', async () => {
        await renderWith();
        const offPill = screen.getByTestId('ViscosityThresholdPreset-off');
        expect(offPill.textContent?.trim()).toBe('выкл');
        expect(offPill.getAttribute('aria-pressed')).toBe('true');
    });

    it('selecting a threshold reveals the subfilter block', async () => {
        const { rerender } = await renderWith();
        // Click any numeric preset → parent will rerender with the new
        // threshold; simulate that rerender here (real ExperimentFilters
        // is a controlled component).
        rerender(
            <ExperimentFilters
                filters={{ ...EMPTY_FILTERS, viscosityThreshold: '50' }}
                onChange={onChange}
            />,
        );
        await waitFor(() => {
            expect(screen.getByTestId('TouchPointSubfilters')).toBeDefined();
            expect(screen.getByTestId('HasCrossingFilterToggle')).toBeDefined();
        });
    });

    it('clicking "выкл" clears every touch-point subfilter value', async () => {
        // Set up a sidebar that already has touch-point filters active.
        await renderWith({
            viscosityThreshold: '300',
            hasCrossing: 'yes',
            crossingTimeMin: '2',
            crossingTimeMax: '7',
            viscosityAtTargetMin: '15',
            viscosityAtTargetMax: '80',
        });
        // Clicking the "выкл" pill must zero out *everything* touch-point,
        // otherwise the UI would claim the filter is off while the backend
        // still received stale `hasCrossing` / range values.
        fireEvent.click(screen.getByTestId('ViscosityThresholdPreset-off'));
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({
                viscosityThreshold: '',
                hasCrossing: '',
                crossingTimeMin: '',
                crossingTimeMax: '',
                viscosityAtTargetMin: '',
                viscosityAtTargetMax: '',
            }),
        );
    });

    it('switching between numeric thresholds preserves subfilter values', async () => {
        // Non-destructive path: the user is iterating on the threshold
        // and we must NOT wipe their crossing-time / viscosity-at-target
        // selections just because they changed the cP value.
        await renderWith({
            viscosityThreshold: '50',
            hasCrossing: 'yes',
            crossingTimeMin: '2',
            viscosityAtTargetMax: '80',
        });
        fireEvent.click(screen.getByTestId('ViscosityThresholdPreset-500'));
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({
                viscosityThreshold: '500',
                hasCrossing: 'yes',
                crossingTimeMin: '2',
                viscosityAtTargetMax: '80',
            }),
        );
    });

    // ── hasCrossing toggle behaviour (with threshold ON) ─────────────

    it('hasCrossing toggle reflects the current filter value', async () => {
        // All these cases require a non-empty threshold so the toggle is
        // actually mounted.  The OFF-sentinel case (threshold === '') is
        // covered by the "subfilters are hidden by default" test above.
        const { rerender } = await renderWith({ viscosityThreshold: '50' });
        expect(
            screen.getByTestId('HasCrossingFilterToggle').getAttribute('aria-checked'),
        ).toBe('false');

        rerender(
            <ExperimentFilters
                filters={{ ...EMPTY_FILTERS, viscosityThreshold: '50', hasCrossing: 'yes' }}
                onChange={onChange}
            />,
        );
        await waitFor(() => {
            expect(
                screen.getByTestId('HasCrossingFilterToggle').getAttribute('aria-checked'),
            ).toBe('true');
        });

        // 'no' is still reachable via the IPC contract / E2E tests, but
        // the binary sidebar toggle must treat it as "not yes" — i.e. OFF.
        rerender(
            <ExperimentFilters
                filters={{ ...EMPTY_FILTERS, viscosityThreshold: '50', hasCrossing: 'no' }}
                onChange={onChange}
            />,
        );
        await waitFor(() => {
            expect(
                screen.getByTestId('HasCrossingFilterToggle').getAttribute('aria-checked'),
            ).toBe('false');
        });
    });

    it('hasCrossing toggle flips between OFF and ON on click', async () => {
        // Threshold must be ON for the toggle to be mounted.
        const { rerender } = await renderWith({ viscosityThreshold: '50' });
        fireEvent.click(screen.getByTestId('HasCrossingFilterToggle'));
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ hasCrossing: 'yes' }),
        );

        onChange.mockClear();
        rerender(
            <ExperimentFilters
                filters={{ ...EMPTY_FILTERS, viscosityThreshold: '50', hasCrossing: 'yes' }}
                onChange={onChange}
            />,
        );
        fireEvent.click(screen.getByTestId('HasCrossingFilterToggle'));
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ hasCrossing: '' }),
        );
    });

    it('selecting a threshold from OFF auto-activates hasCrossing', async () => {
        // When the filter was off (viscosityThreshold='', hasCrossing=''),
        // clicking a preset must auto-set hasCrossing='yes' so the user
        // immediately sees only experiments that crossed the threshold —
        // not the full unfiltered list.
        await renderWith();
        const preset500 = screen.getByTestId('ViscosityThresholdPreset-500');
        fireEvent.click(preset500);
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({
                viscosityThreshold: '500',
                hasCrossing: 'yes',
            }),
        );
    });

    it('changing threshold-to-threshold preserves hasCrossing state', async () => {
        // Once the user has chosen hasCrossing='no' (or 'yes'),
        // switching between thresholds must not override their choice.
        await renderWith({ viscosityThreshold: '100', hasCrossing: 'no' });
        const preset500 = screen.getByTestId('ViscosityThresholdPreset-500');
        fireEvent.click(preset500);
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({
                viscosityThreshold: '500',
                hasCrossing: 'no',
            }),
        );
    });

    it('crossing-time range inputs propagate into FilterState', async () => {
        // Range inputs only render when the threshold is ON, so seed
        // the filter with a non-empty value.
        await renderWith({ viscosityThreshold: '50' });
        const section = screen.getByTestId('TouchPointFiltersSection');
        const label = Array.from(section.querySelectorAll('label')).find(
            (l) => l.textContent === 'Время касания (мин)',
        );
        expect(label).toBeDefined();
        const inputs = label!.parentElement!.querySelectorAll('input');
        expect(inputs).toHaveLength(2);

        fireEvent.change(inputs[0], { target: { value: '3.5' } });
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ crossingTimeMin: '3.5' }),
        );

        fireEvent.change(inputs[1], { target: { value: '8' } });
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ crossingTimeMax: '8' }),
        );
    });

    it('viscosity threshold presets propagate into FilterState', async () => {
        await renderWith();

        // Click the 500 cP preset — crosslinked-gel break-point scenario.
        const preset500 = screen.getByTestId('ViscosityThresholdPreset-500');
        fireEvent.click(preset500);
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ viscosityThreshold: '500' }),
        );

        // Click the "выкл" pill — clears the filter.
        const presetOff = screen.getByTestId('ViscosityThresholdPreset-off');
        fireEvent.click(presetOff);
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ viscosityThreshold: '' }),
        );
    });

    it('viscosity threshold custom input propagates into FilterState on blur', async () => {
        await renderWith();
        const custom = screen.getByTestId('ViscosityThresholdCustomInput');
        // The custom input uses a local draft — changes don't fire the
        // parent callback until the user blurs or presses Enter so
        // intermediate characters never trigger the slow-path query.
        fireEvent.change(custom, { target: { value: '250' } });
        fireEvent.blur(custom);
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ viscosityThreshold: '250' }),
        );
    });

    it('hasCrossing toggle label reflects the active threshold', async () => {
        // When user picks a non-default threshold, the toggle's label
        // must swap in that number so they always see which cP value
        // the filter will test against.
        await renderWith({ viscosityThreshold: '300' });
        expect(
            screen.getByText(/Только достигшие порога 300 сП/),
        ).toBeDefined();
    });

    it('viscosity-at-target range inputs propagate into FilterState', async () => {
        await renderWith({ viscosityThreshold: '50' });
        const section = screen.getByTestId('TouchPointFiltersSection');
        const label = Array.from(section.querySelectorAll('label')).find(
            (l) => l.textContent === 'Вязкость на 10 мин (сП)',
        );
        expect(label).toBeDefined();
        const inputs = label!.parentElement!.querySelectorAll('input');
        expect(inputs).toHaveLength(2);

        fireEvent.change(inputs[0], { target: { value: '10' } });
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ viscosityAtTargetMin: '10' }),
        );
        fireEvent.change(inputs[1], { target: { value: '100' } });
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ viscosityAtTargetMax: '100' }),
        );
    });

    it('"Clear All" resets every touch-point field to its empty value', async () => {
        await renderWith({
            hasCrossing: 'yes',
            viscosityThreshold: '500',
            crossingTimeMin: '1',
            crossingTimeMax: '5',
            viscosityAtTargetMin: '15',
            viscosityAtTargetMax: '80',
        });
        const clearBtn = screen.getByTestId('ClearFiltersButton');
        fireEvent.click(clearBtn);
        // The handler is called exactly once with the fully-empty shape.
        expect(onChange).toHaveBeenCalledTimes(1);
        const payload = onChange.mock.calls[0][0] as FilterState;
        expect(payload.hasCrossing).toBe('');
        expect(payload.viscosityThreshold).toBe('');
        expect(payload.crossingTimeMin).toBe('');
        expect(payload.crossingTimeMax).toBe('');
        expect(payload.viscosityAtTargetMin).toBe('');
        expect(payload.viscosityAtTargetMax).toBe('');
    });

    it('"Clear All" is disabled when no touch-point filter is active and no other filters are set', async () => {
        await renderWith();
        const clearBtn = screen.getByTestId('ClearFiltersButton') as HTMLButtonElement;
        expect(clearBtn.disabled).toBe(true);
    });

    it('"Clear All" is enabled as soon as any touch-point filter becomes active', async () => {
        await renderWith({ crossingTimeMin: '4' });
        const clearBtn = screen.getByTestId('ClearFiltersButton') as HTMLButtonElement;
        expect(clearBtn.disabled).toBe(false);
    });
});
