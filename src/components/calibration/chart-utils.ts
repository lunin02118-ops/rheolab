/**
 * @fileoverview Low-level SVG chart utilities for calibration charts.
 *
 * Contains domain calculation, scale factories, axis tick generation,
 * number formatting, and monotone cubic spline path generation.
 *
 * @module calibration/chart-utils
 */

export function domainOf(values: number[], pad = 0.08): [number, number] {
  let mn = Infinity, mx = -Infinity;
  for (const v of values) { if (isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; } }
  if (!isFinite(mn)) return [0, 1];
  const p = (mx - mn) * pad || Math.abs(mn) * pad || 1;
  return [mn - p, mx + p];
}

export function mkScale(dom: [number, number], size: number, flip = false) {
  return (v: number) => { const t = (v - dom[0]) / (dom[1] - dom[0]); return flip ? (1 - t) * size : t * size; };
}

export function axisTicks(dom: [number, number], n = 5) {
  return Array.from({ length: n + 1 }, (_, i) => dom[0] + (dom[1] - dom[0]) * i / n);
}

export function fmt(v: number, d = 1) { return Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(d); }

/**
 * Monotone cubic spline interpolation (same algorithm as Recharts type="monotone").
 */
export function smoothPath(pts: [number, number][]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  if (pts.length === 2) {
    return `M ${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)} L ${pts[1][0].toFixed(1)},${pts[1][1].toFixed(1)}`;
  }
  const n = pts.length;
  const dx: number[] = [], slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    slope[i] = dx[i] !== 0 ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0;
  }
  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) m[i] = 0;
    else m[i] = (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (dx[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / slope[i], b = m[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * slope[i]; m[i + 1] = t * b * slope[i]; }
  }
  let d = `M ${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const cpx1 = x0 + dx[i] / 3, cpy1 = y0 + m[i] * dx[i] / 3;
    const cpx2 = x1 - dx[i] / 3, cpy2 = y1 - m[i + 1] * dx[i] / 3;
    d += ` C ${cpx1.toFixed(1)},${cpy1.toFixed(1)} ${cpx2.toFixed(1)},${cpy2.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

export const PAD = { t: 14, r: 54, b: 46, l: 62 };
export const MONO = 'JetBrains Mono, monospace';
