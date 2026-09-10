/**
 * Tests for webhook controller
 */

jest.mock("../../services/webhook.service", () => ({
  createWebhook: jest.fn(),
  listWebhooks: jest.fn(),
  getWebhook: jest.fn(),
  updateWebhook: jest.fn(),
  deleteWebhook: jest.fn(),
  listDeliveries: jest.fn(),
  testWebhook: jest.fn(),
  emitEvent: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const webhookController = require("../../controllers/webhook.controller");
const webhookService = require("../../services/webhook.service");
const { success } = require("../../utils/response.util");

const WEBHOOK_ID = "550e8400-e29b-41d4-a716-446655440000";
const TENANT_ID = "550e8400-e29b-41d4-a716-446655440001";

describe("webhook Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((res, data, meta, message, status) => {
      res.status(status || 200).json({ success: true, data, message });
    });
    req = {
      params: {},
      body: {},
      query: {},
      user: { id: "user-1", tenantId: TENANT_ID },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
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

      await webhookController.create(req, res, next);

      expect(webhookService.createWebhook).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          url: "https://example.com/hook",
          createdBy: "user-1",
        }),
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("list", () => {
    it("should list webhooks", async () => {
      req.query = { page: "1", limit: "10" };
      webhookService.listWebhooks.mockResolvedValue({
        rows: [{ id: WEBHOOK_ID, url: "https://example.com/hook" }],
        meta: { total: 1, page: 1, limit: 10 },
      });

      await webhookController.list(req, res, next);

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

      await webhookController.getOne(req, res, next);

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

      await webhookController.update(req, res, next);

      expect(webhookService.updateWebhook).toHaveBeenCalledWith(
        TENANT_ID,
        WEBHOOK_ID,
        { url: "https://example.com/new-hook", description: "Updated" },
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("should delete a webhook", async () => {
      req.params = { id: WEBHOOK_ID };
      webhookService.deleteWebhook.mockResolvedValue({ id: WEBHOOK_ID });

      await webhookController.remove(req, res, next);

      expect(webhookService.deleteWebhook).toHaveBeenCalledWith(TENANT_ID, WEBHOOK_ID);
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

      await webhookController.deliveries(req, res, next);

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

      await webhookController.test(req, res, next);

      expect(webhookService.testWebhook).toHaveBeenCalledWith(TENANT_ID, WEBHOOK_ID);
      expect(success).toHaveBeenCalled();
    });
  });
});
