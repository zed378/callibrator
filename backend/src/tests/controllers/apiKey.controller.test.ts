/**
 * Tests for apiKey controller
 */
import type { Request, Response } from "express";

jest.mock("../../services/apiKey.service", () => ({
  createApiKey: jest.fn(),
  listApiKeys: jest.fn(),
  getApiKey: jest.fn(),
  revokeApiKey: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

interface ApiKeyServiceDouble {
  createApiKey: jest.Mock;
  listApiKeys: jest.Mock;
  getApiKey: jest.Mock;
  revokeApiKey: jest.Mock;
}

type Handler = (req: Request, res: Response, next: (err?: unknown) => void) => Promise<unknown>;

interface ApiKeyControllerDouble {
  create: Handler;
  list: Handler;
  getOne: Handler;
  revoke: Handler;
}

interface ResponseDouble {
  success: jest.Mock;
}

interface FakeReq {
  query: Record<string, unknown>;
  params: Record<string, unknown>;
  body: Record<string, unknown>;
  user?: Record<string, unknown> | null;
  file?: unknown;
  files?: unknown;
  headers?: Record<string, unknown>;
  ip?: string;
  protocol?: string;
  get?: jest.Mock;
  validated?: unknown;
}

interface FakeRes {
  status: (code: number) => FakeRes;
  json: jest.Mock;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const apiKeyService = require("../../services/apiKey.service") as ApiKeyServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const apiKeyController = require("../../controllers/apiKey.controller") as ApiKeyControllerDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { success } = require("../../utils/response.util") as ResponseDouble;

const VALID_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440001";
const VALID_KEY_ID = "550e8400-e29b-41d4-a716-446655440002";

describe("apiKey Controller", () => {
  let req: FakeReq;
  let res: FakeRes;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation(
      (response: FakeRes, data: unknown, _meta: unknown, message: string, status?: number) => {
        response.status(status ?? 200).json({ success: true, data, message });
      },
    );
    req = {
      query: {},
      params: {},
      body: {},
      user: {
        id: VALID_USER_ID,
        tenantId: VALID_TENANT_ID,
      },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("create", () => {
    it("should create an API key", async () => {
      req.body = {
        name: "Service Integration Key",
        scopes: ["device.read", "calibration.write"],
        expiresAt: "2027-01-01T00:00:00Z",
      };

      apiKeyService.createApiKey.mockResolvedValue({
        id: VALID_KEY_ID,
        name: "Service Integration Key",
        key: "sk_test_abc123xyz",
        scopes: ["device.read", "calibration.write"],
      });

      await apiKeyController.create(req as unknown as Request, res as unknown as Response, next);

      expect(apiKeyService.createApiKey).toHaveBeenCalledWith(VALID_TENANT_ID, {
        name: "Service Integration Key",
        scopes: ["device.read", "calibration.write"],
        expiresAt: "2027-01-01T00:00:00Z",
        createdBy: VALID_USER_ID,
      }, expect.objectContaining({ userId: VALID_USER_ID }));
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: "API key created — copy the key now, it will not be shown again",
        }),
      );
    });

    it("should create without optional fields", async () => {
      req.body = { name: "Default Key" };

      apiKeyService.createApiKey.mockResolvedValue({
        id: VALID_KEY_ID,
        name: "Default Key",
        key: "sk_test_default",
        scopes: null,
        expiresAt: null,
      });

      await apiKeyController.create(req as unknown as Request, res as unknown as Response, next);

      expect(apiKeyService.createApiKey).toHaveBeenCalledWith(VALID_TENANT_ID, {
        name: "Default Key",
        scopes: undefined,
        expiresAt: undefined,
        createdBy: VALID_USER_ID,
      }, expect.objectContaining({ userId: VALID_USER_ID }));
    });
  });

  describe("list", () => {
    it("should list API keys with default pagination", async () => {
      apiKeyService.listApiKeys.mockResolvedValue({
        rows: [
          { id: VALID_KEY_ID, name: "Key One" },
          { id: "key-2", name: "Key Two" },
        ],
        meta: { total: 2, page: 1, limit: 20 },
      });

      await apiKeyController.list(req as unknown as Request, res as unknown as Response, next);

      expect(apiKeyService.listApiKeys).toHaveBeenCalledWith(VALID_TENANT_ID, {
        page: undefined,
        limit: undefined,
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: "API keys retrieved",
        }),
      );
    });

    it("should list API keys with custom pagination", async () => {
      req.query = { page: "2", limit: "50" };
      apiKeyService.listApiKeys.mockResolvedValue({
        rows: [],
        meta: { total: 0, page: 2, limit: 50 },
      });

      await apiKeyController.list(req as unknown as Request, res as unknown as Response, next);

      expect(apiKeyService.listApiKeys).toHaveBeenCalledWith(VALID_TENANT_ID, {
        page: "2",
        limit: "50",
      });
    });
  });

  describe("getOne", () => {
    it("should return a specific API key", async () => {
      req.params = { id: VALID_KEY_ID };

      apiKeyService.getApiKey.mockResolvedValue({
        id: VALID_KEY_ID,
        name: "Secret Key Detail",
        scopes: ["device.read"],
      });

      await apiKeyController.getOne(req as unknown as Request, res as unknown as Response, next);

      expect(apiKeyService.getApiKey).toHaveBeenCalledWith(VALID_TENANT_ID, VALID_KEY_ID);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: "API key retrieved",
        }),
      );
    });

    it("should handle service error", async () => {
      req.params = { id: VALID_KEY_ID };
      const err = { status: 404, message: "API key not found" };
      apiKeyService.getApiKey.mockRejectedValue(err);

      await apiKeyController.getOne(req as unknown as Request, res as unknown as Response, next);

      expect(next).toHaveBeenCalledWith(err);
    });
  });

  describe("revoke", () => {
    it("should revoke an API key", async () => {
      req.params = { id: VALID_KEY_ID };

      apiKeyService.revokeApiKey.mockResolvedValue({
        id: VALID_KEY_ID,
        revoked: true,
        revokedAt: "2024-01-01T00:00:00Z",
      });

      await apiKeyController.revoke(req as unknown as Request, res as unknown as Response, next);

      expect(apiKeyService.revokeApiKey).toHaveBeenCalledWith(
        VALID_TENANT_ID,
        VALID_KEY_ID,
        expect.objectContaining({ userId: VALID_USER_ID }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: "API key revoked",
        }),
      );
    });

    it("should handle service error on revoke", async () => {
      req.params = { id: VALID_KEY_ID };
      const err = { status: 404, message: "API key not found" };
      apiKeyService.revokeApiKey.mockRejectedValue(err);

      await apiKeyController.revoke(req as unknown as Request, res as unknown as Response, next);

      expect(next).toHaveBeenCalledWith(err);
    });
  });
});
