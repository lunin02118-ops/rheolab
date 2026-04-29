export type LibraryFilterPerfEventName =
  | 'filters_changed'
  | 'debounce_scheduled'
  | 'debounce_fired'
  | 'ipc_start'
  | 'ipc_end'
  | 'render_commit';

export interface LibraryFilterPerfEvent {
  name: LibraryFilterPerfEventName;
  at_ms: number;
  request_id?: number;
  filter_keys?: string[];
  page?: number;
  limit?: number;
  view_mode?: 'grid' | 'list';
  result_count?: number;
  total_count?: number | null;
  duration_ms?: number;
}

export const LIBRARY_FILTER_PERF_EVENT = 'rheolab:library-filter-perf';
export const LIBRARY_FILTER_PERF_LOCAL_STORAGE_KEY = '__RHEOLAB_LIBRARY_FILTER_PERF_EVENTS__';

type LibraryFilterPerfHook = {
  record?: (event: LibraryFilterPerfEvent) => void;
};

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return Math.round(performance.now() * 10) / 10;
  }
  return Date.now();
}

function shouldDispatchDomEvent(): boolean {
  try {
    return window.localStorage.getItem(LIBRARY_FILTER_PERF_LOCAL_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function emitLibraryFilterPerfEvent(
  event: Omit<LibraryFilterPerfEvent, 'at_ms'>,
): void {
  if (typeof window === 'undefined') return;
  const observedEvent = {
    ...event,
    at_ms: nowMs(),
  };
  const hook = (window as unknown as {
    __RHEOLAB_LIBRARY_FILTER_PERF_HOOK__?: LibraryFilterPerfHook;
  }).__RHEOLAB_LIBRARY_FILTER_PERF_HOOK__;

  try {
    if (hook?.record) {
      hook.record(observedEvent);
    } else if (shouldDispatchDomEvent() && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent(LIBRARY_FILTER_PERF_EVENT, { detail: observedEvent }));
    }
  } catch {
    // Test-only observer hook; never let it affect production filtering.
  }
}
