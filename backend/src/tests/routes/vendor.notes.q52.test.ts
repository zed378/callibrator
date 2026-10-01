/**
 * Q-52 (ADR-109 §6) — a vendor's `notes` is stored, not silently dropped.
 *
 * `POST /vendors` and `PATCH /vendors/:vendorId` accept `notes` (the shared
 * contract, packages/contracts/src/vendor.ts) and answered 200, but the Vendor
 * model had no `notes` attribute, so Sequelize dropped it: the value was never
 * written, and GET never returned it. Migration 0106 adds the column; the
 * model declares it.
 *
 * REAL router, dynamicAccess (matrix granted), validate, controller, service,
 * audit, models and tenant hooks over memoryDb (the model decides which
 * attributes are written, exactly as on PostgreSQL).
 * Fail-before: the stored row had no `notes`, and GET answered without it.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as VendorRoute from "../../routes/api/vendor.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof VendorRoute>("../../routes/api/vendor.route");

const VENDOR = "a0520000-0000-4000-8000-000000000001";

let adminA: ReturnType<ReturnType<typeof twoTenants>["principal"]>;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  adminA = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [adminA]);
  mdb.seed("Vendor", { id: VENDOR, tenantId: fx.tenantA.id, name: "Lab A", type: "CalibrationLab" });
  as(adminA);
});

const data = (body: unknown): Record<string, unknown> => (body as { data: Record<string, unknown> }).data;

describe("Q-52 — vendors.notes round-trips", () => {
  it("POST stores notes, and GET returns them", async () => {
    const created = await call(router, "POST", "/", {
      body: { name: "Metrology Partner", type: "CalibrationLab", notes: "ISO 17025 accredited; ask for Budi." },
    });
    expect(created.status).toBe(201);
    const id = data(created.body)["id"] as string;

    const stored = mdb.rows("Vendor").find((row) => row["id"] === id);
    expect(stored?.["notes"]).toBe("ISO 17025 accredited; ask for Budi.");

    const read = await call(router, "GET", `/${id}`);
    expect(read.status).toBe(200);
    expect(data(read.body)["notes"]).toBe("ISO 17025 accredited; ask for Budi.");
  });

  it("notes is bounded at 2,000 characters: 2,000 is stored, 2,001 is a 400 and nothing is written", async () => {
    const atMax = await call(router, "PATCH", `/${VENDOR}`, { body: { notes: "x".repeat(2000) } });
    expect(atMax.status).toBe(200);
    expect(String(mdb.rows("Vendor").find((row) => row["id"] === VENDOR)?.["notes"])).toHaveLength(2000);

    const over = await call(router, "POST", "/", { body: { name: "Too Long Notes Lab", notes: "x".repeat(2001) } });
    expect(over.status).toBe(400);
    expect(mdb.rows("Vendor").some((row) => row["name"] === "Too Long Notes Lab")).toBe(false);
  });

  it("PATCH updates notes, and null clears them", async () => {
    const updated = await call(router, "PATCH", `/${VENDOR}`, { body: { notes: "Contract renewed 2026-09." } });
    expect(updated.status).toBe(200);
    expect(mdb.rows("Vendor").find((row) => row["id"] === VENDOR)?.["notes"]).toBe("Contract renewed 2026-09.");

    const cleared = await call(router, "PATCH", `/${VENDOR}`, { body: { notes: null } });
    expect(cleared.status).toBe(200);
    expect(mdb.rows("Vendor").find((row) => row["id"] === VENDOR)?.["notes"]).toBeNull();
  });
});
