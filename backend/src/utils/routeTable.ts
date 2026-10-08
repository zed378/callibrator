/**
 * The mounted route table, resolved the way Express dispatches a request (P21-09; ADR-124 Am. 2
 * § 8; spec MEMORY/specs/P19-04-client-facilities.md § 7.7; AM-12).
 *
 * WHY. The facility route gate runs from `tenantContextMiddleware` — inside `auth`, before any
 * `validate` reads a parameter — and 33 routers mount `auth` with `router.use(auth)`, where
 * `req.route` is not set yet. So the gate must know, BEFORE Express gets there, which route
 * Express WILL dispatch. Matching the request against the marked patterns alone would let a
 * shadowing route through (`GET /calibration-devices/stats` registered before `GET /:id`).
 *
 * HOW. `resolveRoute` walks the router stack in registration order with Express's OWN matchers
 * (router 2's `layer.matchers` — pure functions; `layer.match` is never called, so no layer
 * state Express is using is touched): a mounted router consumes its prefix (the same
 * separator rule as router's `trimPrefix`) and is entered; plain middleware is passed over; the
 * FIRST route layer whose path matches and whose route handles the method (HEAD as GET) is the
 * answer. `null` means Express would answer 404 (or a non-route middleware answers).
 *
 * The index is registered once at boot (`registerRouteIndex`, index.ts, after every router is
 * mounted) with the app's router and the map from each mounted router to its route file; a route
 * test registers the router it drives. Parity with Express is PROVED, not assumed:
 * tests/middlewares/facilityRouteIndex.parity.test.ts dispatches real requests through Express
 * (shadowing cases included) and asserts this resolves each to the route Express ran.
 *
 * Named exports only (ADR-087 Am. 15).
 */

import fs from "fs";
import path from "path";

/** A path matcher of router 2: the matched prefix and parameters, or false. */
type Matcher = (path: string) => false | { path: string; params: Record<string, unknown> };

/** A route, as far as this module reads it. */
interface RouteLike {
  readonly path: unknown;
  readonly methods: Readonly<Record<string, boolean | undefined>>;
}

/** A router layer, as far as this module reads it. */
interface LayerLike {
  readonly matchers?: readonly Matcher[];
  readonly slash?: boolean;
  readonly route?: RouteLike;
  readonly handle?: unknown;
}

/** A router (an Express app's router, or `express.Router()`), as far as this module reads it. */
export interface RouterLike {
  readonly stack: readonly LayerLike[];
}

/** Where a route was found: its route file (relative to src/routes, e.g. `api/auth.route.ts`) and its key. */
export interface ResolvedRoute {
  readonly file: string | null;
  /** `"METHOD /path"` — the route's own path inside its router, as routeGateExemptions keys it. */
  readonly key: string;
  /** The route's own path parameters, decoded by Express's matcher (a `selfParam` check reads them). */
  readonly params: Readonly<Record<string, unknown>>;
}

/** The registered index: the root to walk and the route file of each mounted router. */
export interface RouteIndex {
  readonly root: RouterLike;
  readonly fileOf: (router: unknown) => string | null;
}

/** Whether a layer's handle is a router (Express 5: a function with a `stack`). */
const isRouter = (handle: unknown): handle is RouterLike =>
  typeof handle === "function" && Array.isArray((handle as { stack?: unknown }).stack);

/** Router 2's `Route#_handlesMethod`: `_all`, else the method, HEAD falling back to GET. */
const handlesMethod = (route: RouteLike, method: string): boolean => {
  if (route.methods["_all"]) {
    return true;
  }
  const name = method.toLowerCase();
  return Boolean(route.methods[name] ?? (name === "head" ? route.methods["get"] : false));
};

/** What a layer matches on `path`, or null (router 2's `Layer#match`, without its state). */
const matchOf = (layer: LayerLike, path: string): { path: string; params: Record<string, unknown> } | null => {
  if (layer.slash) {
    return { path: "", params: {} };
  }
  for (const matcher of layer.matchers ?? []) {
    const match = matcher(path);
    if (match) {
      return match;
    }
  }
  return null;
};

/**
 * The route Express will dispatch `method path` to, or null.
 *
 * @param root - the router to start from
 * @param method - the request method
 * @param path - the request's pathname (no query)
 * @param fileOf - the route file of a mounted router
 * @param file - the route file of `root` (for the recursion)
 * @returns the route, or null
 */
export const resolveRoute = (
  root: RouterLike,
  method: string,
  path: string,
  fileOf: (router: unknown) => string | null,
  file: string | null = null,
): ResolvedRoute | null => {
  for (const layer of root.stack) {
    const match = matchOf(layer, path);
    if (!match) {
      continue;
    }
    if (layer.route) {
      if (handlesMethod(layer.route, method)) {
        const verb = method.toUpperCase() === "HEAD" && !layer.route.methods["head"] ? "GET" : method.toUpperCase();
        return { file, key: `${verb} ${String(layer.route.path)}`, params: match.params };
      }
      continue;
    }
    const prefix = match.path;
    if (!isRouter(layer.handle)) {
      continue;
    }
    // router's trimPrefix: the prefix must end on a path separator.
    const next = path[prefix.length];
    if (next && next !== "/") {
      continue;
    }
    const rest = path.slice(prefix.length);
    const found = resolveRoute(layer.handle, method, rest.startsWith("/") ? rest : `/${rest}`, fileOf, fileOf(layer.handle) ?? file);
    if (found) {
      return found;
    }
  }
  return null;
};

let registered: RouteIndex | null = null;

/** Register the index the facility route gate resolves against (index.ts at boot; a route test). */
export const registerRouteIndex = (index: RouteIndex | null): void => {
  registered = index;
};

/** The registered index, or null (the gate then refuses every bound request — deny by default). */
export const routeIndex = (): RouteIndex | null => registered;

/** The route files under `routesDir` (`api/*.route.*`, `internal/*.route.*`), as routeGateExemptions keys them. */
const routeFilesIn = (routesDir: string): { key: string; path: string }[] =>
  ["api", "internal"].flatMap((dir) => {
    const full = path.join(routesDir, dir);
    return fs.existsSync(full)
      ? fs
        .readdirSync(full)
        .filter((name) => /\.route\.(ts|js)$/.test(name) && !name.endsWith(".d.ts"))
        .map((name) => ({ key: `${dir}/${name.replace(/\.js$/, ".ts")}`, path: path.join(full, name) }))
      : [];
  });

/**
 * The route file of every mounted router: each route module under `routesDir` is required (at
 * boot they are all loaded already, so this reads the module cache) and its exported router is
 * mapped to its key. A `.js` file (the compiled dist/) keys as its `.ts` source.
 *
 * @param routesDir - src/routes (or dist's)
 * @param load - the module loader (require)
 * @returns router → route file
 */
export const routeFileMap = (routesDir: string, load: (file: string) => unknown): Map<unknown, string> => {
  const map = new Map<unknown, string>();
  for (const file of routeFilesIn(routesDir)) {
    const exported = load(file.path);
    const router = isRouter(exported) ? exported : (exported as { default?: unknown } | null)?.default;
    if (isRouter(router)) {
      map.set(router, file.key);
    }
  }
  return map;
};

/**
 * Register the app's index (index.ts, once every router is mounted): the app's router and the
 * route file of each mounted router.
 *
 * @param app - the Express app (Express 5: `app.router`)
 */
export const registerAppRouteIndex = (app: { readonly router: unknown }): void => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the route modules, already loaded by index.ts: the module cache answers
  const files = routeFileMap(path.join(__dirname, "..", "routes"), (file) => require(file) as unknown);
  registerRouteIndex({ root: app.router as RouterLike, fileOf: (router) => files.get(router) ?? null });
};
