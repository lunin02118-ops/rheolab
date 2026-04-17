/**
 * License Event Bus — decouples license-store from its subscribers.
 *
 * license-store emits events here; other stores (e.g. comparison-store)
 * subscribe without creating a circular import.
 */

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

export const licenseEvents = {
    on(event: string, fn: Listener): () => void {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(fn);
        return () => { listeners.get(event)?.delete(fn); };
    },
    emit(event: string): void {
        listeners.get(event)?.forEach((fn) => fn());
    },
};
