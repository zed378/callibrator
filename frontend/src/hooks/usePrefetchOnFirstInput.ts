import { useEffect } from "react";

/** The input that starts a prefetch: a key press, a tap or a click. Not focus. */
export const PREFETCH_EVENTS = ["keydown", "pointerdown", "touchstart"] as const;

/**
 * P10-17 perf addendum, P10-19: run `load` (an `import()` of a page's API
 * layer) once, at the visitor's first key press, tap or click INSIDE `<main>`,
 * so the module is there by the time they submit, yet costs the page's first
 * load nothing.
 *
 * - Not on focus: several public forms autofocus a field as they hydrate.
 * - Not for input outside `<main>` (the theme toggle, the language form): that
 *   work would land on their interaction (INP).
 * - A failed prefetch is silent; the caller awaits the same `load` on use and
 *   handles the failure there.
 *
 * `load` must be stable (a module-level function), or the listeners are
 * re-added on every render.
 */
export function usePrefetchOnFirstInput(load: () => Promise<unknown>): void {
  useEffect(() => {
    const prefetch = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest("main")) return;
      for (const type of PREFETCH_EVENTS) document.removeEventListener(type, prefetch, true);
      void load().catch(() => undefined);
    };
    for (const type of PREFETCH_EVENTS) document.addEventListener(type, prefetch, { capture: true, passive: true });
    return () => {
      for (const type of PREFETCH_EVENTS) document.removeEventListener(type, prefetch, true);
    };
  }, [load]);
}
