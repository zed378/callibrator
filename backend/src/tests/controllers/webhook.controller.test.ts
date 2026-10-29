/**
 * Tests for webhook controller
 */
import type { Request, Response, NextFunction } from "express";

jest.mock("../../services/webhook.service", () => ({
  createWebhook: jest.fn(),
  listWebhooks: jest.fn(),
  getWebhook: jest.fn(),
  updateWebhook: jest.fn(),
  deleteWebhook: jest.fn(),
  listDeliveries: jest.fn(),
  testWebhook: jest.fn(),
  rotateSecret: jest.fn(),
  emitEvent: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

interface WebhookServiceDouble {
  createWebhook: jest.Mock;
  listWebhooks: jest.Mock;
  getWebhook: jest.Mock;
  updateWebhook: jest.Mock;
  deleteWebhook: jest.Mock;
  listDeliveries: jest.Mock;
  testWebhook: jest.Mock;
  rotateSecret: jest.Mock;
  emitEvent: jest.Mock;
}

interface ResponseDouble {
  success: jest.Mock;
  error: jest.Mock;
}

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

interface MockRequest {
  params: Record<string, string | undefined>;
  body: Record<string, unknown> | undefined;
  query: Record<string, string | undefined>;
  user?: { id: string; tenantId: string } | undefined;
  ip?: string | undefined;
  get: jest.Mock;
}

interface MockResponse {
  status: jest.Mock<MockResponse, [number?]>;
  json: jest.Mock<MockResponse, [unknown?]>;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const webhookController = require("../../controllers/webhook.controller") as {
  create: Handler;
  list: Handler;
  getOne: Handler;
  update: Handler;
  remove: Handler;
  deliveries: Handler;
  test: Handler;
  rotateSecret: Handler;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const webhookService = require("../../services/webhook.service") as WebhookServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { success } = require("../../utils/response.util") as ResponseDouble;

const WEBHOOK_ID = "550e8400-e29b-41d4-a716-446655440000";
const TENANT_ID = "550e8400-e29b-41d4-a716-446655440001";

describe("webhook Controller", () => {
  let req: MockRequest;
  let res: MockResponse;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((resObj: MockResponse, data: unknown, _meta: unknown, message: unknown, status?: number) => {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as in original test
      resObj.status(status || 200).json({ success: true, data, message });
    });
    req = {
      params: {},
      body: {},
      query: {},
      user: { id: "user-1", tenantId: TENANT_ID },
      ip: "10.0.0.1",
      get: jest.fn((h: string) => (h === "user-agent" ? "jest-agent" : undefined)),
    };
    res = {
      status: jest.fn<MockResponse, [number?]>(),
      json: jest.fn<MockResponse, [unknown?]>(),
    };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    next = jest.fn();
  });

  describe("create", () => {
    it("should create a webhook", async () => {
      req.body = {
        url: "https://example.com/hook",
        events: ["device.created", "device.updated"],
        description: "Test webhook",
      };
      webhookService.createWebhook.mockResolvedValue({
        id: WEBHOOK_ID,
        url: "https://example.com/hook",
      });

      await webhookController.create(req as unknown as Request, res as unknown as Response, next);

      expect(webhookService.createWebhook).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          url: "https://example.com/hook",
          createdBy: "user-1",
        }),
        // P6-13: the actor, for the audit row written inside the create.
        { userId: "user-1", ipAddress: "10.0.0.1", userAgent: "jest-agent" },
      );
      expect(success).toHaveBeenCalled();
    });

    // A-51: even if the validator were bypassed, the controller forwards only
    // the four accepted fields — never a caller's `secret` or `tenantId`.
    it("never forwards a caller-supplied secret to the service", async () => {
      req.body = {
        url: "https://example.com/hook",
        events: ["*"],
        description: "d",
        isActive: true,
        secret: "a",
        tenantId: "someone-else",
      };
      webhookService.createWebhook.mockResolvedValue({ id: WEBHOOK_ID });

      await webhookController.create(req as unknown as Request, res as unknown as Response, next);

      expect(webhookService.createWebhook).toHaveBeenCalledWith(
        TENANT_ID,
        {
          url: "https://example.com/hook",
          events: ["*"],
          description: "d",
          isActive: true,
          createdBy: "user-1",
        },
        { userId: "user-1", ipAddress: "10.0.0.1", userAgent: "jest-agent" },
      );
    });
  });

  describe("list", () => {
    it("should list webhooks", async () => {
      req.query = { page: "1", limit: "10" };
      webhookService.listWebhooks.mockResolvedValue({
        rows: [{ id: WEBHOOK_ID, url: "https://example.com/hook" }],
        meta: { total: 1, page: 1, limit: 10 },
      });

      await webhookController.list(req as unknown as Request, res as unknown as Response, next);

      expect(webhookService.listWebhooks).toHaveBeenCalledWith(TENANT_ID, {
        page: "1",
        limit: "10",
      });
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getOne", () => {
    it("should return a specific webhook", async () => {
      req.params = { id: WEBHOOK_ID };
      webhookService.getWebhook.mockResolvedValue({
        id: WEBHOOK_ID,
        url: "https://example.com/hook",
      });

      await webhookController.getOne(req as unknown as Request, res as unknown as Response, next);

      expect(webhookService.getWebhook).toHaveBeenCalledWith(TENANT_ID, WEBHOOK_ID);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("should update a webhook", async () => {
      req.params = { id: WEBHOOK_ID };
      req.body = { url: "https://example.com/new-hook", description: "Updated" };
      webhookService.updateWebhook.mockResolvedValue({
        id: WEBHOOK_ID,
        url: "https://example.com/new-hook",
      });

      await webhookController.update(req as unknown as Request, res as unknown as Response, next);

      expect(webhookService.updateWebhook).toHaveBeenCalledWith(
        TENANT_ID,
        WEBHOOK_ID,
        { url: "https://example.com/new-hook", description: "Updated" },
        { userId: "user-1", ipAddress: "10.0.0.1", userAgent: "jest-agent" },
      );
      expect(success).toHaveBeenCalled();
    });

    it("passes an empty patch when there is no body", async () => {
      req.params = { id: WEBHOOK_ID };
      req.body = undefined;
      webhookService.updateWebhook.mockResolvedValue({ id: WEBHOOK_ID });

      await webhookController.update(req as unknown as Request, res as unknown as Response, next);

      expect(webhookService.updateWebhook).toHaveBeenCalledWith(
        TENANT_ID,
        WEBHOOK_ID,
        {},
        expect.objectContaining({ userId: "user-1" }),
      );
    });
  });

  describe("rotateSecret", () => {
    it("rotates the secret with the actor, and returns it", async () => {
      req.params = { id: WEBHOOK_ID };
      req.body = { overlapHours: 6 };
      webhookService.rotateSecret.mockResolvedValue({ id: WEBHOOK_ID, secret: "new" });

      await webhookController.rotateSecret(req as unknown as Request, res as unknown as Response, next);

      expect(webhookService.rotateSecret).toHaveBeenCalledWith(
        TENANT_ID,
        WEBHOOK_ID,
        { userId: "user-1", ipAddress: "10.0.0.1", userAgent: "jest-agent" },
        { overlapHours: 6 },
      );
      expect(success).toHaveBeenCalledWith(
        res,
        { id: WEBHOOK_ID, secret: "new" },
        null,
        expect.stringContaining("rotated"),
        200,
      );
    });
  });

  describe("rotateSecret — bodyless (P6-13)", () => {
    it("passes an undefined overlap when there is no body, so the service default applies", async () => {
      req.params = { id: WEBHOOK_ID };
      req.body = undefined;
      webhookService.rotateSecret.mockResolvedValue({ id: WEBHOOK_ID, secret: "new" });

      await webhookController.rotateSecret(req as unknown as Request, res as unknown as Response, next);

      const firstCall = webhookService.rotateSecret.mock.calls[0] as [unknown, unknown, unknown, unknown] | undefined;
      expect(firstCall?.[3]).toEqual({ overlapHours: undefined });
    });
  });

  describe("remove", () => {
    it("should delete a webhook", async () => {
      req.params = { id: WEBHOOK_ID };
      webhookService.deleteWebhook.mockResolvedValue({ id: WEBHOOK_ID });

      await webhookController.remove(req as unknown as Request, res as unknown as Response, next);

      expect(webhookService.deleteWebhook).toHaveBeenCalledWith(TENANT_ID, WEBHOOK_ID, {
        userId: "user-1",
        ipAddress: "10.0.0.1",
        userAgent: "jest-agent",
      });
      expect(success).toHaveBeenCalled();
    });
  });

  describe("deliveries", () => {
    it("should list webhook deliveries", async () => {
      req.params = { id: WEBHOOK_ID };
      req.query = { page: "1", limit: "10" };
      webhookService.listDeliveries.mockResolvedValue({
        rows: [{ id: "d-1", status: "success" }],
        meta: { total: 1, page: 1, limit: 10 },
      });

      await webhookController.deliveries(req as unknown as Request, res as unknown as Response, next);

      expect(webhookService.listDeliveries).toHaveBeenCalledWith(
        TENANT_ID,
        WEBHOOK_ID,
        { page: "1", limit: "10" },
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("test", () => {
    it("should test a webhook delivery", async () => {
      req.params = { id: WEBHOOK_ID };
      webhookService.testWebhook.mockResolvedValue({
        deliveryId: "d-1",
        status: "success",
      });

      await webhookController.test(req as unknown as Request, res as unknown as Response, next);

      expect(webhookService.testWebhook).toHaveBeenCalledWith(TENANT_ID, WEBHOOK_ID);
      expect(success).toHaveBeenCalled();
    });
  });
});
