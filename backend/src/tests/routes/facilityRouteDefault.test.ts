/**
 * P21-09 — G-10 of docs/SECURITY/15 § 11 (spec MEMORY/specs/P19-04-client-facilities.md § 7.7;
 * AM-12): the route layer is deny-by-default for a facility-BOUND principal.
 *
 * Over EVERY route of every route module (loaded, not listed), as a bound HEALTHCARE ADMIN:
 *  - an unmarked route answers 403 `FACILITY_ROUTE_REFUSED` — with an IDENTICAL body for a valid
 *    and an invalid id (the gate runs before any parameter is read, AM-12);
 *  - a marked route passes (a `selfParam` route only with the caller's own id);
 *  - the same routes pass untouched for an unbound principal, the super admin and a system task
 *    (FT-39: nothing changes for anyone else);
 *  - with no index registered every bound request is refused; a path no route matches passes
 *    (Express answers 404).
 * The gate is the exact function tenantContextMiddleware calls; the index is the routers mounted
 * as they are in the app.
 */
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { loadRouteChains, type RouteChain } from "../fixtures/routeChains";
import { registerRouteIndex, resolveRoute, type RouterLike } from "../../utils/routeTable";
import { FACILITY_ACCESSIBLE_ROUTES } from "../../constants/facilityAccess";
import type { TenantContextStore } from "../../middlewares/tenantContext.middleware";
import type * as GateModule from "../../middlewares/facilityRouteGate.middleware";

const routes: RouteChain[] = loadRouteChains();
// eslint-disable-next-line @typescript-eslint/no-require-imports -- after the route modules (the gate's own imports are not routes)
const { facilityRouteGate, FACILITY_ROUTE_REFUSED } = require("../../middlewares/facilityRouteGate.middleware") as typeof GateModule;

const USER = "11111111-1111-4111-8111-111111111111";
const VALID = "22222222-2222-4222-8222-222222222222";
const INVALID = "not-a-uuid";

const bound: TenantContextStore = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as TenantContextStore["tenantId"],
  isSuperAdmin: false,
  isSystemTask: false,
  userId: USER,
  clientFacilityId: "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1" as NonNullable<TenantContextStore["clientFacilityId"]>,
  facilityBound: true,
};

// The routers, each mounted under its own prefix, as the app mounts them.
const routers = [...new Set(routes.map((r) => r.router))];
const root = express.Router();
const fileByRouter = new Map<unknown, string>();
routers.forEach((router, i) => {
  root.use(`/m${String(i)}`, router as express.Router);
  fileByRouter.set(router, (routes.find((r) => r.router === router) as RouteChain).file);
});
const index = { root: root as unknown as RouterLike, fileOf: (r: unknown): string | null => fileByRouter.get(r) ?? null };

/** A concrete path for a route pattern: every parameter `value`, optional groups taken, wildcards one segment. */
const concrete = (pattern: string, value: string): string =>
  pattern.replace(/\{([^}]*)\}/g, "$1").replace(/\*\w*/g, "x").replace(/:(\w+)/g, value);

interface Outcome {
  passed: boolean;
  status?: number;
  body?: unknown;
}

const gate = (context: TenantContextStore, method: string, url: string): Outcome => {
  const out: Outcome = { passed: false };
  const req = { method, originalUrl: url, url } as unknown as Request;
  const res = {
    status(code: number) {
      out.status = code;
      return this;
    },
    json(body: unknown) {
      out.body = body;
      return this;
    },
  } as unknown as Response;
  facilityRouteGate(context, req, res, (() => {
    out.passed = true;
  }) as NextFunction);
  return out;
};

const urlOf = (route: RouteChain, value: string): string => `/m${String(routers.indexOf(route.router))}${concrete(route.path, value)}`;

beforeAll(() => {
  registerRouteIndex(index);
});

afterAll(() => {
  registerRouteIndex(null);
});

describe("G-10 — every mounted route, as a bound principal", () => {
  it("loads the route table (the walk works)", () => {
    expect(routes.length).toBeGreaterThan(400);
  });

  it("every unmarked route answers 403 FACILITY_ROUTE_REFUSED, identical for a valid and an invalid id", () => {
    const leaks: string[] = [];
    for (const route of routes) {
      const url = urlOf(route, VALID);
      const resolved = resolveRoute(index.root, route.method, url, index.fileOf);
      // A shadowed route resolves to the route Express runs; that one is the one judged.
      const judged = resolved ?? { file: route.file, key: route.key };
      const marker = judged.file ? FACILITY_ACCESSIBLE_ROUTES[judged.file]?.[judged.key] : undefined;
      if (marker) {
        continue;
      }
      const valid = gate(bound, route.method, url);
      const invalid = gate(bound, route.method, urlOf(route, INVALID));
      if (valid.passed || valid.status !== 403 || (valid.body as { code?: unknown }).code !== FACILITY_ROUTE_REFUSED) {
        leaks.push(`${route.file} ${route.key}`);
      }
      if (route.path.includes(":") && JSON.stringify(valid) !== JSON.stringify(invalid)) {
        leaks.push(`${route.file} ${route.key} (the answer depends on the id)`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("every marked route passes — a selfParam route only for the caller's own id", () => {
    const marked = routes.filter((r) => FACILITY_ACCESSIBLE_ROUTES[r.file]?.[r.key]);
    expect(marked.length).toBe(Object.values(FACILITY_ACCESSIBLE_ROUTES).reduce((n, entries) => n + Object.keys(entries).length, 0));
    for (const route of marked) {
      const entry = FACILITY_ACCESSIBLE_ROUTES[route.file]?.[route.key];
      expect([route.key, gate(bound, route.method, urlOf(route, USER)).passed]).toEqual([route.key, true]);
      if (entry?.selfParam) {
        expect([route.key, gate(bound, route.method, urlOf(route, VALID)).status]).toEqual([route.key, 403]);
      }
    }
  });

  it("nothing changes for an unbound principal, the super admin or a system task (FT-39)", () => {
    const others: TenantContextStore[] = [
      { ...bound, facilityBound: false, clientFacilityId: null },
      { ...bound, isSuperAdmin: true },
      { ...bound, isSystemTask: true },
      { tenantId: null, isSuperAdmin: false, isSystemTask: false },
    ];
    for (const context of others) {
      expect(routes.filter((r) => !gate(context, r.method, urlOf(r, VALID)).passed).map((r) => r.key)).toEqual([]);
    }
  });

  it("HEAD is judged as the GET it runs; an unknown path passes to Express's 404; no index refuses", () => {
    const head = routes.find((r) => r.file === "api/session.route.ts" && r.key === "GET /mine") as RouteChain;
    expect(gate(bound, "HEAD", urlOf(head, VALID)).passed).toBe(true);
    expect(gate(bound, "GET", "/no-such-mount/at-all").passed).toBe(true);
    expect(gate(bound, "GET", `${urlOf(head, VALID)}?x=1#f`).passed).toBe(true);
    registerRouteIndex(null);
    try {
      expect(gate(bound, "GET", urlOf(head, VALID))).toMatchObject({ passed: false, status: 403 });
      // A router the index cannot name a file for: its routes refuse a bound principal (fail closed).
      registerRouteIndex({ root: index.root, fileOf: () => null });
      expect(gate(bound, "GET", urlOf(head, VALID))).toMatchObject({ passed: false, status: 403 });
      // A request with no url at all reads as "/" (no route there).
      expect(facilityRouteGate.length).toBe(4);
      expect(gate(bound, "GET", "")).toMatchObject({ passed: true });
    } finally {
      registerRouteIndex(index);
    }
  });
});
