import uPlot from 'uplot';

export interface TouchPoint {
    time: number;
    viscosity: number;
    type: 'threshold' | 'target';
    color: string;
}

export interface TouchPointsPluginOptions {
    touchPoints: TouchPoint[];
    viscosityThreshold?: number;
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

                // Draw threshold line
                if (options.viscosityThreshold !== undefined) {
                    const yPos = u.valToPos(options.viscosityThreshold, viscosityScale, true);
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
                    const xPos = u.valToPos(tp.time, 'x', true);
                    const yPos = u.valToPos(tp.viscosity, viscosityScale, true);

                    if (xPos >= left && xPos <= left + width && yPos >= top && yPos <= top + height) {
                        // Draw circle
                        ctx.beginPath();
                        ctx.arc(xPos, yPos, 4 * dpr, 0, 2 * Math.PI);
                        ctx.fillStyle = tp.color;
                        ctx.fill();
                        ctx.strokeStyle = (options.pdfMode || options.captureMode) ? '#ffffff' : (options.isDark !== false ? '#ffffff' : '#1e293b');
                        ctx.lineWidth = 1.5 * dpr;
                        ctx.stroke();

                        // Draw label — always theme-contrasted, not series color
                        ctx.fillStyle = thresholdColor;
                        ctx.font = `600 ${Math.round(11 * dpr)}px sans-serif`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'bottom';
                        const timeLabel = options.targetTime !== undefined ? options.targetTime : '?';
                        const minuteSuffix = options.language === 'en' ? 'min' : 'м';
                        const label = tp.type === 'threshold' 
                            ? `${tp.viscosity.toFixed(1)}cP` 
                            : `@${timeLabel}${minuteSuffix}: ${tp.viscosity.toFixed(1)}cP`;
                        ctx.fillText(label, xPos, yPos - 8 * dpr);
                    }
                });

                ctx.restore();

                // Draw threshold label in the left axis area (outside chart clip)
                if (options.viscosityThreshold !== undefined) {
                    const yPos = u.valToPos(options.viscosityThreshold, viscosityScale, true);
                    if (yPos >= top && yPos <= top + height) {
                        const labelText = `${options.viscosityThreshold} cP`;
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