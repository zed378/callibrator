/**
 * W-10 — `POST /api/v1/sop` answers 400, not 500, to a body without its fields.
 *
 * Before 2026-10-05 the route carried no schema: a bodyless request (which
 * bodyDefault turns into `{}`), an array body, a blank title or
 * `requiresTraining: null` reached `SopDocument.create` and the model's NOT
 * NULL answered **500** ("notNull Violation: SopDocument.title cannot be
 * null"). The route now mounts `validate(createSopDocument)`
 * (`@callibrator/contracts/sop`).
 *
 * REAL router, dynamicAccess (role matrix granted), validate, controller, sop
 * service and audit service on the REAL models and tenant hooks
 * (fixtures/memoryDb); only `auth` is replaced (fixtures/routeClient).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as SopRoute from "../../routes/api/sop.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof SopRoute>("../../routes/api/sop.route");

let admin: Principal;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [admin]);
  as(admin);
});

const post = (body: unknown): ReturnType<typeof call> => call(router, "POST", "/", { body });

describe("W-10 — POST /sop refuses a body without its fields with 400, and writes nothing", () => {
  it.each([
    ["an empty body (what bodyDefault makes of a bodyless request)", {}],
    ["an array body", []],
    ["a blank title", { title: "   " }],
    ["a title of the wrong type", { title: 5 }],
    ["requiresTraining: null (the column is NOT NULL)", { title: "Pump SOP", requiresTraining: null }],
    ["requiresTraining that is not a boolean", { title: "Pump SOP", requiresTraining: "maybe" }],
    ["a version longer than its column", { title: "Pump SOP", version: "v".repeat(21) }],
  ])("%s → 400 Validation Error", async (_label, body) => {
    const res = await post(body);
    expect({ status: res.status, message: (res.body as { message?: unknown }).message }).toEqual({
      status: 400,
      message: "Validation Error",
    });
    expect(mdb.committed()).toEqual([]);
  });

  it("a valid body still creates a DRAFT, with the audit row, and server-owned fields are stripped", async () => {
    const res = await post({
      title: "  Calibration of infusion pumps  ",
      requiresTraining: "false",
      status: "PUBLISHED",
      tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      documentNumber: "SOP-9999",
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      data: {
        title: "Calibration of infusion pumps",
        version: "1.0",
        status: "DRAFT",
        requiresTraining: false,
        tenantId: admin.tenantId,
        documentNumber: "SOP-0001",
        authorId: admin.id,
      },
    });
    expect(mdb.committed().map((w) => w.model)).toEqual(expect.arrayContaining(["SopDocument", "AuditLog"]));
  });

  it("an empty or null version still reads as 1.0, as before", async () => {
    const empty = await post({ title: "A", version: "" });
    const none = await post({ title: "B", version: null, contentUrl: null });
    expect([empty.status, none.status]).toEqual([201, 201]);
    expect([(empty.body as { data: { version: string } }).data.version, (none.body as { data: { version: string } }).data.version]).toEqual([
      "1.0",
      "1.0",
    ]);
  });
});
