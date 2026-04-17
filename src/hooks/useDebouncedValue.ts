import { useEffect, useState } from 'react';

/**
 * Returns a debounced version of the value — only updates after `delay` ms of
 * no new changes.  Used to coalesce rapid changes into a single update.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
    const [debounced, setDebounced] = useState<T>(value);
    useEffect(() => {
        const id = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(id);
    }, [value, delay]);
    return debounced;
}
