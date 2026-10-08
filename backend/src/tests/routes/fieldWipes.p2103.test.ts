/**
 * P21-03c — `POST /field/wipes` (P19-08 spec § 11.3, G-O9; § 16.2 `fieldWipes.test`): an unbound
 * tenant administrator records a wipe of another user's offline data (counts only); a bound
 * principal is refused by the route gate (unmarked), a technician by `rbac`, an API key by
 * `denyApiKey`; another tenant's user is the 404 of a missing one.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as FieldRoute from "../../routes/api/field.route";
import { IPM, seedIpmWorld, type IpmWorld } from "../fixtures/ipmSeed";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const field = jest.requireActual<typeof FieldRoute>("../../routes/api/field.route");

let world: IpmWorld;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
});

const wipe = (principal: Principal, body: unknown): Promise<{ status: number; body: { data?: Record<string, unknown>; code?: string; message?: string } }> => {
  as(principal);
  return call(field, "POST", "/wipes", { body, routeFile: "api/field.route.ts" }) as Promise<{
    status: number;
    body: { data?: Record<string, unknown>; code?: string; message?: string };
  }>;
};

describe("POST /field/wipes", () => {
  it("records the wipe with its counts, one audit row on the wiped user", async () => {
    const res = await wipe(world.admin, { wipedUserId: IPM.BOUND, captures: 2, photos: 5 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ wipedUserId: IPM.BOUND, captures: 2, photos: 5 });
    const rows = mdb.rows("AuditLog").filter((a) => (a["changes"] as Record<string, unknown>)["operation"] === "FIELD_DATA_WIPED");
    expect(rows).toEqual([
      expect.objectContaining({
        action: "DELETE",
        resourceType: "User",
        resourceId: IPM.BOUND,
        userId: world.admin.id,
        changes: { operation: "FIELD_DATA_WIPED", captures: 2, photos: 5 },
      }),
    ]);
  });

  it("another tenant's user is the 404 of a missing one, and nothing is written", async () => {
    const before = mdb.committed().length;
    const foreign = await wipe(world.admin, { wipedUserId: world.other.id, captures: 0, photos: 0 });
    const missing = await wipe(world.admin, { wipedUserId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", captures: 0, photos: 0 });
    expect([foreign.status, foreign.body]).toEqual([404, missing.body]);
    expect(mdb.committed().slice(before)).toEqual([]);
  });

  it("a bound principal is refused by the route gate (unmarked: bound users never wipe)", async () => {
    const res = await wipe(world.bound, { wipedUserId: IPM.BOUND2, captures: 1, photos: 0 });
    expect([res.status, res.body.code]).toEqual([403, "FACILITY_ROUTE_REFUSED"]);
  });

  it("a technician is refused by rbac; an API key by denyApiKey; content beyond counts by the contract", async () => {
    expect((await wipe(world.staff, { wipedUserId: IPM.BOUND, captures: 1, photos: 0 })).status).toBe(403);
    expect((await wipe({ ...world.admin, isApiKey: true }, { wipedUserId: IPM.BOUND, captures: 1, photos: 0 })).status).toBe(403);
    expect((await wipe(world.admin, { wipedUserId: IPM.BOUND, captures: 1, photos: 0, notes: "x" })).status).toBe(400);
  });
});
