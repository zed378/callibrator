"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot() {
  return false; // motion allowed during SSR / first paint
}

/**
 * SSR-safe reduced-motion hook built on useSyncExternalStore so it subscribes
 * to `matchMedia` without a setState-in-effect. Returns `false` on the server
 * / first paint, then the real OS setting after hydration (and on change).
 * One shared source of truth for the whole immersive layer (GSAP + Framer).
 */
export function useReducedMotionSafe(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export default useReducedMotionSafe;
