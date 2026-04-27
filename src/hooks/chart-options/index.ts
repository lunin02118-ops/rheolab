/**
 * Public API for chart-options decomposition.
 *
 * Note: time-format helpers (formatTimeTick, timeAxisUnit, pressureLabel,
 * parseDash, applyOpacity) are imported directly from './time-format' by
 * their consumers — no barrel re-export is needed.
 */
export { buildChartTranslations } from './translations';
export type { ChartTranslations } from './translations';
export { buildAxes, buildSeries } from './build-axes-series';
