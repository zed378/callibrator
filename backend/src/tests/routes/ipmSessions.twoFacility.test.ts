/**
 * P21-03 — C-03 … C-07 (P18-04 plan; spec P19-02 § 17; threat model § 11 G-07): the IPM session
 * routes marked facility-accessible (N-2 reads, N-3 draft writes), each with its two-facility
 * suite. One tenant with SELF, F1 and F2; a HEALTHCARE TECHNICIAN bound to F1; provider staff
 * unbound.
 *
 * For every `:id` route: F2's session (or device) answers the bound F1 principal 404, identical to a
 * missing id, nothing written; F1's is reached. The list holds F1's session and not F2's. Plus: a
 * create naming F2's device is the same 404 (C-05) and a create in F1 is stamped F1; another F1
 * technician's draft is 403 (C-07).
 *
 * @two-facility api/ipmSessions.route.ts GET /:sessionId
 * @two-facility api/ipmSessions.route.ts PATCH /:sessionId
 * @two-facility api/ipmSessions.route.ts PUT /:sessionId/results
 * @two-facility api/ipmSessions.route.ts POST /:sessionId/discard
 * @two-facility api/ipmSessions.route.ts POST /:sessionId/corrections
 * @two-facility api/calibrationDevices.route.ts GET /:calibrationDeviceId/ipm-sessions
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as FacilitySuite from "../fixtures/twoFacilitySuite";
import type { FacilitySuiteContext } from "../fixtures/twoFacilitySuite";
import type { Principal } from "../fixtures/routeClient";
import type * as SessionsRoute from "../../routes/api/ipmSessions.route";
import type * as DevicesRoute from "../../routes/api/calibrationDevices.route";
import { IPM, seedIpmWorld, type IpmWorld } from "../fixtures/ipmSeed";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoFacilitySuite } = jest.requireActual<typeof FacilitySuite>("../fixtures/twoFacilitySuite");
const sessions = jest.requireActual<typeof SessionsRoute>("../../routes/api/ipmSessions.route");
const devices = jest.requireActual<typeof DevicesRoute>("../../routes/api/calibrationDevices.route");

const ROUTE_FILE = "api/ipmSessions.route.ts";

interface Ctx extends FacilitySuiteContext {
  readonly bound: Principal;
  readonly unbound: Principal;
}
let ctx: Ctx;
let world: IpmWorld;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
  ctx = { bound: world.bound, unbound: world.staff };
});

const id = (key: keyof typeof IPM) => (): string => IPM[key];

twoFacilitySuite({
  module: "ipm-sessions",
  router: sessions,
  routeFile: ROUTE_FILE,
  mdb,
  context: () => ctx,
  routes: [
    { key: "GET /:sessionId", method: "GET", path: (s) => `/${s}`, ownId: id("S1"), foreignId: id("S2"), unboundToo: true },
    {
      key: "PATCH /:sessionId",
      method: "PATCH",
      path: (s) => `/${s}`,
      ownId: id("DRAFT1"),
      foreignId: id("DRAFT2"),
      body: { revision: 0, notes: "Synthetic note" },
      writes: ["InspectionSession", "AuditLog"],
    },
    {
      key: "PUT /:sessionId/results",
      method: "PUT",
      path: (s) => `/${s}/results`,
      ownId: id("DRAFT1"),
      foreignId: id("DRAFT2"),
      body: { revision: 0, results: [] },
      writes: ["InspectionSession", "AuditLog"],
    },
    {
      key: "POST /:sessionId/discard",
      method: "POST",
      path: (s) => `/${s}/discard`,
      ownId: id("DRAFT1"),
      foreignId: id("DRAFT2"),
      writes: ["InspectionSession", "AuditLog"],
    },
    {
      key: "POST /:sessionId/corrections",
      method: "POST",
      path: (s) => `/${s}/corrections`,
      ownId: id("S1"),
      foreignId: id("S2"),
      body: { reason: "Synthetic correction" },
      ownStatus: 201,
      writes: ["InspectionSession", "InspectionResult", "AuditLog"],
      unboundToo: true,
    },
  ],
  lists: [{ key: "GET /", path: "/", ownId: id("S1"), foreignId: id("S2") }],
});

twoFacilitySuite({
  module: "calibration-devices",
  router: devices,
  routeFile: "api/calibrationDevices.route.ts",
  mdb,
  context: () => ctx,
  routes: [{ key: "GET /:calibrationDeviceId/ipm-sessions", method: "GET", path: (d) => `/${d}/ipm-sessions`, ownId: id("D1"), foreignId: id("D2"), unboundToo: true }],
});

interface Body {
  data?: Record<string, unknown> | null;
  message?: string;
  code?: string;
}
const send = (principal: Principal, method: string, url: string, body: unknown = {}, query: Record<string, unknown> = {}): Promise<{ status: number; body: Body }> => {
  as(principal);
  return call(sessions, method, url, { body, query, routeFile: ROUTE_FILE }) as Promise<{ status: number; body: Body }>;
};

describe("ipm-sessions — the bound rules (C-05, C-07)", () => {
  it("C-05: a bound create naming another facility's device is the 404 of a missing device, and nothing is written", async () => {
    const before = mdb.committed().length;
    const foreign = await send(world.bound, "POST", "/", { deviceId: IPM.D2 });
    const missing = await send(world.bound, "POST", "/", { deviceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" });
    expect([foreign.status, foreign.body]).toEqual([404, missing.body]);
    expect(mdb.committed().slice(before)).toEqual([]);
  });

  it("a bound create for its own facility's device is stamped with that facility and the caller", async () => {
    // DRAFT1 is the bound technician's open draft of D1: discard it first (one per technician).
    await send(world.bound, "POST", `/${IPM.DRAFT1}/discard`);
    const res = await send(world.bound, "POST", "/", { deviceId: IPM.D1 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ clientFacilityId: IPM.F1, createdBy: IPM.BOUND, performedBy: IPM.BOUND, status: "draft", revision: 0 });
  });

  it("C-07: another technician of the same facility editing the draft is 403, and nothing is written", async () => {
    const before = mdb.committed().length;
    const res = await send(world.bound2, "PATCH", `/${IPM.DRAFT1}`, { revision: 0, notes: "Not mine" });
    expect([res.status, res.body.message]).toEqual([403, "Only the technician who started this IPM can edit it."]);
    expect(mdb.committed().slice(before)).toEqual([]);
  });

  it("a bound technician cannot discard another technician's draft (only an unbound administrator may)", async () => {
    const res = await send(world.bound2, "POST", `/${IPM.DRAFT1}/discard`);
    expect(res.status).toBe(403);
  });

  it("a foreign facility named in the list query answers an empty page to a bound caller", async () => {
    const res = await send(world.bound, "GET", "/", {}, { clientFacilityId: IPM.F2 });
    expect([res.status, res.body.data]).toEqual([200, []]);
  });
});
