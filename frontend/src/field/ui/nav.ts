/**
 * P22-10c2 — the field app's screens are client state in ONE document (P19-08 § 3.1, G-O2): the
 * screen lives in `/field?view=…&id=…&ref=…`, pushed with `history.pushState`, so the back button
 * works offline and no screen change asks the server for anything. React reads the location with
 * `useSyncExternalStore` (no effect sets state).
 */
import { useSyncExternalStore } from "react";

export const VIEWS = ["home", "scan", "device", "register", "capture", "outbox", "sign", "settings"] as const;
export type View = (typeof VIEWS)[number];

export interface Route {
  readonly view: View;
  /** A device id (`device`). */
  readonly id: string | null;
  /** A capture's local id (`capture`). */
  readonly ref: string | null;
}

/** The custom event `go` dispatches (pushState itself fires none). */
export const NAV_EVENT = "cf:navigate";

export const parseRoute = (search: string): Route => {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  return {
    view: (VIEWS as readonly string[]).includes(view ?? "") ? (view as View) : "home",
    id: params.get("id"),
    ref: params.get("ref"),
  };
};

export const hrefOf = (view: View, extra: { id?: string; ref?: string } = {}): string => {
  const params = new URLSearchParams({ view });
  if (extra.id) params.set("id", extra.id);
  if (extra.ref) params.set("ref", extra.ref);
  return `/field?${params.toString()}`;
};

/** Moves to a screen (a history entry, no request). */
export const go = (view: View, extra: { id?: string; ref?: string } = {}): void => {
  window.history.pushState(null, "", hrefOf(view, extra));
  window.dispatchEvent(new Event(NAV_EVENT));
};

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener("popstate", onChange);
  window.addEventListener(NAV_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(NAV_EVENT, onChange);
  };
};

const getSearch = (): string => window.location.search;
const getServerSearch = (): string => "";

export const useRoute = (): Route => parseRoute(useSyncExternalStore(subscribe, getSearch, getServerSearch));
