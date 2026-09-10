/**
 * Tests for attachment.service.js
 *
 * Covers: createAttachment, listAttachments, getAttachment, getDownload,
 * deleteAttachment, generateSignedUrl, getSignedDownload, _verifySignedToken
 */

jest.mock("../../models", () => ({
  Attachment: {
    findAndCountAll: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
    findOne: jest.fn(),
  },
}));

jest.mock(
  "../../utils/storagePath.util",
  () =>
    (...parts) =>
      "C:/uploads/" + parts.join("/"),
);

jest.mock("../../utils/appError.util", () => {
  class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.name = "AppError";
      this.status = status;
    }
  }
  return { AppError };
});

jest.mock("../../utils/upload.util", () => ({
  getUploadUrl: (fileName, folder) => "/uploads/" + folder + "/" + fileName,
}));

jest.mock("../../services/virusScan.service", () => ({
  scanFile: jest.fn().mockResolvedValue({ clean: true }),
}));

jest.mock("../../constants", () => ({
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("fs", () => ({
  createReadStream: jest.fn(() => {
    const EventEmitter = require("events");
    const emitter = new EventEmitter();
    // Simulate async data + end events
    setImmediate(() => {
      emitter.emit("data", Buffer.from("test content"));
      emitter.emit("end");
    });
    return emitter;
  }),
  promises: {
    unlink: jest.fn().mockResolvedValue(undefined),
    access: jest.fn(),
  },
  existsSync: jest.fn().mockReturnValue(true),
}));

const attachmentService = require("../../services/attachment.service");
const { Attachment } = require("../../models");
const virusScan = require("../../services/virusScan.service");

describe("attachment.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ================================================================
  describe("createAttachment", () => {
    it("should throw when no file uploaded", async () => {
      await expect(
        attachmentService.createAttachment("t-1", null),
      ).rejects.toMatchObject({
        status: 400,
        message: "No file uploaded (expected multipart field 'file')",
      });
    });

    it("should create attachment from uploaded file", async () => {
      const mockFile = {
        path: "C:/uploads/test.pdf",
        filename: "test.pdf",
        originalname: "Test Document",
        mimetype: "application/pdf",
        size: 1024,
      };
      Attachment.create.mockResolvedValueOnce({
        id: "att-1",
        fileName: "test.pdf",
        tenantId: "t-1",
        originalName: "Test Document",
        mimeType: "application/pdf",
        size: 1024,
        checksum: "abc123",
        uploadedBy: "u-1",
        folder: "uploads/attachments",
        createdAt: new Date(),
      });

      const result = await attachmentService.createAttachment("t-1", mockFile, {
        uploadedBy: "u-1",
      });

      expect(result.fileName).toBe("test.pdf");
      expect(Attachment.create).toHaveBeenCalled();
    });

    it("should reject if virus scan fails", async () => {
      virusScan.scanFile.mockResolvedValueOnce({
        clean: false,
        reason: "infected",
      });

      const mockFile = {
        path: "C:/uploads/malware.pdf",
        filename: "malware.pdf",
      };

      await expect(
        attachmentService.createAttachment("t-1", mockFile),
      ).rejects.toMatchObject({ status: 422 });
    });
  });

  // ================================================================
  describe("listAttachments", () => {
    it("should return paginated attachments with defaults", async () => {
      const mockRows = [
        {
          id: "a-1",
          fileName: "test.pdf",
          mimeType: "application/pdf",
          size: 1024,
          createdAt: new Date(),
          tenantId: "t-1",
          originalName: "test.pdf",
          checksum: "abc",
          uploadedBy: "u-1",
          folder: "uploads/attachments",
          resourceType: "generic",
          resourceId: null,
        },
      ];
      Attachment.findAndCountAll.mockResolvedValueOnce({
        count: 1,
        rows: mockRows,
      });

      const result = await attachmentService.listAttachments("t-1");

      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
      expect(result.rows).toHaveLength(1);
    });

    it("should filter by resourceType", async () => {
      Attachment.findAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });

      await attachmentService.listAttachments("t-1", {
        resourceType: "certificate",
      });

      expect(Attachment.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ resourceType: "certificate" }),
        }),
      );
    });

    it("should filter by resourceId", async () => {
      Attachment.findAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });

      await attachmentService.listAttachments("t-1", { resourceId: "cert-1" });

      expect(Attachment.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ resourceId: "cert-1" }),
        }),
      );
    });

    it("should cap limit to MAX_LIMIT", async () => {
      Attachment.findAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });

      await attachmentService.listAttachments("t-1", { limit: 99999 });

      expect(Attachment.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 100,
        }),
      );
    });

    it("should return empty when no attachments match", async () => {
      Attachment.findAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });

      const result = await attachmentService.listAttachments("t-1");

      expect(result.meta.total).toBe(0);
      expect(result.rows).toHaveLength(0);
    });
  });

  // ================================================================
  describe("getAttachment", () => {
    it("should return attachment metadata", async () => {
      const mockAtt = {
        id: "a-1",
        tenantId: "t-1",
        fileName: "doc.pdf",
        resourceType: "certificate",
        resourceId: "c-1",
        mimeType: "application/pdf",
        size: 2048,
        createdAt: new Date(),
        folder: "uploads/attachments",
        originalName: "doc.pdf",
        checksum: "abc",
        uploadedBy: "u-1",
      };
      Attachment.findOne.mockResolvedValueOnce(mockAtt);

      const result = await attachmentService.getAttachment("t-1", "a-1");

      expect(result.id).toBe("a-1");
      expect(result.fileName).toBe("doc.pdf");
    });

    it("should throw 404 when not found", async () => {
      Attachment.findOne.mockResolvedValueOnce(null);

      await expect(
        attachmentService.getAttachment("t-1", "nonexistent"),
      ).rejects.toMatchObject({
        status: 404,
        message: "Attachment not found",
      });
    });
  });

  // ================================================================
  describe("deleteAttachment", () => {
    it("should soft-delete the attachment", async () => {
      const mockAtt = {
        id: "a-1",
        softDelete: jest.fn().mockResolvedValue({}),
      };
      Attachment.findOne.mockResolvedValueOnce(mockAtt);

      const result = await attachmentService.deleteAttachment("t-1", "a-1");

      expect(result.id).toBe("a-1");
      expect(mockAtt.softDelete).toHaveBeenCalled();
    });

    it("should throw 404 when not found", async () => {
      Attachment.findOne.mockResolvedValueOnce(null);

      await expect(
        attachmentService.deleteAttachment("t-1", "nonexistent"),
      ).rejects.toMatchObject({
        status: 404,
        message: "Attachment not found",
      });
    });
  });

  // ================================================================
  describe("generateSignedUrl", () => {
    it("should generate a signed URL with HMAC token", async () => {
      const mockAtt = { id: "a-1" };
      Attachment.findOne.mockResolvedValueOnce(mockAtt);

      const result = await attachmentService.generateSignedUrl("t-1", "a-1");

      expect(result.url).toContain("/api/v1/attachments/a-1/signed");
      expect(result.token).toBeDefined();
      expect(result.expiresInSec).toBeGreaterThan(0);
    });

    it("should use custom expiry when provided", async () => {
      const mockAtt = { id: "a-1" };
      Attachment.findOne.mockResolvedValueOnce(mockAtt);

      const result = await attachmentService.generateSignedUrl("t-1", "a-1", {
        expiresInSec: 600,
      });

      expect(result.expiresInSec).toBe(600);
    });
  });

  // ================================================================
  describe("_verifySignedToken", () => {
    it("should return true for a valid token", async () => {
      const mockAtt = { id: "a-1" };
      Attachment.findOne.mockResolvedValueOnce(mockAtt);

      const { token } = await attachmentService.generateSignedUrl("t-1", "a-1");
      const valid = attachmentService._verifySignedToken("a-1", token);

      expect(valid).toBe(true);
    });

    it("should return false for invalid token", () => {
      expect(
        attachmentService._verifySignedToken("a-1", "bad.token.here"),
      ).toBe(false);
    });

    it("should return false for expired token", () => {
      const pastExp = Math.floor(Date.now() / 1000) - 10000;
      expect(
        attachmentService._verifySignedToken("a-1", `${pastExp}.fakesig`),
      ).toBe(false);
    });
  });
});
