/**
 * twoTenantSuite — the two tests every tenant-owned `:id` route gets.
 *
 * For each route in the table:
 *
 *  1. "another tenant's record answers 404, identical to one that does not
 *     exist, and nothing is written" — as the OTHER tenant's principal, the
 *     owner's id and a never-existing id (probeCrossTenant): status 404, equal
 *     bodies (ids masked), every table unchanged, no committed write.
 *  2. "the owning tenant reaches it" — the same request as the owner succeeds
 *     (the positive control: without it a 404 could be a broken fixture), and
 *     a mutation commits a write (`writes: [...models]` names the tables that
 *     must receive one).
 *
 * Route options: `ownerStatus` (default: any 2xx), `body`, `query`,
 * `headers`, `principal` / `ownerPrincipal` (override the context's),
 * `missingId`, `ownerPath` (when the owner's request needs a different path),
 * `before` (run before each request pair).
 */
import { as, call, probeCrossTenant } from "./routeClient";
import type { Principal, RouteResponse } from "./routeClient";
import type { MemoryDb } from "./memoryDb";

export const MISSING_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

/** What a suite needs from its test file's beforeEach. */
export interface SuiteContext {
  owner: Principal;
  other: Principal;
}

export interface TwoTenantRoute<C extends SuiteContext = SuiteContext> {
  readonly key: string;
  readonly method: string;
  readonly path: (id: string) => string;
  readonly id: (ctx: C) => string;
  readonly body?: unknown;
  readonly query?: Record<string, unknown>;
  readonly headers?: Record<string, string>;
  /** P21-02b: a multipart route's `req.file` (multer doubled), made fresh for each request. */
  readonly file?: () => unknown;
  readonly writes?: readonly string[];
  readonly ownerStatus?: number;
  readonly principal?: (ctx: C) => Principal;
  readonly ownerPrincipal?: (ctx: C) => Principal;
  readonly missingId?: string;
  readonly ownerPath?: (id: string) => string;
  readonly before?: (ctx: C) => unknown;
}

export interface SuiteOptions<C extends SuiteContext> {
  readonly module: string;
  readonly router: unknown;
  readonly mdb: MemoryDb;
  readonly context: () => C;
  readonly routes: readonly TwoTenantRoute<C>[];
}

export const twoTenantSuite = <C extends SuiteContext>({ module, router, mdb, context, routes }: SuiteOptions<C>): void => {
  describe.each(routes.map((r) => [r.key, r] as const))(`${module} %s — two tenants`, (_key, route) => {
    const request = (id: string, path: (id: string) => string = route.path): Promise<RouteResponse> =>
      call(router, route.method, path(id), {
        body: typeof route.body === "function" ? (route.body as () => unknown)() : (route.body ?? {}),
        query: route.query ?? {},
        headers: route.headers ?? {},
        ...(route.file ? { file: route.file() } : {}),
      });

    it("another tenant's record answers 404, identical to one that does not exist, and nothing is written", async () => {
      const ctx = context();
      await route.before?.(ctx);
      as(route.principal ? route.principal(ctx) : ctx.other);
      const probe = await probeCrossTenant(mdb, (id) => request(id), route.id(ctx), route.missingId ?? MISSING_ID);

      expect(probe.foreign.status).toBe(404);
      expect(probe.foreign.body).toEqual(probe.missing.body);
      expect(probe.tablesAfter).toEqual(probe.tablesBefore);
      expect(probe.committed).toEqual([]);
    });

    it("the owning tenant reaches it", async () => {
      const ctx = context();
      await route.before?.(ctx);
      as(route.ownerPrincipal ? route.ownerPrincipal(ctx) : ctx.owner);
      const res = await request(route.id(ctx), route.ownerPath);

      if (route.ownerStatus !== undefined) {
        expect({ status: res.status, body: res.body }).toEqual({ status: route.ownerStatus, body: res.body });
      } else {
        expect([res.status >= 200 && res.status < 300, res.status, res.body]).toEqual([true, res.status, res.body]);
      }
      for (const model of route.writes ?? []) {
        expect(mdb.committed().map((w) => w.model)).toContain(model);
      }
    });
  });
};
