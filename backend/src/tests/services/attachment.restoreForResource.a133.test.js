/**
 * A-133 (ADR-075) — attachment.service#restoreForResource, the other half of
 * D-22: a parent's restore brings back EXACTLY the attachments its delete took.
 *
 * The end-to-end behaviour (through the route, the real models and the ledger)
 * is calibrationDevices.restore.a133.test.js. This file pins the decision rule
 * on the edges: which audit row decides, and the programming-error refusals.
 *
 * Real: attachment.service. Faked: the models (AuditLog.findAll answers from
 * `auditRows` by the `where` the service builds; Attachment.unscoped() is
 * observed) and audit.service.
 */
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));
jest.mock("../../services/virusScan.service", () => ({}));

const mockLockedWith = [];
const mockModels = {
  auditRows: [],
  attachments: [],
  updated: [],
};

jest.mock("../../models", () => ({
  AuditLog: {
    findAll: jest.fn(async ({ where }) =>
      mockModels.auditRows.filter((row) => {
        if (row.tenantId !== where.tenantId || row.action !== where.action) {return false;}
        if (where.changes) {
          return (
            row.changes &&
            row.changes.operation === where.changes.operation &&
            row.changes.cascade &&
            row.changes.cascade.type === where.changes.cascade.type &&
            row.changes.cascade.id === where.changes.cascade.id
          );
        }
        return where.resourceId.includes(row.resourceId);
      }),
    ),
  },
  Attachment: {
    unscoped: () => ({
      findAll: jest.fn(async ({ where, lock }) => {
        mockLockedWith.push(lock);
        return mockModels.attachments.filter(
          (row) => where.id.includes(row.id) && row.tenantId === where.tenantId && row.isDeleted === where.isDeleted,
        );
      }),
      update: jest.fn(async (values, { where }) => {
        mockModels.updated.push({ values, where });
        return [where.id.length];
      }),
    }),
  },
  Certificate: {},
}));

const auditService = require("../../services/audit.service");
const attachments = require("../../services/attachment.service");

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE = "d0000000-0000-4000-8000-00000000000a";
const OTHER_DEVICE = "d0000000-0000-4000-8000-00000000000c";
const ATT = "e0000000-0000-4000-8000-000000000001";
const tx = { id: "tx" };

const deleteRow = (resourceId, changes, at) => ({
  tenantId: TENANT,
  action: "DELETE",
  resourceType: "Attachment",
  resourceId,
  changes,
  createdAt: new Date(at),
});
const cascadeOf = (id) => ({ operation: "cascade-soft-delete", cascade: { type: "CalibrationDevice", id } });

beforeEach(() => {
  jest.clearAllMocks();
  mockModels.auditRows = [];
  // The attachment is still deleted unless a test says otherwise, so each
  // decision below is taken by the audit rule, not by an empty lock.
  mockModels.attachments = [
    { id: ATT, tenantId: TENANT, isDeleted: true, resourceType: "device", resourceId: DEVICE, originalName: "a.pdf", checksum: "c" },
  ];
  mockModels.updated = [];
  mockLockedWith.length = 0;
});

const restore = (options = { transaction: tx }) =>
  attachments.restoreForResource(TENANT, "CalibrationDevice", DEVICE, options);

describe("A-133 — restoreForResource", () => {
  it("refuses a model that nothing links to — a programming error, not input", async () => {
    await expect(attachments.restoreForResource(TENANT, "Nope", DEVICE, { transaction: tx })).rejects.toThrow(
      /Nope is not a linkable resource/,
    );
  });

  it("refuses to run outside the parent restore's transaction", async () => {
    await expect(restore({})).rejects.toThrow(/inside the parent restore's transaction/);
    await expect(attachments.restoreForResource(TENANT, "CalibrationDevice", DEVICE)).rejects.toThrow(
      /inside the parent restore's transaction/,
    );
  });

  it("nothing was ever cascaded from this parent: restores nothing", async () => {
    await expect(restore()).resolves.toEqual([]);
    expect(mockModels.updated).toEqual([]);
  });

  it("a cascade row without a resource id is ignored", async () => {
    mockModels.auditRows = [{ ...deleteRow(null, cascadeOf(DEVICE), "2026-09-01"), resourceId: null }];
    await expect(restore()).resolves.toEqual([]);
  });

  it("the latest DELETE is the deleted-file sweep's (ADR-083): stays deleted — its bytes are gone", async () => {
    mockModels.auditRows = [
      deleteRow(ATT, { operation: "file-purge", file: "removed" }, "2026-12-01"),
      deleteRow(ATT, cascadeOf(DEVICE), "2026-09-01"),
    ];
    await expect(restore()).resolves.toEqual([]);
    expect(mockModels.updated).toEqual([]);
  });

  it("the latest DELETE is an explicit one (no changes recorded): stays deleted", async () => {
    // Newest first, as the service's ORDER BY created_at DESC returns them.
    mockModels.auditRows = [
      deleteRow(ATT, null, "2026-08-15"),
      deleteRow(ATT, cascadeOf(DEVICE), "2026-08-01"),
    ];
    await expect(restore()).resolves.toEqual([]);
  });

  it("the latest DELETE cascaded from ANOTHER parent: stays deleted", async () => {
    mockModels.auditRows = [
      deleteRow(ATT, cascadeOf(OTHER_DEVICE), "2026-09-05"),
      deleteRow(ATT, cascadeOf(DEVICE), "2026-09-01"),
    ];
    await expect(restore()).resolves.toEqual([]);
  });

  it("the latest DELETE is a cascade of another kind of parent: stays deleted", async () => {
    mockModels.auditRows = [
      deleteRow(ATT, { operation: "cascade-soft-delete", cascade: { type: "Certificate", id: DEVICE } }, "2026-09-05"),
      deleteRow(ATT, cascadeOf(DEVICE), "2026-09-01"),
    ];
    await expect(restore()).resolves.toEqual([]);
  });

  it("a cascade row with no cascade object is not this parent's", async () => {
    mockModels.auditRows = [
      deleteRow(ATT, { operation: "cascade-soft-delete" }, "2026-09-05"),
      deleteRow(ATT, cascadeOf(DEVICE), "2026-09-01"),
    ];
    await expect(restore()).resolves.toEqual([]);
  });

  it("taken by this parent but already live again (restored by other means): nothing to write", async () => {
    mockModels.auditRows = [deleteRow(ATT, cascadeOf(DEVICE), "2026-09-01")];
    mockModels.attachments = [{ id: ATT, tenantId: TENANT, isDeleted: false }];
    await expect(restore()).resolves.toEqual([]);
    expect(mockModels.updated).toEqual([]);
  });

  it("taken by this parent and still deleted: restored, with a null actor when none is given", async () => {
    mockModels.auditRows = [deleteRow(ATT, cascadeOf(DEVICE), "2026-09-01")];

    await expect(restore()).resolves.toEqual([ATT]);
    // Locked before the history is read (ADR-083's sweep locks what it purges).
    expect(mockLockedWith).toEqual([true]);
    expect(mockModels.updated).toEqual([
      { values: { isDeleted: false }, where: { id: [ATT], tenantId: TENANT, isDeleted: true } },
    ]);
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        userId: null,
        action: "UPDATE",
        resourceId: ATT,
        ipAddress: null,
        userAgent: null,
        changes: expect.objectContaining({
          operation: "cascade-restore",
          resource: { type: "device", id: DEVICE },
          cascade: { type: "CalibrationDevice", id: DEVICE },
        }),
      }),
      { transaction: tx },
    );
  });
});
