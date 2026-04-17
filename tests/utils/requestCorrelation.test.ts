/**
 * Sprint 5 — Regression test for findings #39/#73
 *
 * The race condition: two rapid `analyzeData()` calls share one Worker.
 * Without requestId filtering, whichever response arrives last "wins" — even
 * if it belongs to the first (stale) request.
 *
 * The fix: WorkerManager generates a UUID per call and passes it to the worker.
 * The worker echoes it back.  The handler ignores any message whose requestId
 * doesn't match the one issued for this Promise.
 *
 * We test the filtering logic directly (no real Worker needed).
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal replica of the correlation guard extracted from WorkerManager
//
// The pattern under test:
//   const requestId = crypto.randomUUID();
//   handleMessage = (event) => {
//     if (event.data.requestId && event.data.requestId !== requestId) return; // stale
//     resolve(event.data);
//   };
// ---------------------------------------------------------------------------

function makeCorrelatedHandler(requestId: string, onResolve: (data: unknown) => void) {
    return (event: { data: { requestId?: string; type: string; payload: unknown } }) => {
        // Guard: discard stale responses whose requestId doesn't match
        if (event.data.requestId && event.data.requestId !== requestId) return;
        if (event.data.type === 'ANALYSIS_COMPLETE') {
            onResolve(event.data.payload);
        }
    };
}

// ---------------------------------------------------------------------------

describe('Worker request correlation IDs (finding #39/#73 regression)', () => {

    it('same requestId → handler resolves', () => {
        const resolved = vi.fn();
        const id = crypto.randomUUID();
        const handler = makeCorrelatedHandler(id, resolved);

        // Correct response: same requestId
        handler({ data: { requestId: id, type: 'ANALYSIS_COMPLETE', payload: { cycles: [] } } });
        expect(resolved).toHaveBeenCalledTimes(1);
    });

    it('different requestId → handler is ignored (stale response discarded)', () => {
        const resolved = vi.fn();
        const myId = crypto.randomUUID();
        const otherId = crypto.randomUUID();
        const handler = makeCorrelatedHandler(myId, resolved);

        // Stale response from an older request
        handler({ data: { requestId: otherId, type: 'ANALYSIS_COMPLETE', payload: { cycles: [] } } });
        expect(resolved).not.toHaveBeenCalled();
    });

    it('no requestId in response → handler resolves (backward compat)', () => {
        // Responses without a requestId (e.g. WASM_INIT_COMPLETE) should still
        // be processed — the guard only filters when requestId is present.
        const resolved = vi.fn();
        const id = crypto.randomUUID();
        const handler = makeCorrelatedHandler(id, resolved);

        handler({ data: { type: 'ANALYSIS_COMPLETE', payload: { cycles: [] } } });
        expect(resolved).toHaveBeenCalledTimes(1);
    });

    it('two concurrent handlers: only the correct one resolves', () => {
        const resolved1 = vi.fn();
        const resolved2 = vi.fn();

        const id1 = crypto.randomUUID();
        const id2 = crypto.randomUUID();

        const handler1 = makeCorrelatedHandler(id1, resolved1);
        const handler2 = makeCorrelatedHandler(id2, resolved2);

        // Both handlers receive the response meant for request 2
        const response2 = { data: { requestId: id2, type: 'ANALYSIS_COMPLETE', payload: { cycles: ['b'] } } };
        handler1(response2);
        handler2(response2);

        // Only handler2 should resolve
        expect(resolved1).not.toHaveBeenCalled();  // ← stale; discarded
        expect(resolved2).toHaveBeenCalledTimes(1);
    });

    it('two concurrent handlers: both resolve with their own response', () => {
        const resolved1 = vi.fn();
        const resolved2 = vi.fn();

        const id1 = crypto.randomUUID();
        const id2 = crypto.randomUUID();

        const handler1 = makeCorrelatedHandler(id1, resolved1);
        const handler2 = makeCorrelatedHandler(id2, resolved2);

        // Responses arrive out of order: first response2, then response1
        handler1({ data: { requestId: id2, type: 'ANALYSIS_COMPLETE', payload: { order: 'second' } } });
        handler2({ data: { requestId: id1, type: 'ANALYSIS_COMPLETE', payload: { order: 'first' } } });
        handler1({ data: { requestId: id1, type: 'ANALYSIS_COMPLETE', payload: { order: 'first' } } });
        handler2({ data: { requestId: id2, type: 'ANALYSIS_COMPLETE', payload: { order: 'second' } } });

        expect(resolved1).toHaveBeenCalledTimes(1);
        expect(resolved2).toHaveBeenCalledTimes(1);
        expect(resolved1).toHaveBeenCalledWith({ order: 'first' });
        expect(resolved2).toHaveBeenCalledWith({ order: 'second' });
    });
});
