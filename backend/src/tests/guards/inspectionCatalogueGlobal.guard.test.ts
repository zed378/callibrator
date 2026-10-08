/**
 * P21-01 — inspectionCatalogueGlobal.guard (ADR-125 § 4, § 7; spec
 * MEMORY/specs/P19-01-inspection-catalogue.md § 8.1, § 13): the GLOBAL catalogue's writes are the
 * platform operator's, route by route — the shape of rolesGlobal.d16.
 *
 * WHY. The catalogue's models have no tenant column, so the deny-by-default hooks do nothing for
 * them: a write route a tenant principal could reach would change every tenant's checklists. The
 * route gate is the only write control.
 *
 * HOW, over the REAL chains of every mounted route (fixtures/routeChains):
 *  1. every route of deviceTypes.route and ipm.route that is not a catalogue READ and not a tenant
 *     PROPOSAL route is on MUTATING below — and MUTATING names nothing else: a new operator route
 *     fails the inventory until it is reviewed here;
 *  2. each MUTATING route carries `superAdminOnly` (and `denyApiKey`), and that gate answers a tenant
 *     administrator holding every menu with 403 and lets the super admin through;
 *  3. the catalogue reads carry the G-2 read gate and nothing that writes.
 *
 * Fail-before: `bites` plants a copy of a MUTATING chain without `superAdminOnly` and a mutating
 * route missing from the inventory — each is reported.
 */
import { loadRouteChains, gateOf, type RouteChain } from "../fixtures/routeChains";
import type * as AuthModule from "../../middlewares/auth.middleware";

const routes: RouteChain[] = loadRouteChains();
const auth = jest.requireActual<typeof AuthModule>("../../middlewares/auth.middleware");

const FILES = new Set(["api/deviceTypes.route.ts", "api/ipm.route.ts"]);

/** The catalogue reads (G-2) — open to any catalogue reader. */
const READS = new Set([
  "api/deviceTypes.route.ts GET /",
  "api/deviceTypes.route.ts GET /:deviceTypeId",
  "api/ipm.route.ts GET /templates/published",
  "api/ipm.route.ts GET /template-versions/:versionId",
]);

/** The operator's routes: every one superAdminOnly (reads of drafts and the library included). */
const MUTATING = new Set([
  "api/deviceTypes.route.ts POST /",
  "api/deviceTypes.route.ts PATCH /:deviceTypeId",
  "api/deviceTypes.route.ts POST /:deviceTypeId/retire",
  "api/deviceTypes.route.ts POST /:deviceTypeId/reactivate",
  "api/ipm.route.ts GET /item-definitions",
  "api/ipm.route.ts GET /item-definitions/:itemDefinitionId",
  "api/ipm.route.ts POST /item-definitions",
  "api/ipm.route.ts PATCH /item-definitions/:itemDefinitionId",
  "api/ipm.route.ts POST /item-definitions/:itemDefinitionId/retire",
  "api/ipm.route.ts GET /templates",
  "api/ipm.route.ts POST /templates",
  "api/ipm.route.ts POST /templates/:templateId/retire",
  "api/ipm.route.ts POST /templates/:templateId/reactivate",
  "api/ipm.route.ts POST /templates/:templateId/versions",
  "api/ipm.route.ts GET /template-versions",
  "api/ipm.route.ts PUT /template-versions/:versionId/items",
  "api/ipm.route.ts PATCH /template-versions/:versionId",
  "api/ipm.route.ts POST /template-versions/:versionId/publish",
  "api/ipm.route.ts POST /template-versions/:versionId/discard",
]);

const id = (r: RouteChain): string => `${r.file} ${r.key}`;
const isProposal = (r: RouteChain): boolean => r.path.startsWith("/template-proposals");
const gates = (r: RouteChain): string[] => r.chain.map((fn) => gateOf(fn)?.gate ?? "").filter(Boolean);

/** What is wrong with the catalogue's routes (empty: nothing). */
const violations = (all: readonly RouteChain[], mutating: ReadonlySet<string>): string[] => {
  const mine = all.filter((r) => FILES.has(r.file) && !isProposal(r));
  const out: string[] = [];
  for (const r of mine) {
    if (READS.has(id(r))) {
      const read = r.chain.map((fn) => gateOf(fn)).find((g) => g?.gate === "dynamicAccess");
      if (JSON.stringify(read?.args) !== JSON.stringify([["calibration", "ipm", "ipm-templates"], "read"])) {
        out.push(`${id(r)}: a catalogue read must carry dynamicAccess(["calibration","ipm","ipm-templates"], "read")`);
      }
      continue;
    }
    if (!mutating.has(id(r))) {
      out.push(`${id(r)}: not on the MUTATING inventory — review it and add it`);
    }
    if (!gates(r).includes("superAdminOnly") || !gates(r).includes("denyApiKey")) {
      out.push(`${id(r)}: an operator route without superAdminOnly and denyApiKey`);
    }
  }
  for (const key of mutating) {
    if (!mine.some((r) => id(r) === key)) {
      out.push(`${key}: on MUTATING but no such route`);
    }
  }
  return out;
};

describe("inspectionCatalogueGlobal.guard — the catalogue's writes are the operator's", () => {
  it("every operator route is on the inventory and carries superAdminOnly + denyApiKey; the reads carry the G-2 gate", () => {
    expect(violations(routes, MUTATING)).toEqual([]);
  });

  it("superAdminOnly answers a tenant administrator with every menu 403 and lets the super admin through", () => {
    const run = (user: unknown): { status: number | null; next: boolean } => {
      const result = { status: null as number | null, next: false };
      const res = {
        status: (code: number) => {
          result.status = code;
          return { json: () => undefined };
        },
      };
      (auth.superAdminOnly as unknown as (q: unknown, s: unknown, n: () => void) => void)({ user }, res, () => {
        result.next = true;
      });
      return result;
    };
    expect(run({ role: { name: "TENANT_ADMIN", roleLevel: 9 }, permissions: "*" })).toEqual({ status: 403, next: false });
    expect(run({ role: { name: "SUPER_ADMIN", roleLevel: 10 } })).toEqual({ status: null, next: true });
  });

  it("bites (fail-before): a planted chain without superAdminOnly, and a route missing from the inventory", () => {
    const publish = routes.find((r) => id(r) === "api/ipm.route.ts POST /template-versions/:versionId/publish") as RouteChain;
    const planted: RouteChain = { ...publish, key: "POST /template-versions/:versionId/planted", path: "/template-versions/:versionId/planted", chain: publish.chain.filter((fn) => gateOf(fn)?.gate !== "superAdminOnly") };
    const found = violations([...routes, planted], MUTATING);
    expect(found).toEqual([
      "api/ipm.route.ts POST /template-versions/:versionId/planted: not on the MUTATING inventory — review it and add it",
      "api/ipm.route.ts POST /template-versions/:versionId/planted: an operator route without superAdminOnly and denyApiKey",
    ]);
    const stale = new Set([...MUTATING, "api/ipm.route.ts DELETE /templates/:templateId"]);
    expect(violations(routes, stale)).toEqual(["api/ipm.route.ts DELETE /templates/:templateId: on MUTATING but no such route"]);
    const unread = routes.map((r) => (id(r) === "api/deviceTypes.route.ts GET /" ? { ...r, chain: [] } : r));
    expect(violations(unread, MUTATING)).toHaveLength(1);
  });
});
