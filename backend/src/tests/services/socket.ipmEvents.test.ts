/**
 * G-19 (docs/SECURITY/15 § 11; AM-19, AM-20; P19-02 § 17, P19-06 § 16; built by P21-04): every IPM
 * realtime event — `ipm:submitted`, `ipm:signed`, `ipm:voided` — goes through `emitForRow` to the
 * tenant room and the SESSION's facility room only (named from the row, never from the actor), after
 * the commit; F2's event never reaches F1's room; the payload names ids and the report number, never a
 * person.
 *
 * REAL: the routes, the services, emitForRow, the models and the hooks over memoryDb; the socket
 * server is a recorder. Synthetic data only.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as SessionsRoute from "../../routes/api/ipmSessions.route";
import type CertificateServiceModule from "../../services/certificate.service";
import { IPM, seedIpmWorld, type IpmWorld } from "../fixtures/ipmSeed";
import { IPM_RESULTS, answerAdvisoryLocks, issueSession } from "../fixtures/ipmIssue";

const mockEmits: { event: string; rooms: string[]; payload: unknown }[] = [];
jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../config/socket", () => ({
  getIo: () => ({ to: (rooms: string[]) => ({ emit: (event: string, payload: unknown) => mockEmits.push({ event, rooms, payload }) }) }),
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const sessions = jest.requireActual<typeof SessionsRoute>("../../routes/api/ipmSessions.route");
const certificateService = jest.requireActual<typeof CertificateServiceModule>("../../services/certificate.service");

let world: IpmWorld;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
  answerAdvisoryLocks(mdb);
  mockEmits.length = 0;
  jest.spyOn(certificateService, "verifySignerCredentials").mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const send = (principal: Principal, method: string, url: string, body: unknown = {}): Promise<{ status: number; body: { data?: unknown } }> => {
  as(principal);
  return call(sessions, method, url, { body, routeFile: "api/ipmSessions.route.ts" }) as Promise<{ status: number; body: { data?: unknown } }>;
};

describe("G-19 — IPM events reach the tenant room and the session's facility room only", () => {
  it("submitted, signed and voided — for F1's session, F1's room; never F2's; no person in the payload", async () => {
    const id = await issueSession(send, world.staff, IPM.D1);
    await send(world.staff, "POST", `/${id}/signatures`, { kind: "performer", authMethod: "password", authPayload: "x", meaningAcknowledged: true });
    await send(world.admin, "POST", `/${id}/void`, { reason: "Synthetic duplicate visit" });
    const F1_ROOMS = [`tenant_${world.tenantA}`, `facility_${world.tenantA}_${IPM.F1}`];
    expect(mockEmits.map((e) => [e.event, e.rooms])).toEqual([
      ["ipm:submitted", F1_ROOMS],
      ["ipm:signed", F1_ROOMS],
      ["ipm:voided", F1_ROOMS],
    ]);
    expect(JSON.stringify(mockEmits)).not.toContain(world.staff.id);
    expect(JSON.stringify(mockEmits)).not.toContain(world.admin.id);
  });

  it("an F2 session's event names F2's room — the room comes from the row, not the (unbound) actor", async () => {
    await send(world.staff, "PATCH", `/${IPM.DRAFT2}`, { revision: 0, inspectionOutcome: "pass", maintenanceOutcome: "pass", recommendation: "fit_for_use" });
    await send(world.staff, "PUT", `/${IPM.DRAFT2}/results`, { revision: 1, results: IPM_RESULTS });
    await send(world.staff, "POST", `/${IPM.DRAFT2}/submit`, { revision: 2 });
    expect(mockEmits.map((e) => e.rooms)).toEqual([[`tenant_${world.tenantA}`, `facility_${world.tenantA}_${IPM.F2}`]]);
  });

  it("a refused submit emits nothing", async () => {
    await send(world.staff, "POST", `/${IPM.DRAFT2}/submit`, { revision: 0 });
    expect(mockEmits).toEqual([]);
  });
});
