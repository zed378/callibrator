/**
 * D-22 (ADR-083) — the two remainders of the polymorphic attachment link that
 * live in attachment.service.
 *
 * 1. `resourceType` was a FREE STRING on an unlinked upload: A-97 checked the
 *    type only when a `resourceId` came with it, so `"certficate"` or
 *    `"anything"` was stored as given — a file attached to a type nothing
 *    would ever query. It is now one of constants/attachmentResources
 *    (ignoring case) on every upload, linked or not: a 400 that names the
 *    types, before the virus scan, with the uploaded file removed. The model
 *    refuses it on every create path too, but validates it only when it is
 *    WRITTEN, so a row stored before the list existed can still be
 *    soft-deleted.
 * 2. A kanban PROJECT's delete did not reach its cards' files. The cascade now
 *    takes an array of parent ids (a page of cards), and each audit row names
 *    its own card, with the project as `changes.cascade.via` — so a card's
 *    restore would still restore exactly its files.
 *
 * kanban.service.test.js asserts the project delete calls this in its
 * transaction; dataLayer.dbD.live.test.js runs both on PostgreSQL 18.
 */

// P8-01 (ADR-086 Amendment 1): a scanned upload is put into the tenant's
// storage. The double keeps the real key rules (fixtures/fakeStorage).
jest.mock("../../services/storage", () => require("../fixtures/fakeStorage").createFakeStorage());
jest.mock("../../models", () => ({
  Attachment: { create: jest.fn(), findAll: jest.fn(), update: jest.fn(), findOne: jest.fn() },
  Certificate: { findOne: jest.fn() },
}));
jest.mock("../../config", () => ({ db: { transaction: jest.fn(async (cb) => cb("TX")) } }));
jest.mock("../../utils/upload.util", () => ({
  promoteFromQuarantine: jest.fn(async (file) => file.path),
  // P8-01: the attachment path checks the file is in quarantine, then puts it
  // into storage (promoteFromQuarantine is no longer on it).
  assertInQuarantine: jest.fn((filePath) => filePath),
}));
jest.mock("../../services/virusScan.service", () => ({
  scanFile: jest.fn().mockResolvedValue({ clean: true }),
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const fs = require("fs");
const { Sequelize, DataTypes } = require("sequelize");
const { Attachment } = require("../../models");
const virusScan = require("../../services/virusScan.service");
const auditService = require("../../services/audit.service");
const attachmentService = require("../../services/attachment.service");
const {
  ATTACHMENT_RESOURCE_TYPES,
  LINKABLE_RESOURCES,
  STANDALONE_RESOURCE_TYPES,
  isAttachmentResourceType,
} = require("../../constants/attachmentResources");

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT = "99999999-9999-4999-8999-999999999999";
const file = () => ({
  path: "/q/upload.pdf",
  filename: "upload.pdf",
  originalname: "evidence.pdf",
  mimetype: "application/pdf",
  size: 3,
});

let unlink;
beforeEach(() => {
  jest.clearAllMocks();
  unlink = jest.spyOn(fs.promises, "unlink").mockResolvedValue(undefined);
  jest.spyOn(fs, "createReadStream").mockImplementation(() => {
    const EventEmitter = require("events");
    const emitter = new EventEmitter();
    setImmediate(() => {
      emitter.emit("data", Buffer.from("x"));
      emitter.emit("end");
    });
    return emitter;
  });
  Attachment.create.mockImplementation(async (values) => ({ id: "att-1", ...values }));
});

describe("D-22 (ADR-083) — one list of attachment resource types", () => {
  it("is the linkable types plus the standalone ones, and the service uses the same map", () => {
    expect(ATTACHMENT_RESOURCE_TYPES).toEqual([...Object.keys(LINKABLE_RESOURCES), ...STANDALONE_RESOURCE_TYPES]);
    expect(STANDALONE_RESOURCE_TYPES).toEqual(["generic", "ticket", "post"]);
    expect(attachmentService.LINKABLE_RESOURCES).toBe(LINKABLE_RESOURCES);
    expect(Object.isFrozen(ATTACHMENT_RESOURCE_TYPES)).toBe(true);
  });

  it("matches without regard to case, and refuses what is not a string", () => {
    for (const value of ["KanbanCard", "Ticket", "DEVICE", "generic", "calibrationRecord"]) {
      expect({ value, known: isAttachmentResourceType(value) }).toEqual({ value, known: true });
    }
    for (const value of ["certficate", "", "anything", null, undefined, ["device"], 7]) {
      expect({ value, known: isAttachmentResourceType(value) }).toEqual({ value, known: false });
    }
  });
});

describe("D-22 (ADR-083) — createAttachment refuses an unknown type, linked or not", () => {
  it("400 naming the allowed types for an UNLINKED upload with a free-string type; the file is removed and nothing is stored", async () => {
    await expect(
      attachmentService.createAttachment(TENANT, file(), { resourceType: "certficate" }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('resourceType "certficate" is not an attachment type — use one of: certificate, device,'),
    });
    expect(unlink).toHaveBeenCalledWith("/q/upload.pdf");
    expect(virusScan.scanFile).not.toHaveBeenCalled();
    expect(Attachment.create).not.toHaveBeenCalled();
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("refuses a repeated multipart field (an array), too", async () => {
    await expect(
      attachmentService.createAttachment(TENANT, file(), { resourceType: ["device", "device"] }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    [undefined, "generic"],
    ["", "generic"],
    ["Ticket", "Ticket"],
    ["generic", "generic"],
    ["post", "post"],
  ])("stores a known standalone type (%p) as given", async (resourceType, stored) => {
    await attachmentService.createAttachment(TENANT, file(), { resourceType });
    expect(Attachment.create).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: stored, resourceId: null }),
      { transaction: "TX" },
    );
  });
});

describe("D-22 (ADR-083) — the model refuses an unknown type when it is written, and only then", () => {
  const mockQueries = [];
  const sequelize = new Sequelize({ dialect: "postgres", logging: false });
  sequelize.query = async (sql, options = {}) => {
    mockQueries.push(typeof sql === "string" ? sql : sql.query);
    // An instance save reads back [the updated instance, rows affected].
    return [options.instance || [], 1];
  };
  const Model = require("../../models/attachment.model")(sequelize, DataTypes);
  const base = { tenantId: TENANT, fileName: "f.bin", originalName: "f.pdf" };

  it("a new row with a free-string type fails validation before any SQL", async () => {
    await expect(Model.build({ ...base, resourceType: "anything" }).validate()).rejects.toThrow(
      'resourceType "anything" is not one of: certificate,',
    );
    await expect(Model.build({ ...base, resourceType: "KanbanCard" }).validate()).resolves.toBeDefined();
  });

  it("a row stored before the list existed can still be soft-deleted — save() validates only what it changes", async () => {
    // As a row read from the database: nothing changed yet.
    const legacy = Model.build({ ...base, id: "11111111-1111-4111-8111-111111111111", resourceType: "legacy-typo" }, {
      isNewRecord: false,
      raw: true,
    });
    expect(legacy.changed()).toBe(false);
    legacy.isDeleted = true;
    mockQueries.length = 0;
    await legacy.save({ hooks: false });
    expect(mockQueries.join("\n")).toMatch(/^UPDATE "attachments" SET "is_deleted"=\$1/m);
  });
});

describe("D-22 (ADR-083) — softDeleteForResource over a page of parents", () => {
  const row = (id, resourceId) => ({ id, resourceType: "KanbanCard", resourceId, originalName: `${id}.pdf`, checksum: `s-${id}` });

  it("soft-deletes every page's attachment, each audit row naming its own card and the project as `via`", async () => {
    Attachment.findAll.mockResolvedValueOnce([row("a-1", "card-1"), row("a-2", "card-2"), row("a-3", "card-2")]);

    const ids = await attachmentService.softDeleteForResource(TENANT, "KanbanCard", ["card-1", "card-2"], {
      transaction: "TX",
      actor: { userId: "u-1" },
      via: { type: "KanbanProject", id: PROJECT },
    });

    expect(ids).toEqual(["a-1", "a-2", "a-3"]);
    expect(Attachment.findAll.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ tenantId: TENANT, resourceId: ["card-1", "card-2"] }),
    );
    expect(Attachment.update).toHaveBeenCalledWith(
      { isDeleted: true },
      { where: { id: ["a-1", "a-2", "a-3"], tenantId: TENANT }, transaction: "TX" },
    );
    expect(auditService.logAction.mock.calls.map(([entry]) => entry.changes.cascade)).toEqual([
      { type: "KanbanCard", id: "card-1", via: { type: "KanbanProject", id: PROJECT } },
      { type: "KanbanCard", id: "card-2", via: { type: "KanbanProject", id: PROJECT } },
      { type: "KanbanCard", id: "card-2", via: { type: "KanbanProject", id: PROJECT } },
    ]);
    for (const [, options] of auditService.logAction.mock.calls) {
      expect(options).toEqual({ transaction: "TX" });
    }
  });

  it("a single parent without `via` is recorded exactly as before", async () => {
    Attachment.findAll.mockResolvedValueOnce([row("a-9", "card-9")]);
    await attachmentService.softDeleteForResource(TENANT, "KanbanCard", "card-9", { transaction: "TX" });
    expect(auditService.logAction.mock.calls[0][0].changes.cascade).toEqual({ type: "KanbanCard", id: "card-9" });
  });
});
