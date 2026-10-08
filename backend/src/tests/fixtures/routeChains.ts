/**
 * routeChains — every route of every route module, with the middleware chain Express runs for it
 * and the gates in that chain (P21-09: G-09 facilityAccessibleRoutes.guard and G-10
 * facilityRouteDefault; the technique of routes/routePermissionGuard.p604).
 *
 * The gate FACTORIES (`dynamicAccess`, `rbac`, `checkRoleLevel`, `abac`) are tagged with their
 * arguments BEFORE any route module loads, so a chain says which gate it carries and with what.
 * `loadRouteChains()` must therefore be called before anything else requires a route module.
 * Every router-level `use` in src/routes is path-less (p604 asserts it), so it precedes every
 * route of its router.
 */
import fs from "fs";
import path from "path";

/** A tagged gate: the factory's name and its arguments. */
export interface GateTag {
  readonly gate: string;
  readonly args: readonly unknown[];
}

/** One route: its file (as routeGateExemptions keys it), method, path, key and chain. */
export interface RouteChain {
  readonly file: string;
  readonly method: string;
  readonly path: string;
  readonly key: string;
  readonly chain: readonly unknown[];
  readonly router: unknown;
}

const GATE_TAG = Symbol.for("callibrator.p2109.gate");
const SRC = path.join(__dirname, "..", "..");
const ROUTES_DIR = path.join(SRC, "routes");

type Factory = (...args: unknown[]) => Record<symbol, unknown>;
type MutableModule = Record<string, unknown>;

let tagged = false;
let direct = new Map<unknown, string>();

/** Tag the gate factories (idempotent). */
const tagFactories = (): void => {
  if (tagged) {
    return;
  }
  tagged = true;
  /* eslint-disable @typescript-eslint/no-require-imports -- the factories are replaced before any route module loads */
  const dynamicAccess = require("../../middlewares/dynamicAccess.middleware") as MutableModule;
  const rbac = require("../../middlewares/rbac.middleware") as MutableModule;
  const abac = require("../../middlewares/abac.middleware") as MutableModule;
  const auth = require("../../middlewares/auth.middleware") as MutableModule;
  /* eslint-enable @typescript-eslint/no-require-imports */
  const tag = (mod: MutableModule, name: string): void => {
    const real = mod[name] as Factory;
    mod[name] = (...args: unknown[]) => {
      const middleware = real(...args);
      middleware[GATE_TAG] = { gate: name, args } satisfies GateTag;
      return middleware;
    };
  };
  tag(dynamicAccess, "dynamicAccess");
  tag(rbac, "rbac");
  tag(rbac, "checkRoleLevel");
  tag(abac, "abac");
  direct = new Map<unknown, string>([
    [auth["superAdminOnly"], "superAdminOnly"],
    [auth["denyApiKey"], "denyApiKey"],
    [auth["auth"], "auth"],
    [auth["optionalAuth"], "optionalAuth"],
  ]);
};

/** The gate a middleware is, if any. */
export const gateOf = (fn: unknown): GateTag | null => {
  if (typeof fn === "function" && (fn as unknown as Record<symbol, unknown>)[GATE_TAG]) {
    return (fn as unknown as Record<symbol, GateTag>)[GATE_TAG] as GateTag;
  }
  const name = direct.get(fn);
  return name ? { gate: name, args: [] } : null;
};

const isRouter = (value: unknown): value is { stack: { route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] }; handle: unknown }[] } =>
  typeof value === "function" && Array.isArray((value as { stack?: unknown }).stack);

const routeFiles = (): { key: string; full: string }[] =>
  ["api", "internal"].flatMap((dir) =>
    fs
      .readdirSync(path.join(ROUTES_DIR, dir))
      .filter((name) => name.endsWith(".route.ts"))
      .map((name) => ({ key: `${dir}/${name}`, full: path.join(ROUTES_DIR, dir, name) })),
  );

/**
 * Every route of every route module, in registration order.
 *
 * @returns the routes
 */
export const loadRouteChains = (): RouteChain[] => {
  tagFactories();
  const out: RouteChain[] = [];
  for (const file of routeFiles()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the route modules, loaded after the factories are tagged
    const exported = require(file.full) as unknown;
    const routers = isRouter(exported) ? [exported] : Object.values((exported ?? {}) as Record<string, unknown>).filter(isRouter);
    for (const router of routers) {
      const before: unknown[] = [];
      for (const layer of router.stack) {
        if (!layer.route) {
          before.push(layer.handle);
          continue;
        }
        const chain = [...before, ...layer.route.stack.map((s) => s.handle)];
        for (const method of Object.keys(layer.route.methods)) {
          out.push({ file: file.key, method: method.toUpperCase(), path: layer.route.path, key: `${method.toUpperCase()} ${layer.route.path}`, chain, router });
        }
      }
    }
  }
  return out;
};
