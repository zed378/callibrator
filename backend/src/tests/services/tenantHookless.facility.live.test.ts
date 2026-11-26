/**
 * P17-07 / G-04: facility isolation for hookless statics on PostgreSQL as callibrator_app.
 * Independent numeric expectations and positive controls for the other facility and tenant.
 */
import { QueryTypes } from "sequelize";
import type { Sequelize } from "sequelize";
import type * as Models from "../../models";
import type * as Context from "../../middlewares/tenantContext.middleware";
import type * as Boot from "../fixtures/liveBoot";
import { LIVE_BOOT_TIMEOUT_MS } from "../fixtures/disposableDatabase";
import { seedSql } from "../fixtures/ipmLive";
import type { TenantId, ClientFacilityId } from "../../types/ids";

const T1 = "c1707040-0000-4000-8000-000000000001";
const T2 = "c1707040-0000-4000-8000-000000000002";
const F1 = "c1707040-0000-4000-8000-0000000000f1";
const F2 = "c1707040-0000-4000-8000-0000000000f2";
const F3 = "c1707040-0000-4000-8000-0000000000f3";
const D1 = "c1707040-0000-4000-8000-0000000000d1";
const D2 = "c1707040-0000-4000-8000-0000000000d2";
const D3 = "c1707040-0000-4000-8000-0000000000d3";
const D4 = "c1707040-0000-4000-8000-0000000000d4";

interface Graph {
  db: Sequelize;
  bootDb: Parameters<typeof Boot.bootSchema>[0];
  models: typeof Models;
  storage: typeof Context.tenantStorage;
  boot: typeof Boot;
  migrator: Parameters<typeof Boot.bootSchema>[1];
}

/* eslint-disable @typescript-eslint/no-require-imports -- load one graph after the live runner selects its scratch database */
const load = (): Graph => {
  const { db } = require("../../config") as { db: Sequelize };
  return {
    db,
    bootDb: db as unknown as Parameters<typeof Boot.bootSchema>[0],
    models: require("../../models") as typeof Models,
    storage: (require("../../middlewares/tenantContext.middleware") as typeof Context).tenantStorage,
    boot: require("../fixtures/liveBoot") as typeof Boot,
    migrator: (require("../../config/migrator") as { migrator: Graph["migrator"] }).migrator,
  };
};
/* eslint-enable @typescript-eslint/no-require-imports */

describe("P17-07 G-04 - facility statics on PostgreSQL as callibrator_app", () => {
  let g: Graph;
  const scoped = <R>(work: () => Promise<R>, facility: string | null = F1, bound = true): Promise<R> =>
    g.storage.run({
      tenantId: T1 as TenantId, clientFacilityId: facility as ClientFacilityId | null,
      facilityBound: bound, isSuperAdmin: false, isSystemTask: false,
    }, work);
  const quantities = async (): Promise<number[]> => {
    const rows = await g.db.query<{ calibration_interval_days: number }>(
      "SELECT calibration_interval_days FROM calibration_devices WHERE tenant_id IN ($1, $2) ORDER BY id",
      { bind: [T1, T2], type: QueryTypes.SELECT },
    );
    return rows.map((row) => row.calibration_interval_days);
  };

  beforeAll(async () => {
    g = load();
    await g.boot.bootSchema(g.bootDb, g.migrator);
    for (const [tenant, role, facilities, devices, tag] of [
      [T1, "c1707040-0000-4000-8000-0000000000a1", [[F1, "G04-F1"], [F2, "G04-F2"]], [[D1, F1, "G04-1"], [D2, F1, "G04-2"], [D3, F2, "G04-3"]], "g04t1"],
      [T2, "c1707040-0000-4000-8000-0000000000a2", [[F3, "G04-F3"]], [[D4, F3, "G04-4"]], "g04t2"],
    ] as const) {
      for (const statement of seedSql({ tenant, role, users: [], facilities, devices, tag })) {
        await g.db.query(statement);
      }
    }
    await g.boot.enterAppRole(g.db);
  }, LIVE_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    await g.db.query(
      "UPDATE calibration_devices SET calibration_interval_days = CASE id WHEN $1 THEN 3 WHEN $2 THEN 4 WHEN $3 THEN 100 ELSE 1000 END WHERE tenant_id IN ($4, $5)",
      { bind: [D1, D2, D3, T1, T2] },
    );
  });
  afterAll(async () => { await g.db.close(); });

  it("uses the application role without superuser privileges", async () => {
    const rows = await g.db.query<{ role: string; superuser: boolean }>(
      "SELECT current_user AS role, rolsuper AS superuser FROM pg_roles WHERE rolname = current_user",
      { type: QueryTypes.SELECT },
    );
    expect(rows).toEqual([{ role: "callibrator_app", superuser: false }]);
  });

  it("sum/min/max/aggregate/count read F1 only, with F2 and T2 as positive controls", async () => {
    const device = g.models.CalibrationDevice;
    expect(await scoped(() => device.sum("calibrationIntervalDays"))).toBe(7);
    expect(await scoped(() => device.min("calibrationIntervalDays"))).toBe(3);
    expect(await scoped(() => device.max("calibrationIntervalDays"))).toBe(4);
    expect(Number(await scoped(() => device.aggregate("calibrationIntervalDays", "sum")))).toBe(7);
    expect(await scoped(() => device.count())).toBe(2);
    expect(await scoped(() => device.sum("calibrationIntervalDays"), F2)).toBe(100);
    expect(await scoped(() => device.sum("calibrationIntervalDays"), null, false)).toBe(107);
    expect(await device.sum("calibrationIntervalDays", { where: { tenantId: T2 } })).toBe(1000);
  });

  it("a forged facility filter cannot widen aggregates, including unscoped models", async () => {
    const device = g.models.CalibrationDevice.unscoped();
    expect(await scoped(() => device.count({ where: { clientFacilityId: F2 } }))).toBe(2);
    expect(await scoped(() => device.sum("calibrationIntervalDays", { where: { id: D3 } }))).toBeNull();
  });

  it("unscoped increment/decrement change F1 only and keep the caller's filter", async () => {
    const device = g.models.CalibrationDevice.unscoped();
    await scoped(() => device.increment("calibrationIntervalDays", { by: 10, where: {} }));
    await scoped(() => device.decrement("calibrationIntervalDays", { by: 1, where: {} }));
    expect(await quantities()).toEqual([12, 13, 100, 1000]);
    await scoped(() => device.increment("calibrationIntervalDays", { by: 20, where: { id: D3 } }));
    await scoped(() => device.increment("calibrationIntervalDays", { by: 20, where: { id: D4 } }));
    expect(await quantities()).toEqual([12, 13, 100, 1000]);
  });

  it("missing facility denies aggregates and increments", async () => {
    const device = g.models.CalibrationDevice;
    expect(await scoped(() => device.count(), null)).toBe(0);
    expect(await scoped(() => device.sum("calibrationIntervalDays"), null)).toBeNull();
    await scoped(() => device.increment("calibrationIntervalDays", { by: 10, where: {} }), null);
    expect(await quantities()).toEqual([3, 4, 100, 1000]);
  });

  it("skipTenantScope still confines a bound principal to F1", async () => {
    const device = g.models.CalibrationDevice;
    // Deliberate bypass: prove that the independent facility control still applies.
    const options = { skipTenantScope: true, where: {} };
    expect(await scoped(() => device.sum("calibrationIntervalDays", options))).toBe(7);
    await scoped(() => device.increment("calibrationIntervalDays", { ...options, by: 10, where: {} }));
    expect(await quantities()).toEqual([13, 14, 100, 1000]);
  });

  it("truncate is refused before SQL even with skipTenantScope", async () => {
    const options = { truncate: true, skipTenantScope: true };
    await expect(scoped(() => g.models.CalibrationDevice.destroy(options))).rejects.toThrow("Security Violation: Attempted to truncate");
    expect(await quantities()).toEqual([3, 4, 100, 1000]);
  });
});
