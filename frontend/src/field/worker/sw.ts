/**
 * P22-10b — the field app's service worker (P19-08 § 4; ADR-127 Am. 1 § 1, § 3). The source of
 * `public/sw.js`, which `scripts/build-sw.mjs` generates from this file (stamped with a version,
 * every `export` dropped, no import) — never edited by hand; `sw.build.test.ts` fails when the two
 * differ.
 *
 * Its whole fetch policy (§ 4.2):
 *  - a navigation to `/field` (any query): network-first with a 3-second timeout; a 200 HTML answer
 *    that carries a Content-Security-Policy is kept as THE shell (one entry); offline or slow → the
 *    kept shell; none kept → a plain-text offline page with no script;
 *  - `GET /_next/static/**`, `/fonts/**`, `/brand/**`: cache-first (content-hashed, immutable);
 *  - `GET /manifest.webmanifest`: network-first, the cached copy offline;
 *  - **anything else passes untouched and is never cached** — `/api/**`, uploads, images, other
 *    origins, every non-GET (FT-84): the worker holds no tenant data, no token, no cookie value.
 *
 * Scope `/field` only (the registration sets it). No `importScripts`, no library, no `eval`.
 * Install fetches the shell and the static files it references (any failure fails the install —
 * no half-populated version); activate deletes the other versions' `cf-*` caches and claims the
 * clients only on the first install (an update waits for the user, § 13: `SKIP_WAITING`). A
 * Background Sync `sync` event only asks an open page to run its engine (the worker holds no key).
 */

export const CF_VERSION = "__CF_VERSION__";
export const SHELL_PATH = "/field";
export const NETWORK_TIMEOUT_MS = 3000;
export const OFFLINE_PAGE = "Callibrator — offline.\nThe field app has not been opened online on this phone yet. Connect once, then try again.\n";

export type Policy = "shell" | "static" | "manifest" | "pass";

export const shellCache = (version: string): string => `cf-shell-${version}`;
export const staticCache = (version: string): string => `cf-static-${version}`;

/** What the worker does with a request. */
export const policyOf = (method: string, url: URL, origin: string, mode: string): Policy => {
  if (method !== "GET" || url.origin !== origin) return "pass";
  if (url.pathname === SHELL_PATH && mode === "navigate") return "shell";
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/brand/")) return "static";
  if (url.pathname === "/manifest.webmanifest") return "manifest";
  return "pass";
};

/** The `/_next/static/` and `/fonts/` URLs a shell references (`src` / `href` attributes; a strict pattern, never evaluated). */
export const staticUrlsOf = (html: string): string[] => {
  const urls = new Set<string>();
  for (const m of html.matchAll(/\s(?:src|href)="(\/(?:_next\/static|fonts)\/[A-Za-z0-9._~\-/%]+)"/g)) urls.add(m[1] as string);
  return [...urls];
};

/** The platform the handlers run on (the worker's own globals, or a test's doubles). */
export interface WorkerDeps {
  readonly caches: CacheStorage;
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  readonly origin: string;
  readonly version: string;
  setTimeout(fn: () => void, ms: number): unknown;
  claim(): Promise<void>;
  skipWaiting(): Promise<void>;
  /** Posts a message to every open window client of the scope. */
  postToClients(message: unknown): Promise<void>;
}

/** The handlers, bound to their platform. */
export function createWorker(deps: WorkerDeps) {
  const timeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
    new Promise((resolve, reject) => {
      deps.setTimeout(() => reject(new Error("timeout")), ms);
      promise.then(resolve, reject);
    });

  const keepShell = async (response: Response): Promise<void> => {
    const html = (response.headers.get("content-type") ?? "").includes("text/html");
    if (response.status === 200 && html && response.headers.has("content-security-policy")) {
      const cache = await deps.caches.open(shellCache(deps.version));
      await cache.put(SHELL_PATH, response);
    }
  };

  const shell = async (request: Request): Promise<Response> => {
    try {
      const response = await timeout(deps.fetch(request), NETWORK_TIMEOUT_MS);
      await keepShell(response.clone());
      return response;
    } catch {
      const kept = await (await deps.caches.open(shellCache(deps.version))).match(SHELL_PATH);
      return kept ?? new Response(OFFLINE_PAGE, { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
  };

  const cacheFirst = async (request: Request): Promise<Response> => {
    const cache = await deps.caches.open(staticCache(deps.version));
    const hit = await cache.match(request);
    if (hit) return hit;
    const response = await deps.fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  };

  const networkFirst = async (request: Request): Promise<Response> => {
    const cache = await deps.caches.open(staticCache(deps.version));
    try {
      const response = await deps.fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch (err) {
      const hit = await cache.match(request);
      if (hit) return hit;
      throw err;
    }
  };

  return {
    /** The response for a fetch, or null to let it pass untouched. */
    respond(request: Request): Promise<Response> | null {
      const policy = policyOf(request.method, new URL(request.url), deps.origin, request.mode);
      if (policy === "shell") return shell(request);
      if (policy === "static") return cacheFirst(request);
      if (policy === "manifest") return networkFirst(request);
      return null;
    },

    /** Install: the shell and every static file it references, or nothing (a failure fails the install). */
    async install(): Promise<void> {
      const response = await deps.fetch(SHELL_PATH, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(`shell ${String(response.status)}`);
      const html = await response.clone().text();
      const cache = await deps.caches.open(staticCache(deps.version));
      for (const url of staticUrlsOf(html)) {
        const file = await deps.fetch(url);
        if (!file.ok) throw new Error(`static ${url} ${String(file.status)}`);
        await cache.put(url, file);
      }
      await keepShell(response);
    },

    /** Activate: other versions' `cf-*` caches deleted; the clients claimed only on the first install. */
    async activate(): Promise<void> {
      const names = await deps.caches.keys();
      const mine = new Set([shellCache(deps.version), staticCache(deps.version)]);
      const old = names.filter((n) => n.startsWith("cf-") && !mine.has(n));
      for (const n of old) await deps.caches.delete(n);
      if (old.length === 0) await deps.claim();
    },

    async message(data: unknown): Promise<void> {
      if (data !== null && typeof data === "object" && (data as { type?: unknown }).type === "SKIP_WAITING") await deps.skipWaiting();
    },

    /** Background Sync: ask an open page to run its engine (the worker holds no key and no data). */
    async sync(): Promise<void> {
      await deps.postToClients({ type: "cf-sync" });
    },
  };
}

// ── Wiring, only inside a service worker (the module is also imported by the tests) ──
interface SwEvent {
  waitUntil(promise: Promise<unknown>): void;
}
interface SwFetchEvent extends SwEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}
interface SwScope {
  readonly registration: unknown;
  readonly location: { readonly origin: string };
  readonly caches: CacheStorage;
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  skipWaiting(): Promise<void>;
  setTimeout(fn: () => void, ms: number): unknown;
  readonly clients: { claim(): Promise<void>; matchAll(options: { type: string }): Promise<{ postMessage(message: unknown): void }[]> };
  addEventListener(type: string, listener: (event: never) => void): void;
}

const scope = globalThis as unknown as Partial<SwScope>;
if (scope.registration !== undefined && typeof scope.skipWaiting === "function" && scope.clients && scope.location && scope.caches && scope.fetch && scope.setTimeout && scope.addEventListener) {
  const sw = scope as SwScope;
  const worker = createWorker({
    caches: sw.caches,
    fetch: (input, init) => sw.fetch(input, init),
    origin: sw.location.origin,
    version: CF_VERSION,
    setTimeout: (fn, ms) => sw.setTimeout(fn, ms),
    claim: () => sw.clients.claim(),
    skipWaiting: () => sw.skipWaiting(),
    postToClients: async (message) => {
      for (const client of await sw.clients.matchAll({ type: "window" })) client.postMessage(message);
    },
  });
  sw.addEventListener("install", (event: SwEvent) => event.waitUntil(worker.install()));
  sw.addEventListener("activate", (event: SwEvent) => event.waitUntil(worker.activate()));
  sw.addEventListener("fetch", (event: SwFetchEvent) => {
    const response = worker.respond(event.request);
    if (response) event.respondWith(response);
  });
  sw.addEventListener("message", (event: SwEvent & { data: unknown }) => event.waitUntil(worker.message(event.data)));
  sw.addEventListener("sync", (event: SwEvent) => event.waitUntil(worker.sync()));
}
