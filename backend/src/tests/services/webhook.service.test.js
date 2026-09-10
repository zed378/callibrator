const crypto = require("crypto");

jest.mock("../../models", () => ({
  Webhook: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    findAndCountAll: jest.fn(),
  },
  WebhookDelivery: {
    create: jest.fn(),
    findByPk: jest.fn(),
    findAndCountAll: jest.fn(),
  },
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// SSRF guards do real URL parsing / DNS resolution; neutralize them here so
// these tests exercise delivery/retry logic (SSRF logic is covered separately
// in tests/utils/ssrf.util.test.js).
jest.mock("../../utils/ssrf.util", () => ({
  assertSafeUrl: jest.fn(),
  assertResolvedHostIsPublic: jest.fn().mockResolvedValue(undefined),
  isBlockedIp: jest.fn(),
}));

const webhookService = require("../../services/webhook.service");
const { Webhook, WebhookDelivery } = require("../../models");
const { logger } = require("../../middlewares/activityLog.middleware");

describe("webhook.service", () => {
  let originalSetTimeout = global.setTimeout;
  let originalFetch = global.fetch;
  let triggerTimeout = false;

  beforeEach(() => {
    jest.clearAllMocks();
    triggerTimeout = false;
    global.setTimeout = jest.fn((cb, ms) => {
      // Differentiate between abort timeout and promise backoff via callback inspection
      if (cb.toString().includes("abort")) {
        if (triggerTimeout) {
          cb();
        } else {
          // Do not run timeout immediately for normal tests
          return originalSetTimeout(cb, ms);
        }
      } else {
        cb();
      }
    });
  });

  afterEach(() => {
    global.setTimeout = originalSetTimeout;
    global.fetch = originalFetch;
  });

  describe("_sign", () => {
    it("produces a stable 64-char HMAC", () => {
      const a = webhookService._sign("secret", "body");
      const b = webhookService._sign("secret", "body");
      expect(a).toBe(b);
      expect(a).toHaveLength(64);
    });
  });

  describe("CRUD", () => {
    describe("createWebhook", () => {
      it("creates a webhook and returns secret", async () => {
        Webhook.create.mockResolvedValue({
          id: "w1",
          tenantId: "t1",
          url: "https://test.com",
          events: ["*"],
          description: "Test hook",
          isActive: true,
          secret: "super-secret",
          createdBy: "user-1",
        });

        const result = await webhookService.createWebhook("t1", {
          url: "https://test.com",
          events: ["*"],
          description: "Test hook",
          secret: "super-secret",
          createdBy: "user-1",
        });

        expect(result.secret).toBe("super-secret");
        expect(result.url).toBe("https://test.com");
      });

      it("creates a webhook with minimal parameters and defaults", async () => {
        Webhook.create.mockResolvedValue({
          id: "w1",
          tenantId: "t1",
          url: "https://test.com",
          events: ["*"],
          description: null,
          isActive: true,
          secret: undefined,
          createdBy: null,
        });

        const result = await webhookService.createWebhook("t1", {
          url: "https://test.com",
          events: ["*"],
        });

        expect(result.description).toBeNull();
        expect(result.isActive).toBe(true);
      });

      it("creates a webhook with isActive explicitly false", async () => {
        Webhook.create.mockResolvedValue({
          id: "w1",
          tenantId: "t1",
          url: "https://test.com",
          events: ["*"],
          isActive: false,
        });

        const result = await webhookService.createWebhook("t1", {
          url: "https://test.com",
          events: ["*"],
          isActive: false,
        });

        expect(result.isActive).toBe(false);
      });

      it("throws 400 if url is missing", async () => {
        await expect(webhookService.createWebhook("t1", { events: ["*"] })).rejects.toThrow("url is required");
      });

      it("throws 400 if events is not a non-empty array", async () => {
        await expect(webhookService.createWebhook("t1", { url: "https://x.com", events: [] })).rejects.toThrow(
          "events must be a non-empty array"
        );
        await expect(webhookService.createWebhook("t1", { url: "https://x.com", events: "not-array" })).rejects.toThrow(
          "events must be a non-empty array"
        );
      });
    });

    describe("listWebhooks", () => {
      it("lists webhooks with pagination and metadata", async () => {
        Webhook.findAndCountAll.mockResolvedValue({
          count: 1,
          rows: [{ id: "w1", url: "https://x.com" }],
        });

        const result = await webhookService.listWebhooks("t1", { page: 2, limit: 5 });
        expect(result.meta.totalPages).toBe(1);
        expect(result.meta.page).toBe(2);
      });

      it("lists webhooks with default parameters", async () => {
        Webhook.findAndCountAll.mockResolvedValue({
          count: 1,
          rows: [{ id: "w1", url: "https://x.com" }],
        });

        const result = await webhookService.listWebhooks("t1");
        expect(result.meta.page).toBe(1);
      });

      it("handles listWebhooks with falsy or extremely high limits", async () => {
        Webhook.findAndCountAll.mockResolvedValue({
          count: 1,
          rows: [{ id: "w1", url: "https://x.com" }],
        });

        await webhookService.listWebhooks("t1", { limit: 0 });
        expect(Webhook.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 25 }));

        await webhookService.listWebhooks("t1", { limit: 9999 });
        expect(Webhook.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }));
      });
    });

    describe("getWebhook", () => {
      it("returns public webhook details", async () => {
        Webhook.findOne.mockResolvedValue({ id: "w1", tenantId: "t1", url: "https://x.com" });
        const result = await webhookService.getWebhook("t1", "w1");
        expect(result.id).toBe("w1");
      });

      it("throws 404 if webhook not found", async () => {
        Webhook.findOne.mockResolvedValue(null);
        await expect(webhookService.getWebhook("t1", "w1")).rejects.toThrow("Webhook not found");
      });
    });

    describe("updateWebhook", () => {
      it("updates webhook parameters", async () => {
        const mockUpdate = jest.fn();
        Webhook.findOne.mockResolvedValue({ id: "w1", tenantId: "t1", update: mockUpdate });

        await webhookService.updateWebhook("t1", "w1", { url: "https://new.com", events: ["event1"] });
        expect(mockUpdate).toHaveBeenCalledWith({ url: "https://new.com", events: ["event1"] });
      });

      it("throws 400 if updating events with invalid array", async () => {
        Webhook.findOne.mockResolvedValue({ id: "w1", tenantId: "t1" });
        await expect(webhookService.updateWebhook("t1", "w1", { events: [] })).rejects.toThrow(
          "events must be a non-empty array"
        );
      });
    });

    describe("deleteWebhook", () => {
      it("soft deletes a webhook", async () => {
        const mockSoftDelete = jest.fn();
        Webhook.findOne.mockResolvedValue({ id: "w1", tenantId: "t1", softDelete: mockSoftDelete });

        const result = await webhookService.deleteWebhook("t1", "w1");
        expect(result.id).toBe("w1");
        expect(mockSoftDelete).toHaveBeenCalled();
      });
    });

    describe("listDeliveries", () => {
      it("lists webhook deliveries with defaults", async () => {
        Webhook.findOne.mockResolvedValue({ id: "w1", tenantId: "t1" });
        WebhookDelivery.findAndCountAll.mockResolvedValue({
          count: 1,
          rows: [{ id: "d1" }],
        });

        const result = await webhookService.listDeliveries("t1", "w1");
        expect(result.rows.length).toBe(1);
      });

      it("lists webhook deliveries with explicit page and limits", async () => {
        Webhook.findOne.mockResolvedValue({ id: "w1", tenantId: "t1" });
        WebhookDelivery.findAndCountAll.mockResolvedValue({
          count: 1,
          rows: [{ id: "d1" }],
        });

        const result = await webhookService.listDeliveries("t1", "w1", { page: 2, limit: 15 });
        expect(result.meta.page).toBe(2);
      });

      it("handles listDeliveries with falsy or extremely high limits", async () => {
        Webhook.findOne.mockResolvedValue({ id: "w1", tenantId: "t1" });
        WebhookDelivery.findAndCountAll.mockResolvedValue({
          count: 1,
          rows: [{ id: "d1" }],
        });

        await webhookService.listDeliveries("t1", "w1", { limit: 0 });
        expect(WebhookDelivery.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 25 }));

        await webhookService.listDeliveries("t1", "w1", { limit: 9999 });
        expect(WebhookDelivery.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }));
      });
    });
  });

  describe("Delivery and emitEvent", () => {
    it("delivers event successfully on first attempt", async () => {
      Webhook.findAll.mockResolvedValue([{ id: "w1", url: "https://x.com", secret: "s" }]);
      const mockUpdate = jest.fn();
      WebhookDelivery.create.mockResolvedValue({
        id: "d1",
        event: "test",
        payload: {},
        update: mockUpdate,
      });

      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

      const result = await webhookService.emitEvent("t1", "test");
      expect(result.matched).toBe(1);

      // Yield event loop to allow delivery background task to run
      await new Promise((r) => setImmediate(r));

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "success",
          attempts: 1,
          responseStatus: 200,
        })
      );
    });

    it("retries up to max attempts (5) and marks as exhausted on fetch status failure", async () => {
      Webhook.findAll.mockResolvedValue([{ id: "w1", url: "https://x.com", secret: "s" }]);
      const mockUpdate = jest.fn();
      WebhookDelivery.create.mockResolvedValue({
        id: "d1",
        event: "test",
        payload: {},
        update: mockUpdate,
      });

      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });

      await webhookService.emitEvent("t1", "test", {});

      await new Promise((r) => setImmediate(r));

      expect(mockUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: "exhausted",
          attempts: 5,
          responseStatus: 500,
        })
      );
    });

    it("marks as timeout when fetch throws AbortError (timeout)", async () => {
      triggerTimeout = true;
      Webhook.findAll.mockResolvedValue([{ id: "w1", url: "https://x.com", secret: "s" }]);
      const mockUpdate = jest.fn();
      WebhookDelivery.create.mockResolvedValue({
        id: "d1",
        event: "test",
        payload: {},
        update: mockUpdate,
      });

      global.fetch = jest.fn().mockImplementation((url, options) => {
        return new Promise((resolve, reject) => {
          if (options?.signal?.aborted) {
            const abortError = new Error("The user aborted a request.");
            abortError.name = "AbortError";
            return reject(abortError);
          }
          if (options?.signal) {
            options.signal.addEventListener("abort", () => {
              const abortError = new Error("The user aborted a request.");
              abortError.name = "AbortError";
              reject(abortError);
            });
          }
        });
      });

      await webhookService.emitEvent("t1", "test", {});
      await new Promise((r) => setImmediate(r));

      expect(mockUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: "exhausted",
          attempts: 5,
          lastError: "timeout",
        })
      );
    });

    it("returns matched:0 when no webhook subscribes", async () => {
      Webhook.findAll.mockResolvedValue([]);
      const r = await webhookService.emitEvent("t1", "nothing.subscribed", {});
      expect(r.matched).toBe(0);
      expect(WebhookDelivery.create).not.toHaveBeenCalled();
    });

    it("never throws on a DB error (best-effort)", async () => {
      Webhook.findAll.mockRejectedValue(new Error("db down"));
      const r = await webhookService.emitEvent("t1", "x", {});
      expect(r.matched).toBe(0);
      expect(r.error).toBe("db down");
    });

    it("logs error when background deliverWithRetry throws an error due to update failure", async () => {
      Webhook.findAll.mockResolvedValue([{ id: "w1", url: "https://x.com", secret: "s" }]);
      const mockUpdate = jest.fn().mockRejectedValue(new Error("Update failed"));
      WebhookDelivery.create.mockResolvedValue({
        id: "d1",
        event: "test",
        payload: {},
        update: mockUpdate,
      });

      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

      await webhookService.emitEvent("t1", "test", {});
      await new Promise((r) => setImmediate(r));

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Webhook delivery error: Update failed"));
    });
  });

  describe("testWebhook", () => {
    it("sends a synthetic test event successfully", async () => {
      Webhook.findOne.mockResolvedValue({ id: "w1", tenantId: "t1", url: "https://x.com", secret: "s" });
      WebhookDelivery.create.mockResolvedValue({
        id: "d1",
        event: "webhook.test",
        payload: {},
        update: jest.fn(),
      });
      WebhookDelivery.findByPk.mockResolvedValue({
        id: "d1",
        status: "success",
        responseStatus: 200,
        attempts: 1,
        lastError: null,
      });

      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

      const result = await webhookService.testWebhook("t1", "w1");
      expect(result.status).toBe("success");
    });

    it("handles failure of deliverWithRetry in testWebhook gracefully", async () => {
      Webhook.findOne.mockResolvedValue({ id: "w1", tenantId: "t1", url: "https://x.com", secret: "s" });
      const mockUpdate = jest.fn().mockRejectedValue(new Error("Database write error during retry"));
      WebhookDelivery.create.mockResolvedValue({
        id: "d1",
        event: "webhook.test",
        payload: {},
        update: mockUpdate,
      });
      WebhookDelivery.findByPk.mockResolvedValue({
        id: "d1",
        status: "failed",
        responseStatus: null,
        attempts: 1,
        lastError: "Database write error during retry",
      });

      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

      const result = await webhookService.testWebhook("t1", "w1");
      expect(result).toBeDefined();
      expect(result.deliveryId).toBe("d1");
    });
  });
});
