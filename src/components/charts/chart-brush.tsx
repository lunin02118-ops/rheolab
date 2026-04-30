import React, { useEffect, useRef } from 'react';
import { createLogger } from '@/lib/logger';

/**
 * Brush / range-selector bar rendered below a uPlot chart.
 *
 * - Left / right handles: drag to resize the selection window.
 * - Center area: drag to pan the selection window.
 * - Double-click anywhere: reset to full range.
 */

export interface ChartBrushProps {
    times: number[];
    values: (number | null)[];
    range: [number, number] | null;
    onChange: (min: number, max: number) => void;
    onReset: () => void;
    height?: number;
    width: number;
}

const HANDLE_W = 12;
const MIN_SPAN_PX = 24;
const brushLogger = createLogger('ChartBrush');

export const ChartBrush: React.FC<ChartBrushProps> = ({
    times,
    values,
    range,
    onChange,
    onReset,
    height = 40,
    width,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    const drag = useRef<{
        mode: 'left' | 'right' | 'center';
        startX: number;
        startSelLeft: number;
        startSelRight: number;
    } | null>(null);
    const lastMoveLogAtRef = useRef<number>(0);

    const tMin = times.length > 0 ? times[0] : 0;
    const tMax = times.length > 0 ? times[times.length - 1] : 1;
    const tDataSpan = tMax - tMin;
    // Degenerate when the series has a single point or every sample shares the
    // same x value. Using `|| 1` here historically meant a stale `range` from
    // a previous experiment (warm navigation) was projected onto a fake 1
    // minute span, producing handles outside the real data extent (e.g.
    // tMin = tMax = 93.1, range = [93.4, 93.5]). The guards below treat that
    // case as "no zoom available" and avoid emitting out-of-range onChange.
    const isDegenerate = tDataSpan <= 0;
    const tSpan = isDegenerate ? 1 : tDataSpan;

    // Two-sided clamp keeps the visual handles inside the rendered bar even if
    // `range` is stale (came from another experiment whose time span did not
    // overlap with the current data). With degenerate data we collapse to the
    // full bar so the user sees no zoom indicator and the brush is inert.
    const selLeft  = range && !isDegenerate
        ? Math.min(1, Math.max(0, (range[0] - tMin) / tSpan))
        : 0;
    const selRight = range && !isDegenerate
        ? Math.max(0, Math.min(1, (range[1] - tMin) / tSpan))
        : 1;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || times.length === 0 || width <= 0 || height <= 0) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);
        let vMin = Infinity, vMax = -Infinity;
        for (const v of values) {
            if (v != null && isFinite(v)) {
                if (v < vMin) vMin = v;
                if (v > vMax) vMax = v;
            }
        }
        if (!isFinite(vMin)) return;
        const vSpan = vMax - vMin || 1;
        const padY = 3;
        const pts: [number, number][] = [];
        for (let i = 0; i < times.length; i++) {
            const v = values[i];
            if (v == null || !isFinite(v)) continue;
            const x = ((times[i] - tMin) / tSpan) * width;
            const y = height - padY - ((v - vMin) / vSpan) * (height - 2 * padY);
            pts.push([x, y]);
        }
        if (pts.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.lineTo(pts[pts.length - 1][0], height - padY);
        ctx.lineTo(pts[0][0], height - padY);
        ctx.closePath();
        ctx.fillStyle = 'rgba(96,165,250,0.12)';
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.strokeStyle = 'rgba(96,165,250,0.45)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }, [times, values, width, height, tMin, tSpan]);

    // Zero canvas dimensions on unmount to immediately release the GPU texture
    // backing store. Runs only once on unmount (dep array []) � mirrors the same
    // pattern used in UPlotChart before chart.destroy().
    useEffect(() => {
        const c = canvasRef.current;
        return () => {
            if (c) {
                c.width = 0;
                c.height = 0;
            }
        };
    }, []);

    const stateRef = useRef({ selLeft, selRight, width, tMin, tSpan, isDegenerate, onChange, onReset });
    useEffect(() => {
        stateRef.current = { selLeft, selRight, width, tMin, tSpan, isDegenerate, onChange, onReset };
    });

    useEffect(() => {
        const root = rootRef.current;
        if (!root || width <= 0) return;
        const getX = (clientX: number) => {
            const rect = root.getBoundingClientRect();
            return Math.max(0, Math.min(1, (clientX - rect.left) / stateRef.current.width));
        };
        const onDown = (e: PointerEvent) => {
            if (e.button !== 0) return;
            // Refuse to start a drag on degenerate data — there is no real range
            // to brush over, so accepting a pointerdown would only let the user
            // emit out-of-range viewports based on the fake 1-unit span.
            if (stateRef.current.isDegenerate) return;
            e.preventDefault();
            // Some embedded browser shells can throw here despite a valid pointerdown.
            // Drag still works via bubbling pointermove, so keep going on failure.
            try {
                root.setPointerCapture(e.pointerId);
            } catch (_e) {
                brushLogger.warn('setPointerCapture failed, using fallback pointer flow');
            }
            const { selLeft, selRight, width } = stateRef.current;
            const frac = getX(e.clientX);
            const lPx = selLeft * width;
            const rPx = selRight * width;
            const xPx = frac * width;
            let mode: 'left' | 'right' | 'center';
            if (Math.abs(xPx - lPx) <= HANDLE_W) {
                mode = 'left';
            } else if (Math.abs(xPx - rPx) <= HANDLE_W) {
                mode = 'right';
            } else {
                mode = 'center';
            }
            brushLogger.info('pointerdown', {
                mode,
                pointerId: e.pointerId,
                selLeft,
                selRight,
            });
            drag.current = { mode, startX: e.clientX, startSelLeft: selLeft, startSelRight: selRight };
        };
        const onMove = (e: PointerEvent) => {
            if (!drag.current) return;
            const { width, tMin, tSpan, onChange } = stateRef.current;
            const dx = (e.clientX - drag.current.startX) / width;
            let sL = drag.current.startSelLeft;
            let sR = drag.current.startSelRight;
            if (drag.current.mode === 'left') {
                sL = Math.max(0, Math.min(sR - MIN_SPAN_PX / width, sL + dx));
            } else if (drag.current.mode === 'right') {
                sR = Math.min(1, Math.max(sL + MIN_SPAN_PX / width, sR + dx));
            } else {
                const span = sR - sL;
                let nL = sL + dx;
                let nR = sR + dx;
                if (nL < 0) { nL = 0; nR = span; }
                if (nR > 1) { nR = 1; nL = 1 - span; }
                sL = nL; sR = nR;
            }
            const min = tMin + sL * tSpan;
            const max = tMin + sR * tSpan;
            onChange(min, max);

            const now = Date.now();
            if (now - lastMoveLogAtRef.current > 250) {
                lastMoveLogAtRef.current = now;
                brushLogger.debug('pointermove', {
                    mode: drag.current.mode,
                    min,
                    max,
                });
            }
        };
        const onUp = (e: PointerEvent) => { 
            if (drag.current) {
                brushLogger.info('pointerup', {
                    mode: drag.current.mode,
                    pointerId: e.pointerId,
                });
                if (root.hasPointerCapture?.(e.pointerId)) {
                    root.releasePointerCapture(e.pointerId);
                }
                drag.current = null; 
            }
        };
        const onDbl = () => {
            brushLogger.info('dblclick reset');
            stateRef.current.onReset();
        };
        root.addEventListener('pointerdown', onDown);
        root.addEventListener('pointermove', onMove);
        root.addEventListener('pointerup', onUp);
        root.addEventListener('pointercancel', onUp);
        root.addEventListener('dblclick', onDbl);
        return () => {
            root.removeEventListener('pointerdown', onDown);
            root.removeEventListener('pointermove', onMove);
            root.removeEventListener('pointerup', onUp);
            root.removeEventListener('pointercancel', onUp);
            root.removeEventListener('dblclick', onDbl);
        };
    }, [width]); // Only re-bind if width changes (rare)

    if (width <= 0 || times.length === 0) return null;

    const lPx = Math.round(selLeft  * width);
    const rPx = Math.round(selRight * width);
    const selW = Math.max(0, rPx - lPx);

    return (
        <div
            ref={rootRef}
            className="relative select-none overflow-hidden rounded touch-none"
            style={{ width, height }}
        >
            <canvas ref={canvasRef} className="absolute inset-0 bg-muted" />

            {lPx > 0 && (
                <div className="absolute inset-y-0 bg-background/65 pointer-events-none" style={{ left: 0, width: lPx }} />
            )}
            {rPx < width && (
                <div className="absolute inset-y-0 bg-background/65 pointer-events-none" style={{ left: rPx, right: 0 }} />
            )}

            <div
                className="absolute inset-y-0 pointer-events-none border-y border-blue-500/50"
                style={{ left: lPx, width: selW }}
            />

            {selW > HANDLE_W * 2 + 4 && (
                <div
                    className="absolute inset-y-0 cursor-grab"
                    style={{ left: lPx + HANDLE_W, width: selW - HANDLE_W * 2 }}
                />
            )}

            <div
                className="absolute inset-y-0 flex items-center justify-center cursor-ew-resize border-l-2 border-blue-500 bg-blue-500/20 hover:bg-blue-500/35 transition-colors"
                style={{ left: lPx - HANDLE_W / 2, width: HANDLE_W }}
            >
                <div className="flex gap-px">
                    <div className="w-px h-3 rounded-full bg-blue-300/80" />
                    <div className="w-px h-3 rounded-full bg-blue-300/80" />
                </div>
            </div>

            <div
                className="absolute inset-y-0 flex items-center justify-center cursor-ew-resize border-r-2 border-blue-500 bg-blue-500/20 hover:bg-blue-500/35 transition-colors"
                style={{ left: rPx - HANDLE_W / 2, width: HANDLE_W }}
            >
                <div className="flex gap-px">
                    <div className="w-px h-3 rounded-full bg-blue-300/80" />
                    <div className="w-px h-3 rounded-full bg-blue-300/80" />
                </div>
            </div>

            <div className="absolute bottom-0.5 left-1.5 text-[9px] text-muted-foreground pointer-events-none leading-none">
                {tMin.toFixed(1)}�
            </div>
            <div className="absolute bottom-0.5 right-1.5 text-[9px] text-muted-foreground pointer-events-none leading-none">
                {tMax.toFixed(1)}�
            </div>

            {range && selW > 60 && (
                <>
                    <div
                        className="absolute top-0.5 text-[9px] text-blue-300 pointer-events-none leading-none"
                        style={{ left: lPx + HANDLE_W / 2 + 2 }}
                    >
                        {range[0].toFixed(1)}�
                    </div>
                    <div
                        className="absolute top-0.5 text-[9px] text-blue-300 pointer-events-none leading-none"
                        style={{ right: width - rPx + HANDLE_W / 2 + 2 }}
                    >
                        {range[1].toFixed(1)}�
                    </div>
                </>
            )}
        </div>
    );
};
