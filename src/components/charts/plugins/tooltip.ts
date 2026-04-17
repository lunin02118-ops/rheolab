import uPlot from 'uplot';

/** Auto-incrementing ID to uniquely tag each tooltip instance. */
let nextTooltipId = 0;

type TooltipContent = string | Node;

/**
 * Creates a tooltip plugin for uPlot that mimics Recharts' default tooltip behavior.
 * 
 * @param options Configuration options for the tooltip
 * @returns A uPlot plugin object
 */
export function tooltipPlugin(options: {
    className?: string;
    formatter?: (seriesIdx: number, value: number) => string;
    titleFormatter?: (timeValue: number) => string;
    renderTooltip?: (u: uPlot, dataIdx: number) => TooltipContent | null;
    isDark?: boolean;
} = {}): uPlot.Plugin & { tooltipInstanceId: string } {
    let tooltip: HTMLDivElement | null = null;
    let titleEl: HTMLDivElement | null = null;
    let itemsEl: HTMLDivElement | null = null;
    let lastDataIdx: number | null = null;
    const instanceId = String(++nextTooltipId);

    return {
        hooks: {
            init: (_u: uPlot) => {
                // Create tooltip container — tagged with instance ID for targeted cleanup
                const dark = options.isDark !== false;
                tooltip = document.createElement('div');
                tooltip.className = `uplot-tooltip ${options.className || ''}`;
                tooltip.dataset.uplotTooltipId = instanceId;
                tooltip.style.display = 'none';
                // position: fixed so viewport-coords from getBoundingClientRect()
                // map exactly to CSS left/top regardless of page scroll position.
                tooltip.style.position = 'fixed';
                tooltip.style.pointerEvents = 'none';
                tooltip.style.zIndex = '100';
                tooltip.style.backgroundColor = dark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.96)';
                tooltip.style.border = dark ? '1px solid rgba(51, 65, 85, 0.6)' : '1px solid rgba(148, 163, 184, 0.4)';
                tooltip.style.borderRadius = '8px';
                tooltip.style.padding = '10px 12px';
                tooltip.style.boxShadow = dark ? '0 8px 32px rgba(0,0,0,0.4)' : '0 8px 32px rgba(0,0,0,0.12)';
                tooltip.style.backdropFilter = 'blur(12px)';
                tooltip.style.fontFamily = 'sans-serif';
                tooltip.style.fontSize = '12px';
                tooltip.style.color = dark ? '#e2e8f0' : '#0f172a';

                if (!options.renderTooltip) {
                    // Create title element (usually time)
                    titleEl = document.createElement('div');
                    titleEl.style.fontWeight = 'bold';
                    titleEl.style.marginBottom = '5px';
                    titleEl.style.borderBottom = dark ? '1px solid rgba(51, 65, 85, 0.5)' : '1px solid rgba(148, 163, 184, 0.3)';
                    titleEl.style.paddingBottom = '5px';
                    titleEl.style.color = dark ? '#94a3b8' : '#475569';
                    tooltip.appendChild(titleEl);

                    // Create items container
                    itemsEl = document.createElement('div');
                    itemsEl.style.display = 'flex';
                    itemsEl.style.flexDirection = 'column';
                    itemsEl.style.gap = '4px';
                    tooltip.appendChild(itemsEl);
                }

                // Append to document body to avoid clipping
                document.body.appendChild(tooltip);
            },
            setCursor: (u: uPlot) => {
                if (!tooltip) {
                    return;
                }

                const { left, top, idx } = u.cursor;

                // Hide tooltip if cursor is out of bounds
                if (left === undefined || top === undefined || left < 0 || top < 0 || idx === undefined || idx === null) {
                    tooltip.style.display = 'none';
                    return;
                }

                // Get data index
                const dataIdx = idx;

                if (options.renderTooltip) {
                    const content = options.renderTooltip(u, dataIdx);
                    if (content) {
                        tooltip.replaceChildren();
                        if (typeof content === 'string') {
                            tooltip.textContent = content;
                        } else {
                            tooltip.appendChild(content);
                        }
                    } else {
                        tooltip.style.display = 'none';
                        return;
                    }
                } else {
                    if (!titleEl || !itemsEl) {
                        tooltip.style.display = 'none';
                        return;
                    }

                    // Update title (x-axis value) only when data index changes
                    const xVal = u.data[0][dataIdx];
                    titleEl.textContent = options.titleFormatter 
                        ? options.titleFormatter(xVal) 
                        : `Time: ${xVal.toFixed(1)}s`;

                    if (dataIdx !== lastDataIdx) {
                        lastDataIdx = dataIdx;

                        // Rebuild series items
                        let itemIdx = 0;
                        let hasVisibleItems = false;

                        for (let i = 1; i < u.series.length; i++) {
                            const s = u.series[i];
                            if (s.show === false) continue;

                            const val = u.data[i][dataIdx];
                            if (val === null || val === undefined) continue;

                            hasVisibleItems = true;

                            // Reuse existing item element or create a new one
                            let itemEl = itemsEl.children[itemIdx] as HTMLDivElement | undefined;
                            if (!itemEl) {
                                itemEl = document.createElement('div');
                                itemEl.style.display = 'flex';
                                itemEl.style.alignItems = 'center';
                                itemEl.style.gap = '8px';

                                const swatch = document.createElement('div');
                                swatch.style.width = '10px';
                                swatch.style.height = '10px';
                                swatch.style.borderRadius = '50%';
                                itemEl.appendChild(swatch);

                                const textEl = document.createElement('span');
                                itemEl.appendChild(textEl);

                                itemsEl.appendChild(itemEl);
                            }

                            // Update swatch color
                            const swatch = itemEl.children[0] as HTMLDivElement;
                            swatch.style.backgroundColor = (s.stroke as string) || '#000';

                            // Update label text (avoid innerHTML for perf)
                            const textEl = itemEl.children[1] as HTMLSpanElement;
                            const formattedVal = options.formatter 
                                ? options.formatter(i, val) 
                                : val.toFixed(2);
                            textEl.textContent = `${s.label}: ${formattedVal}`;

                            itemIdx++;
                        }

                        // Hide surplus elements from a previous render with more series
                        while (itemsEl.children.length > itemIdx) {
                            itemsEl.removeChild(itemsEl.lastChild!);
                        }

                        if (!hasVisibleItems) {
                            tooltip.style.display = 'none';
                            return;
                        }
                    }
                }

                // Position tooltip using live bBox — position: fixed means we need
                // accurate viewport coordinates at the moment of cursor move.
                // getBoundingClientRect() is fast for a single element and correct
                // regardless of page scroll, window resize, or minimize/restore.
                const bBox = u.root.getBoundingClientRect();

                // Calculate position relative to viewport
                let tooltipLeft = bBox.left + left + 15;
                let tooltipTop = bBox.top + top + 15;

                // Ensure tooltip stays within viewport
                tooltip.style.display = 'block';
                const tooltipRect = tooltip.getBoundingClientRect();

                if (tooltipLeft + tooltipRect.width > window.innerWidth) {
                    tooltipLeft = bBox.left + left - tooltipRect.width - 15;
                }

                if (tooltipTop + tooltipRect.height > window.innerHeight) {
                    tooltipTop = bBox.top + top - tooltipRect.height - 15;
                }

                tooltip.style.left = `${tooltipLeft}px`;
                tooltip.style.top = `${tooltipTop}px`;
            },
            destroy: () => {
                try {
                    if (tooltip?.parentNode) {
                        tooltip.parentNode.removeChild(tooltip);
                    }
                } catch (_e) { /* swallow — node may already be removed */ }
                // Null out ALL closure references so DOM nodes become
                // GC-eligible even if the plugin closure is retained by
                // React's fiber alternate tree or the uPlot options object.
                lastDataIdx = null;
                tooltip = null;
                titleEl = null;
                itemsEl = null;
            }
        },
        /** Unique ID stamped on the tooltip DOM element (`data-uplot-tooltip-id`).
         *  Used by UPlotChart's safety-net cleanup to remove orphaned tooltips. */
        tooltipInstanceId: instanceId,
    };
}
