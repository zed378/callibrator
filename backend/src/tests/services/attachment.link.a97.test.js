/**
 * A-97 — POST /attachments accepted any `resourceId`.
 *
 * `createAttachment` stored `(resourceType, resourceId)` as given. The tenant
 * is stamped from the principal, so the row could not cross tenants — but it
 * could name another tenant's record, a deleted one, or none at all, and a
 * later reader that follows the link (certificate evidence: the delete lock in
 * deleteAttachment reads the parent certificate's state) trusted it.
 *
 * Now a `resourceId` must resolve, for its `resourceType`, to a live record of
 * the caller's tenant. Missing, soft-deleted and another tenant's answer the
 * same 404 (CLAUDE.md). A type that cannot be linked, or a malformed id, is
 * 400. In every refusal the uploaded file is removed — multer has already
 * written it — and no row is created.
 */

jest.mock("../../models", () => {
  const model = () => ({ findOne: jest.fn() });
  return {
    Attachment: { create: jest.fn(), findOne: jest.fn() },
    Certificate: model(),
    CalibrationDevice: { ...model(), rawAttributes: { isDeleted: {} } },
    CalibrationRecord: { ...model(), rawAttributes: { isDeleted: {} } },
    MaintenanceWorkOrder: model(),
    KanbanCard: model(),
    AuditLog: { create: jest.fn() },
  };
});

// A-117: createAttachment writes the row and its audit row in one transaction.
jest.mock("../../config", () => ({ db: { transaction: jest.fn(async (cb) => cb("TX")) } }));

jest.mock("../../utils/upload.util", () => ({
  getUploadUrl: (fileName, folder) => `/${folder}/${fileName}`,
}));

jest.mock("../../services/virusScan.service", () => ({
  scanFile: jest.fn().mockResolvedValue({ clean: true }),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("fs", () => ({
  createReadStream: jest.fn(() => {
    const EventEmitter = require("events");
    const emitter = new EventEmitter();
    setImmediate(() => {
      emitter.emit("data", Buffer.from("x"));
      emitter.emit("end");
    });
    return emitter;
  }),
  promises: { unlink: jest.fn().mockResolvedValue(undefined) },
  existsSync: jest.fn().mockReturnValue(true),
}));

const fs = require("fs");
const models = require("../../models");
const virusScan = require("../../services/virusScan.service");
const attachmentService = require("../../services/attachment.service");

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECORD = "11111111-1111-4111-8111-111111111111";
const FILE = {
  path: "/uploads/attachments/f.pdf",
  filename: "f.pdf",
  originalname: "F.pdf",
  mimetype: "application/pdf",
  size: 1,
};

beforeEach(() => {
  jest.clearAllMocks();
  models.Attachment.create.mockImplementation(async (values) => ({
    id: "att-1",
    folder: "uploads/attachments",
    ...values,
  }));
});

const create = (meta) => attachmentService.createAttachment(TENANT, FILE, meta);

describe("A-97 — a linked resourceId must be a live record of the caller's tenant", () => {
  it.each([
    ["certificate", "Certificate", {}],
    ["Certificate", "Certificate", {}],
    ["device", "CalibrationDevice", { isDeleted: false }],
    ["calibrationDevice", "CalibrationDevice", { isDeleted: false }],
    ["calibration", "CalibrationRecord", { isDeleted: false }],
    ["CalibrationRecord", "CalibrationRecord", { isDeleted: false }],
    ["workorder", "MaintenanceWorkOrder", {}],
    ["MaintenanceWorkOrder", "MaintenanceWorkOrder", {}],
    ["KanbanCard", "KanbanCard", {}],
  ])(
    "%s → %s: looked up with the explicit tenant predicate; found → stored",
    async (resourceType, modelName, extraWhere) => {
      models[modelName].findOne.mockResolvedValue({ id: RECORD });

      const result = await create({ resourceType, resourceId: RECORD, uploadedBy: "u-1" });

      expect(models[modelName].findOne).toHaveBeenCalledWith({
        where: { id: RECORD, tenantId: TENANT, ...extraWhere },
        attributes: ["id"],
      });
      expect(result).toMatchObject({ resourceType, resourceId: RECORD });
      expect(fs.promises.unlink).not.toHaveBeenCalled();
    },
  );

  it("another tenant's record (the predicate matches nothing) is 404; the file is removed and no row is written", async () => {
    models.Certificate.findOne.mockResolvedValue(null);

    await expect(
      create({ resourceType: "certificate", resourceId: RECORD }),
    ).rejects.toMatchObject({ status: 404, message: "Resource not found" });

    expect(fs.promises.unlink).toHaveBeenCalledWith(FILE.path);
    expect(models.Attachment.create).not.toHaveBeenCalled();
    expect(virusScan.scanFile).not.toHaveBeenCalled();
  });

  it("a malformed resourceId is 400 before any lookup; the file is removed", async () => {
    await expect(
      create({ resourceType: "certificate", resourceId: "c-1" }),
    ).rejects.toMatchObject({ status: 400 });

    expect(models.Certificate.findOne).not.toHaveBeenCalled();
    expect(fs.promises.unlink).toHaveBeenCalledWith(FILE.path);
    expect(models.Attachment.create).not.toHaveBeenCalled();
  });

  it.each(["generic", "post", "somethingElse"])(
    "a resourceId with a type that cannot be linked (%s) is 400; the file is removed",
    async (resourceType) => {
      await expect(create({ resourceType, resourceId: RECORD })).rejects.toMatchObject({
        status: 400,
      });

      expect(fs.promises.unlink).toHaveBeenCalledWith(FILE.path);
      expect(models.Attachment.create).not.toHaveBeenCalled();
    },
  );

  it("a resourceId with no resourceType is 400 (the default type is unlinked)", async () => {
    await expect(create({ resourceId: RECORD })).rejects.toMatchObject({ status: 400 });
    expect(models.Attachment.create).not.toHaveBeenCalled();
  });

  it.each([undefined, null, ""])(
    "no resourceId (%s): a standalone file, nothing looked up",
    async (resourceId) => {
      const result = await create({ resourceType: "post", resourceId });

      expect(result.resourceId).toBeNull();
      for (const name of ["Certificate", "CalibrationDevice", "KanbanCard"]) {
        expect(models[name].findOne).not.toHaveBeenCalled();
      }
    },
  );

  it("a refusal whose clean-up fails still reports the refusal", async () => {
    models.KanbanCard.findOne.mockResolvedValue(null);
    fs.promises.unlink.mockRejectedValueOnce(new Error("EPERM"));

    await expect(
      create({ resourceType: "KanbanCard", resourceId: RECORD }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
