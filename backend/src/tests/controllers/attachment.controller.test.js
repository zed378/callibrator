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

const attachmentService = require("../../services/attachment.service");
const attachmentController = require("../../controllers/attachment.controller");
const { success } = require("../../utils/response.util");

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
      });

      await attachmentController.download(req, res, next);

      expect(attachmentService.getDownload).toHaveBeenCalledWith(VALID_TENANT_ID, VALID_ATTACHMENT_ID);
      expect(res.download).toHaveBeenCalledWith("/uploads/devices/report.pdf", "report.pdf");
    });
  });

  describe("createSignedUrl", () => {
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
        { baseUrl: "https://localhost:3000", expiresInSec: 3600 },
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
        { baseUrl: "https://localhost:3000", expiresInSec: undefined },
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
      });

      await attachmentController.downloadSigned(req, res, next);

      expect(attachmentService.getSignedDownload).toHaveBeenCalledWith(VALID_ATTACHMENT_ID, "abc123");
      expect(res.download).toHaveBeenCalledWith("/uploads/file.pdf", "file.pdf");
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

      expect(attachmentService.deleteAttachment).toHaveBeenCalledWith(VALID_TENANT_ID, VALID_ATTACHMENT_ID);
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
