/**
 * D-22 (ADR-070) — a parent's soft delete left its attachments live, and no
 * report could find the attachments whose parent was already gone.
 *
 *  - softDeleteForResource: the parent's delete soft-deletes every live
 *    attachment linked to it — under ANY spelling of its type, case-insensitive
 *    — in the parent's transaction, with one DELETE audit row per attachment
 *    naming the parent (`changes.cascade`). The file is not unlinked.
 *  - listOrphans: the tenant's live attachments whose link resolves to no live
 *    record of the SAME tenant, paginated into the response envelope.
 *
 * The parent services' own tests assert each delete calls the cascade in its
 * transaction (certificate, calibrationDevices, maintenance, kanban).
 * dataLayer.dbC.live.test.js runs both against PostgreSQL 18.
 */

jest.mock("../../models", () => ({
  Attachment: { findAll: jest.fn(), update: jest.fn(), findOne: jest.fn() },
  Certificate: { findOne: jest.fn() },
}));

jest.mock("../../config", () => ({
  db: { transaction: jest.fn(async (cb) => cb("TX")), query: jest.fn() },
}));

jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn().mockResolvedValue({}),
}));

jest.mock("../../services/virusScan.service", () => ({ scanFile: jest.fn() }));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const fs = require("fs");
const { Op } = require("sequelize");
const { Attachment } = require("../../models");
const { db } = require("../../config");
const auditService = require("../../services/audit.service");
const attachmentService = require("../../services/attachment.service");

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CERT = "11111111-1111-4111-8111-111111111111";
const ACTOR = { userId: "u-1", ipAddress: "10.0.0.1", userAgent: "jest" };

const row = (id, resourceType) => ({
  id,
  resourceType,
  resourceId: CERT,
  originalName: `${id}.pdf`,
  checksum: `sum-${id}`,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("D-22 — softDeleteForResource", () => {
  it("soft-deletes every linked attachment in the parent's transaction, one audit row each, and keeps the file", async () => {
    const rmSpy = jest.spyOn(fs.promises, "rm");
    Attachment.findAll.mockResolvedValueOnce([row("a-1", "certificate"), row("a-2", "Certificate")]);

    const ids = await attachmentService.softDeleteForResource(TENANT, "Certificate", CERT, {
      transaction: "TX",
      actor: ACTOR,
    });

    expect(ids).toEqual(["a-1", "a-2"]);
    expect(Attachment.update).toHaveBeenCalledWith(
      { isDeleted: true },
      { where: { id: ["a-1", "a-2"], tenantId: TENANT }, transaction: "TX" },
    );
    expect(auditService.logAction).toHaveBeenCalledTimes(2);
    expect(auditService.logAction).toHaveBeenNthCalledWith(
      2,
      {
        tenantId: TENANT,
        userId: "u-1",
        action: "DELETE",
        resourceType: "Attachment",
        resourceId: "a-2",
        changes: {
          operation: "cascade-soft-delete",
          before: { isDeleted: false },
          after: { isDeleted: true },
          originalName: "a-2.pdf",
          checksum: "sum-a-2",
          resource: { type: "Certificate", id: CERT },
          cascade: { type: "Certificate", id: CERT },
        },
        ipAddress: "10.0.0.1",
        userAgent: "jest",
      },
      { transaction: "TX" },
    );
    // Evidence bytes are not destroyed by a parent delete.
    expect(rmSpy).not.toHaveBeenCalled();
    rmSpy.mockRestore();
  });

  it("matches every spelling that links to the model, lower-cased, inside the tenant, in the transaction", async () => {
    Attachment.findAll.mockResolvedValueOnce([]);

    await attachmentService.softDeleteForResource(TENANT, "CalibrationDevice", CERT, { transaction: "TX" });

    const [options] = Attachment.findAll.mock.calls[0];
    expect(options.transaction).toBe("TX");
    expect(options.where.tenantId).toBe(TENANT);
    expect(options.where.resourceId).toBe(CERT);
    const [typeClause] = options.where[Op.and];
    expect(typeClause.attribute.fn).toBe("lower");
    expect(typeClause.attribute.args[0].col).toBe("resource_type");
    expect(typeClause.logic[Op.in]).toEqual(["device", "calibrationdevice"]);
  });

  it("writes nothing when the parent has no live attachments", async () => {
    Attachment.findAll.mockResolvedValueOnce([]);

    await expect(
      attachmentService.softDeleteForResource(TENANT, "KanbanCard", CERT, { transaction: "TX" }),
    ).resolves.toEqual([]);
    expect(Attachment.update).not.toHaveBeenCalled();
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("records a missing actor field as null rather than undefined", async () => {
    Attachment.findAll.mockResolvedValueOnce([row("a-1", "workorder")]);

    await attachmentService.softDeleteForResource(TENANT, "MaintenanceWorkOrder", CERT, {
      transaction: "TX",
    });

    const [entry] = auditService.logAction.mock.calls[0];
    expect(entry.userId).toBeNull();
    expect(entry.ipAddress).toBeNull();
    expect(entry.userAgent).toBeNull();
  });

  it("a failing audit row rejects, so the parent's transaction rolls back with it", async () => {
    Attachment.findAll.mockResolvedValueOnce([row("a-1", "certificate")]);
    auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));

    await expect(
      attachmentService.softDeleteForResource(TENANT, "Certificate", CERT, { transaction: "TX", actor: ACTOR }),
    ).rejects.toThrow("audit insert failed");
  });

  it("refuses a model that cannot be linked, and a call outside a transaction — programming errors", async () => {
    await expect(
      attachmentService.softDeleteForResource(TENANT, "Stock", CERT, { transaction: "TX" }),
    ).rejects.toThrow("Stock is not a linkable resource");
    await expect(attachmentService.softDeleteForResource(TENANT, "Certificate", CERT)).rejects.toThrow(
      "inside the parent delete's transaction",
    );
    expect(Attachment.findAll).not.toHaveBeenCalled();
  });
});

describe("D-22 — listOrphans", () => {
  const answer = (total, rows) => {
    db.query.mockImplementation(async (sql) => (/count\(\*\)/.test(sql) ? [[{ total }]] : [rows]));
  };

  it("reports the caller's tenant's orphans in the envelope shape, sizes as numbers", async () => {
    answer(3, [{ id: "a-1", size: "2048", reason: "parent_missing_or_deleted" }]);

    const result = await attachmentService.listOrphans(TENANT, { page: "2", limit: "2" });

    expect(result).toEqual({
      rows: [{ id: "a-1", size: 2048, reason: "parent_missing_or_deleted" }],
      meta: { total: 3, page: 2, limit: 2, totalPages: 2 },
    });
    for (const [, options] of db.query.mock.calls) {
      expect(options.replacements.tenantId).toBe(TENANT);
    }
    const rowsCall = db.query.mock.calls.find(([sql]) => /LIMIT :limit/.test(sql));
    expect(rowsCall[1].replacements).toEqual({ tenantId: TENANT, limit: 2, offset: 2 });
  });

  it("defaults and caps the page size, and never pages below 1", async () => {
    answer(0, []);

    const defaults = await attachmentService.listOrphans(TENANT);
    const capped = await attachmentService.listOrphans(TENANT, { page: "-4", limit: "100000" });

    expect(defaults.meta).toEqual({ total: 0, page: 1, limit: 25, totalPages: 0 });
    expect(capped.meta.page).toBe(1);
    expect(capped.meta.limit).toBe(200);

    const junk = await attachmentService.listOrphans(TENANT, { page: "abc", limit: "0" });
    expect(junk.meta.page).toBe(1);
    expect(junk.meta.limit).toBe(25);
  });

  it("the SQL is tenant-bound on the attachment AND on the parent, and skips deleted attachments", async () => {
    answer(0, []);
    await attachmentService.listOrphans(TENANT);

    const sqls = db.query.mock.calls.map(([sql]) => sql);
    for (const sql of sqls) {
      expect(sql).toMatch(/a\.tenant_id = :tenantId/);
      expect(sql).toMatch(/a\.is_deleted = false/);
      expect(sql).toMatch(/a\.deleted_at IS NULL/);
      expect(sql).toMatch(/a\.resource_id IS NOT NULL/);
      // Another tenant's record never makes an attachment's link live.
      expect(sql.match(/p\.tenant_id = a\.tenant_id/g)).toHaveLength(
        Object.keys(attachmentService.LIVE_PARENTS).length,
      );
    }
    // A voided calibration record keeps its files: only deleted_at decides.
    expect(attachmentService.LIVE_PARENTS.CalibrationRecord.live).toBe("p.deleted_at IS NULL");
    expect(attachmentService.LIVE_PARENTS.CalibrationDevice.live).toMatch(/p\.is_deleted = false/);
  });

  it("every linkable model has a liveness rule, so a new linkable type cannot be silently reported as orphaned", () => {
    const linkedModels = new Set(Object.values(attachmentService.LINKABLE_RESOURCES));
    expect(new Set(Object.keys(attachmentService.LIVE_PARENTS))).toEqual(linkedModels);
  });
});
