/**
 * Q-55 (ADR-097 Am. 4, migration 0107) — a work order's schedule, costs and
 * resolution are stored, not silently dropped, and their bounds are 400s.
 *
 * `POST /maintenance` and `PATCH /maintenance/:orderId` accepted
 * `scheduledDate`, `completedDate`, `estimatedCost`, `actualCost` and
 * `resolutionNotes` and answered 201/200, but the model had no such
 * attributes: Sequelize dropped them, nothing was written, GET never returned
 * them. Fail-before: the stored rows had none of the five, and the bounds
 * (completed before scheduled, a cost over NUMERIC(14,2), notes over 5000)
 * were accepted.
 *
 * REAL router, dynamicAccess (matrix granted), validate, controller, service,
 * audit, models and tenant hooks over memoryDb (the model decides which
 * attributes are written, exactly as on PostgreSQL).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as MaintenanceRoute from "../../routes/api/maintenance.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof MaintenanceRoute>("../../routes/api/maintenance.route");

const DEVICE = "a0550000-0000-4000-8000-000000000001";
const ORDER = "a0550000-0000-4000-8000-000000000002";

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  const admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [admin]);
  mdb.seed("CalibrationDevice", { id: DEVICE, tenantId: fx.tenantA.id, name: "Infusion pump", serialNumber: "SN-1" });
  mdb.seed("MaintenanceWorkOrder", {
    id: ORDER, tenantId: fx.tenantA.id, deviceId: DEVICE, title: "Battery", type: "Repair", status: "Open", priority: "Medium",
  });
  as(admin);
});

const data = (body: unknown): Record<string, unknown> => (body as { data: Record<string, unknown> }).data;
const stored = (id: string): Record<string, unknown> | undefined =>
  mdb.rows("MaintenanceWorkOrder").find((row) => row["id"] === id);
const time = (value: unknown): number => new Date(value as string).getTime();

describe("Q-55 — work-order schedule, costs and resolution are stored", () => {
  it("POST stores scheduledDate and estimatedCost, and GET returns them", async () => {
    const created = await call(router, "POST", "/", {
      body: { deviceId: DEVICE, title: "Annual PM", type: "Preventative", scheduledDate: "2026-11-02", estimatedCost: "1250.5" },
    });
    expect(created.status).toBe(201);
    const id = data(created.body)["id"] as string;
    expect(time(stored(id)?.["scheduledDate"])).toBe(Date.parse("2026-11-02"));
    expect(Number(stored(id)?.["estimatedCost"])).toBe(1250.5);

    const read = await call(router, "GET", `/${id}`);
    expect(read.status).toBe(200);
    expect(time(data(read.body)["scheduledDate"])).toBe(Date.parse("2026-11-02"));
    // D-21: the DECIMAL reads back as a number, not a decimal string.
    expect(data(read.body)["estimatedCost"]).toBe(1250.5);
  });

  it("PATCH stores completedDate, actualCost and resolutionNotes; the audit row has the values, and the notes' LENGTH only", async () => {
    const notes = "Battery replaced; leak test passed.";
    const res = await call(router, "PATCH", `/${ORDER}`, {
      body: { scheduledDate: "2026-11-02", completedDate: "2026-11-03T10:00:00Z", actualCost: 980, resolutionNotes: notes },
    });
    expect(res.status).toBe(200);
    const row = stored(ORDER);
    expect(time(row?.["completedDate"])).toBe(Date.parse("2026-11-03T10:00:00Z"));
    expect(Number(row?.["actualCost"])).toBe(980);
    expect(row?.["resolutionNotes"]).toBe(notes);

    const audit = mdb.rows("AuditLog").filter((a) => a["resourceId"] === ORDER);
    expect(audit).toHaveLength(1);
    const changes = audit[0]?.["changes"] as { before: Record<string, unknown>; after: Record<string, unknown> };
    expect(changes.after).toMatchObject({ actualCost: 980, resolutionNotesLength: notes.length });
    expect(time(changes.after["completedDate"])).toBe(Date.parse("2026-11-03T10:00:00Z"));
    expect(changes.before).toMatchObject({ resolutionNotesLength: null, actualCost: null });
    expect(JSON.stringify(changes)).not.toContain("leak test");
  });

  it.each([
    ["completed before scheduled", { scheduledDate: "2026-11-05", completedDate: "2026-11-04" }, "completedDate"],
    ["a negative cost", { actualCost: -1 }, "actualCost"],
    ["a cost over NUMERIC(14,2)", { estimatedCost: 1_000_000_000_000 }, "estimatedCost"],
    ["notes over 5000 characters", { resolutionNotes: "x".repeat(5001) }, "resolutionNotes"],
  ])("refuses %s with a 400 naming the field, and writes nothing", async (_label, body, field) => {
    const before = JSON.stringify(stored(ORDER));
    const res = await call(router, "PATCH", `/${ORDER}`, { body });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(field);
    expect(JSON.stringify(stored(ORDER))).toBe(before);
  });

  it("accepts the bounds themselves: completed on the scheduled day, notes of exactly 5000", async () => {
    const res = await call(router, "PATCH", `/${ORDER}`, {
      body: { scheduledDate: "2026-11-02", completedDate: "2026-11-02", resolutionNotes: "x".repeat(5000), estimatedCost: 999_999_999_999.99 },
    });
    expect(res.status).toBe(200);
    expect((stored(ORDER)?.["resolutionNotes"] as string).length).toBe(5000);
  });
});
