/**
 * A-133 — calibration-device create, update, delete and bulk import wrote no
 * audit row.
 *
 * A device register is the anchor of every calibration record and certificate
 * (ISO 17025 §6.4.13 equipment records); a device created, re-identified or
 * deleted with no trail cannot be attributed. Each mutation now writes its
 * audit row inside the SAME transaction as the change (the A-41 rule): a
 * rolled-back change leaves no row, and a failed audit insert rolls the change
 * back. A bulk import writes its devices with one bulkCreate and ONE audit row
 * summarising the import — counts, and the ids of the devices it created.
 *
 * Real: calibrationDevices.service, audit.service, the calibrationDevices
 * validators, and the AuditLog schema (through the auditLedger fixture, which
 * enforces the audit_logs ENUM and NOT NULL columns and commits only what a
 * real transaction would). Faked: the CalibrationDevice model (backed by the
 * ledger), the database.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null, existing: null };

// D-22 (ADR-070): a parent's delete soft-deletes its attachments through
// attachment.service, in the parent's transaction.
jest.mock("../../services/attachment.service", () => ({
  softDeleteForResource: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));

jest.mock("../../models", () => {
  let seq = 0;
  const nextId = () => {
    seq += 1;
    return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  };
  const instance = (values) => ({
    ...values,
    async update(changes, options) {
      mockRef.ledger.write("calibration_devices", { id: this.id, ...changes }, options);
      Object.assign(this, changes);
      return this;
    },
    // The model's softDelete() takes no options: it joins the ambient
    // (CLS) transaction, which the ledger models.
    async softDelete() {
      mockRef.ledger.write("calibration_devices", { id: this.id, isDeleted: true });
      this.isDeleted = true;
      return this;
    },
  });
  return {
    CalibrationDevice: {
      create: jest.fn(async (values, options) => {
        const row = { id: nextId(), ...values };
        mockRef.ledger.write("calibration_devices", row, options);
        return instance(row);
      }),
      bulkCreate: jest.fn(async (rows, options) =>
        rows.map((values) => {
          const row = { id: nextId(), ...values };
          mockRef.ledger.write("calibration_devices", row, options);
          return instance(row);
        }),
      ),
      findOne: jest.fn(async () => (mockRef.existing ? instance(mockRef.existing) : null)),
      unscoped: () => ({
        findOne: jest.fn(async () => null),
        findAll: jest.fn(async () => []),
      }),
    },
    AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
    User: {},
  };
});

const service = require("../../services/calibrationDevices.service");

const TENANT = "22222222-2222-4222-8222-222222222222";
const DEVICE = "33333333-3333-4333-8333-333333333333";
const ACTOR = {
  userId: "11111111-1111-4111-8111-111111111111",
  tenantId: TENANT,
  ipAddress: "10.0.0.7",
  userAgent: "UA",
};

const DEVICE_INPUT = {
  name: "Infusion pump",
  manufacturer: "Acme",
  model: "IP-1",
  serialNumber: "SN-1",
};

beforeEach(() => {
  mockRef.ledger = createLedger();
  mockRef.existing = null;
});

const deviceRows = () => mockRef.ledger.committed("calibration_devices");

describe("A-133 — device mutations write their audit row in the transaction", () => {
  it("a device create writes its audit row in the transaction", async () => {
    const result = await service.createCalibrationDevice(TENANT, DEVICE_INPUT, ACTOR);

    expect(result.status).toBe(201);
    expect(deviceRows()).toHaveLength(1);
    const audit = mockRef.ledger.auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      tenantId: TENANT,
      userId: ACTOR.userId,
      action: "CREATE",
      resourceType: "CalibrationDevice",
      resourceId: deviceRows()[0].id,
      ipAddress: ACTOR.ipAddress,
      userAgent: ACTOR.userAgent,
    });
    expect(audit[0].changes.after).toMatchObject({ name: "Infusion pump", serialNumber: "SN-1" });
  });

  it("a device create whose audit insert fails is rolled back — no device without its row", async () => {
    mockRef.ledger.failNext("audit_logs");
    await expect(service.createCalibrationDevice(TENANT, DEVICE_INPUT, ACTOR)).rejects.toThrow();
    expect(deviceRows()).toHaveLength(0);
    expect(mockRef.ledger.auditRows()).toHaveLength(0);
  });

  it("a device update writes its audit row, with before and after, in the transaction", async () => {
    mockRef.existing = { id: DEVICE, tenantId: TENANT, name: "Old name", serialNumber: "SN-1" };
    // `manufacturer` was never set on the device: its `before` is null, not absent.
    const result = await service.updateCalibrationDevice(
      TENANT,
      DEVICE,
      { name: "New name", manufacturer: "Acme" },
      ACTOR,
    );

    expect(result.status).toBe(200);
    const audit = mockRef.ledger.auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "UPDATE",
      resourceType: "CalibrationDevice",
      resourceId: DEVICE,
      userId: ACTOR.userId,
      changes: {
        before: { name: "Old name", manufacturer: null },
        after: { name: "New name", manufacturer: "Acme" },
      },
    });
  });

  it("a device update whose audit insert fails is rolled back", async () => {
    mockRef.existing = { id: DEVICE, tenantId: TENANT, name: "Old name", serialNumber: "SN-1" };
    mockRef.ledger.failNext("audit_logs");
    await expect(
      service.updateCalibrationDevice(TENANT, DEVICE, { name: "New name" }, ACTOR),
    ).rejects.toThrow();
    expect(deviceRows()).toHaveLength(0);
  });

  it("a device delete writes its audit row in the transaction", async () => {
    mockRef.existing = { id: DEVICE, tenantId: TENANT, name: "Pump", isDeleted: false };
    const result = await service.deleteCalibrationDevice(TENANT, DEVICE, ACTOR);

    expect(result.status).toBe(200);
    expect(deviceRows()).toEqual([{ id: DEVICE, isDeleted: true }]);
    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({
        action: "DELETE",
        resourceType: "CalibrationDevice",
        resourceId: DEVICE,
        userId: ACTOR.userId,
        changes: { before: { isDeleted: false }, after: { isDeleted: true } },
      }),
    ]);
  });

  it("a device delete whose audit insert fails is rolled back", async () => {
    mockRef.existing = { id: DEVICE, tenantId: TENANT, name: "Pump", isDeleted: false };
    mockRef.ledger.failNext("audit_logs");
    await expect(service.deleteCalibrationDevice(TENANT, DEVICE, ACTOR)).rejects.toThrow();
    expect(deviceRows()).toHaveLength(0);
  });

  it("a not-found update or delete writes nothing", async () => {
    expect((await service.updateCalibrationDevice(TENANT, DEVICE, { name: "Renamed" }, ACTOR)).status).toBe(404);
    expect((await service.deleteCalibrationDevice(TENANT, DEVICE, ACTOR)).status).toBe(404);
    expect(mockRef.ledger.rows).toHaveLength(0);
  });

  describe("bulk import", () => {
    let dir;
    const csv = (content) => {
      const file = path.join(dir, `import-${Date.now()}-${Math.random()}.csv`);
      fs.writeFileSync(file, content);
      return file;
    };
    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "a133-"));
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it("writes its devices and ONE audit row summarising the import, with counts and ids", async () => {
      const file = csv(
        "name,manufacturer,model,serial number\n" +
          "Pump A,Acme,IP-1,SN-A\n" +
          "Pump B,Acme,IP-1,SN-B\n" +
          "Pump C,Acme,IP-1,SN-A\n", // duplicate serial in the file → one failed row
      );
      const result = await service.bulkImportCalibrationDevices(TENANT, file, ACTOR);

      expect(result.status).toBe(200);
      expect(result.data).toMatchObject({ successCount: 2, failedCount: 1, totalCount: 3 });
      const ids = deviceRows().map((r) => r.id);
      expect(ids).toHaveLength(2);
      const audit = mockRef.ledger.auditRows();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        tenantId: TENANT,
        userId: ACTOR.userId,
        action: "CREATE",
        resourceType: "CalibrationDevice",
        resourceId: null,
        changes: {
          operation: "bulk_import",
          after: { successCount: 2, failedCount: 1, totalCount: 3, ids },
        },
      });
    });

    it("an import whose audit insert fails imports nothing", async () => {
      const file = csv("name,serial number\nPump A,SN-A\n");
      mockRef.ledger.failNext("audit_logs");
      await expect(service.bulkImportCalibrationDevices(TENANT, file, ACTOR)).rejects.toThrow();
      expect(deviceRows()).toHaveLength(0);
      expect(mockRef.ledger.auditRows()).toHaveLength(0);
    });

    it("an import with no valid row writes no device and no audit row", async () => {
      const file = csv("name,serial number\n,\nPump A,\n".replace("Pump A,", ",") );
      const result = await service.bulkImportCalibrationDevices(TENANT, file, ACTOR);
      expect(result.data.successCount).toBe(0);
      expect(mockRef.ledger.rows).toHaveLength(0);
    });
  });
});
