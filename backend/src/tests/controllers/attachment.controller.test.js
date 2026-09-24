/**
 * Tests for attachment controller
 */

jest.mock("../../services/attachment.service", () => ({
  createAttachment: jest.fn(),
  listAttachments: jest.fn(),
  getAttachment: jest.fn(),
  getDownload: jest.fn(),
  generateSignedUrl: jest.fn(),
  getSignedDownload: jest.fn(),
  deleteAttachment: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

jest.mock("../../utils/fileResponse.util", () => ({
  sendStoredFile: jest.fn().mockResolvedValue(undefined),
}));

const attachmentService = require("../../services/attachment.service");
const attachmentController = require("../../controllers/attachment.controller");
const { success } = require("../../utils/response.util");
const { sendStoredFile } = require("../../utils/fileResponse.util");

const VALID_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440001";
const VALID_ATTACHMENT_ID = "550e8400-e29b-41d4-a716-446655440002";

describe("attachment Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((res, data, meta, message, status) => {
      res.status(status || 200).json({ success: true, data, message });
    });
    req = {
      query: {},
      params: {},
      body: {},
      user: {
        id: VALID_USER_ID,
        tenantId: VALID_TENANT_ID,
      },
      protocol: "https",
      get: jest.fn().mockReturnValue("localhost:3000"),
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      download: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("upload", () => {
    it("should upload an attachment", async () => {
      const mockFile = { originalname: "report.pdf", buffer: Buffer.from("pdf") };
      req.file = mockFile;
      req.body = {
        resourceType: "device",
        resourceId: "device-123",
      };

      attachmentService.createAttachment.mockResolvedValue({
        id: VALID_ATTACHMENT_ID,
        fileName: "report.pdf",
        url: "/uploads/report.pdf",
      });

      await attachmentController.upload(req, res, next);

      expect(attachmentService.createAttachment).toHaveBeenCalledWith(
        VALID_TENANT_ID,
        mockFile,
        {
          resourceType: "device",
          resourceId: "device-123",
          uploadedBy: VALID_USER_ID,
          // A-117: for the CREATE audit row (req.get is a stub here).
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        },
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("should upload without optional resource params", async () => {
      const mockFile = { originalname: "image.png", buffer: Buffer.from("img") };
      req.file = mockFile;
      req.body = {};

      attachmentService.createAttachment.mockResolvedValue({
        id: VALID_ATTACHMENT_ID,
        fileName: "image.png",
      });

      await attachmentController.upload(req, res, next);

      expect(attachmentService.createAttachment).toHaveBeenCalledWith(
        VALID_TENANT_ID,
        mockFile,
        {
          resourceType: undefined,
          resourceId: undefined,
          uploadedBy: VALID_USER_ID,
          // A-117: for the CREATE audit row (req.get is a stub here).
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        },
      );
    });
  });

  describe("list", () => {
    it("should list all attachments", async () => {
      attachmentService.listAttachments.mockResolvedValue({
        rows: [{ id: VALID_ATTACHMENT_ID, fileName: "file.pdf" }],
        meta: { total: 1, page: 1, limit: 20 },
      });

      await attachmentController.list(req, res, next);

      expect(attachmentService.listAttachments).toHaveBeenCalledWith(
        VALID_TENANT_ID,
        { resourceType: undefined, resourceId: undefined, page: undefined, limit: undefined },
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should filter by resource type and ID", async () => {
      req.query = { resourceType: "device", resourceId: "device-123" };
      attachmentService.listAttachments.mockResolvedValue({
        rows: [],
        meta: { total: 0 },
      });

      await attachmentController.list(req, res, next);

      expect(attachmentService.listAttachments).toHaveBeenCalledWith(
        VALID_TENANT_ID,
        { resourceType: "device", resourceId: "device-123", page: undefined, limit: undefined },
      );
    });

    it("should support pagination query", async () => {
      req.query = { page: "1", limit: "10", resourceType: "device" };
      attachmentService.listAttachments.mockResolvedValue({
        rows: [],
        meta: { total: 0 },
      });

      await attachmentController.list(req, res, next);

      expect(attachmentService.listAttachments).toHaveBeenCalledWith(
        VALID_TENANT_ID,
        { resourceType: "device", resourceId: undefined, page: "1", limit: "10" },
      );
    });
  });

  describe("getOne", () => {
    it("should return an attachment by ID", async () => {
      req.params = { id: VALID_ATTACHMENT_ID };

      attachmentService.getAttachment.mockResolvedValue({
        id: VALID_ATTACHMENT_ID,
        fileName: "report.pdf",
        resourceType: "device",
        resourceId: "device-123",
      });

      await attachmentController.getOne(req, res, next);

      expect(attachmentService.getAttachment).toHaveBeenCalledWith(VALID_TENANT_ID, VALID_ATTACHMENT_ID);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should handle attachment not found", async () => {
      req.params = { id: VALID_ATTACHMENT_ID };
      const err = { status: 404, message: "Attachment not found" };
      attachmentService.getAttachment.mockRejectedValue(err);

      await attachmentController.getOne(req, res, next);

      expect(next).toHaveBeenCalledWith(err);
    });
  });

  describe("download", () => {
    it("should serve file download", async () => {
      req.params = { id: VALID_ATTACHMENT_ID };

      attachmentService.getDownload.mockResolvedValue({
        absPath: "/uploads/devices/report.pdf",
        fileName: "report.pdf",
        mimeType: "application/pdf",
      });

      await attachmentController.download(req, res, next);

      expect(attachmentService.getDownload).toHaveBeenCalledWith(VALID_TENANT_ID, VALID_ATTACHMENT_ID);
      // ADR-042 step 5: served with a content-type-driven disposition, ETag and Range.
      expect(sendStoredFile).toHaveBeenCalledWith(res, "/uploads/devices/report.pdf", {
        contentType: "application/pdf",
        fileName: "report.pdf",
      });
    });

    it("serves opaque bytes when the row carries no MIME type", async () => {
      req.params = { id: VALID_ATTACHMENT_ID };
      attachmentService.getDownload.mockResolvedValue({ absPath: "/x", fileName: "x" });
      await attachmentController.download(req, res, next);
      expect(sendStoredFile).toHaveBeenCalledWith(res, "/x", {
        contentType: "application/octet-stream",
        fileName: "x",
      });
    });
  });

  describe("createSignedUrl", () => {
    // A-189: the link's origin is the configured public one
    // (utils/publicBaseUrl.util.js), never the request's Host header.
    let savedBase;
    beforeEach(() => {
      savedBase = process.env.PUBLIC_BASE_URL;
      process.env.PUBLIC_BASE_URL = "https://callibrator.example/";
    });
    afterEach(() => {
      if (savedBase === undefined) {delete process.env.PUBLIC_BASE_URL;} else {process.env.PUBLIC_BASE_URL = savedBase;}
    });

    it("should generate a signed URL", async () => {
      req.params = { id: VALID_ATTACHMENT_ID };
      req.body = { expiresInSec: 3600 };

      attachmentService.generateSignedUrl.mockResolvedValue({
        signedUrl: "https://cdn.example.com/file.pdf?token=abc",
        expiresIn: 3600,
      });

      await attachmentController.createSignedUrl(req, res, next);

      expect(attachmentService.generateSignedUrl).toHaveBeenCalledWith(
        VALID_TENANT_ID,
        VALID_ATTACHMENT_ID,
        { baseUrl: "https://callibrator.example", expiresInSec: 3600 },
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should use default expiresInSec when not provided", async () => {
      req.params = { id: VALID_ATTACHMENT_ID };
      req.body = {};

      attachmentService.generateSignedUrl.mockResolvedValue({
        signedUrl: "https://cdn.example.com/file.pdf?token=abc",
        expiresIn: 900,
      });

      await attachmentController.createSignedUrl(req, res, next);

      expect(attachmentService.generateSignedUrl).toHaveBeenCalledWith(
        VALID_TENANT_ID,
        VALID_ATTACHMENT_ID,
        { baseUrl: "https://callibrator.example", expiresInSec: undefined },
      );
    });
  });

  describe("downloadSigned", () => {
    it("should serve file download via signed URL", async () => {
      req.params = { id: VALID_ATTACHMENT_ID };
      req.query = { token: "abc123" };

      attachmentService.getSignedDownload.mockResolvedValue({
        absPath: "/uploads/file.pdf",
        fileName: "file.pdf",
        mimeType: "image/png",
      });

      await attachmentController.downloadSigned(req, res, next);

      expect(attachmentService.getSignedDownload).toHaveBeenCalledWith(VALID_ATTACHMENT_ID, "abc123");
      expect(sendStoredFile).toHaveBeenCalledWith(res, "/uploads/file.pdf", {
        contentType: "image/png",
        fileName: "file.pdf",
      });
    });

    it("serves opaque bytes via a signed URL when the row carries no MIME type", async () => {
      req.params = { id: VALID_ATTACHMENT_ID };
      req.query = { token: "abc123" };
      attachmentService.getSignedDownload.mockResolvedValue({ absPath: "/y", fileName: "y" });
      await attachmentController.downloadSigned(req, res, next);
      expect(sendStoredFile).toHaveBeenCalledWith(res, "/y", {
        contentType: "application/octet-stream",
        fileName: "y",
      });
    });
  });

  describe("remove", () => {
    it("should delete an attachment", async () => {
      req.params = { id: VALID_ATTACHMENT_ID };

      attachmentService.deleteAttachment.mockResolvedValue({
        id: VALID_ATTACHMENT_ID,
        deleted: true,
      });

      await attachmentController.remove(req, res, next);

      // A-28: the actor travels to the service so the audit row is attributable.
      expect(attachmentService.deleteAttachment).toHaveBeenCalledWith(
        VALID_TENANT_ID,
        VALID_ATTACHMENT_ID,
        { userId: VALID_USER_ID, ipAddress: req.ip, userAgent: "localhost:3000" },
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: "Attachment deleted",
        }),
      );
    });

    it("should return 404 when attachment not found", async () => {
      req.params = { id: VALID_ATTACHMENT_ID };
      const err = { status: 404, message: "Attachment not found" };
      attachmentService.deleteAttachment.mockRejectedValue(err);

      await attachmentController.remove(req, res, next);

      expect(next).toHaveBeenCalledWith(err);
    });
  });
});
