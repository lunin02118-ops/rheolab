import type { ChartColumnarData, NullableNumericColumn, NumericColumn } from '@/types';

export const DEFAULT_SERIES_WINDOW_CACHE_TTL_MS = 5 * 60_000;
export const DEFAULT_SERIES_WINDOW_CACHE_MAX_BYTES = 96 * 1024 * 1024;
export const DEFAULT_SERIES_WINDOW_CACHE_MAX_ENTRIES = 64;

export type SeriesWindowCacheKind = 'overview' | 'window';

export interface SeriesWindowCacheKey {
  experimentId: string;
  dataHash?: string;
  metricsKey: string;
  maxPoints: number;
  kind: SeriesWindowCacheKind;
  sessionId?: string;
  xMinSec?: number;
  xMaxSec?: number;
}

export interface SeriesWindowCacheEntry {
  key: string;
  cacheKey: SeriesWindowCacheKey;
  data: ChartColumnarData;
  byteSize: number;
  createdAt: number;
  lastAccessedAt: number;
  ttlMs: number;
}

export interface SeriesWindowCacheStats {
  entries: number;
  byteSize: number;
  maxEntries: number;
  maxBytes: number;
  ttlMs: number;
  oldestEntryAgeMs: number | null;
}

interface SeriesWindowCacheOptions {
  ttlMs?: number;
  maxBytes?: number;
  maxEntries?: number;
  now?: () => number;
}

function roundedSeconds(value: number | undefined): string {
  if (!Number.isFinite(value)) return '';
  return String(Math.round(Number(value) * 1000) / 1000);
}

export function serializeSeriesWindowCacheKey(key: SeriesWindowCacheKey): string {
  return [
    key.sessionId ?? 'global',
    key.experimentId,
    key.dataHash ?? '',
    key.metricsKey,
    key.maxPoints,
    key.kind,
    roundedSeconds(key.xMinSec),
    roundedSeconds(key.xMaxSec),
  ].join('|');
}

function numericColumnByteLength(column: NumericColumn | NullableNumericColumn | undefined): number {
  if (!column) return 0;
  if (ArrayBuffer.isView(column)) return column.byteLength;
  return column.length * 8;
}

export function estimateChartColumnarDataBytes(data: ChartColumnarData): number {
  return (
    numericColumnByteLength(data.timeSec) +
    numericColumnByteLength(data.viscosityCp) +
    numericColumnByteLength(data.temperatureC) +
    numericColumnByteLength(data.shearRate) +
    numericColumnByteLength(data.shearStress) +
    numericColumnByteLength(data.pressureBar) +
    numericColumnByteLength(data.speedRpm) +
    numericColumnByteLength(data.bathTemperatureC)
  );
}

export class SeriesWindowCache {
  private readonly entries = new Map<string, SeriesWindowCacheEntry>();
  private readonly ttlMs: number;
  private readonly maxBytes: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private byteSize = 0;

  constructor(options: SeriesWindowCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_SERIES_WINDOW_CACHE_TTL_MS;
    this.maxBytes = options.maxBytes ?? DEFAULT_SERIES_WINDOW_CACHE_MAX_BYTES;
    this.maxEntries = options.maxEntries ?? DEFAULT_SERIES_WINDOW_CACHE_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }

  get(key: SeriesWindowCacheKey): ChartColumnarData | null {
    this.prune();
    const serialized = serializeSeriesWindowCacheKey(key);
    const entry = this.entries.get(serialized);
    if (!entry) return null;

    const now = this.now();
    if (now - entry.createdAt > entry.ttlMs) {
      this.deleteSerialized(serialized);
      return null;
    }

    entry.lastAccessedAt = now;
    return entry.data;
  }

  set(key: SeriesWindowCacheKey, data: ChartColumnarData): void {
    const serialized = serializeSeriesWindowCacheKey(key);
    const existing = this.entries.get(serialized);
    if (existing) {
      this.byteSize -= existing.byteSize;
      this.entries.delete(serialized);
    }

    const now = this.now();
    const entry: SeriesWindowCacheEntry = {
      key: serialized,
      cacheKey: { ...key },
      data,
      byteSize: estimateChartColumnarDataBytes(data),
      createdAt: now,
      lastAccessedAt: now,
      ttlMs: this.ttlMs,
    };
    this.entries.set(serialized, entry);
    this.byteSize += entry.byteSize;
    this.prune();
  }

  deleteByExperiment(experimentId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.cacheKey.experimentId === experimentId) {
        this.deleteSerialized(key);
      }
    }
  }

  deleteBySession(sessionId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.cacheKey.sessionId === sessionId) {
        this.deleteSerialized(key);
      }
    }
  }

  prune(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (now - entry.createdAt > entry.ttlMs) {
        this.deleteSerialized(key);
      }
    }

    while (this.entries.size > this.maxEntries || this.byteSize > this.maxBytes) {
      const oldest = this.oldestEntryKey();
      if (!oldest) break;
      this.deleteSerialized(oldest);
    }
  }

  stats(): SeriesWindowCacheStats {
    this.prune();
    const now = this.now();
    let oldestCreatedAt: number | null = null;
    for (const entry of this.entries.values()) {
      oldestCreatedAt = oldestCreatedAt === null
        ? entry.createdAt
        : Math.min(oldestCreatedAt, entry.createdAt);
    }
    return {
      entries: this.entries.size,
      byteSize: this.byteSize,
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes,
      ttlMs: this.ttlMs,
      oldestEntryAgeMs: oldestCreatedAt === null ? null : now - oldestCreatedAt,
    };
  }

  clear(): void {
    this.entries.clear();
    this.byteSize = 0;
  }

  private oldestEntryKey(): string | null {
    let oldestKey: string | null = null;
    let oldestAccess = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.entries) {
      if (entry.lastAccessedAt < oldestAccess) {
        oldestAccess = entry.lastAccessedAt;
        oldestKey = key;
      }
    }
    return oldestKey;
  }

  private deleteSerialized(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.byteSize -= entry.byteSize;
    this.entries.delete(key);
  }
}

export const seriesWindowCache = new SeriesWindowCache();
