import { useEffect, useState, type RefObject } from 'react';

interface ChartSize {
  width: number;
  height: number;
}

/**
 * Observe the size of a container element via ResizeObserver.
 *
 * @param containerRef — ref to the DOM element to observe
 * @param options.enabled — when false the observer is disconnected (e.g. no data yet)
 * @returns current { width, height } in integer pixels
 *
 * Extracted from rheology-chart.tsx to standardise the "re-run observer
 * when data arrives" pattern and prevent forgotten useEffect deps.
 */
export function useChartResize(
  containerRef: RefObject<HTMLDivElement | null>,
  options: { enabled: boolean } = { enabled: true },
): ChartSize {
  const [size, setSize] = useState<ChartSize>({ width: 0, height: 0 });

  useEffect(() => {
    if (!options.enabled) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(0, Math.floor(rect.width));
      const height = Math.max(0, Math.floor(rect.height));
      setSize((prev) =>
        prev.width === width && prev.height === height
          ? prev
          : { width, height },
      );
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, options.enabled]);

  return size;
}
