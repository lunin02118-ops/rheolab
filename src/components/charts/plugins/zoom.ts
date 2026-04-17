import uPlot from 'uplot';
import { useZoomSyncStore } from '@/lib/store/zoom-sync-store';
import { createLogger } from '@/lib/logger';

const zoomPluginLogger = createLogger('ZoomPlugin');

/**
 * Creates a zoom plugin for uPlot that mimics Recharts' brush/zoom behavior.
 * Allows selecting a region to zoom in, and double-clicking to reset zoom.
 *
 * §4.5 – When `syncKey` is specified, zoom/reset events are broadcast via
 * `zoom-sync-store` so that all charts sharing the same key stay in lock-step.
 * 
 * @param options Configuration options for the zoom plugin
 * @returns A uPlot plugin object
 */
export function zoomPlugin(options: {
    onZoom?: (min: number, max: number) => void;
    onReset?: () => void;
    /** Optional key for cross-chart zoom synchronisation. */
    syncKey?: string;
} = {}): uPlot.Plugin {
    let isZoomed = false;
    let originalXMin: number | null = null;
    let originalXMax: number | null = null;
    let dblClickHandler: (() => void) | null = null;
    /** Unsubscribe function returned by the Zustand store subscription. */
    let storeUnsub: (() => void) | null = null;
    /** Flag to prevent re-entrant zoom application from the store subscription. */
    let applyingFromStore = false;

    return {
        hooks: {
            init: (u: uPlot) => {
                // Add double-click listener to reset zoom (saved for cleanup in destroy)
                dblClickHandler = () => {
                    if (isZoomed && originalXMin != null && originalXMax != null) {
                        zoomPluginLogger.info('dblclick reset', {
                            fromMin: u.scales?.x?.min,
                            fromMax: u.scales?.x?.max,
                            toMin: originalXMin,
                            toMax: originalXMax,
                        });
                        u.setScale('x', { min: originalXMin, max: originalXMax });
                        isZoomed = false;
                        if (options.onReset) options.onReset();
                        // Publish reset to sync group
                        if (options.syncKey) {
                            useZoomSyncStore.getState().setRange(options.syncKey, null);
                        }
                    }
                };
                u.root.addEventListener('dblclick', dblClickHandler);

                // Subscribe to store changes for cross-chart sync
                if (options.syncKey) {
                    const key = options.syncKey;
                    storeUnsub = useZoomSyncStore.subscribe((state, prev) => {
                        if (applyingFromStore) return;
                        const newRange = state.ranges[key];
                        const prevRange = prev.ranges[key];
                        if (newRange === prevRange) return;

                        applyingFromStore = true;
                        try {
                            if (newRange) {
                                // Lazily capture original bounds before first sync zoom
                                if (!isZoomed && u.scales.x?.min != null && u.scales.x?.max != null) {
                                    originalXMin = u.scales.x.min;
                                    originalXMax = u.scales.x.max;
                                }
                                u.setScale('x', { min: newRange.min, max: newRange.max });
                                isZoomed = true;
                            } else if (isZoomed && originalXMin != null && originalXMax != null) {
                                u.setScale('x', { min: originalXMin, max: originalXMax });
                                isZoomed = false;
                            }
                        } finally {
                            applyingFromStore = false;
                        }
                    });
                }
            },
            setSelect: (u: uPlot) => {
                // Handle zoom selection
                const { left, width } = u.select;
                
                // Ignore tiny selections (likely accidental clicks)
                if (width < 5) {
                    zoomPluginLogger.debug('selection ignored: too small', { left, width });
                    u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
                    return;
                }

                // Lazily capture original bounds on first zoom (data is loaded by now)
                if (!isZoomed && u.scales.x && u.scales.x.min != null && u.scales.x.max != null) {
                    originalXMin = u.scales.x.min;
                    originalXMax = u.scales.x.max;
                }

                // Calculate new x-axis bounds based on selection
                const min = u.posToVal(left, 'x');
                const max = u.posToVal(left + width, 'x');

                zoomPluginLogger.info('selection zoom', {
                    left,
                    width,
                    min,
                    max,
                    beforeMin: u.scales?.x?.min,
                    beforeMax: u.scales?.x?.max,
                });

                // Apply new scale
                u.setScale('x', { min, max });
                
                // Clear selection box
                u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
                
                isZoomed = true;
                if (options.onZoom) options.onZoom(min, max);

                // Publish to sync group
                if (options.syncKey) {
                    useZoomSyncStore.getState().setRange(options.syncKey, { min, max });
                }
            },
            destroy: (u: uPlot) => {
                if (dblClickHandler) {
                    u.root.removeEventListener('dblclick', dblClickHandler);
                    dblClickHandler = null;
                }
                if (storeUnsub) {
                    storeUnsub();
                    storeUnsub = null;
                }
                // Null closure state so no data survives if the plugin
                // object is retained by React's fiber alternate tree.
                isZoomed = false;
                originalXMin = null;
                originalXMax = null;
                applyingFromStore = false;
            }
        }
    };
}
