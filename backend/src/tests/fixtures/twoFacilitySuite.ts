/**
 * twoFacilitySuite — the tests every facility-ACCESSIBLE route gets (P21-09e; spec
 * MEMORY/specs/P19-04-client-facilities.md § 17 G-07; threat model § 11 G-07, G-08).
 *
 * One tenant with facilities F1 and F2; a principal BOUND to F1. For each `:id` route:
 *
 *  1. "another facility's record answers 404, identical to one that does not exist, and nothing is
 *     written" — the F1 principal asks for F2's record and for a never-existing id (ids masked):
 *     status 404, equal bodies, every table unchanged, no committed write;
 *  2. "its own facility's record is reached" — the positive control: the same request for the F1
 *     record succeeds as the bound principal (without it, a 404 could be a refused route);
 *  3. (optional) "an unbound principal of the tenant reaches it too" — marking a route for bound
 *     users must not narrow it for provider staff (FT-39).
 *
 * For each LIST route (`list: true`): the bound principal's answer holds F1's id and not F2's.
 *
 * The route file is passed so the facility route gate finds the route on FACILITY_ACCESSIBLE_ROUTES
 * (an unmarked route answers 403 and fails the positive control). Mark each covered route in the
 * test file's header: `@two-facility <route file> <METHOD> <path>` — tests/guards/
 * twoFacilityRoutes.guard holds every marked `:id` route to one.
 */
import { as, call, probeCrossTenant } from "./routeClient";
import type { Principal, RouteResponse } from "./routeClient";
import type { MemoryDb } from "./memoryDb";

export const MISSING_FACILITY_ROW = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

/** What a suite needs from its test file's beforeEach. */
export interface FacilitySuiteContext {
  /** A principal bound to F1 (its `clientFacilityId` set). */
  readonly bound: Principal;
  /** An unbound principal of the same tenant (provider staff), for the FT-39 check. */
  readonly unbound?: Principal;
}

export interface TwoFacilityRoute<C extends FacilitySuiteContext = FacilitySuiteContext> {
  readonly key: string;
  readonly method: string;
  readonly path: (id: string) => string;
  /** F1's record (the bound principal's own facility). */
  readonly ownId: (ctx: C) => string;
  /** F2's record of the same tenant. */
  readonly foreignId: (ctx: C) => string;
  readonly body?: unknown;
  readonly query?: Record<string, unknown>;
  readonly ownStatus?: number;
  /** Tables the positive control must write (a mutation). */
  readonly writes?: readonly string[];
  /** Also call it as the unbound principal and expect success (FT-39). */
  readonly unboundToo?: boolean;
  readonly before?: (ctx: C) => unknown;
}

export interface TwoFacilityList<C extends FacilitySuiteContext = FacilitySuiteContext> {
  readonly key: string;
  readonly path: string;
  readonly query?: Record<string, unknown>;
  readonly ownId: (ctx: C) => string;
  readonly foreignId: (ctx: C) => string;
}

export interface TwoFacilityOptions<C extends FacilitySuiteContext> {
  readonly module: string;
  readonly router: unknown;
  readonly routeFile: string;
  readonly baseUrl?: string;
  readonly mdb: MemoryDb;
  readonly context: () => C;
  readonly routes?: readonly TwoFacilityRoute<C>[];
  readonly lists?: readonly TwoFacilityList<C>[];
}

const ok = (res: RouteResponse): boolean => res.status >= 200 && res.status < 300;

export const twoFacilitySuite = <C extends FacilitySuiteContext>({
  module,
  router,
  routeFile,
  baseUrl,
  mdb,
  context,
  routes = [],
  lists = [],
}: TwoFacilityOptions<C>): void => {
  const send = (method: string, url: string, body: unknown, query: Record<string, unknown>): Promise<RouteResponse> =>
    call(router, method, url, { body, query, routeFile, ...(baseUrl ? { baseUrl } : {}) });

  if (routes.length > 0) {
    describe.each(routes.map((r) => [r.key, r] as const))(`${module} %s — two facilities`, (_key, route) => {
      const request = (id: string): Promise<RouteResponse> =>
        send(route.method, route.path(id), typeof route.body === "function" ? (route.body as () => unknown)() : (route.body ?? {}), route.query ?? {});

      it("another facility's record answers 404, identical to one that does not exist, and nothing is written", async () => {
        const ctx = context();
        await route.before?.(ctx);
        as(ctx.bound);
        const probe = await probeCrossTenant(mdb, request, route.foreignId(ctx), MISSING_FACILITY_ROW);
        expect(probe.foreign.status).toBe(404);
        expect(probe.foreign.body).toEqual(probe.missing.body);
        expect(probe.tablesAfter).toEqual(probe.tablesBefore);
        expect(probe.committed).toEqual([]);
      });

      it("its own facility's record is reached by the bound principal", async () => {
        const ctx = context();
        await route.before?.(ctx);
        as(ctx.bound);
        const res = await request(route.ownId(ctx));
        if (route.ownStatus !== undefined) {
          expect({ status: res.status, body: res.body }).toEqual({ status: route.ownStatus, body: res.body });
        } else {
          expect([ok(res), res.status, res.body]).toEqual([true, res.status, res.body]);
        }
        for (const model of route.writes ?? []) {
          expect(mdb.committed().map((w) => w.model)).toContain(model);
        }
      });

      if (route.unboundToo) {
        it("an unbound principal of the tenant reaches it too (FT-39)", async () => {
          const ctx = context();
          await route.before?.(ctx);
          if (!ctx.unbound) {
            throw new Error("twoFacilitySuite: unboundToo needs ctx.unbound");
          }
          as(ctx.unbound);
          const res = await request(route.ownId(ctx));
          expect([ok(res), res.status, res.body]).toEqual([true, res.status, res.body]);
        });
      }
    });
  }

  if (lists.length > 0) {
    describe.each(lists.map((l) => [l.key, l] as const))(`${module} %s — two facilities (list)`, (_key, list) => {
      it("the bound principal's list holds its facility's record and not another facility's", async () => {
        const ctx = context();
        as(ctx.bound);
        const res = await send("GET", list.path, {}, list.query ?? {});
        expect(res.status).toBe(200);
        const text = JSON.stringify((res.body as { data?: unknown }).data ?? null);
        expect({ own: text.includes(list.ownId(ctx)), foreign: text.includes(list.foreignId(ctx)) }).toEqual({ own: true, foreign: false });
      });
    });
  }
};
