/**
 * `GET /ipm/sessions?unsigned=…` — the field app's "to sign" list: the CALLER's signable reports
 * (submitted, effective, not imported, performed by the caller — the rules of
 * ipmSignature.service) with no performer signature (`true`) or with one (`false`).
 *  - another performer's report, a superseded, voided or imported one never appears;
 *  - the tenant and facility hooks still apply: a bound F1 caller sees only F1, another tenant's
 *    reports never appear, and a `clientFacilityId` narrows;
 *  - a value that is not a boolean is a 400; no caller (a system path) lists nothing.
 *
 * REAL: the router's chain, controller, service, models and the tenant + facility hooks over
 * memoryDb (fixtures/ipmSeed). Synthetic data only.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as SessionsRoute from "../../routes/api/ipmSessions.route";
import type * as Service from "../../services/ipmSession.service";
import { IPM, seedIpmWorld, submittedSession, type IpmWorld } from "../fixtures/ipmSeed";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const sessions = jest.requireActual<typeof SessionsRoute>("../../routes/api/ipmSessions.route");
const service = jest.requireActual<typeof Service>("../../services/ipmSession.service");

const SUPERSEDED = "5e550000-0000-4000-8000-0000000006f1";
const VOIDED = "5e550000-0000-4000-8000-0000000007f1";
const IMPORTED = "5e550000-0000-4000-8000-0000000008f1";
const BOUND_S = "5e550000-0000-4000-8000-0000000009f1";

let world: IpmWorld;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
  mdb.seed("InspectionSession", [
    submittedSession(SUPERSEDED, world.tenantA, IPM.F1, IPM.D1, world.staff.id, { supersededById: IPM.S1 }),
    submittedSession(VOIDED, world.tenantA, IPM.F1, IPM.D1, world.staff.id, { status: "voided" }),
    submittedSession(IMPORTED, world.tenantA, IPM.F2, IPM.D2, world.staff.id, { legacyKey: "TST000002|2025-01-01" }),
    submittedSession(BOUND_S, world.tenantA, IPM.F1, IPM.D1, IPM.BOUND),
  ]);
  // The staff technician has signed S1 (F1) as its performer; S2 (F2) awaits its signature.
  mdb.seed("InspectionSessionSignature", {
    id: "5e55bbbb-0000-4000-8000-0000000000f1",
    tenantId: world.tenantA,
    clientFacilityId: IPM.F1,
    sessionId: IPM.S1,
    kind: "performer",
    signerId: world.staff.id,
    signerSnapshot: { name: "Teknisi Sintetis", role: "TECHNICIAN", organisation: "Lab Sintetis" },
    meaning: "authorship",
    authMethod: "password",
    documentHash: "a".repeat(64),
    signedAt: new Date("2026-10-01T04:00:00Z"),
  });
});

const list = async (principal: Principal, query: Record<string, unknown>): Promise<{ status: number; ids: string[] }> => {
  as(principal);
  const res = (await call(sessions, "GET", "/", { query, routeFile: "api/ipmSessions.route.ts" })) as { status: number; body: { data?: { id: string }[] | null } };
  return { status: res.status, ids: (res.body.data ?? []).map((r) => r.id).sort() };
};

describe("GET /ipm/sessions?unsigned", () => {
  it("true: the caller's own signable reports without its performer signature; false: those with one", async () => {
    expect(await list(world.staff, { unsigned: "true" })).toEqual({ status: 200, ids: [IPM.S2] });
    expect(await list(world.staff, { unsigned: "false" })).toEqual({ status: 200, ids: [IPM.S1] });
  });

  it("narrows with clientFacilityId; a bound F1 caller gets only its own F1 report; another tenant only its own", async () => {
    expect(await list(world.staff, { unsigned: "true", clientFacilityId: IPM.F1 })).toEqual({ status: 200, ids: [] });
    expect(await list(world.staff, { unsigned: "true", clientFacilityId: IPM.F2 })).toEqual({ status: 200, ids: [IPM.S2] });
    expect(await list(world.bound, { unsigned: "true" })).toEqual({ status: 200, ids: [BOUND_S] });
    expect(await list(world.other, { unsigned: "true" })).toEqual({ status: 200, ids: [IPM.SB] });
  });

  it("a caller that has signed nothing: false lists nothing (and true, above, every signable report of its own)", async () => {
    expect(await list(world.bound, { unsigned: "false" })).toEqual({ status: 200, ids: [] });
  });

  it("a value that is not a boolean is a 400", async () => {
    expect((await list(world.staff, { unsigned: "maybe" })).status).toBe(400);
  });

  it("without a person (a key reaching the service) the filter lists nothing", async () => {
    const page = await service.listSessions(null, { page: 1, limit: 25, sort: "performedAt", unsigned: true });
    expect(page.rows).toEqual([]);
  });
});
