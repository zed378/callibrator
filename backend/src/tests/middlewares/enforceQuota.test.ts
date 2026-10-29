/**
 * Tests for enforceQuota middleware
 * Tests seat quota, storage quota, and feature gating enforcement.
 */
import type { Request, Response } from "express";

jest.mock("../../services/quota.service", () => ({
  checkSeatQuota: jest.fn(),
  checkStorageQuota: jest.fn(),
  checkFeature: jest.fn(),
}));

import type * as QuotaServiceModule from "../../services/quota.service";
import type * as EnforceQuotaModule from "../../middlewares/enforceQuota.middleware";
import { AppError } from "../../utils/appError.util";

const quotaService = jest.requireMock<typeof QuotaServiceModule>("../../services/quota.service");
const { enforceSeatQuota, enforceStorageQuota, requireFeature } =
  jest.requireActual<typeof EnforceQuotaModule>("../../middlewares/enforceQuota.middleware");

interface MockReq {
  body?: unknown;
  query?: Record<string, unknown> | undefined;
  params?: Record<string, unknown> | undefined;
  user?: { role?: { name?: string | undefined } | null | undefined; tenantId?: string | undefined } | null | undefined;
  headers: Record<string, string | undefined>;
  ip?: string | undefined;
  [key: string]: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createMockReq, createMockNext } = require("../utils/test.utils") as {
  createMockReq: (overrides?: Record<string, unknown>) => MockReq;
  createMockNext: () => jest.Mock;
};

const mockQuotaService = quotaService as unknown as {
  checkSeatQuota: jest.Mock;
  checkStorageQuota: jest.Mock;
  checkFeature: jest.Mock;
};

describe("enforceQuota middleware", () => {
  let req: MockReq;
  let res: Record<string, unknown>;
  let next: jest.Mock;

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
      await middleware(req as unknown as Request, res as unknown as Response, next);
      expect(mockQuotaService.checkSeatQuota).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it("should bypass quota check for SUPERADMIN (name 'SUPERADMIN')", async () => {
      req.user = { role: { name: "SUPERADMIN" }, tenantId: "t-1" };
      const middleware = enforceSeatQuota();
      await middleware(req as unknown as Request, res as unknown as Response, next);
      expect(mockQuotaService.checkSeatQuota).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it("should allow when quota check returns allowed: true", async () => {
      req.user = { role: { name: "USER" }, tenantId: "t-1" };
      mockQuotaService.checkSeatQuota.mockResolvedValue({ allowed: true, used: 2, limit: 10 });
      const middleware = enforceSeatQuota();
      await middleware(req as unknown as Request, res as unknown as Response, next);
      expect(mockQuotaService.checkSeatQuota).toHaveBeenCalledWith("t-1");
      expect(next).toHaveBeenCalled();
    });

    it("should throw 403 when seat limit is reached", async () => {
      req.user = { role: { name: "USER" }, tenantId: "t-1" };
      mockQuotaService.checkSeatQuota.mockResolvedValue({ allowed: false, used: 10, limit: 10 });
      const middleware = enforceSeatQuota();
      await middleware(req as unknown as Request, res as unknown as Response, next);
      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      const calls = next.mock.calls as [AppError][];
      const err = calls[0]?.[0];
      expect(err?.status).toBe(403);
      expect(err?.message).toContain("Seat limit reached");
    });

    it("should forward unexpected errors to next()", async () => {
      req.user = { role: { name: "USER" }, tenantId: "t-1" };
      mockQuotaService.checkSeatQuota.mockRejectedValue(new Error("DB down"));
      const middleware = enforceSeatQuota();
      await middleware(req as unknown as Request, res as unknown as Response, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const calls = next.mock.calls as [Error][];
      const err = calls[0]?.[0];
      expect(err?.message).toBe("DB down");
    });
  });

  // --- enforceStorageQuota ---

  describe("enforceStorageQuota", () => {
    it("should bypass for SUPER_ADMIN", async () => {
      req.user = { role: { name: "SUPER_ADMIN" }, tenantId: "t-1" };
      const middleware = enforceStorageQuota();
      await middleware(req as unknown as Request, res as unknown as Response, next);
      expect(mockQuotaService.checkStorageQuota).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it("should allow when storage quota has headroom", async () => {
      req.user = { role: { name: "USER" }, tenantId: "t-1" };
      req.headers["content-length"] = "1000";
      mockQuotaService.checkStorageQuota.mockResolvedValue({ allowed: true, usedMb: 5, limitMb: 100 });
      const middleware = enforceStorageQuota();
      await middleware(req as unknown as Request, res as unknown as Response, next);
      expect(mockQuotaService.checkStorageQuota).toHaveBeenCalledWith("t-1", 1000);
      expect(next).toHaveBeenCalled();
    });

    it("should allow when content-length header is missing (treats as 0)", async () => {
      req.user = { role: { name: "USER" }, tenantId: "t-1" };
      mockQuotaService.checkStorageQuota.mockResolvedValue({ allowed: true, usedMb: 5, limitMb: 100 });
      const middleware = enforceStorageQuota();
      await middleware(req as unknown as Request, res as unknown as Response, next);
      expect(mockQuotaService.checkStorageQuota).toHaveBeenCalledWith("t-1", 0);
      expect(next).toHaveBeenCalled();
    });

    it("should throw 413 when storage limit would be exceeded", async () => {
      req.user = { role: { name: "USER" }, tenantId: "t-1" };
      req.headers["content-length"] = "500000000";
      mockQuotaService.checkStorageQuota.mockResolvedValue({ allowed: false, usedMb: 95, limitMb: 100 });
      const middleware = enforceStorageQuota();
      await middleware(req as unknown as Request, res as unknown as Response, next);
      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      const calls = next.mock.calls as [AppError][];
      const err = calls[0]?.[0];
      expect(err?.status).toBe(413);
      expect(err?.message).toContain("Storage limit reached");
    });

    it("should forward unexpected errors to next()", async () => {
      req.user = { role: { name: "USER" }, tenantId: "t-1" };
      mockQuotaService.checkStorageQuota.mockRejectedValue(new Error("quota service down"));
      const middleware = enforceStorageQuota();
      await middleware(req as unknown as Request, res as unknown as Response, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // --- requireFeature ---

  describe("requireFeature", () => {
    it("should bypass feature check for SUPER_ADMIN", async () => {
      req.user = { role: { name: "SUPER_ADMIN" }, tenantId: "t-1" };
      const middleware = requireFeature("webhooks");
      await middleware(req as unknown as Request, res as unknown as Response, next);
      expect(mockQuotaService.checkFeature).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it("should allow when the plan has the feature", async () => {
      req.user = { role: { name: "USER" }, tenantId: "t-1" };
      mockQuotaService.checkFeature.mockResolvedValue({ allowed: true, plan: "professional" });
      const middleware = requireFeature("webhooks");
      await middleware(req as unknown as Request, res as unknown as Response, next);
      expect(mockQuotaService.checkFeature).toHaveBeenCalledWith("t-1", "webhooks");
      expect(next).toHaveBeenCalled();
    });

    it("should throw 402 when plan lacks the feature", async () => {
      req.user = { role: { name: "USER" }, tenantId: "t-1" };
      mockQuotaService.checkFeature.mockResolvedValue({ allowed: false, plan: "free" });
      const middleware = requireFeature("webhooks");
      await middleware(req as unknown as Request, res as unknown as Response, next);
      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      const calls = next.mock.calls as [AppError][];
      const err = calls[0]?.[0];
      expect(err?.status).toBe(402);
      expect(err?.message).toContain("webhooks");
      expect(err?.message).toContain("free");
    });

    it("should forward unexpected errors to next()", async () => {
      req.user = { role: { name: "USER" }, tenantId: "t-1" };
      mockQuotaService.checkFeature.mockRejectedValue(new Error("service down"));
      const middleware = requireFeature("reports");
      await middleware(req as unknown as Request, res as unknown as Response, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
