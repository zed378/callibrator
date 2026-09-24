"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * True in the browser, false during server rendering and hydration's first
 * pass. `useSyncExternalStore` with a server snapshot gives exactly that without
 * a setState in an effect (react-hooks/set-state-in-effect).
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
