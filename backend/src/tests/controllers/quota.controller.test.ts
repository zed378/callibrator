/**
 * Tests for quota.controller.js
 *
 * quota.controller uses asyncHandler but also throws AppError
 * (for 404 when tenant not found), which asyncHandler catches
 * and routes through next().
 */
import type { Request, Response } from "express";

jest.mock("../../services/quota.service", () => ({
  getUsageSummary: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

jest.mock("../../utils/appError.util", () => ({
  AppError: class AppError extends Error {
    declare status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.message = message;
    }
  },
}));

interface QuotaServiceDouble {
    getUsageSummary: jest.Mock;
}

interface ResponseDouble {
    success: jest.Mock;
}

interface AppErrorDouble {
    status: number;
    message: string;
}

type AppErrorConstructor = new (status: number, message: string) => AppErrorDouble;

type Handler = (req: Request, res: Response, next: (err?: unknown) => void) => Promise<unknown>;

interface FakeRes {
    status: (code: number) => FakeRes;
    json: jest.Mock;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const quotaService = require("../../services/quota.service") as QuotaServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const quotaController = require("../../controllers/quota.controller") as { getUsage: Handler };
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the mocked class, so instanceof matches the controller's
const { AppError } = require("../../utils/appError.util") as { AppError: AppErrorConstructor };
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { success } = require("../../utils/response.util") as ResponseDouble;

const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("quotaController", () => {
  let req: Record<string, unknown>;
  let res: FakeRes;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((response: FakeRes, data: unknown, _meta: unknown, message: unknown, status?: number) => {
      response.status(status ?? 200).json({ success: true, data, message });
    });
    req = {
      query: {},
      params: {},
      body: {},
      user: { id: "user-1", tenantId: VALID_TENANT_ID },
      ip: "127.0.0.1",
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("getUsage", () => {
    it("should return quota usage summary", async () => {
      quotaService.getUsageSummary.mockResolvedValue({
        plan: "professional",
        status: "active",
        features: ["core", "reports", "webhooks"],
        seats: { used: 10, limit: 50 },
        storage: { usedMb: 1024, limitMb: 10240 },
      });

      await quotaController.getUsage(req as unknown as Request, res as unknown as Response, next);

      expect(quotaService.getUsageSummary).toHaveBeenCalledWith(VALID_TENANT_ID);
      expect(success).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should return 404 when tenant not found", async () => {
      quotaService.getUsageSummary.mockResolvedValue(null);

      await quotaController.getUsage(req as unknown as Request, res as unknown as Response, next);

      expect(next).toHaveBeenCalled();
      const [err] = next.mock.calls[0] as [AppErrorDouble];
      expect(err instanceof AppError).toBe(true);
      expect(err.status).toBe(404);
      expect(err.message).toBe("Tenant not found");
    });
  });
});
