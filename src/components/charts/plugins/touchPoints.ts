import type uPlot from 'uplot';
import type { ViscosityUnit } from '@/lib/store/chart-settings-types';
import { convertViscosity } from '@/lib/utils/unit-converters';

/**
 * Unit contract (aligned with {@link TouchPointMarker} in useRheologyData.ts):
 *  - `time`               — chart X coordinate in minutes.
 *  - `viscosity`          — **current display unit** value (direct chart Y
 *                           coordinate; identical to `viscosityDisplay`).
 *  - `viscosityDisplay`   — same as `viscosity`, spelled out for readability.
 *  - `viscosityCp`        — canonical cP value (used only for label text).
 *  - `displayUnit`        — display unit of `viscosity`/`viscosityDisplay`;
 *                           label text uses this for correct on-screen units.
 *  - `snappedToSeries`    — true when the marker sits on an actual visible
 *                           vertex; false when it was interpolated or snapped
 *                           outside the chart's sampling grid.
 *  - `anomaly`            — UI hint for target-time markers crossing a
 *                           shear-rate jump (drawn with a warning glyph).
 *
 * Backwards compatibility: callers that still populate only `time`/`viscosity`
 * are treated as display-unit values (i.e. `viscosityDisplay === viscosity`).
 */
export interface TouchPoint {
    time: number;
    viscosity: number;
    viscosityDisplay?: number;
    viscosityCp?: number;
    displayUnit?: ViscosityUnit;
    snappedToSeries?: boolean;
    anomaly?: 'shear-rate-jump';
    type: 'threshold' | 'target';
    color: string;
}

export interface TouchPointsPluginOptions {
    touchPoints: TouchPoint[];
    /**
     * Viscosity threshold in **cP** (the algorithm's canonical unit).
     * The plugin converts this to {@link displayUnit} internally before
     * calling `valToPos` so the horizontal guide line lands on the
     * correct pixel for any chart unit.
     */
    viscosityThreshold?: number;
    /** Display unit of the Y scale; defaults to `'cP'` (identity conv). */
    displayUnit?: ViscosityUnit;
    showTouchPoints?: boolean;
    targetTime?: number;
    pdfMode?: boolean;
    captureMode?: boolean;
    /** Whether the UI is in dark mode; controls threshold line color */
    isDark?: boolean;
    /** Scale name for viscosity axis; defaults to 'viscosity' */
    scaleName?: string;
    /** Report language; affects touch-point label suffix */
    language?: 'ru' | 'en';
}

/**
 * Localised, compact display of a viscosity value + unit.  Matches the
 * inline-text convention used in RheologyChart info panel (cP uses сП in
 * Russian, everything else stays as-is).
 */
function formatViscosityLabel(
    value: number,
    unit: ViscosityUnit,
    language: 'ru' | 'en' | undefined,
): string {
    const decimals = unit === 'Pa·s' ? 3 : 1;
    const unitLabel = unit === 'cP' && language !== 'en' ? 'сП' : unit;
    return `${value.toFixed(decimals)}${unitLabel}`;
}

/**
 * Creates a touch-points overlay plugin for uPlot.
 *
 * Accepts **either** a plain options object (static — captured once at plugin
 * creation) **or** a React-style ref (`{ current: TouchPointsPluginOptions }`)
 * so that the `draw` hook always reads the latest values without requiring the
 * chart to be destroyed and recreated when only touch-point data changes.
 */
export function touchPointsPlugin(
    optionsOrRef: TouchPointsPluginOptions | { current: TouchPointsPluginOptions },
): uPlot.Plugin {
    // Normalise to a getter so the draw hook works identically in both modes.
    const getOpts = (): TouchPointsPluginOptions =>
        'current' in optionsOrRef ? optionsOrRef.current : optionsOrRef;

    return {
        hooks: {
            draw: (u: uPlot) => {
                const options = getOpts();
                if (!options.showTouchPoints) return;

                const { ctx } = u;
                const dpr = window.devicePixelRatio || 1;
                const { left, top, width, height } = u.bbox;
                const viscosityScale = options.scaleName ?? 'viscosity';
                const displayUnit: ViscosityUnit = options.displayUnit ?? 'cP';

                // Guard: if the scale doesn't exist on this chart, skip drawing
                if (!u.scales[viscosityScale]) {
                    return;
                }

                const thresholdColor = (options.pdfMode || options.captureMode)
                    ? '#000000'
                    : (options.isDark !== false ? '#ffffff' : '#1e293b');

                // Draw threshold line + touch points — clipped to chart area
                ctx.save();
                ctx.beginPath();
                ctx.rect(left, top, width, height);
                ctx.clip();

                // Draw threshold line — convert cP → displayUnit so the
                // horizontal rule lands on the right pixel for any Y-scale.
                let thresholdDisplayValue: number | undefined;
                if (options.viscosityThreshold !== undefined) {
                    thresholdDisplayValue = convertViscosity(options.viscosityThreshold, displayUnit);
                    const yPos = u.valToPos(thresholdDisplayValue, viscosityScale, true);
                    if (yPos >= top && yPos <= top + height) {
                        ctx.beginPath();
                        ctx.moveTo(left, yPos);
                        ctx.lineTo(left + width, yPos);
                        ctx.strokeStyle = thresholdColor;
                        ctx.lineWidth = 1 * dpr;
                        ctx.setLineDash([6 * dpr, 4 * dpr]);
                        ctx.globalAlpha = 0.8;
                        ctx.stroke();
                        ctx.globalAlpha = 1.0;
                        ctx.setLineDash([]);
                    }
                }

                // Draw touch points
                options.touchPoints.forEach(tp => {
                    // Prefer the explicit display-unit value; fall back to
                    // the legacy `viscosity` field (which is display-unit by
                    // the post-audit contract).
                    const yValue = tp.viscosityDisplay ?? tp.viscosity;
                    const xPos = u.valToPos(tp.time, 'x', true);
                    const yPos = u.valToPos(yValue, viscosityScale, true);

                    if (xPos >= left && xPos <= left + width && yPos >= top && yPos <= top + height) {
                        // Draw circle
                        ctx.beginPath();
                        ctx.arc(xPos, yPos, 4 * dpr, 0, 2 * Math.PI);
                        ctx.fillStyle = tp.color;
                        ctx.fill();
                        ctx.strokeStyle = (options.pdfMode || options.captureMode) ? '#ffffff' : (options.isDark !== false ? '#ffffff' : '#1e293b');
                        ctx.lineWidth = 1.5 * dpr;
                        ctx.stroke();

                        // Warning glyph for shear-rate-jump anomalies —
                        // a small triangle above the dot hints that the
                        // marker was snapped away from a discontinuity.
                        if (tp.anomaly === 'shear-rate-jump') {
                            ctx.save();
                            ctx.fillStyle = '#f59e0b';
                            ctx.beginPath();
                            const triSize = 4 * dpr;
                            ctx.moveTo(xPos, yPos - 10 * dpr - triSize);
                            ctx.lineTo(xPos - triSize, yPos - 10 * dpr);
                            ctx.lineTo(xPos + triSize, yPos - 10 * dpr);
                            ctx.closePath();
                            ctx.fill();
                            ctx.restore();
                        }

                        // Draw label — always theme-contrasted, not series color
                        ctx.fillStyle = thresholdColor;
                        ctx.font = `600 ${Math.round(11 * dpr)}px sans-serif`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'bottom';
                        const tpUnit = tp.displayUnit ?? displayUnit;
                        const timeLabel = options.targetTime !== undefined ? options.targetTime : '?';
                        const minuteSuffix = options.language === 'en' ? 'min' : 'м';
                        const viscLabel = formatViscosityLabel(yValue, tpUnit, options.language);
                        const label = tp.type === 'threshold'
                            ? viscLabel
                            : `@${timeLabel}${minuteSuffix}: ${viscLabel}`;
                        ctx.fillText(label, xPos, yPos - 8 * dpr);
                    }
                });

                ctx.restore();

                // Draw threshold label in the left axis area (outside chart clip)
                if (options.viscosityThreshold !== undefined && thresholdDisplayValue !== undefined) {
                    const yPos = u.valToPos(thresholdDisplayValue, viscosityScale, true);
                    if (yPos >= top && yPos <= top + height) {
                        const labelText = formatViscosityLabel(thresholdDisplayValue, displayUnit, options.language);
                        const fontSize = Math.round(12 * dpr);
                        ctx.save();
                        ctx.font = `600 ${fontSize}px sans-serif`;
                        ctx.textAlign = 'right';
                        ctx.textBaseline = 'middle';

                        // Highlight background
                        const metrics = ctx.measureText(labelText);
                        const pad = 3 * dpr;
                        const bgX = left - 4 * dpr - metrics.width - pad;
                        const bgY = yPos - fontSize / 2 - pad;
                        const bgW = metrics.width + pad * 2;
                        const bgH = fontSize + pad * 2;
                        const labelBg = (options.pdfMode || options.captureMode)
                            ? 'rgba(255,255,255,0.15)'
                            : (options.isDark !== false ? 'rgba(30,41,59,0.85)' : 'rgba(255,255,255,0.92)');
                        ctx.fillStyle = labelBg;
                        ctx.fillRect(bgX, bgY, bgW, bgH);

                        ctx.fillStyle = thresholdColor;
                        ctx.globalAlpha = 0.95;
                        ctx.fillText(labelText, left - 4 * dpr, yPos);
                        ctx.globalAlpha = 1.0;
                        ctx.restore();
                    }
                }
            }
        }
    };
}
