/**
 * P20-01 (ADR-125 Am. 1; spec P19-01 § 4.7, § 13 `calibrationDevice.deviceType`)
 * — a device names its type in the GLOBAL catalogue, and a list that includes
 * the type with `required: false` keeps every device: one with no type, one
 * whose type is retired, one with an active type (CLAUDE.md, the first trap).
 *
 * REAL models and REAL tenant hooks over fixtures/memoryDb:
 *  - the include of the global DeviceType gets NO tenant predicate (it has no
 *    tenant column), while the device list stays scoped to the caller's
 *    tenant — another tenant's device of the same type never appears;
 *  - the same include with `required: true` (an INNER JOIN) drops the typeless
 *    device — the defect shape `required: false` prevents, pinned so the
 *    fixture is seen to bite.
 *
 * The API that sets a device's type (and refuses a retired one, 400) is
 * P21-01; this holds the model association the API will read through.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as TenantContext from "../../middlewares/tenantContext.middleware";
import type * as ModelsModule from "../../models";
import type { TenantId } from "../../types/ids";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const models = jest.requireActual<typeof ModelsModule>("../../models");
const { tenantStorage } = jest.requireActual<typeof TenantContext>("../../middlewares/tenantContext.middleware");

const TENANT_A = "a2001000-0000-4000-8000-0000000000a0" as TenantId;
const TENANT_B = "a2001000-0000-4000-8000-0000000000b0" as TenantId;
const TYPE_ACTIVE = "a2001000-0000-4000-8000-000000000071";
const TYPE_RETIRED = "a2001000-0000-4000-8000-000000000072";
const DEVICE_NO_TYPE = "a2001000-0000-4000-8000-0000000000d1";
const DEVICE_RETIRED_TYPE = "a2001000-0000-4000-8000-0000000000d2";
const DEVICE_ACTIVE_TYPE = "a2001000-0000-4000-8000-0000000000d3";
const DEVICE_OTHER_TENANT = "a2001000-0000-4000-8000-0000000000d4";

const asTenant = <T>(tenantId: TenantId, fn: () => Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    tenantStorage.run({ tenantId, isSuperAdmin: false, isSystemTask: false }, () => {
      fn().then(resolve, reject);
    });
  });

const device = (id: string, tenantId: TenantId, deviceTypeId: string | null, name: string) => ({
  id,
  tenantId,
  name,
  deviceTypeId,
  status: "active",
  iotEnabled: false,
  isDeleted: false,
});

beforeEach(() => {
  mdb.reset();
  // Synthetic types (no upstream name).
  mdb.seed("DeviceType", [
    { id: TYPE_ACTIVE, name: "Test Device Type A", status: "active" },
    { id: TYPE_RETIRED, name: "Test Device Type B", status: "retired" },
  ]);
  mdb.seed("CalibrationDevice", [
    device(DEVICE_NO_TYPE, TENANT_A, null, "Device without a type"),
    device(DEVICE_RETIRED_TYPE, TENANT_A, TYPE_RETIRED, "Device of a retired type"),
    device(DEVICE_ACTIVE_TYPE, TENANT_A, TYPE_ACTIVE, "Device of an active type"),
    device(DEVICE_OTHER_TENANT, TENANT_B, TYPE_ACTIVE, "Another tenant's device"),
  ]);
});

const listWithType = (required: boolean) =>
  asTenant(TENANT_A, () =>
    models.CalibrationDevice.findAll({
      include: [{ model: models.DeviceType, as: "deviceType", required }],
      order: [["id", "ASC"]],
    }),
  );

describe("P20-01 — CalibrationDevice → DeviceType (tenant → global, RESTRICT)", () => {
  it("is a belongsTo on deviceTypeId, RESTRICT, and DeviceType has no association back to the device", () => {
    const association = models.CalibrationDevice.associations["deviceType"];
    expect(association?.associationType).toBe("BelongsTo");
    expect(association?.foreignKey).toBe("deviceTypeId");
    expect(Object.values(models.DeviceType.associations).map((a) => a.target.name)).toEqual(["InspectionTemplate"]);
  });

  it("required: false keeps every device of the tenant — no type, a retired type, an active type — and only its own", async () => {
    const rows = await listWithType(false);
    expect(rows.map((d) => [d.id, d.deviceType?.name ?? null, d.deviceType?.status ?? null])).toEqual([
      [DEVICE_NO_TYPE, null, null],
      [DEVICE_RETIRED_TYPE, "Test Device Type B", "retired"],
      [DEVICE_ACTIVE_TYPE, "Test Device Type A", "active"],
    ]);
  });

  it("the other tenant sees its own device, joined to the SAME global type (no tenant predicate on the global include)", async () => {
    const rows = await asTenant(TENANT_B, () =>
      models.CalibrationDevice.findAll({ include: [{ model: models.DeviceType, as: "deviceType", required: false }] }),
    );
    expect(rows.map((d) => [d.id, d.deviceType?.id])).toEqual([[DEVICE_OTHER_TENANT, TYPE_ACTIVE]]);
  });

  it("required: true (an INNER JOIN) drops the typeless device — the defect required: false prevents", async () => {
    const rows = await listWithType(true);
    expect(rows.map((d) => d.id)).toEqual([DEVICE_RETIRED_TYPE, DEVICE_ACTIVE_TYPE]);
  });
});
