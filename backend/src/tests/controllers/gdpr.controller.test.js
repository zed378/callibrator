/**
 * Tests for GDPR Controller
 */

jest.mock("../../services/gdpr.service", () => ({
  exportUserData: jest.fn(),
  createDsar: jest.fn(),
  getDsarStatus: jest.fn(),
  updateConsent: jest.fn(),
  getConsentHistory: jest.fn(),
  getProcessingActivities: jest.fn(),
  rectifyData: jest.fn(),
  restrictProcessing: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const gdprService = require("../../services/gdpr.service");
const gdprController = require("../../controllers/gdpr.controller");
const { success } = require("../../utils/response.util");

describe("gdprController", () => {
  let req;
  let res;

  beforeEach(() => {
    jest.clearAllMocks();

    // req.user carries the user id under `id` (not `userId`); tenantId is
    // resolved from req.tenantId (set by the auth middleware).
    req = {
      user: { id: "user-123", tenantId: "tenant-123" },
      tenantId: "tenant-123",
      ip: "203.0.114.9",
      query: {},
      body: {},
      params: {},
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      locals: {},
    };

    success.mockImplementation((response) => {
      response.json({ success: true });
    });
  });

  describe("exportUserData", () => {
    it("exports user data with (tenantId, userId) order", async () => {
      gdprService.exportUserData.mockResolvedValue({ exportId: "e-1" });
      await gdprController.exportUserData(req, res);
      expect(gdprService.exportUserData).toHaveBeenCalledWith(
        "tenant-123",
        "user-123",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("requestErasure", () => {
    it("records an erasure DSAR", async () => {
      gdprService.createDsar.mockResolvedValue({ dsarId: "d-1" });
      req.body = { reason: "User requested account deletion" };
      await gdprController.requestErasure(req, res);
      expect(gdprService.createDsar).toHaveBeenCalledWith(
        "tenant-123",
        "user-123",
        "erasure",
        { reason: "User requested account deletion" },
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getErasureStatus", () => {
    it("returns the DSAR status", async () => {
      gdprService.getDsarStatus.mockResolvedValue({ status: "pending" });
      req.params = { requestId: "d-1" };
      await gdprController.getErasureStatus(req, res);
      expect(gdprService.getDsarStatus).toHaveBeenCalledWith("tenant-123", "d-1");
      expect(success).toHaveBeenCalled();
    });
  });

  describe("updateConsent", () => {
    it("updates consent for the given categories", async () => {
      gdprService.updateConsent.mockResolvedValue({ updated: 2 });
      req.body = { categories: ["analytics", "marketing"], consent: true };
      await gdprController.updateConsent(req, res);
      expect(gdprService.updateConsent).toHaveBeenCalledWith(
        "tenant-123",
        "user-123",
        ["analytics", "marketing"],
        true,
        "203.0.114.9",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getConsentHistory", () => {
    it("returns consent history with (tenantId, userId) order", async () => {
      gdprService.getConsentHistory.mockResolvedValue([]);
      await gdprController.getConsentHistory(req, res);
      expect(gdprService.getConsentHistory).toHaveBeenCalledWith(
        "tenant-123",
        "user-123",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getProcessingActivities", () => {
    it("returns processing activities", async () => {
      gdprService.getProcessingActivities.mockResolvedValue({ activities: [] });
      await gdprController.getProcessingActivities(req, res);
      expect(gdprService.getProcessingActivities).toHaveBeenCalledWith(
        "tenant-123",
        "user-123",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("rectifyData", () => {
    it("rectifies a whitelisted field", async () => {
      gdprService.rectifyData.mockResolvedValue({ rectified: true });
      req.body = { field: "firstName", value: "Jane" };
      await gdprController.rectifyData(req, res);
      expect(gdprService.rectifyData).toHaveBeenCalledWith(
        "tenant-123",
        "user-123",
        "firstName",
        "Jane",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("restrictProcessing", () => {
    it("records a processing restriction", async () => {
      gdprService.restrictProcessing.mockResolvedValue({ restricted: true });
      req.body = { reason: "User requested restriction" };
      await gdprController.restrictProcessing(req, res);
      expect(gdprService.restrictProcessing).toHaveBeenCalledWith(
        "tenant-123",
        "user-123",
        "User requested restriction",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  // The `actor(req)` helper resolves tenantId from req.tenantId first, then
  // falls back to req.user.tenantId, then null. userId comes from req.user.id.
  describe("actor() resolution", () => {
    it("falls back to req.user.tenantId when the middleware set no req.tenantId", async () => {
      gdprService.exportUserData.mockResolvedValue({ exportId: "e-2" });
      req.tenantId = undefined;
      await gdprController.exportUserData(req, res);
      expect(gdprService.exportUserData).toHaveBeenCalledWith(
        "tenant-123",
        "user-123",
      );
    });

    it("resolves both to null when req.user is absent entirely", async () => {
      gdprService.getConsentHistory.mockResolvedValue([]);
      req.tenantId = undefined;
      req.user = undefined;
      await gdprController.getConsentHistory(req, res);
      expect(gdprService.getConsentHistory).toHaveBeenCalledWith(null, null);
    });

    it("resolves userId to null when req.user carries no id", async () => {
      gdprService.getProcessingActivities.mockResolvedValue({ activities: [] });
      req.user = { tenantId: "tenant-123" };
      await gdprController.getProcessingActivities(req, res);
      expect(gdprService.getProcessingActivities).toHaveBeenCalledWith(
        "tenant-123",
        null,
      );
    });
  });

  describe("requestErasure reason fallback", () => {
    it("passes reason: null when no reason is supplied", async () => {
      gdprService.createDsar.mockResolvedValue({ dsarId: "d-2" });
      req.body = {};
      await gdprController.requestErasure(req, res);
      expect(gdprService.createDsar).toHaveBeenCalledWith(
        "tenant-123",
        "user-123",
        "erasure",
        { reason: null },
      );
    });
  });
});
