/**
 * A-117 — two mutations wrote no audit row.
 *
 *  - attachment.service#createAttachment: an upload — including evidence
 *    attached to a certificate — was stored with no row saying who added it.
 *  - tenant.service#updateTenantSettings: a tenant's settings changed with no
 *    row at all.
 *
 * Both now write the row INSIDE the mutation's transaction (CLAUDE.md, "Every
 * mutation writes an audit row, inside the transaction"): the row is written
 * with the same transaction object as the change, and a failed audit insert
 * fails the change. The audit insert itself is faked at audit.service, whose
 * own suite covers logAction; what is asserted is the call and its transaction.
 */

jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../services/redis.service", () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  delPattern: jest.fn(),
  cacheKeys: { tenantSettings: (id) => `tenant:settings:${id}` },
}));

jest.mock("../../utils/upload.util", () => ({
  getUploadUrl: (fileName, folder) => `/${folder}/${fileName}`,
  deleteUpload: jest.fn(),
  // S-17: the service promotes the scanned file out of quarantine.
  promoteFromQuarantine: jest.fn(async (file) => file.path),
}));

jest.mock("../../services/virusScan.service", () => ({
  scanFile: jest.fn().mockResolvedValue({ clean: true }),
}));

jest.mock("fs", () => {
  const actual = jest.requireActual("fs");
  return {
    ...actual,
    createReadStream: jest.fn(() => {
      const EventEmitter = require("events");
      const emitter = new EventEmitter();
      setImmediate(() => {
        emitter.emit("data", Buffer.from("hello"));
        emitter.emit("end");
      });
      return emitter;
    }),
    promises: { ...actual.promises, unlink: jest.fn().mockResolvedValue(undefined) },
  };
});

// A managed transaction for attachments (db.transaction(cb)), an unmanaged one
// for tenant settings (await db.transaction()) — each service's own shape.
const mockTx = { id: "TX", finished: undefined };
jest.mock("../../config", () => ({
  db: {
    transaction: jest.fn(async (cb) => {
      if (typeof cb === "function") {
        return cb(mockTx);
      }
      return mockTx;
    }),
  },
}));

jest.mock("../../models", () => ({
  Attachment: { create: jest.fn(), findOne: jest.fn() },
  Certificate: { findOne: jest.fn() },
  Tenants: { findByPk: jest.fn() },
  Users: {},
  TenantSettings: { findOrCreate: jest.fn(), findAll: jest.fn() },
}));

const fs = require("fs");
const models = require("../../models");
const auditService = require("../../services/audit.service");
const attachmentService = require("../../services/attachment.service");
const tenantService = require("../../services/tenant.service");

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FILE = {
  path: "/uploads/attachments/f.pdf",
  filename: "f.pdf",
  originalname: "Calibration evidence.pdf",
  mimetype: "application/pdf",
  size: 5,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockTx.finished = undefined;
  mockTx.commit = jest.fn(async () => {
    mockTx.finished = "commit";
  });
  mockTx.rollback = jest.fn(async () => {
    mockTx.finished = "rollback";
  });
  auditService.logAction.mockResolvedValue({ id: "audit-1" });
});

describe("A-117 — createAttachment is audited in its transaction", () => {
  beforeEach(() => {
    models.Attachment.create.mockImplementation(async (values) => ({
      id: "att-1",
      ...values,
    }));
  });

  it("writes one CREATE row, with the attachment's transaction, naming the uploader", async () => {
    await attachmentService.createAttachment(TENANT, FILE, {
      uploadedBy: "u-1",
      ipAddress: "203.0.113.7",
      userAgent: "jest",
    });

    expect(models.Attachment.create).toHaveBeenCalledWith(expect.any(Object), {
      transaction: mockTx,
    });
    expect(auditService.logAction).toHaveBeenCalledTimes(1);
    expect(auditService.logAction).toHaveBeenCalledWith(
      {
        tenantId: TENANT,
        userId: "u-1",
        action: "CREATE",
        resourceType: "Attachment",
        resourceId: "att-1",
        changes: {
          originalName: "Calibration evidence.pdf",
          mimeType: "application/pdf",
          size: 5,
          // sha256("hello")
          checksum: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
          resource: { type: "generic", id: null },
        },
        ipAddress: "203.0.113.7",
        userAgent: "jest",
      },
      { transaction: mockTx },
    );
  });

  it("a failed audit insert fails the upload and removes the file multer wrote", async () => {
    auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));

    await expect(
      attachmentService.createAttachment(TENANT, FILE, { uploadedBy: "u-1" }),
    ).rejects.toThrow("audit insert failed");

    expect(fs.promises.unlink).toHaveBeenCalledWith(FILE.path);
  });

  it("a failed audit insert is still the error reported when the file is already gone", async () => {
    auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));
    fs.promises.unlink.mockRejectedValueOnce(new Error("ENOENT"));

    await expect(
      attachmentService.createAttachment(TENANT, FILE, { uploadedBy: "u-1" }),
    ).rejects.toThrow("audit insert failed");
  });

  it("with no actor details, the row still names the tenant and a null actor", async () => {
    await attachmentService.createAttachment(TENANT, FILE);

    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, userId: null, ipAddress: null, userAgent: null }),
      { transaction: mockTx },
    );
  });
});

describe("A-117 — updateTenantSettings is audited in its transaction", () => {
  const tenant = () => ({ id: TENANT, update: jest.fn().mockResolvedValue(undefined) });

  beforeEach(() => {
    models.Tenants.findByPk.mockResolvedValue(tenant());
    models.TenantSettings.findAll.mockResolvedValue([]);
  });

  it("writes one UPDATE row before the commit, naming the created and changed keys — never their values", async () => {
    const existingSame = { value: "id", update: jest.fn().mockResolvedValue(undefined) };
    const existingChanged = { value: "light", update: jest.fn().mockResolvedValue(undefined) };
    models.TenantSettings.findOrCreate.mockImplementation(async ({ where }) => {
      if (where.key === "sso_idp_entity_id") {return [existingSame, false];}
      if (where.key === "ai_vendor") {return [existingChanged, false];}
      return [{ value: "x" }, true];
    });

    await tenantService.updateTenantSettings(
      TENANT,
      { ai_vendor: "dark", sso_idp_entity_id: "id", ai_api_key: "hunter2" },
      "u-admin",
      { userId: "u-admin", ipAddress: "203.0.113.7", userAgent: "jest" },
    );

    expect(auditService.logAction).toHaveBeenCalledTimes(1);
    const [row, options] = auditService.logAction.mock.calls[0];
    expect(options).toEqual({ transaction: mockTx });
    expect(row).toEqual({
      tenantId: TENANT,
      userId: "u-admin",
      action: "UPDATE",
      resourceType: "TenantSettings",
      resourceId: TENANT,
      changes: { operation: "UPDATE_SETTINGS", created: ["ai_api_key"], changed: ["ai_vendor"] },
      ipAddress: "203.0.113.7",
      userAgent: "jest",
    });
    expect(JSON.stringify(row)).not.toContain("hunter2");

    // Written before the commit, i.e. inside the transaction.
    expect(auditService.logAction.mock.invocationCallOrder[0]).toBeLessThan(
      mockTx.commit.mock.invocationCallOrder[0],
    );
  });

  it("a failed audit insert rolls the settings back and fails the request", async () => {
    models.TenantSettings.findOrCreate.mockResolvedValue([{ value: "x" }, true]);
    auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));

    await expect(
      tenantService.updateTenantSettings(TENANT, { ai_vendor: "dark" }, "u-admin", { userId: "u-admin" }),
    ).rejects.toThrow("audit insert failed");

    expect(mockTx.commit).not.toHaveBeenCalled();
    expect(mockTx.rollback).toHaveBeenCalledTimes(1);
  });

  it("without an actor object the row falls back to updatedBy as the actor", async () => {
    models.TenantSettings.findOrCreate.mockResolvedValue([{ value: "x" }, true]);

    await tenantService.updateTenantSettings(TENANT, { ai_vendor: "dark" }, "u-admin");

    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u-admin", ipAddress: null, userAgent: null }),
      { transaction: mockTx },
    );
  });
});
