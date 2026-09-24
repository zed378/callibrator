"use client";

import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/**
 * A value that can only be read in the browser (the current year, the hour of
 * day): `serverValue` during prerender and hydration's first pass, `read()`
 * after. Replaces the "useState(null) + setState in a mount effect" shape
 * (react-hooks/set-state-in-effect) without disabling the rule.
 *
 * `read` must return a primitive (or otherwise stable) value: React compares
 * successive snapshots with Object.is.
 */
export function useClientValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(noSubscription, read, () => serverValue);
}

const subscribeEverySecond = (onTick: () => void) => {
  const timer = setInterval(onTick, 1000);
  return () => clearInterval(timer);
};
const currentSecond = () => Math.floor(Date.now() / 1000);

/**
 * The wall clock, re-rendering once a second; null during prerender. An
 * external-store subscription, so no setState runs in an effect.
 */
export function useClockSeconds(): number | null {
  return useSyncExternalStore(subscribeEverySecond, currentSecond, () => null);
}
