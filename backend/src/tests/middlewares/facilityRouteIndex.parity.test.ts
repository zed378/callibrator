/**
 * P21-09 — the route index resolves a request to the route EXPRESS dispatches (spec
 * MEMORY/specs/P19-04-client-facilities.md § 7.7; ADR-124 Am. 2, implication: "the parity test is
 * the only thing that keeps it true").
 *
 * PROVED, not assumed, over the REAL route table: every route module is loaded, every route's
 * handlers are replaced by a probe that answers which route ran, every router-level middleware
 * (`router.use(auth)` …) by a pass-through, and the routers are mounted at index.ts's mount
 * paths, in index.ts's order (several routers share `/api/v1/tenants`). Then a real HTTP request
 * per route goes through Express 5, and `resolveRoute` must name the route that answered —
 * shadowing included (`/stats` before `/:id`). Planted cases cover what the real table may not:
 * a static route shadowing a parameter route, a parameter route shadowing a later static one, a
 * method mismatch falling through to a later router at the same mount, HEAD as GET, a prefix that
 * does not end on a separator, a trailing slash, an encoded parameter.
 */
import fs from "fs";
import http from "http";
import path from "path";
import express from "express";
import type { AddressInfo } from "net";
import { loadRouteChains, type RouteChain } from "../fixtures/routeChains";
import { registerAppRouteIndex, registerRouteIndex, resolveRoute, routeFileMap, routeIndex, type RouterLike } from "../../utils/routeTable";

const routes: RouteChain[] = loadRouteChains();
const INDEX = fs.readFileSync(path.join(__dirname, "..", "..", "..", "index.ts"), "utf8");

/** index.ts's `const xRoutes = require("./src/routes/<dir>/<file>")` and `app.use("<mount>", xRoutes)`, in order. */
const mountTable = (): { mount: string; file: string }[] => {
  const files = new Map<string, string>();
  for (const m of INDEX.matchAll(/const (\w+) = require\("\.\/src\/routes\/(api|internal)\/([\w.]+)"\)/g)) {
    files.set(m[1] as string, `${m[2] as string}/${m[3] as string}.ts`);
  }
  const out: { mount: string; file: string }[] = [];
  for (const m of INDEX.matchAll(/app\.use\("([^"]+)",\s*(\w+)\)/g)) {
    const file = files.get(m[2] as string);
    if (file) {
      out.push({ mount: m[1] as string, file });
    }
  }
  return out;
};

interface Layer {
  route?: { stack: { handle: unknown }[]; path: string };
  handle: unknown;
}
interface RouterObj {
  stack: Layer[];
}

/** Replace every handler of `router` by a probe answering `file` + the route key, and every `use` by a pass-through. */
const probe = (router: RouterObj, file: string): void => {
  for (const layer of router.stack) {
    if (!layer.route) {
      layer.handle = (_req: unknown, _res: unknown, next: () => void): void => {
        next();
      };
      continue;
    }
    const routePath = layer.route.path;
    for (const step of layer.route.stack) {
      step.handle = (req: express.Request, res: express.Response): void => {
        const key = `${req.method === "HEAD" ? "GET" : req.method} ${routePath}`;
        res.setHeader("x-route", `${file}|${key}`);
        res.status(200).json({ file, key });
      };
    }
  }
};

const byFile = new Map<string, RouterObj>();
for (const r of routes) {
  byFile.set(r.file, r.router as RouterObj);
}

const app = express();
const mounts = mountTable();
const probed = new Set<RouterObj>();
for (const { mount, file } of mounts) {
  const router = byFile.get(file);
  if (!router) {
    continue;
  }
  if (!probed.has(router)) {
    probe(router, file);
    probed.add(router);
  }
  app.use(mount, router as unknown as express.Router);
}

// Planted shadowing cases (a router of this test, mounted after the real ones).
const planted = express.Router();
planted.get("/stats", (_req, res) => res.setHeader("x-route", "planted|GET /stats").json({}));
planted.get("/:id", (_req, res) => res.setHeader("x-route", "planted|GET /:id").json({}));
planted.get("/later", (_req, res) => res.setHeader("x-route", "planted|GET /later").json({}));
planted.post("/only-post", (_req, res) => res.setHeader("x-route", "planted|POST /only-post").json({}));
const plantedB = express.Router();
plantedB.get("/only-post", (_req, res) => res.setHeader("x-route", "plantedB|GET /only-post").json({}));
plantedB.all("/any", (req, res) => res.setHeader("x-route", `plantedB|${req.method} /any`).json({}));
app.use("/planted", planted);
app.use("/planted", plantedB);
app.use((_req, res) => res.status(404).setHeader("x-route", "none").json({}));

const files = routeFileMap(path.join(__dirname, "..", "..", "routes"), (file) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the same module instances loadRouteChains loaded
  return require(file) as unknown;
});
const fileOf = (router: unknown): string | null => {
  if (router === planted) {
    return "planted";
  }
  if (router === plantedB) {
    return "plantedB";
  }
  return files.get(router) ?? null;
};
const root = (app as unknown as { router: RouterLike }).router;

let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

const dispatched = async (method: string, url: string): Promise<string> => {
  const res = await fetch(`${base}${url}`, { method });
  return res.headers.get("x-route") ?? "none";
};
const resolved = (method: string, url: string): string => {
  const route = resolveRoute(root, method, url.split("?")[0] as string, fileOf);
  return route ? `${String(route.file)}|${route.key}` : "none";
};

const concrete = (pattern: string): string =>
  pattern.replace(/\{([^}]*)\}/g, "$1").replace(/\*\w*/g, "x").replace(/:(\w+)/g, "22222222-2222-4222-8222-222222222222");

describe("the route index resolves the route Express dispatches", () => {
  it("reads index.ts's mount table (the parse works)", () => {
    expect(mounts.length).toBeGreaterThan(50);
    expect(mounts).toContainEqual({ mount: "/api/v1/client-facilities", file: "api/clientFacilities.route.ts" });
  });

  it("every mounted route: the index names the route Express ran", async () => {
    const mismatches: string[] = [];
    for (const { mount, file } of mounts) {
      for (const route of routes.filter((r) => r.file === file && r.method !== "_ALL")) {
        const url = `${mount}${concrete(route.path)}`.replace(/\/+$/, "") || "/";
        const [express5, index] = [await dispatched(route.method, url), resolved(route.method, url)];
        if (express5 !== index) {
          mismatches.push(`${route.method} ${url}: express ${express5}, index ${index}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it.each([
    ["GET", "/planted/stats", "planted|GET /stats"],
    ["GET", "/planted/abc", "planted|GET /:id"],
    ["GET", "/planted/later", "planted|GET /:id"],
    ["GET", "/planted/only-post", "planted|GET /:id"],
    ["POST", "/planted/only-post", "planted|POST /only-post"],
    ["HEAD", "/planted/stats", "planted|GET /stats"],
    ["GET", "/planted/", "none"],
    ["GET", "/plantedx/stats", "none"],
    ["GET", "/planted/a%20b", "planted|GET /:id"],
    ["DELETE", "/planted/stats", "none"],
    ["DELETE", "/planted/any", "plantedB|DELETE /any"],
  ])("planted: %s %s → %s", async (method, url, expected) => {
    expect(await dispatched(method, url)).toBe(expected);
    expect(resolved(method, url)).toBe(expected);
  });

  it("a mount whose routers both miss falls through to the next router at that mount", async () => {
    // GET /only-post: `planted` has POST only — but `/:id` (GET) matches it first, as Express does.
    expect(await dispatched("PUT", "/planted/only-post")).toBe("none");
    expect(resolved("PUT", "/planted/only-post")).toBe("none");
  });
});

describe("resolveRoute and the index registration — the edges the real table does not reach", () => {
  const sub = Object.assign(() => undefined, { stack: [{ route: { path: "/x", methods: { get: true } }, matchers: [(p: string) => (p === "/x" ? { path: "/x", params: {} } : false)] }] });

  it("a prefix that does not end on a path separator is not entered (router's trimPrefix)", () => {
    const root: RouterLike = { stack: [{ matchers: [() => ({ path: "/ab", params: {} })], handle: sub }] };
    expect(resolveRoute(root, "GET", "/abc/x", () => null)).toBeNull();
    expect(resolveRoute(root, "GET", "/ab/x", () => null)).toEqual({ file: null, key: "GET /x", params: {} });
  });

  it("a layer without matchers matches nothing; a mounted router with no file keeps its parent's", () => {
    const root: RouterLike = { stack: [{ handle: sub }, { slash: true, handle: sub }] };
    expect(resolveRoute(root, "GET", "/x", () => null, "api/parent.route.ts")).toEqual({ file: "api/parent.route.ts", key: "GET /x", params: {} });
  });

  it("routeFileMap maps a router export, a `default` router export, and skips anything else", () => {
    const router = express.Router();
    const map = routeFileMap(path.join(__dirname, "..", "..", "routes"), (file) => {
      if (file.endsWith("auth.route.ts")) {
        return router;
      }
      if (file.endsWith("vendor.route.ts")) {
        return { default: sub };
      }
      return file.endsWith("health.route.ts") ? null : {};
    });
    expect([...map.values()].sort()).toEqual(["api/auth.route.ts", "api/vendor.route.ts"]);
    // A directory without api/ or internal/ maps nothing.
    expect(routeFileMap(path.join(__dirname, "..", "..", "docs"), () => router).size).toBe(0);
  });

  it("registerAppRouteIndex registers the app's router and the route files", () => {
    try {
      registerAppRouteIndex(app);
      const registered = routeIndex();
      expect(registered?.root).toBe(root);
      expect(registered?.fileOf(byFile.get("api/auth.route.ts"))).toBe("api/auth.route.ts");
      expect(registered?.fileOf(planted)).toBeNull();
    } finally {
      registerRouteIndex(null);
    }
  });
});
