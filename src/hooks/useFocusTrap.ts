import { useEffect, useRef, type RefObject } from "react";

/**
 * Trap keyboard focus within a container element while it is open.
 *
 * Usage:
 * ```tsx
 * const ref = useFocusTrap<HTMLDivElement>(isOpen);
 * return isOpen ? <div ref={ref} role="dialog" aria-modal="true">...</div> : null;
 * ```
 *
 * The hook:
 * - Focuses the first focusable element on mount
 * - Wraps Tab / Shift+Tab to cycle within the container
 * - Restores focus to the previously focused element on unmount
 */
export function useFocusTrap<T extends HTMLElement>(
  isOpen: boolean,
): RefObject<T | null> {
  const containerRef = useRef<T | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Remember the element that had focus before the trap opened
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const container = containerRef.current;
    if (!container) return;

    const FOCUSABLE =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    // Focus the first focusable element inside the trap
    const focusFirst = () => {
      const first = container.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    };

    // Small delay to let the DOM settle (e.g. after animation)
    const id = requestAnimationFrame(focusFirst);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("keydown", handleKeyDown);
      // Restore focus to the element that was focused before trap
      previousFocusRef.current?.focus();
    };
  }, [isOpen]);

  return containerRef;
}
