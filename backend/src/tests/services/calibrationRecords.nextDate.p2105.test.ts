/**
 * P21-05 — the next due date follows the latest EFFECTIVE record (ADR-133 § 1; spec P19-05 § 5,
 * § 12; BACKLOG G-11). A behaviour change for every tenant, recorded as a defect fix.
 *
 * FAIL-BEFORE (2026-10-09, this suite run against `calibrationRecords.service` as of `71ddf27`,
 * before this card): 8 of 9 failed — no source written; an older record moved the date BACK to
 * 2026-01-01; a stated due date lost to the interval; a void left the voided record's date (twice);
 * a correction left the original's; an interval change did not re-derive; no derivation audit row.
 * The one that passed is the manual date kept with no interval (the old code did not touch it).
 *
 * REAL: the calibration-records router's chain (auth double → tenant context, dynamicAccess,
 * denyPlatformAuthoring, the admin-only void), the controller and service, the models and tenant
 * hooks over memoryDb. Synthetic data only.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as RecordsRoute from "../../routes/api/calibrationRecords.route";
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
const records = jest.requireActual<typeof RecordsRoute>("../../routes/api/calibrationRecords.route");
const devices = jest.requireActual<typeof DevicesRoute>("../../routes/api/calibrationDevices.route");

interface Res {
  status: number;
  body: { data?: Record<string, unknown> | null; message?: string };
}

let world: IpmWorld;
/** The device under test: a stored row (seed returns the table's own object, so a test may set its fields). */
let dev: Record<string, unknown>;
const D9 = "d1000000-0000-4000-8000-0000000000f9";

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
  mdb.seed("TenantSettings", { tenantId: world.tenantA, key: "tenant_time_zone", value: "UTC" });
  // A device of F1 with a yearly interval and no date yet.
  [dev] = mdb.seed("CalibrationDevice", { id: D9, tenantId: world.tenantA, clientFacilityId: IPM.F1, name: "Alat sintetis 9", status: "active", calibrationIntervalDays: 365, isDeleted: false }) as [Record<string, unknown>];
});

const post = (principal: Principal, url: string, body: Record<string, unknown>): Promise<Res> => {
  as(principal);
  return call(records, "POST", url, { body, routeFile: "api/calibrationRecords.route.ts", baseUrl: "/api/v1/calibration-records" }) as Promise<Res>;
};
const record = async (date: string, extra: Record<string, unknown> = {}): Promise<string> => {
  const res = await post(world.staff, "/", { deviceId: D9, calibrationDate: `${date}T00:00:00.000Z`, ...extra });
  expect(res.status).toBe(201);
  return String(res.body.data?.["id"]);
};
const device = (): Record<string, unknown> => dev;
const nextDate = (): string | null => {
  const value = device()["nextCalibrationDate"] as Date | null | undefined;
  return value ? new Date(value).toISOString().slice(0, 10) : null;
};

describe("P21-05 — the next due date from the latest effective record (G-11)", () => {
  it("a new record derives the date from its own date + the interval, source `record`", async () => {
    await record("2026-06-01");
    expect(nextDate()).toBe("2027-06-01");
    expect(device()["nextCalibrationDateSource"]).toBe("record");
  });

  it("an older record does not move the date backward", async () => {
    await record("2026-06-01");
    await record("2025-01-01");
    expect(nextDate()).toBe("2027-06-01");
  });

  it("a record's stated due date wins over the interval", async () => {
    await record("2026-06-01", { dueDate: "2026-12-01T00:00:00.000Z" });
    expect(nextDate()).toBe("2026-12-01");
  });

  it("a void falls back to the previous effective record", async () => {
    await record("2025-01-01");
    const newer = await record("2026-06-01");
    const voided = await post(world.admin, `/${newer}/void`, { reason: "entered in error" });
    expect(voided.status).toBe(200);
    expect(nextDate()).toBe("2026-01-01");
  });

  it("the last record voided leaves no derived date (source cleared)", async () => {
    const only = await record("2026-06-01");
    await post(world.admin, `/${only}/void`, { reason: "entered in error" });
    expect(nextDate()).toBeNull();
    expect(device()["nextCalibrationDateSource"] ?? null).toBeNull();
  });

  it("a correction moves the date to the corrected record's", async () => {
    const original = await record("2026-06-01");
    const corrected = await post(world.staff, `/${original}/corrections`, { calibrationDate: "2026-07-01T00:00:00.000Z", reason: "typo in the date" });
    expect(corrected.status).toBe(201);
    expect(nextDate()).toBe("2027-07-01");
  });

  it("a date set by hand stays when no record exists, and a void of nothing derived keeps it", async () => {
    Object.assign(dev, { nextCalibrationDate: new Date("2030-01-01T00:00:00Z"), nextCalibrationDateSource: "manual", calibrationIntervalDays: null });
    const id = await record("2026-06-01");
    // No interval, no stated due date: the manual date is kept.
    expect(nextDate()).toBe("2030-01-01");
    await post(world.admin, `/${id}/void`, { reason: "entered in error" });
    expect(nextDate()).toBe("2030-01-01");
    expect(device()["nextCalibrationDateSource"]).toBe("manual");
  });

  it("an interval change re-derives a `record` date; the device form writes `manual`", async () => {
    await record("2026-06-01");
    as(world.staff);
    const changed = (await call(devices, "PUT", `/${D9}`, { body: { calibrationIntervalDays: 180 }, routeFile: "api/calibrationDevices.route.ts", baseUrl: "/api/v1/calibration-devices" })) as Res;
    expect(changed.status).toBe(200);
    expect(nextDate()).toBe("2026-11-28");
    as(world.staff);
    await call(devices, "PUT", `/${D9}`, { body: { nextCalibrationDate: "2027-02-02T00:00:00.000Z" }, routeFile: "api/calibrationDevices.route.ts", baseUrl: "/api/v1/calibration-devices" });
    expect(nextDate()).toBe("2027-02-02");
    expect(device()["nextCalibrationDateSource"]).toBe("manual");
  });

  it("the derivation is audited (DERIVE_NEXT_CALIBRATION_DATE) only when the date changes", async () => {
    await record("2026-06-01");
    await record("2025-01-01");
    const derive = mdb.rows("AuditLog").filter((a) => (a["changes"] as { operation?: string } | null)?.operation === "DERIVE_NEXT_CALIBRATION_DATE");
    expect(derive).toHaveLength(1);
  });
});
