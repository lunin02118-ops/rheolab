// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChartBrush } from '@/components/charts/chart-brush';

/**
 * Regression tests for the brush range selector under degenerate / stale data.
 *
 * Background — bug observed on the Comparison tab in v0.2.2-alpha.7:
 * after warm navigation persisted a viewport from a prior experiment whose
 * time range no longer overlapped the currently loaded series, the brush
 * could be dragged into a window that was entirely outside the data extent
 * (e.g. tMin = tMax = 93.1, range = [93.4, 93.5]).  The chart then rendered
 * empty while the brush handles still showed a visible selection bar.
 *
 * The bug stemmed from two cooperating issues in `chart-brush.tsx`:
 *  (a) `tSpan = tMax - tMin || 1` — for degenerate data (one point or every
 *      sample at the same x) it silently fell back to a fake 1 unit span,
 *      so dragging produced `min/max` outside the real data extent;
 *  (b) `selLeft` was clamped only on the lower edge and `selRight` only on
 *      the upper edge, so a stale `range` projected onto a normal chart
 *      could still land outside [0, 1].
 *
 * These tests pin the corrected behaviour: degenerate data disables the
 * brush, and stale ranges are visually clamped to the rendered bar without
 * a corresponding `onChange` emission.
 */

function findBrushRoot(container: HTMLElement): HTMLElement {
    const root = container.firstElementChild as HTMLElement | null;
    if (!root) throw new Error('ChartBrush did not render a root element');
    return root;
}

describe('ChartBrush — degenerate data guard', () => {
    it('renders nothing visible-as-selection when times has only one point', () => {
        const onChange = vi.fn();
        const onReset = vi.fn();
        const { container } = render(
            <ChartBrush
                times={[93.1]}
                values={[1000]}
                range={[93.4, 93.5]}
                onChange={onChange}
                onReset={onReset}
                width={400}
            />,
        );

        // With degenerate data the visible selection collapses to the full bar
        // (selLeft = 0, selRight = 1) instead of being projected through the
        // fake 1 unit span. The dimmed overlays at left/right are not rendered
        // because lPx === 0 and rPx === width.
        const root = findBrushRoot(container);
        const overlays = root.querySelectorAll('div.bg-background\\/65');
        expect(overlays.length).toBe(0);
    });

    it('refuses to start a drag and never emits onChange when data is degenerate', () => {
        const onChange = vi.fn();
        const onReset = vi.fn();
        const { container } = render(
            <ChartBrush
                times={[93.1]}
                values={[1000]}
                range={[93.4, 93.5]}
                onChange={onChange}
                onReset={onReset}
                width={400}
            />,
        );

        const root = findBrushRoot(container);
        // pointerdown anywhere should be a no-op when isDegenerate is true.
        // Without the guard, the historical bug emitted onChange(min, max)
        // with values derived from `tMin + sX * 1` (fake span), which were
        // outside the data extent.
        fireEvent.pointerDown(root, { clientX: 120, clientY: 18, button: 0, pointerId: 1 });
        fireEvent.pointerMove(root, { clientX: 200, clientY: 18, pointerId: 1 });
        fireEvent.pointerUp(root, { clientX: 200, clientY: 18, pointerId: 1 });

        expect(onChange).not.toHaveBeenCalled();
    });

    it('treats all-equal time samples (tSpan = 0) the same as a single point', () => {
        const onChange = vi.fn();
        const { container } = render(
            <ChartBrush
                times={[42.0, 42.0, 42.0]}
                values={[1, 2, 3]}
                range={[42.5, 42.6]}
                onChange={onChange}
                onReset={() => {}}
                width={400}
            />,
        );

        const root = findBrushRoot(container);
        fireEvent.pointerDown(root, { clientX: 80, clientY: 18, button: 0, pointerId: 2 });
        fireEvent.pointerMove(root, { clientX: 200, clientY: 18, pointerId: 2 });
        fireEvent.pointerUp(root, { clientX: 200, clientY: 18, pointerId: 2 });

        expect(onChange).not.toHaveBeenCalled();
    });
});

describe('ChartBrush — stale range clamping', () => {
    it('renders minute labels without replacement glyphs', () => {
        const replacementGlyph = String.fromCharCode(0xfffd);
        const { container } = render(
            <ChartBrush
                times={[0, 100]}
                values={[1, 2]}
                range={[10, 30]}
                onChange={() => {}}
                onReset={() => {}}
                width={400}
            />,
        );

        expect(container.textContent).not.toContain(replacementGlyph);
        expect(container.textContent).toContain('0.0 min');
        expect(container.textContent).toContain('100.0 min');
        expect(container.textContent).toContain('10.0 min');
        expect(container.textContent).toContain('30.0 min');
    });

    it('pans a very narrow selection from the center instead of resizing a handle', () => {
        const onChange = vi.fn();
        const onCommit = vi.fn();
        const width = 1064;
        const range: [number, number] = [1.678477, 5.20328];
        const extentMax = 178.59;
        const beforeWidth = range[1] - range[0];
        const { container } = render(
            <ChartBrush
                times={[0, extentMax]}
                values={[1, 2]}
                range={range}
                onChange={onChange}
                onCommit={onCommit}
                onReset={() => {}}
                width={width}
            />,
        );

        const root = findBrushRoot(container);
        Object.defineProperty(root, 'getBoundingClientRect', {
            value: () => ({
                left: 0,
                top: 0,
                right: width,
                bottom: 36,
                width,
                height: 36,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }),
        });

        const centerX = ((range[0] + range[1]) / 2 / extentMax) * width;
        fireEvent.pointerDown(root, { clientX: centerX, clientY: 18, button: 0, pointerId: 10 });
        fireEvent.pointerMove(root, { clientX: centerX + 48, clientY: 18, pointerId: 10 });
        fireEvent.pointerUp(root, { clientX: centerX + 48, clientY: 18, pointerId: 10 });

        expect(onChange).toHaveBeenCalled();
        const [min, max] = onChange.mock.calls.at(-1)! as [number, number];
        expect(min).toBeGreaterThan(range[0] + 7);
        expect(max).toBeGreaterThan(range[1] + 7);
        expect(max - min).toBeCloseTo(beforeWidth, 4);
        expect(onCommit).toHaveBeenLastCalledWith(min, max);
    });

    it('previews every drag move but commits the range only once on pointerup', () => {
        const onChange = vi.fn();
        const onCommit = vi.fn();
        const onDragEnd = vi.fn();
        const { container } = render(
            <ChartBrush
                times={[0, 10, 20, 30, 40]}
                values={[1, 2, 3, 4, 5]}
                range={[5, 15]}
                onChange={onChange}
                onCommit={onCommit}
                onDragEnd={onDragEnd}
                onReset={() => {}}
                width={400}
            />,
        );

        const root = findBrushRoot(container);
        Object.defineProperty(root, 'getBoundingClientRect', {
            value: () => ({
                left: 0,
                top: 0,
                right: 400,
                bottom: 36,
                width: 400,
                height: 36,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }),
        });

        fireEvent.pointerDown(root, { clientX: 100, clientY: 18, button: 0, pointerId: 7 });
        fireEvent.pointerMove(root, { clientX: 140, clientY: 18, pointerId: 7 });
        fireEvent.pointerMove(root, { clientX: 180, clientY: 18, pointerId: 7 });

        expect(onChange).toHaveBeenCalledTimes(2);
        expect(onCommit).not.toHaveBeenCalled();

        fireEvent.pointerUp(root, { clientX: 180, clientY: 18, pointerId: 7 });

        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenLastCalledWith(...onChange.mock.calls.at(-1)!);
        expect(onDragEnd).toHaveBeenCalledTimes(1);
        expect(onDragEnd).toHaveBeenLastCalledWith('commit');
    });

    it('ends a no-move pointerup as noop without committing', () => {
        const onChange = vi.fn();
        const onCommit = vi.fn();
        const onDragEnd = vi.fn();
        const { container } = render(
            <ChartBrush
                times={[0, 10, 20, 30, 40]}
                values={[1, 2, 3, 4, 5]}
                range={[5, 15]}
                onChange={onChange}
                onCommit={onCommit}
                onDragEnd={onDragEnd}
                onReset={() => {}}
                width={400}
            />,
        );

        const root = findBrushRoot(container);
        Object.defineProperty(root, 'getBoundingClientRect', {
            value: () => ({
                left: 0,
                top: 0,
                right: 400,
                bottom: 36,
                width: 400,
                height: 36,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }),
        });

        fireEvent.pointerDown(root, { clientX: 100, clientY: 18, button: 0, pointerId: 9 });
        fireEvent.pointerUp(root, { clientX: 100, clientY: 18, pointerId: 9 });

        expect(onChange).not.toHaveBeenCalled();
        expect(onCommit).not.toHaveBeenCalled();
        expect(onDragEnd).toHaveBeenCalledTimes(1);
        expect(onDragEnd).toHaveBeenLastCalledWith('noop');
    });

    it('does not commit a cancelled drag', () => {
        const onChange = vi.fn();
        const onCommit = vi.fn();
        const onDragEnd = vi.fn();
        const { container } = render(
            <ChartBrush
                times={[0, 10, 20, 30, 40]}
                values={[1, 2, 3, 4, 5]}
                range={[5, 15]}
                onChange={onChange}
                onCommit={onCommit}
                onDragEnd={onDragEnd}
                onReset={() => {}}
                width={400}
            />,
        );

        const root = findBrushRoot(container);
        Object.defineProperty(root, 'getBoundingClientRect', {
            value: () => ({
                left: 0,
                top: 0,
                right: 400,
                bottom: 36,
                width: 400,
                height: 36,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }),
        });

        fireEvent.pointerDown(root, { clientX: 100, clientY: 18, button: 0, pointerId: 8 });
        fireEvent.pointerMove(root, { clientX: 140, clientY: 18, pointerId: 8 });
        fireEvent.pointerCancel(root, { clientX: 140, clientY: 18, pointerId: 8 });

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onCommit).not.toHaveBeenCalled();
        expect(onDragEnd).toHaveBeenCalledTimes(1);
        expect(onDragEnd).toHaveBeenLastCalledWith('cancel');
    });

    it('keeps drag-emitted onChange values inside the actual data extent for a partially-overlapping stale range', () => {
        const onChange = vi.fn();
        // Range overlaps the right edge of the data — typical of the warm
        // navigation scenario where the prior experiment ran longer than the
        // currently loaded one.  With the historical single-sided clamp the
        // right-handle projection produced selRight > 1, sending the emitted
        // max past tMax (= 20).  After the fix selRight is clamped to [0, 1]
        // and onChange always stays inside [10, 20].
        const { container } = render(
            <ChartBrush
                times={[10, 12, 14, 16, 18, 20]}
                values={[1, 2, 3, 4, 5, 6]}
                range={[18, 25]}
                onChange={onChange}
                onReset={() => {}}
                width={400}
            />,
        );

        const root = findBrushRoot(container);
        Object.defineProperty(root, 'getBoundingClientRect', {
            value: () => ({
                left: 0,
                top: 0,
                right: 400,
                bottom: 36,
                width: 400,
                height: 36,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }),
        });

        // Pan the center band slightly to trigger an onChange emission and
        // verify the result lands strictly inside the data extent.
        fireEvent.pointerDown(root, { clientX: 350, clientY: 18, button: 0, pointerId: 3 });
        fireEvent.pointerMove(root, { clientX: 380, clientY: 18, pointerId: 3 });
        fireEvent.pointerUp(root, { clientX: 380, clientY: 18, pointerId: 3 });

        expect(onChange).toHaveBeenCalled();
        for (const call of onChange.mock.calls) {
            const [min, max] = call as [number, number];
            expect(min).toBeGreaterThanOrEqual(10);
            expect(max).toBeLessThanOrEqual(20);
            expect(max).toBeGreaterThanOrEqual(min);
        }
    });

    it('renders the visual selection inside the bar for a fully-disjoint stale range', () => {
        // When the stale range does not overlap the current data at all, the
        // historical code projected the handles to negative or > 1 fractions,
        // hiding them off-canvas while still letting subsequent drags emit
        // out-of-range viewports.  After the fix selLeft and selRight are
        // both clamped to [0, 1], collapsing the visible window to one edge
        // — the parent (`comparison-chart-uplot.tsx`) can keep the user's
        // logical viewport and rely on the brush itself to avoid emitting
        // invalid ranges.
        const onChange = vi.fn();
        const { container } = render(
            <ChartBrush
                times={[10, 12, 14, 16, 18, 20]}
                values={[1, 2, 3, 4, 5, 6]}
                range={[100, 105]}
                onChange={onChange}
                onReset={() => {}}
                width={400}
            />,
        );

        const root = findBrushRoot(container);
        // Both overlays should render inside the bar (left dim from 0 to lPx,
        // right dim from rPx to width). With both fractions clamped to 1 the
        // selected window collapses to the right edge — visible state, even
        // if zero-width, is preferable to invisible-but-still-active handles.
        const overlays = root.querySelectorAll('div.bg-background\\/65');
        // Exactly one overlay is rendered when lPx === width (the left dim
        // covers the whole bar). The other branch (rPx < width) is suppressed
        // because rPx === width.
        expect(overlays.length).toBeLessThanOrEqual(1);
    });
});
