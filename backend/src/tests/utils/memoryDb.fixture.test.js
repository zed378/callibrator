/**
 * The memoryDb fixture enforces tenant isolation through the REAL hooks —
 * proven here, because every *.twoTenant.test.js leans on it.
 *
 * A two-tenant test is worthless if its database double finds another
 * tenant's row whatever the hooks say (or hides it whatever they say). These
 * tests drive the REAL models barrel on memoryDb with queries that carry NO
 * tenant predicate of their own, so only `tenantScope.util#register` can be
 * what keeps tenant B out — and they check it in both directions.
 */

jest.mock("../../config", () => ({ db: require("../fixtures/memoryDb").memoryDb().sequelize }));

const mdb = require("../fixtures/memoryDb").memoryDb();
const models = require("../../models");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VENDOR_A = "a1000000-0000-4000-8000-000000000001";
const DEVICE_A = "a2000000-0000-4000-8000-000000000001";
const USER_B = "b3000000-0000-4000-8000-000000000001";

const inTenant = (tenantId, fn, extra = {}) =>
  tenantStorage.run({ tenantId, isSuperAdmin: false, isSystemTask: false, ...extra }, fn);

beforeEach(() => {
  mdb.reset();
  mdb.seed("Tenant", [
    { id: TENANT_A, name: "A", code: "A", status: "ACTIVE" },
    { id: TENANT_B, name: "B", code: "B", status: "ACTIVE" },
  ]);
  mdb.seed("Vendor", { id: VENDOR_A, tenantId: TENANT_A, name: "Lab A" });
});

describe("memoryDb — the root predicate comes from the real hooks", () => {
  it("a query naming no tenant finds the row in its own tenant and not in another", async () => {
    expect(await inTenant(TENANT_A, () => models.Vendor.findByPk(VENDOR_A))).not.toBeNull();
    expect(await inTenant(TENANT_B, () => models.Vendor.findByPk(VENDOR_A))).toBeNull();
    expect(await inTenant(TENANT_B, () => models.Vendor.count())).toBe(0);
  });

  it("deny-by-default: an authenticated context with no tenant sees nothing", async () => {
    expect(await inTenant(null, () => models.Vendor.findAll())).toEqual([]);
  });

  it("the super admin, no context and skipTenantScope skip the predicate, as the hooks decide", async () => {
    expect(await inTenant(TENANT_B, () => models.Vendor.findByPk(VENDOR_A), { isSuperAdmin: true })).not.toBeNull();
    expect(await models.Vendor.findByPk(VENDOR_A)).not.toBeNull();
    expect(await inTenant(TENANT_B, () => models.Vendor.findByPk(VENDOR_A, { skipTenantScope: true }))).not.toBeNull();
  });

  it("a bulk update or destroy from another tenant touches nothing", async () => {
    await inTenant(TENANT_B, () => models.Vendor.update({ name: "x" }, { where: { id: VENDOR_A } }));
    await inTenant(TENANT_B, () => models.Vendor.destroy({ where: { id: VENDOR_A } }));
    expect(mdb.rows("Vendor")[0].name).toBe("Lab A");
    expect(mdb.rows("Vendor")[0].deletedAt ?? null).toBeNull();
    expect(mdb.committed()).toEqual([]);
  });

  it("paranoid rows: destroy soft-deletes, and the deleted row is no longer found", async () => {
    await inTenant(TENANT_A, async () => (await models.Vendor.findByPk(VENDOR_A)).destroy());
    expect(mdb.rows("Vendor")[0].deletedAt).toBeInstanceOf(Date);
    expect(await inTenant(TENANT_A, () => models.Vendor.findByPk(VENDOR_A))).toBeNull();
  });

  it("create stamps the context's tenant over a body tenant", async () => {
    const v = await inTenant(TENANT_A, () => models.Vendor.create({ name: "New", tenantId: TENANT_B }));
    expect(v.tenantId).toBe(TENANT_A);
  });
});

describe("memoryDb — includes are scoped by the real A-87 hook", () => {
  const DEVICE_B = "b2000000-0000-4000-8000-000000000001";
  const RECORD_A = "a4000000-0000-4000-8000-000000000001";

  beforeEach(() => {
    mdb.seed("CalibrationDevice", [
      { id: DEVICE_A, tenantId: TENANT_A, name: "Device A", serialNumber: "SN-A" },
      { id: DEVICE_B, tenantId: TENANT_B, name: "Device B", serialNumber: "SN-B" },
    ]);
    // A record of tenant A that (wrongly) references tenant B's device.
    mdb.seed("CalibrationRecord", { id: RECORD_A, tenantId: TENANT_A, deviceId: DEVICE_B });
  });

  it("a LEFT include of another tenant's row joins null and keeps the parent", async () => {
    const record = await inTenant(TENANT_A, () =>
      models.CalibrationRecord.findByPk(RECORD_A, {
        include: [{ model: models.CalibrationDevice.unscoped(), as: "device", required: false }],
      }),
    );
    expect(record).not.toBeNull();
    expect(record.device).toBeNull();
  });

  it("an INNER include of another tenant's row drops the parent (the A-90 shape)", async () => {
    const record = await inTenant(TENANT_A, () =>
      models.CalibrationRecord.findByPk(RECORD_A, {
        include: [{ model: models.CalibrationDevice.unscoped(), as: "device", required: true }],
      }),
    );
    expect(record).toBeNull();
  });

  it("the same include joins when the referenced row is in the tenant", async () => {
    mdb.seed("CalibrationRecord", { id: USER_B, tenantId: TENANT_A, deviceId: DEVICE_A });
    const record = await inTenant(TENANT_A, () =>
      models.CalibrationRecord.findByPk(USER_B, {
        include: [{ model: models.CalibrationDevice.unscoped(), as: "device", required: true }],
      }),
    );
    expect(record.device.id).toBe(DEVICE_A);
  });
});

describe("memoryDb — it refuses what it cannot evaluate", () => {
  it("a column the model does not define is PostgreSQL's error (the is_deleted trap)", async () => {
    await expect(models.Vendor.findAll({ where: { is_deleted: false } })).rejects.toThrow(
      'column "is_deleted" does not exist',
    );
  });

  it("raw SQL with no handler is refused (it bypasses the hooks)", async () => {
    await expect(models.sequelize.query("SELECT 1")).rejects.toThrow("raw SQL");
  });

  it("an unknown operator throws rather than matching", async () => {
    await expect(
      models.Vendor.findAll({ where: { name: { [models.Sequelize.Op.regexp]: "x" } } }),
    ).rejects.toThrow("memoryDb: cannot evaluate");
  });
});

describe("memoryDb — transactions", () => {
  it("rollback undoes every write made in it; commit keeps them", async () => {
    const t1 = await models.sequelize.transaction();
    await inTenant(TENANT_A, () => models.Vendor.update({ name: "rolled" }, { where: { id: VENDOR_A }, transaction: t1 }));
    await t1.rollback();
    expect(mdb.rows("Vendor")[0].name).toBe("Lab A");
    expect(mdb.committed()).toEqual([]);

    await models.sequelize.transaction(async () => {
      // CLS: joins the managed transaction without { transaction }
      await inTenant(TENANT_A, () => models.Vendor.update({ name: "kept" }, { where: { id: VENDOR_A } }));
    });
    expect(mdb.rows("Vendor")[0].name).toBe("kept");
    expect(mdb.committed()).toHaveLength(1);
  });

  it("a managed transaction that throws rolls back", async () => {
    await expect(
      models.sequelize.transaction(async () => {
        await inTenant(TENANT_A, () => models.Vendor.update({ name: "gone" }, { where: { id: VENDOR_A } }));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(mdb.rows("Vendor")[0].name).toBe("Lab A");
  });
});
