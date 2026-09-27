/**
 * twoTenantSuite — the two tests every tenant-owned `:id` route gets.
 *
 * For each route in the table:
 *
 *  1. "another tenant's <thing> answers 404, identical to one that does not
 *     exist, and nothing is written" — as the OTHER tenant's principal, the
 *     owner's id and a never-existing id (probeCrossTenant): status 404, equal
 *     bodies (ids masked), every table unchanged, no committed write.
 *  2. "the owning tenant reaches it" — the same request as the owner succeeds
 *     (the positive control: without it a 404 could be a broken fixture), and
 *     a mutation commits a write (`writes: [...models]` names the tables that
 *     must receive one).
 *
 * Usage (inside a test file wired as in vendor.twoTenant.test.js):
 *
 *   twoTenantSuite({
 *     module: "risk",
 *     router,
 *     mdb,
 *     context: () => ctx,                 // { owner, other } principals, filled in beforeEach
 *     routes: [
 *       { key: "GET /:id", method: "GET", path: (id) => `/${id}`, id: () => RISK_A },
 *       { key: "PUT /:id", method: "PUT", path: (id) => `/${id}`, id: () => RISK_A,
 *         body: { title: "x" }, writes: ["Risk"] },
 *     ],
 *   });
 *
 * Route options: `ownerStatus` (default: any 2xx), `body`, `query`,
 * `headers`, `principal` / `ownerPrincipal` (override the context's),
 * `missingId`, `ownerPath` (when the owner's request needs a different path,
 * e.g. a second id), `before` (async hook run before each request pair).
 */

const { as, call, probeCrossTenant } = require("./routeClient");

const MISSING_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const twoTenantSuite = ({ module, router, mdb, context, routes }) => {
  describe.each(routes.map((r) => [r.key, r]))(`${module} %s — two tenants`, (key, route) => {
    const request = (id, extra = {}) =>
      call(router, route.method, (extra.path || route.path)(id), {
        body: typeof route.body === "function" ? route.body() : route.body || {},
        query: route.query || {},
        headers: route.headers || {},
      });

    it("another tenant's record answers 404, identical to one that does not exist, and nothing is written", async () => {
      const ctx = context();
      if (route.before) {await route.before(ctx);}
      as(route.principal ? route.principal(ctx) : ctx.other);
      const probe = await probeCrossTenant(mdb, (id) => request(id), route.id(ctx), route.missingId || MISSING_ID);

      expect(probe.foreign.status).toBe(404);
      expect(probe.foreign.body).toEqual(probe.missing.body);
      expect(probe.tablesAfter).toEqual(probe.tablesBefore);
      expect(probe.committed).toEqual([]);
    });

    it("the owning tenant reaches it", async () => {
      const ctx = context();
      if (route.before) {await route.before(ctx);}
      as(route.ownerPrincipal ? route.ownerPrincipal(ctx) : ctx.owner);
      const res = await request(route.id(ctx), { path: route.ownerPath });

      if (route.ownerStatus) {
        expect({ status: res.status, body: res.body }).toEqual({ status: route.ownerStatus, body: res.body });
      } else {
        expect([res.status >= 200 && res.status < 300, res.status, res.body]).toEqual([true, res.status, res.body]);
      }
      for (const model of route.writes || []) {
        expect(mdb.committed().map((w) => w.model)).toContain(model);
      }
    });
  });
};

module.exports = { twoTenantSuite, MISSING_ID };
