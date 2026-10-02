/**
 * P9-25 (ADR-103) — every mounted route is in the published contract, and what
 * a code-first operation says about its gate is what the router really runs.
 *
 * WHY
 *
 * The published document is `*.openapi.ts` (code-first) ∪ the remaining
 * `@swagger` JSDoc. A route added with neither is invisible to every client and
 * to the generated frontend types; nothing failed the build for it. And a
 * code-first operation DECLARES `permission` — a declaration that could say
 * `vendors:read` while the chain says `vendors:update`. That would make
 * `x-permission` a lie with a green build.
 *
 * HOW (modelled on twoTenantRoutes.guard and routePermissionGuard.p604)
 *
 *  1. The gate factories (`dynamicAccess`, `rbac`) are wrapped BEFORE any
 *     router loads, so each middleware they build carries its arguments. The
 *     real middleware is returned; the chains walked are the production chains.
 *  2. Every route module under `src/routes` (.js and .ts, not `*.openapi.ts`,
 *     not `.d.ts`) is required and its stack walked; each route is resolved to
 *     its mount(s) from `index.js` (and `docs/apiDocs.ts` for the reference).
 *  3. The document is built by the SAME function `npm run openapi:generate`
 *     uses (`scripts/openapi/build.ts#buildDocument`).
 *  4. Each mounted route must have an operation, or be listed in
 *     `openapiRoutes.undocumented.json` — the routes that had no JSDoc when
 *     P9-25 landed. That list may only SHRINK: a documented entry must be
 *     deleted, and a new undocumented route fails.
 *  5. Each code-first operation must name a live route, and its `x-permission`
 *     and `security` must equal the route chain's gate and authentication.
 *  6. `x-rate-limit` must state what `index.js`'s default limiter is.
 *
 * The checks are pure functions, tested in both directions at the bottom.
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "../../config/env";
import type * as BuildModule from "../../../scripts/openapi/build";
import type * as OperationModule from "../../docs/openapi/operation";

type Handler = (...args: unknown[]) => unknown;
type Json = Record<string, unknown>;

const SRC = path.join(__dirname, "..", "..");
const ROUTES_DIR = path.join(SRC, "routes");
const INDEX_FILE = path.join(SRC, "..", "index.ts");
const API_DOCS_FILE = path.join(SRC, "docs", "apiDocs.ts");
const UNDOCUMENTED_FILE = path.join(__dirname, "openapiRoutes.undocumented.json");

// ---------------------------------------------------------------------------
// 1. Tag the gate factories before any router loads.
// ---------------------------------------------------------------------------

const GATE = Symbol.for("callibrator.p925.gate");

interface GateTag {
  readonly gate: "dynamicAccess" | "rbac";
  readonly args: readonly unknown[];
}

const tagFactory = (mod: Record<string, unknown>, name: "dynamicAccess" | "rbac"): void => {
  const real = mod[name] as (...args: unknown[]) => Handler;
  mod[name] = (...args: unknown[]): Handler => {
    const middleware = real(...args);
    Object.defineProperty(middleware, GATE, { value: { gate: name, args } satisfies GateTag });
    return middleware;
  };
};
tagFactory(jest.requireActual<Record<string, unknown>>("../../middlewares/dynamicAccess.middleware"), "dynamicAccess");
tagFactory(jest.requireActual<Record<string, unknown>>("../../middlewares/rbac.middleware"), "rbac");

interface AuthModule {
  auth: Handler;
  optionalAuth: Handler;
  superAdminOnly: Handler;
}
const authModule = jest.requireActual<AuthModule>("../../middlewares/auth.middleware");

// The builder is loaded after the tags: it requires no router, but keep the order obvious.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the factories are tagged
const { buildDocument } = require("../../../scripts/openapi/build") as typeof BuildModule;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the same values the generator publishes
const { DEFAULT_RATE_LIMIT, toOpenApiPath } = require("../../docs/openapi/operation") as typeof OperationModule;

// ---------------------------------------------------------------------------
// 2. Enumerate the mounted routes.
// ---------------------------------------------------------------------------

/** One route as it is served. */
export interface ServedRoute {
  /** Route module relative to src/routes, no extension. */
  readonly file: string;
  readonly method: string;
  /** The OpenAPI path it is served at (mount + router path). */
  readonly path: string;
  readonly chain: readonly unknown[];
}

const listFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listFiles(full);
    }
    return /\.(js|ts)$/.test(entry.name) && !/\.(openapi|d)\.ts$/.test(entry.name) ? [full] : [];
  });

const stripExtension = (file: string): string => file.replace(/\.(js|ts)$/, "");

/** Mount prefixes per route module and export, read from index.js and docs/apiDocs.ts. */
const mountsFrom = (sources: readonly string[]): Map<string, Map<string, string[]>> => {
  const mounts = new Map<string, Map<string, string[]>>();
  const vars = new Map<string, { rel: string; exportName: string }>();
  const bind = (names: string, rel: string): void => {
    mounts.set(rel, mounts.get(rel) ?? new Map<string, string[]>());
    if (names.startsWith("{")) {
      for (const name of names.replace(/[{}\s]/g, "").split(",").filter(Boolean)) {
        vars.set(name, { rel, exportName: name });
      }
    } else {
      vars.set(names, { rel, exportName: "default" });
    }
  };
  for (const source of sources) {
    for (const m of source.matchAll(/const\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*require\(["']\.\/src\/routes\/([^"']+?)(?:\.js)?["']\)/g)) {
      bind(m[1] ?? "", m[2] ?? "");
    }
    for (const m of source.matchAll(/import\s+(\{[^}]*\})\s+from\s+["']\.\.\/routes\/([^"']+?)["']/g)) {
      bind(m[1] ?? "", m[2] ?? "");
    }
    for (const m of source.matchAll(/app\.use\(\s*(?:["']([^"']*)["']\s*,\s*)?([A-Za-z_$][\w$]*)\s*\)/g)) {
      const target = vars.get(m[2] ?? "");
      if (target === undefined) {
        continue;
      }
      const byExport = mounts.get(target.rel) ?? new Map<string, string[]>();
      byExport.set(target.exportName, [...(byExport.get(target.exportName) ?? []), m[1] ?? ""]);
      mounts.set(target.rel, byExport);
    }
  }
  return mounts;
};

interface LayerLike {
  readonly route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] };
  readonly handle: unknown;
}

const isRouter = (value: unknown): value is { stack: LayerLike[] } =>
  typeof value === "function" && Array.isArray((value as { stack?: unknown }).stack);

const servedRoutes = (): ServedRoute[] => {
  const mounts = mountsFrom([fs.readFileSync(INDEX_FILE, "utf8"), fs.readFileSync(API_DOCS_FILE, "utf8")]);
  const out: ServedRoute[] = [];
  for (const full of listFiles(ROUTES_DIR)) {
    const file = stripExtension(path.relative(ROUTES_DIR, full).split(path.sep).join("/"));
    const exported = jest.requireActual<object>(full);
    const routers: [string, unknown][] = isRouter(exported)
      ? [["default", exported]]
      : Object.entries(exported);
    for (const [exportName, router] of routers) {
      if (!isRouter(router)) {
        continue;
      }
      const prefixes = mounts.get(file)?.get(exportName) ?? [];
      const before: unknown[] = [];
      for (const layer of router.stack) {
        if (layer.route === undefined) {
          before.push(layer.handle);
          continue;
        }
        const chain = [...before, ...layer.route.stack.map((s) => s.handle)];
        for (const method of Object.keys(layer.route.methods)) {
          for (const prefix of prefixes) {
            out.push({ file, method, path: toOpenApiPath(prefix, layer.route.path), chain });
          }
        }
      }
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// The checks — pure.
// ---------------------------------------------------------------------------

/** The router that serves the reference UI and the document (routes/internal/apiDocs.route.ts). */
const REFERENCE_ROUTER = "internal/apiDocs.route";

const gateOf = (chain: readonly unknown[]): Json | null => {
  for (const fn of chain) {
    if (fn === authModule.superAdminOnly) {
      return { gate: "superAdminOnly" };
    }
    const tag = (fn as Record<symbol, GateTag | undefined> | null)?.[GATE];
    if (tag?.gate === "dynamicAccess") {
      const [resource, action] = tag.args;
      return { gate: "dynamicAccess", resource, action };
    }
    if (tag?.gate === "rbac") {
      return { gate: "rbac", roles: tag.args[0] ?? [] };
    }
  }
  return null;
};

const isAuthenticated = (chain: readonly unknown[]): boolean =>
  chain.some((fn) => fn === authModule.auth || fn === authModule.optionalAuth);

/** What `x-permission` publishes, reduced to the fields the chain can confirm. */
const declaredGate = (permission: unknown): Json | null => {
  if (permission === undefined || permission === null || typeof permission !== "object") {
    return null;
  }
  const p = permission as Json;
  if (p["gate"] === "dynamicAccess") {
    return { gate: "dynamicAccess", resource: p["resource"], action: p["action"] };
  }
  if (p["gate"] === "rbac") {
    return { gate: "rbac", roles: p["roles"] };
  }
  // P9-21: "authenticated" declares that the chain carries NO gate factory, only `auth`
  // (security confirms the authentication). Declared on a gated chain, it mismatches.
  if (p["gate"] === "authenticated") {
    return null;
  }
  return { gate: p["gate"] };
};

/**
 * Compare the served routes with the document.
 *
 * @returns undocumented route keys, and problems (each a full sentence)
 */
export const checkDocument = (
  routes: readonly ServedRoute[],
  doc: { paths: Record<string, Record<string, Json>> },
): { undocumented: string[]; problems: string[] } => {
  const undocumented: string[] = [];
  const problems: string[] = [];
  const served = new Map<string, ServedRoute>();
  for (const route of routes) {
    const key = `${route.method.toUpperCase()} ${route.path}`;
    served.set(key, route);
    if (route.file === REFERENCE_ROUTER) {
      continue; // the reference serves the contract; it is not part of it (checked on its own below)
    }
    const op = doc.paths[route.path]?.[route.method];
    if (op === undefined) {
      undocumented.push(key);
      continue;
    }
    const source = op["x-source"];
    if (typeof source !== "string" || !source.startsWith("code-first")) {
      continue; // JSDoc: its x-permission is not generated, nothing to confirm
    }
    const chainGate = gateOf(route.chain);
    const published = declaredGate(op["x-permission"]);
    if (JSON.stringify(chainGate) !== JSON.stringify(published)) {
      problems.push(
        `${key}: x-permission publishes ${JSON.stringify(published)} but the router's chain carries ${JSON.stringify(chainGate)}`,
      );
    }
    const security = op["security"];
    const secured = Array.isArray(security) && security.length > 0;
    if (secured !== isAuthenticated(route.chain)) {
      problems.push(`${key}: security says ${secured ? "authenticated" : "public"}, the chain ${isAuthenticated(route.chain) ? "authenticates" : "does not"}`);
    }
  }
  for (const [p, methods] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const source = op["x-source"];
      if (typeof source === "string" && source.startsWith("code-first") && !served.has(`${method.toUpperCase()} ${p}`)) {
        problems.push(`${method.toUpperCase()} ${p}: documented code-first, but no mounted route serves it`);
      }
    }
  }
  return { undocumented: undocumented.sort(), problems };
};

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

let routes: ServedRoute[] = [];
let doc: { paths: Record<string, Record<string, Json>> } = { paths: {} };

beforeAll(() => {
  routes = servedRoutes();
  doc = buildDocument() as unknown as typeof doc;
});

const PINNED_FILE = JSON.parse(fs.readFileSync(UNDOCUMENTED_FILE, "utf8")) as { routes: string[]; inFlight: string[] };
const PINNED = { routes: [...PINNED_FILE.routes, ...PINNED_FILE.inFlight] };

describe("P9-25 — the published contract covers every mounted route and cannot misstate a gate", () => {
  it("walked the tree (a scan that finds nothing is not a pass)", () => {
    expect(routes.length).toBeGreaterThan(350);
    expect(routes.some((r) => r.file === "api/vendor.route")).toBe(true);
    expect(routes.some((r) => r.file === "internal/apiDocs.route")).toBe(true);
  });

  it("every code-first operation's x-permission and security equal the mounted chain", () => {
    expect(checkDocument(routes, doc).problems).toEqual([]);
    const codeFirst = Object.values(doc.paths)
      .flatMap((m) => Object.values(m))
      .filter((op) => String(op["x-source"]).startsWith("code-first"));
    expect(codeFirst.length).toBeGreaterThanOrEqual(6);
  });

  it("no route is undocumented beyond the pinned pre-P9-25 list, and no pinned entry is stale", () => {
    // To re-derive after documenting routes: delete the entries the failure names as documented.
    const { undocumented } = checkDocument(routes, doc);
    const dump = env("P925_DUMP");
    if (dump !== undefined) {
      fs.writeFileSync(dump, JSON.stringify(undocumented, null, 2));
    }
    const fresh = undocumented.filter((k) => !PINNED.routes.includes(k));
    const stale = PINNED.routes.filter((k) => !undocumented.includes(k));
    expect({ undocumentedAndNotPinned: fresh, pinnedButNowDocumentedOrGone: stale }).toEqual({
      undocumentedAndNotPinned: [],
      pinnedButNowDocumentedOrGone: [],
    });
  });

  it("the API reference itself is served, gated, and documented as nothing it is not", () => {
    const docsRoutes = routes.filter((r) => r.file === "internal/apiDocs.route");
    expect(docsRoutes.map((r) => `${r.method.toUpperCase()} ${r.path}`).sort()).toEqual(
      [
        "GET /api/v1/docs",
        "GET /api/v1/docs/assets/init.js",
        "GET /api/v1/docs/assets/scalar.js",
        "GET /api/v1/docs/openapi.json",
        "GET /docs",
        "GET /docs.json",
        "GET /docs/assets/init.js",
        "GET /docs/assets/scalar.js",
        "GET /docs/openapi.json",
      ].sort(),
    );
    for (const r of docsRoutes) {
      expect([r.path, isAuthenticated(r.chain), gateOf(r.chain)]).toEqual([r.path, true, { gate: "rbac", roles: ["TENANT_ADMIN"] }]);
    }
  });

  it("x-rate-limit states index.js's default limiter", () => {
    const index = fs.readFileSync(INDEX_FILE, "utf8");
    const limiter = /const defaultLimiter = rateLimit\(\{([\s\S]*?)\n\}\);/.exec(index)?.[1] ?? "";
    expect(limiter).toContain("windowMs: WINDOW.FIFTEEN_MIN");
    expect(DEFAULT_RATE_LIMIT.windowSeconds).toBe(15 * 60);
    // P9-21: index.ts reads the environment through config/env (`env(name)` is `process.env[name]`).
    expect(limiter).toContain(`Number(env("${DEFAULT_RATE_LIMIT.overriddenBy}"))`);
    expect(limiter).toContain(`"production" ? ${String(DEFAULT_RATE_LIMIT.limitProduction)} : ${String(DEFAULT_RATE_LIMIT.limitOtherwise)}`);
    expect(limiter).toContain("standardHeaders: true");
    expect(index).toContain("app.use(defaultLimiter)");
  });

  describe("the check, in both directions", () => {
    const dyn = jest.requireActual<{ dynamicAccess: (...a: unknown[]) => Handler }>("../../middlewares/dynamicAccess.middleware");
    const chain = [authModule.auth, dyn.dynamicAccess("vendors", "read")];
    const route: ServedRoute = { file: "api/x.route", method: "get", path: "/api/v1/x", chain };
    const op = (extra: Json): Json => ({
      "x-source": "code-first: x",
      security: [{ bearerAuth: [] }],
      "x-permission": { gate: "dynamicAccess", resource: "vendors", action: "read", superAdmin: "bypasses" },
      ...extra,
    });

    it("passes a true declaration", () => {
      expect(checkDocument([route], { paths: { "/api/v1/x": { get: op({}) } } })).toEqual({ undocumented: [], problems: [] });
    });

    it("refuses an x-permission the chain does not carry", () => {
      const wrong = op({ "x-permission": { gate: "dynamicAccess", resource: "vendors", action: "delete" } });
      expect(checkDocument([route], { paths: { "/api/v1/x": { get: wrong } } }).problems[0]).toMatch(/x-permission publishes/);
    });

    it("refuses a public claim on an authenticated route", () => {
      const pub = op({ security: [] });
      expect(checkDocument([route], { paths: { "/api/v1/x": { get: pub } } }).problems.join()).toMatch(/security says public/);
    });

    it("reports a route with no operation, and a code-first operation with no route", () => {
      expect(checkDocument([route], { paths: {} }).undocumented).toEqual(["GET /api/v1/x"]);
      expect(checkDocument([], { paths: { "/api/v1/x": { get: op({}) } } }).problems[0]).toMatch(/no mounted route serves it/);
    });

    it("P9-21: passes an `authenticated` declaration on an auth-only chain, refuses it on a gated one", () => {
      const own: ServedRoute = { file: "api/x.route", method: "get", path: "/api/v1/x", chain: [authModule.auth] };
      const declared = op({ "x-permission": { gate: "authenticated", note: "the caller's own" } });
      expect(checkDocument([own], { paths: { "/api/v1/x": { get: declared } } }).problems).toEqual([]);
      expect(checkDocument([route], { paths: { "/api/v1/x": { get: declared } } }).problems[0]).toMatch(/x-permission publishes null/);
    });

    it("P9-21: refuses an `authenticated` declaration on a public chain (security says authenticated)", () => {
      const open: ServedRoute = { file: "api/x.route", method: "get", path: "/api/v1/x", chain: [] };
      const declared = op({ "x-permission": { gate: "authenticated", note: "x" } });
      expect(checkDocument([open], { paths: { "/api/v1/x": { get: declared } } }).problems.join()).toMatch(/security says authenticated/);
    });

    it("does not second-guess a JSDoc operation's gate (it publishes none)", () => {
      expect(checkDocument([route], { paths: { "/api/v1/x": { get: { responses: {} } } } })).toEqual({ undocumented: [], problems: [] });
    });

    it("reads rbac and superAdminOnly gates", () => {
      const rb = jest.requireActual<{ rbac: (r: string[]) => Handler }>("../../middlewares/rbac.middleware");
      expect(gateOf([rb.rbac(["TENANT_ADMIN"])])).toEqual({ gate: "rbac", roles: ["TENANT_ADMIN"] });
      expect(gateOf([authModule.superAdminOnly])).toEqual({ gate: "superAdminOnly" });
      expect(gateOf([authModule.auth])).toBeNull();
      expect(declaredGate({ gate: "superAdminOnly" })).toEqual({ gate: "superAdminOnly" });
      expect(declaredGate(undefined)).toBeNull();
    });
  });
});
