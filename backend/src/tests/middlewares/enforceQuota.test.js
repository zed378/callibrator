/**
 * Tests for enforceQuota middleware
 * Tests seat quota, storage quota, and feature gating enforcement.
 */
jest.mock("../../services/quota.service", () => ({
  checkSeatQuota: jest.fn(),
  checkStorageQuota: jest.fn(),
  checkFeature: jest.fn(),
}));
const quotaService = require("../../services/quota.service");
const { AppError } = require("../../utils/appError.util");
const { enforceSeatQuota, enforceStorageQuota, requireFeature } = require("../../middlewares/enforceQuota.middleware");
const { createMockReq, createMockNext } = require("../utils/test.utils");

describe("enforceQuota middleware", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = createMockReq();
    res = {};
    next = createMockNext();
  });

  // --- isSuperAdmin helper (via enforceSeatQuota) ---

  describe("enforceSeatQuota", () => {
    it("should bypass quota check for SUPER_ADMIN (name 'SUPER_ADMIN')", async () => {
      req.user = { role: { name: "SUPER_ADMIN" }, tenantId: "t-1" };
      const middleware = enforceSeatQuota();
      await middleware(req, res, next);
      expect(quotaService.checkSeatQuota).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it("should bypass quota check for SUPERADMIN (name 'SUPERADMIN')", async () => {
      req.user = { role: { name: "SUPERADMIN" }, tenantId: "t-1" };
      const middleware = enforceSeatQuota();
      await middleware(req, res, next);
      expect(quotaService.checkSeatQuota).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it("should allow when quota check returns allowed: true", async () => {
      req.user = { role: { name: "USER" }, tenantId: "t-1" };
      quotaService.checkSeatQuota.mockResolvedValue({ allowed: true, used: 2, limit: 10 });
      const middleware = enforceSeatQuota();
      await middleware(req, res, next);
      expect(quotaService.checkSeatQuota).toHaveBeenCalledWith("t-1");
      expect(next).toHaveBeenCalled();
    });

    it("should throw 403 when seat limit is reached", async () => {
      req.user = { role: { name: "USER" }, tenantId: "t-1" };
      quotaService.checkSeatQuota.mockResolvedValue({ allowed: false, used: 10, limit: 10 });
      const middleware = enforceSeatQuota();
      await middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      expect(next.mock.calls[0][0].status).toBe(403);
      expect(next.mock.calls[0][0].message).toContain("Seat limit reached");
    });

    it("should forward unexpected errors to next()", async () => {
      req.user = { role: { name: "USER" }, tenantId: "t-1" };
      quotaService.checkSeatQuota.mockRejectedValue(new Error("DB down"));
      const middleware = enforceSeatQuota();
      await middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(next.mock.calls[0][0].message).toBe("DB down");
    });
  });

  // --- enforceStorageQuota ---

  describe("enforceStorageQuota", () => {
    it("should bypass for SUPER_ADMIN", async () => {
      req.user = { role: { name: "SUPER_ADMIN" }, tenantId: "t-1" };
      const middleware = enforceStorageQuota();
      await middleware(req, res, next);
      expect(quotaService.checkStorageQuota).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it("should allow when storage quota has headroom", async () => {
      req.user = { role: { name: "USER" }, tenantId: "t-1" };
      req.headers["content-length"] = "1000";
      quotaService.checkStorageQuota.mockResolvedValue({ allowed: true, usedMb: 5, limitMb: 100 });
      const middleware = enforceStorageQuota();
      await middleware(req, res, next);
      expect(quotaService.checkStorageQuota).toHaveBeenCalledWith("t-1", 1000);
      expect(next).toHaveBeenCalled();
    });

    it("should allow when content-length header is missing (treats as 0)", async () => {
      req.user = { role: { name: "USER" }, tenantId: "t-1" };
      quotaService.checkStorageQuota.mockResolvedValue({ allowed: true, usedMb: 5, limitMb: 100 });
      const middleware = enforceStorageQuota();
      await middleware(req, res, next);
      expect(quotaService.checkStorageQuota).toHaveBeenCalledWith("t-1", 0);
      expect(next).toHaveBeenCalled();
    });

    it("should throw 413 when storage limit would be exceeded", async () => {
      req.user = { role: { name: "USER" }, tenantId: "t-1" };
      req.headers["content-length"] = "500000000";
      quotaService.checkStorageQuota.mockResolvedValue({ allowed: false, usedMb: 95, limitMb: 100 });
      const middleware = enforceStorageQuota();
      await middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      expect(next.mock.calls[0][0].status).toBe(413);
      expect(next.mock.calls[0][0].message).toContain("Storage limit reached");
    });

    it("should forward unexpected errors to next()", async () => {
      req.user = { role: { name: "USER" }, tenantId: "t-1" };
      quotaService.checkStorageQuota.mockRejectedValue(new Error("quota service down"));
      const middleware = enforceStorageQuota();
      await middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // --- requireFeature ---

  describe("requireFeature", () => {
    it("should bypass feature check for SUPER_ADMIN", async () => {
      req.user = { role: { name: "SUPER_ADMIN" }, tenantId: "t-1" };
      const middleware = requireFeature("webhooks");
      await middleware(req, res, next);
      expect(quotaService.checkFeature).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it("should allow when the plan has the feature", async () => {
      req.user = { role: { name: "USER" }, tenantId: "t-1" };
      quotaService.checkFeature.mockResolvedValue({ allowed: true, plan: "professional" });
      const middleware = requireFeature("webhooks");
      await middleware(req, res, next);
      expect(quotaService.checkFeature).toHaveBeenCalledWith("t-1", "webhooks");
      expect(next).toHaveBeenCalled();
    });

    it("should throw 402 when plan lacks the feature", async () => {
      req.user = { role: { name: "USER" }, tenantId: "t-1" };
      quotaService.checkFeature.mockResolvedValue({ allowed: false, plan: "free" });
      const middleware = requireFeature("webhooks");
      await middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      expect(next.mock.calls[0][0].status).toBe(402);
      expect(next.mock.calls[0][0].message).toContain("webhooks");
      expect(next.mock.calls[0][0].message).toContain("free");
    });

    it("should forward unexpected errors to next()", async () => {
      req.user = { role: { name: "USER" }, tenantId: "t-1" };
      quotaService.checkFeature.mockRejectedValue(new Error("service down"));
      const middleware = requireFeature("reports");
      await middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
