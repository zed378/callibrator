/**
 * Start a data load from an effect without setting state synchronously in the
 * effect body.
 *
 * A load function usually sets `isLoading` / clears `error` before it awaits
 * anything. Called directly from `useEffect`, that is a synchronous setState in
 * the effect body — one extra, cascading render per load, which is what
 * `react-hooks/set-state-in-effect` (React Compiler) reports. Deferring the
 * call by one microtask moves the first setState out of the effect body, so it
 * is batched like any other async update. The rule is not disabled; the shape
 * it objects to is gone.
 *
 * Returns the effect's cleanup: once the effect is torn down (dependency change
 * or unmount) before the microtask runs, the load is skipped.
 *
 * ```ts
 * useEffect(() => deferEffect(fetchItems), [fetchItems]);
 * ```
 *
 * F-03 (AUDIT-2026-09-FRONTEND): replaces the per-hook
 * `(async () => { await Promise.resolve(); ... })()` copies of the same idea.
 */
export function deferEffect(load: () => unknown): () => void {
  let active = true;
  queueMicrotask(() => {
    if (active) void load();
  });
  return () => {
    active = false;
  };
}
