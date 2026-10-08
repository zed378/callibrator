/**
 * G-24 (docs/SECURITY/15 § 11; P19-02 spec § 4.1, P19-04 § 12, P19-06 § 4.2; built by P21-04): the
 * person printed on an IPM report is a SNAPSHOT taken at the act — exactly `{ name, role,
 * organisation }`, never an id, an e-mail, a phone or a username (FT-15) — with `organisation` the
 * tenant's name for an unbound person and the person's facility's name for a bound one. The
 * performer snapshot is taken at submit, the signer snapshot at signing.
 *
 * REAL: the routes, the services, personDisplay, the models and the hooks over memoryDb. Synthetic.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as SessionsRoute from "../../routes/api/ipmSessions.route";
import type CertificateServiceModule from "../../services/certificate.service";
import { IPM, seedIpmWorld, type IpmWorld } from "../fixtures/ipmSeed";
import { answerAdvisoryLocks, issueSession } from "../fixtures/ipmIssue";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

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
  jest.spyOn(certificateService, "verifySignerCredentials").mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const send = (principal: Principal, method: string, url: string, body: unknown = {}): Promise<{ status: number; body: { data?: unknown } }> => {
  as(principal);
  return call(sessions, method, url, { body, routeFile: "api/ipmSessions.route.ts" }) as Promise<{ status: number; body: { data?: unknown } }>;
};
const stored = (id: string): Record<string, unknown> => mdb.rows("InspectionSession").find((r) => r["id"] === id) as Record<string, unknown>;
const tenantName = (): string => (mdb.rows("Tenant").find((t) => t["id"] === world.tenantA) as Record<string, unknown>)["name"] as string;

describe("G-24 — the performer and signer snapshots", () => {
  it("an unbound performer: exactly name, role, organisation = the tenant's name; nothing else", async () => {
    const id = await issueSession(send, world.staff, IPM.D1);
    const snapshot = stored(id)["performerSnapshot"] as Record<string, unknown>;
    expect(Object.keys(snapshot).sort()).toEqual(["name", "organisation", "role"]);
    expect(snapshot["organisation"]).toBe(tenantName());
    expect(JSON.stringify(snapshot)).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("a bound performer: organisation = its facility's name; its signature carries the same three keys", async () => {
    const id = await issueSession(send, world.bound2, IPM.D1);
    expect(stored(id)["performerSnapshot"]).toEqual({ name: "Bound boundf1b", role: null, organisation: "Facility One" });
    expect((await send(world.bound2, "POST", `/${id}/signatures`, { kind: "performer", authMethod: "password", authPayload: "x", meaningAcknowledged: true })).status).toBe(201);
    const [signature] = mdb.rows("InspectionSessionSignature");
    expect(signature?.["signerSnapshot"]).toEqual({ name: "Bound boundf1b", role: null, organisation: "Facility One" });
  });
});
