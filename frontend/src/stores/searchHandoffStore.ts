import { useEffect, useState } from "react";
import { create } from "zustand";

/**
 * A global-search result handed to the list page it opens (S6, audit 01 §2.2).
 *
 * There is no detail page for a device, a stock item or a certificate yet, so
 * choosing a result opens its list FILTERED TO THAT RECORD instead of the
 * unfiltered list it used to open. The list reads the term once, as its
 * initial filter, and the hand-off is cleared after mount — a later visit to
 * the list starts unfiltered. When detail pages exist, the search opens them.
 */
export type HandoffTarget = "device" | "stock" | "certificate";

interface SearchHandoffState {
  pending: { target: HandoffTarget; term: string } | null;
  handOff: (target: HandoffTarget, term: string) => void;
  /** The term waiting for `target`, or null. Does not clear it (render-safe). */
  peek: (target: HandoffTarget) => string | null;
  /** Clear the hand-off to `target`, if that is who it is for. */
  clear: (target: HandoffTarget) => void;
}

export const useSearchHandoffStore = create<SearchHandoffState>()((set, get) => ({
  pending: null,
  handOff: (target, term) => set({ pending: { target, term } }),
  peek: (target) => {
    const pending = get().pending;
    return pending && pending.target === target ? pending.term : null;
  },
  clear: (target) => {
    if (get().pending?.target === target) set({ pending: null });
  },
}));

/**
 * The term handed to `target` (read once, at mount), or null. The hand-off is
 * cleared in an effect, not during render, so a double-invoked initializer
 * (React StrictMode) reads the same term.
 */
export function useSearchHandoff(target: HandoffTarget): string | null {
  const [term] = useState(() => useSearchHandoffStore.getState().peek(target));
  useEffect(() => {
    useSearchHandoffStore.getState().clear(target);
  }, [target]);
  return term;
}
