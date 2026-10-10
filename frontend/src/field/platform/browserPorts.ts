/**
 * P22-10b — the engine's small ports in a browser (`06` § 4, the web column): the device clock,
 * `crypto.getRandomValues`, `navigator.onLine`, window timers and a diagnostics log that keeps the
 * last events in memory (ids, kinds, states, statuses, counts — the engine never logs tenant data;
 * nothing is sent anywhere). Every browser global is passed in, so the field app and the tests wire
 * them the same way.
 */
import type { Clock, EngineLog, Network, Random, Scheduler } from "../engine/ports";

export interface BrowserGlobals {
  now(): number;
  getRandomValues(array: Uint8Array): Uint8Array;
  onLine(): boolean;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export interface BrowserPorts {
  clock: Clock;
  random: Random;
  network: Network;
  scheduler: Scheduler;
  log: EngineLog & { readonly events: readonly { name: string; at: number; fields: Record<string, string | number | boolean> }[] };
}

/** The last diagnostics kept (the Settings screen can show them for support). */
export const LOG_LIMIT = 200;

export function browserPorts(g: BrowserGlobals): BrowserPorts {
  const events: { name: string; at: number; fields: Record<string, string | number | boolean> }[] = [];
  return {
    clock: { now: () => g.now() },
    random: { bytes: (n) => g.getRandomValues(new Uint8Array(n)) },
    network: { online: () => g.onLine() },
    scheduler: {
      setTimeout(fn, ms) {
        const id = g.setTimeout(fn, ms);
        return () => g.clearTimeout(id);
      },
    },
    log: {
      events,
      event(name, fields) {
        events.push({ name, at: g.now(), fields: { ...fields } });
        if (events.length > LOG_LIMIT) events.splice(0, events.length - LOG_LIMIT);
      },
    },
  };
}
