/** @jest-environment node */
/**
 * P22-10b — the field service worker's policy and handlers (P19-08 § 4), over node's Fetch API and
 * an in-memory CacheStorage:
 *  - the policy: the `/field` navigation is the shell; static files cache-first; the manifest
 *    network-first; EVERYTHING ELSE passes and is never cached (the API, uploads, images, other
 *    origins, every non-GET — FT-84);
 *  - the shell: kept only from a 200 HTML answer with a CSP; served when offline or slower than 3 s;
 *    a plain-text offline page (no script) when none was kept;
 *  - install: the shell and each referenced static file, or a failed install; activate: other
 *    versions' `cf-*` caches deleted, claim only on the first install; SKIP_WAITING; Background Sync
 *    only asks an open page to run;
 *  - the generated `public/sw.js` is current (`build-sw.mjs --check`), has no import, export,
 *    `importScripts` or `eval`, and parses as a classic script.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createWorker, OFFLINE_PAGE, policyOf, shellCache, staticCache, staticUrlsOf, type WorkerDeps } from "../sw";

const ORIGIN = "https://app.example";

class MemoryCache {
  entries = new Map<string, Response>();
  private key(req: Request | string): string {
    return typeof req === "string" ? new URL(req, ORIGIN).href : req.url;
  }
  async match(req: Request | string) {
    const hit = this.entries.get(this.key(req));
    return hit ? hit.clone() : undefined;
  }
  async put(req: Request | string, res: Response) {
    this.entries.set(this.key(req), res);
  }
}
class MemoryCaches {
  stores = new Map<string, MemoryCache>();
  async open(name: string) {
    const s = this.stores.get(name) ?? new MemoryCache();
    this.stores.set(name, s);
    return s;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
}

const html = (body: string, csp = true) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...(csp ? { "content-security-policy": "default-src 'self'" } : {}) } });

const setup = (fetchImpl: (input: Request | string) => Promise<Response>, version = "v1") => {
  const caches = new MemoryCaches();
  const posted: unknown[] = [];
  const deps: WorkerDeps & { claimed: number; skipped: number } = {
    caches: caches as unknown as CacheStorage,
    fetch: (input) => fetchImpl(input),
    origin: ORIGIN,
    version,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    claimed: 0,
    skipped: 0,
    async claim() {
      deps.claimed += 1;
    },
    async skipWaiting() {
      deps.skipped += 1;
    },
    async postToClients(message) {
      posted.push(message);
    },
  };
  return { worker: createWorker(deps), caches, deps, posted };
};

/** A navigation request (node's Request refuses the `navigate` mode, which only the browser sets). */
const nav = (p: string) => ({ method: "GET", url: `${ORIGIN}${p}`, mode: "navigate" }) as unknown as Request;

describe("P22-10b — the worker's policy", () => {
  it("the shell, static files, the manifest; everything else passes", () => {
    const u = (p: string, o = ORIGIN) => new URL(p, o);
    expect(policyOf("GET", u("/field?view=home"), ORIGIN, "navigate")).toBe("shell");
    expect(policyOf("GET", u("/field"), ORIGIN, "cors")).toBe("pass");
    expect(policyOf("GET", u("/_next/static/chunks/a.js"), ORIGIN, "no-cors")).toBe("static");
    expect(policyOf("GET", u("/fonts/NotoSans.ttf"), ORIGIN, "cors")).toBe("static");
    expect(policyOf("GET", u("/brand/icon-192.png"), ORIGIN, "no-cors")).toBe("static");
    expect(policyOf("GET", u("/manifest.webmanifest"), ORIGIN, "cors")).toBe("manifest");
    for (const p of ["/api/v1/ipm/sessions", "/uploads/public/x.png", "/_next/image?url=x", "/dashboard", "/fieldwork"]) expect(policyOf("GET", u(p), ORIGIN, "navigate")).toBe("pass");
    expect(policyOf("POST", u("/field"), ORIGIN, "navigate")).toBe("pass");
    expect(policyOf("GET", u("/_next/static/a.js", "https://cdn.example"), ORIGIN, "no-cors")).toBe("pass");
  });

  it("the static URLs a shell references, nothing else", () => {
    expect(staticUrlsOf('<script src="/_next/static/a.js"></script><link href="/fonts/x.ttf"><img src="/api/v1/x"><script src="https://e.example/_next/static/b.js"></script><a href="/_next/static/a.js">')).toEqual([
      "/_next/static/a.js",
      "/fonts/x.ttf",
    ]);
  });
});

describe("P22-10b — the worker's handlers", () => {
  it("the shell: kept from a 200 HTML with a CSP, served offline; an answer without a CSP is not kept; the offline page has no script", async () => {
    let online = true;
    const { worker, caches } = setup(async () => {
      if (!online) throw new Error("offline");
      return html("<html>shell</html>");
    });
    expect(await (await worker.respond(nav("/field?view=home")))?.text()).toBe("<html>shell</html>");
    expect((await caches.open(shellCache("v1"))).entries.size).toBe(1);
    online = false;
    expect(await (await worker.respond(nav("/field")))?.text()).toBe("<html>shell</html>");

    const none = setup(async () => {
      throw new Error("offline");
    });
    const page = await none.worker.respond(nav("/field"));
    expect(page?.status).toBe(503);
    expect(page?.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await page?.text()).toBe(OFFLINE_PAGE);
    expect(OFFLINE_PAGE).not.toMatch(/<script/i);

    const noCsp = setup(async () => html("<html>x</html>", false));
    await noCsp.worker.respond(nav("/field"));
    expect((await noCsp.caches.open(shellCache("v1"))).entries.size).toBe(0);
  });

  it("a slow network (over 3 s) falls back to the kept shell", async () => {
    jest.useFakeTimers();
    const { worker, caches } = setup(() => new Promise(() => undefined));
    await (await caches.open(shellCache("v1"))).put("/field", html("kept"));
    const pending = worker.respond(nav("/field"));
    await jest.advanceTimersByTimeAsync(3000);
    expect(await (await pending)?.text()).toBe("kept");
    jest.useRealTimers();
  });

  it("static cache-first (a miss fetched and kept, a failure not kept); the manifest network-first with the copy offline; the API passes", async () => {
    let calls = 0;
    let online = true;
    const { worker } = setup(async (input) => {
      calls += 1;
      if (!online) throw new Error("offline");
      const url = typeof input === "string" ? input : input.url;
      return url.includes("missing") ? new Response("", { status: 404 }) : new Response(`body:${url}`);
    });
    const a = new Request(`${ORIGIN}/_next/static/a.js`);
    expect(await (await worker.respond(a))?.text()).toBe(`body:${ORIGIN}/_next/static/a.js`);
    expect(await (await worker.respond(a))?.text()).toBe(`body:${ORIGIN}/_next/static/a.js`);
    expect(calls).toBe(1);
    expect((await worker.respond(new Request(`${ORIGIN}/fonts/missing.ttf`)))).toBeDefined();
    const m = new Request(`${ORIGIN}/manifest.webmanifest`);
    expect(await (await worker.respond(m))?.text()).toContain("manifest");
    online = false;
    expect(await (await worker.respond(m))?.text()).toContain("manifest");
    await expect(worker.respond(new Request(`${ORIGIN}/manifest.webmanifest?x`)) as Promise<Response>).rejects.toThrow("offline");
    expect(worker.respond(new Request(`${ORIGIN}/api/v1/auth/verify`))).toBeNull();
    expect(worker.respond(new Request(`${ORIGIN}/field`, { method: "POST", body: "x" }))).toBeNull();
  });

  it("install: the shell and each referenced static file — or a failed install; activate: old cf-* caches gone, claim on the first install only", async () => {
    const files: Record<string, Response> = {};
    const { worker, caches, deps } = setup(async (input) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "/field") return html('<script src="/_next/static/a.js"></script><link href="/fonts/f.ttf">');
      return files[url] ?? new Response("x");
    });
    await worker.install();
    expect([...(await caches.open(staticCache("v1"))).entries.keys()].sort()).toEqual([`${ORIGIN}/_next/static/a.js`, `${ORIGIN}/fonts/f.ttf`]);
    expect((await caches.open(shellCache("v1"))).entries.size).toBe(1);
    await worker.activate();
    expect(deps.claimed).toBe(1);

    const next = setup(async () => html(""), "v2");
    next.caches.stores = caches.stores;
    await caches.open("other-app");
    await next.worker.activate();
    expect((await next.caches.keys()).sort()).toEqual(["other-app"]);
    expect(next.deps.claimed).toBe(0);

    files["/_next/static/a.js"] = new Response("", { status: 500 });
    const failing = setup(async (input) => {
      const url = typeof input === "string" ? input : input.url;
      return url === "/field" ? html('<script src="/_next/static/a.js"></script>') : (files[url] as Response);
    });
    await expect(failing.worker.install()).rejects.toThrow("static /_next/static/a.js 500");
    const down = setup(async () => new Response("", { status: 502 }));
    await expect(down.worker.install()).rejects.toThrow("shell 502");
  });

  it("SKIP_WAITING updates on the user's word only; Background Sync only asks an open page to run", async () => {
    const { worker, deps, posted } = setup(async () => html(""));
    await worker.message({ type: "OTHER" });
    await worker.message(null);
    expect(deps.skipped).toBe(0);
    await worker.message({ type: "SKIP_WAITING" });
    expect(deps.skipped).toBe(1);
    await worker.sync();
    expect(posted).toEqual([{ type: "cf-sync" }]);
  });
});

describe("P22-10b — the generated public/sw.js", () => {
  const root = path.join(__dirname, "../../../..");
  it("is current, imports and exports nothing, never evaluates code, and parses as a classic script", () => {
    expect(execFileSync(process.execPath, [path.join(root, "scripts/build-sw.mjs"), "--check"], { encoding: "utf8" })).toContain("is current");
    const code = readFileSync(path.join(root, "public/sw.js"), "utf8");
    const executable = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(executable).not.toMatch(/\bimport\b|\bexport\b|importScripts|\beval\(|new Function/);
    expect(code).not.toContain("__CF_VERSION__");
    expect(() => new vm.Script(code)).not.toThrow();
  });

  it("wires its handlers when it runs as a service worker", async () => {
    const listeners: Record<string, (e: unknown) => void> = {};
    const context = vm.createContext({
      registration: {},
      location: { origin: ORIGIN },
      caches: new MemoryCaches(),
      fetch: async () => html(""),
      skipWaiting: async () => undefined,
      setTimeout,
      clients: { claim: async () => undefined, matchAll: async () => [] },
      addEventListener: (type: string, fn: (e: unknown) => void) => {
        listeners[type] = fn;
      },
      URL,
      Response,
      Request,
    });
    vm.runInContext(readFileSync(path.join(root, "public/sw.js"), "utf8"), context);
    expect(Object.keys(listeners).sort()).toEqual(["activate", "fetch", "install", "message", "sync"]);
    const waited: Promise<unknown>[] = [];
    listeners["message"]?.({ data: { type: "SKIP_WAITING" }, waitUntil: (p: Promise<unknown>) => waited.push(p) });
    listeners["sync"]?.({ waitUntil: (p: Promise<unknown>) => waited.push(p) });
    let responded = false;
    listeners["fetch"]?.({ request: new Request(`${ORIGIN}/api/v1/x`), respondWith: () => (responded = true) });
    expect(responded).toBe(false);
    listeners["fetch"]?.({ request: new Request(`${ORIGIN}/_next/static/x.js`), respondWith: (p: Promise<Response>) => waited.push(p.then(() => (responded = true))) });
    await Promise.all(waited);
    expect(responded).toBe(true);
  });
});

describe("P22-10b — the source's own wiring", () => {
  it("binds the handlers when its globals are a service worker's", async () => {
    const listeners: Record<string, (e: unknown) => void> = {};
    const posted: unknown[] = [];
    const g = globalThis as Record<string, unknown>;
    const saved = { registration: g["registration"], location: g["location"], caches: g["caches"], skipWaiting: g["skipWaiting"], clients: g["clients"], addEventListener: g["addEventListener"] };
    Object.assign(g, {
      registration: {},
      location: { origin: ORIGIN },
      caches: new MemoryCaches(),
      skipWaiting: async () => undefined,
      clients: { claim: async () => undefined, matchAll: async () => [{ postMessage: (m: unknown) => posted.push(m) }] },
      addEventListener: (type: string, fn: (e: unknown) => void) => {
        listeners[type] = fn;
      },
    });
    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- the module must load AFTER the worker globals exist, inside an isolated registry
        require("../sw");
      });
      const waited: Promise<unknown>[] = [];
      const waitUntil = (p: Promise<unknown>) => waited.push(p.catch(() => undefined));
      listeners["install"]?.({ waitUntil });
      listeners["activate"]?.({ waitUntil });
      listeners["sync"]?.({ waitUntil });
      listeners["message"]?.({ data: { type: "SKIP_WAITING" }, waitUntil });
      listeners["fetch"]?.({ request: new Request(`${ORIGIN}/api/v1/x`), respondWith: () => undefined });
      await Promise.all(waited);
      expect(posted).toEqual([{ type: "cf-sync" }]);
      expect(Object.keys(listeners).sort()).toEqual(["activate", "fetch", "install", "message", "sync"]);
    } finally {
      Object.assign(g, saved);
    }
  });
});

