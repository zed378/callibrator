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
    findOne: jest.fn(),
    findAndCountAll: jest.fn(),
  },
  AuditLog: { create: jest.fn() },
}));

// `query` is the claim (webhook.service#claim). Its SQL semantics — SKIP
// LOCKED, the lease — are proved on PostgreSQL in webhook.durable.a10.live.
jest.mock("../../config", () => ({
  db: { transaction: jest.fn((cb) => cb({ id: "tx" })), query: jest.fn() },
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
const { db } = require("../../config");
const { logger } = require("../../middlewares/activityLog.middleware");

const flush = () => new Promise((r) => setImmediate(r));

// A delivery row whose `update` applies the patch, as a Sequelize instance does.
const deliveryRow = (fields = {}) => {
  const r = {
    id: "d1",
    tenantId: "t1",
    webhookId: "w1",
    event: "device.overdue",
    payload: {},
    attempts: 0,
    createdAt: new Date("2026-09-24T00:00:00Z"),
    ...fields,
  };
  r.update = jest.fn(async (patch) => Object.assign(r, patch));
  return r;
};

const hookRow = (fields = {}) => ({ id: "w1", tenantId: "t1", url: "https://x.com", secret: "s", isActive: true, ...fields });

// The next claim returns `rows`.
const claims = (...batches) => {
  batches.forEach((rows) => db.query.mockResolvedValueOnce([rows]));
};

describe("webhook.service", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockReset();
    db.query.mockResolvedValue([[]]);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("_sign", () => {
    it("is a stable 64-char HMAC over `${timestamp}.${body}`", () => {
      const a = webhookService._sign("secret", 1700000000, "body");
      expect(a).toBe(webhookService._sign("secret", 1700000000, "body"));
      expect(a).toHaveLength(64);
      expect(a).toBe(crypto.createHmac("sha256", "secret").update("1700000000.body").digest("hex"));
      // The timestamp is signed: a different one is a different signature.
      expect(webhookService._sign("secret", 1700000001, "body")).not.toBe(a);
    });
  });

  describe("_backoffMs — exponential, capped, ~20.5 h to the dead letter", () => {
    it("doubles from one minute and caps at six hours", () => {
      const minutes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => webhookService._backoffMs(n) / 60000);
      expect(minutes).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 256, 360, 360]);
      const totalHours = minutes.reduce((a, b) => a + b, 0) / 60;
      expect(totalHours).toBeGreaterThan(20);
      expect(totalHours).toBeLessThan(24);
      expect(webhookService._config.MAX_ATTEMPTS).toBe(12);
    });

    it("takes its limits from the environment when set", () => {
      const env = { ...process.env };
      Object.assign(process.env, {
        WEBHOOK_MAX_ATTEMPTS: "3",
        WEBHOOK_TIMEOUT_MS: "1000",
        WEBHOOK_BACKOFF_BASE_MS: "1000",
        WEBHOOK_BACKOFF_CAP_MS: "4000",
        WEBHOOK_LEASE_MS: "60000",
        WEBHOOK_DISPATCH_BATCH: "7",
      });
      try {
        jest.isolateModules(() => {
          const svc = require("../../services/webhook.service");
          expect(svc._config).toEqual({
            MAX_ATTEMPTS: 3,
            BACKOFF_BASE_MS: 1000,
            BACKOFF_CAP_MS: 4000,
            LEASE_MS: 60000,
            BATCH_SIZE: 7,
          });
          expect([1, 2, 3, 4].map(svc._backoffMs)).toEqual([1000, 2000, 4000, 4000]);
        });
      } finally {
        process.env = env;
      }
    });
  });

  describe("CRUD", () => {
    describe("createWebhook", () => {
      // A-51: the secret in the response is the server-generated one; the
      // caller's `secret` is ignored (see webhook.secret.a51.test.js).
      it("creates a webhook and returns the server-generated secret", async () => {
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

        expect(result.secret).not.toBe("super-secret");
        expect(result.secret).toMatch(/^[0-9a-f]{64}$/);
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
          "events must be a non-empty array",
        );
        await expect(webhookService.createWebhook("t1", { url: "https://x.com", events: "not-array" })).rejects.toThrow(
          "events must be a non-empty array",
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
      it("updates webhook parameters (a url change also rotates the secret)", async () => {
        const mockUpdate = jest.fn();
        Webhook.findOne.mockResolvedValue({ id: "w1", tenantId: "t1", update: mockUpdate });

        await webhookService.updateWebhook("t1", "w1", { url: "https://new.com", events: ["event1"] });
        expect(mockUpdate).toHaveBeenCalledWith(
          { url: "https://new.com", events: ["event1"], secret: expect.stringMatching(/^v1:/) },
          { transaction: { id: "tx" } },
        );
      });

      it("updates without a transaction or a secret when the url is unchanged", async () => {
        const mockUpdate = jest.fn();
        Webhook.findOne.mockResolvedValue({ id: "w1", tenantId: "t1", url: "https://same.com", update: mockUpdate });

        await webhookService.updateWebhook("t1", "w1", { url: "https://same.com", isActive: false });
        expect(mockUpdate).toHaveBeenCalledWith({ url: "https://same.com", isActive: false });
      });

      it("throws 400 if updating events with invalid array", async () => {
        Webhook.findOne.mockResolvedValue({ id: "w1", tenantId: "t1" });
        await expect(webhookService.updateWebhook("t1", "w1", { events: [] })).rejects.toThrow(
          "events must be a non-empty array",
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

  describe("claim — the SQL it sends", () => {
    it("a batch claim is cross-tenant, SKIP LOCKED, and leases the rows", async () => {
      claims([{ id: "d1", tenantId: "t1" }]);
      const rows = await webhookService._claim();
      expect(rows).toEqual([{ id: "d1", tenantId: "t1" }]);
      const [sql, { replacements }] = db.query.mock.calls[0];
      expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
      expect(sql).toMatch(/status IN \('pending', 'failed'\)/);
      expect(sql).toMatch(/next_attempt_at <= now\(\)/);
      expect(sql).toMatch(/SET next_attempt_at = now\(\) \+ make_interval\(secs => :leaseSeconds\)/);
      expect(sql).not.toMatch(/tenant_id = :tenantId/);
      expect(replacements).toMatchObject({ leaseSeconds: 300, limit: 50 });
    });

    it("a claim by id is bound to the tenant and takes one row", async () => {
      await webhookService._claim({ id: "d1", tenantId: "t1", limit: 99 });
      const [sql, { replacements }] = db.query.mock.calls[0];
      expect(sql).toMatch(/AND id = :id AND tenant_id = :tenantId/);
      expect(replacements).toMatchObject({ id: "d1", tenantId: "t1", limit: 1 });
    });
  });

  describe("emitEvent", () => {
    it("writes a due row per matching webhook, then attempts it at once", async () => {
      Webhook.findAll.mockResolvedValue([hookRow()]);
      const row = deliveryRow();
      WebhookDelivery.create.mockResolvedValue(row);
      claims([{ id: "d1", tenantId: "t1" }]);
      WebhookDelivery.findOne.mockResolvedValue(row);
      Webhook.findOne.mockResolvedValue(hookRow());
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

      const result = await webhookService.emitEvent("t1", "device.overdue", { deviceId: "x" });
      expect(result.matched).toBe(1);
      await flush();
      await flush();

      const created = WebhookDelivery.create.mock.calls[0][0];
      expect(created).toMatchObject({ tenantId: "t1", webhookId: "w1", event: "device.overdue", status: "pending" });
      expect(created.nextAttemptAt).toBeDefined(); // the database's now()
      expect(row.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "success", attempts: 1, responseStatus: 200, nextAttemptAt: null }),
      );
      // Every read after the claim is scoped by the claimed row's tenant.
      expect(WebhookDelivery.findOne).toHaveBeenCalledWith({ where: { id: "d1", tenantId: "t1" } });
      expect(Webhook.findOne).toHaveBeenCalledWith({ where: { id: "w1", tenantId: "t1" } });
    });

    it("sends the timestamp, the delivery id and a v1 signature over `${timestamp}.${body}`", async () => {
      Webhook.findAll.mockResolvedValue([hookRow()]);
      const row = deliveryRow();
      WebhookDelivery.create.mockResolvedValue(row);
      claims([{ id: "d1", tenantId: "t1" }]);
      WebhookDelivery.findOne.mockResolvedValue(row);
      Webhook.findOne.mockResolvedValue(hookRow());
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

      await webhookService.emitEvent("t1", "device.overdue");
      await flush();
      await flush();

      const [, init] = global.fetch.mock.calls[0];
      const ts = init.headers["X-Webhook-Timestamp"];
      expect(ts).toMatch(/^\d+$/);
      expect(Math.abs(Number(ts) - Date.now() / 1000)).toBeLessThan(5);
      expect(init.headers["X-Webhook-Delivery"]).toBe("d1");
      expect(init.headers["X-Webhook-Signature"]).toBe(
        `v1=${crypto.createHmac("sha256", "s").update(`${ts}.${init.body}`).digest("hex")}`,
      );
      expect(JSON.parse(init.body)).toMatchObject({ id: "d1", event: "device.overdue", data: {} });
    });

    it("does not follow a redirect, and records it as a failure with the next attempt scheduled", async () => {
      Webhook.findAll.mockResolvedValue([hookRow()]);
      const row = deliveryRow();
      WebhookDelivery.create.mockResolvedValue(row);
      claims([{ id: "d1", tenantId: "t1" }]);
      WebhookDelivery.findOne.mockResolvedValue(row);
      Webhook.findOne.mockResolvedValue(hookRow());
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 302 });

      const before = Date.now();
      await webhookService.emitEvent("t1", "test");
      await flush();
      await flush();

      expect(global.fetch).toHaveBeenCalledWith("https://x.com", expect.objectContaining({ redirect: "manual" }));
      const patch = row.update.mock.calls[0][0];
      expect(patch).toMatchObject({
        status: "failed",
        attempts: 1,
        responseStatus: 302,
        lastError: expect.stringContaining("Redirect (302) not followed"),
      });
      // Retry in a minute, in the database — not in a timer in this process.
      expect(patch.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + 60000);
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

    it("logs, and leaves the row due for the dispatcher, when the first attempt errors", async () => {
      Webhook.findAll.mockResolvedValue([hookRow()]);
      WebhookDelivery.create.mockResolvedValue(deliveryRow());
      db.query.mockRejectedValueOnce(new Error("claim failed"));

      const r = await webhookService.emitEvent("t1", "test", {});
      expect(r.matched).toBe(1);
      await flush();
      expect(logger.error).toHaveBeenCalledWith("Webhook delivery error: claim failed");
    });

    it("does nothing more when the row was already claimed elsewhere", async () => {
      Webhook.findAll.mockResolvedValue([hookRow()]);
      WebhookDelivery.create.mockResolvedValue(deliveryRow());
      claims([]);
      global.fetch = jest.fn();

      await webhookService.emitEvent("t1", "test", {});
      await flush();
      expect(WebhookDelivery.findOne).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("deliverClaimed — outcomes", () => {
    const run = async (row, hook, fetchImpl) => {
      claims([{ id: row.id, tenantId: row.tenantId }]);
      WebhookDelivery.findOne.mockResolvedValue(row);
      Webhook.findOne.mockResolvedValue(hook);
      global.fetch = fetchImpl || jest.fn().mockResolvedValue({ ok: false, status: 500 });
      return webhookService._dispatchDelivery(row.id, row.tenantId);
    };

    it("returns null when the claimed row has gone (tenant deleted)", async () => {
      claims([{ id: "d1", tenantId: "t1" }]);
      WebhookDelivery.findOne.mockResolvedValue(null);
      expect(await webhookService._dispatchDelivery("d1", "t1")).toBeNull();
    });

    it("dead-letters a delivery whose webhook was deleted", async () => {
      const row = deliveryRow();
      await run(row, null);
      expect(row.update).toHaveBeenCalledWith({ status: "exhausted", nextAttemptAt: null, lastError: "webhook deleted" });
    });

    it("dead-letters a domain event for a deactivated webhook, without posting", async () => {
      const row = deliveryRow();
      const fetchSpy = jest.fn();
      await run(row, hookRow({ isActive: false }), fetchSpy);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(row.update).toHaveBeenCalledWith({ status: "exhausted", nextAttemptAt: null, lastError: "webhook deactivated" });
    });

    it("still sends a test delivery to a deactivated webhook", async () => {
      const row = deliveryRow({ event: "webhook.test" });
      await run(row, hookRow({ isActive: false }), jest.fn().mockResolvedValue({ ok: true, status: 204 }));
      expect(row.update).toHaveBeenCalledWith(expect.objectContaining({ status: "success", responseStatus: 204 }));
    });

    it("schedules attempt n+1 after backoff(n), counting from the stored attempts", async () => {
      const row = deliveryRow({ attempts: 4 });
      const before = Date.now();
      await run(row, hookRow());
      const patch = row.update.mock.calls[0][0];
      expect(patch).toMatchObject({ status: "failed", attempts: 5, responseStatus: 500, lastError: "HTTP 500" });
      const wait = patch.nextAttemptAt.getTime() - before;
      expect(wait).toBeGreaterThanOrEqual(16 * 60000); // backoff(5) = 16 min
      expect(wait).toBeLessThan(17 * 60000);
    });

    it("dead-letters after attempt 12 and logs it", async () => {
      const row = deliveryRow({ attempts: 11 });
      await run(row, hookRow());
      expect(row.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "exhausted", attempts: 12, nextAttemptAt: null }),
      );
      expect(logger.warn).toHaveBeenCalledWith("Webhook delivery exhausted after 12 attempt(s): d1");
    });

    it("gives a test delivery exactly one attempt", async () => {
      const row = deliveryRow({ event: "webhook.test" });
      await run(row, hookRow());
      expect(row.update).toHaveBeenCalledWith(expect.objectContaining({ status: "exhausted", attempts: 1 }));
    });

    it("records a timeout as `timeout`", async () => {
      const row = deliveryRow();
      const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
      await run(row, hookRow(), jest.fn().mockRejectedValue(abort));
      expect(row.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed", responseStatus: null, lastError: "timeout" }),
      );
    });

    it("aborts a request that outlives WEBHOOK_TIMEOUT_MS", async () => {
      jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick"] });
      try {
        const row = deliveryRow();
        const hanging = jest.fn(
          (url, { signal }) =>
            new Promise((resolve, reject) =>
              signal.addEventListener("abort", () => reject(Object.assign(new Error("x"), { name: "AbortError" }))),
            ),
        );
        const pending = run(row, hookRow(), hanging);
        for (let i = 0; i < 5 && !hanging.mock.calls.length; i++) {
          await flush();
        }
        jest.advanceTimersByTime(8000);
        await pending;
        expect(row.update).toHaveBeenCalledWith(expect.objectContaining({ lastError: "timeout" }));
      } finally {
        jest.useRealTimers();
      }
    });

    it("records any other error by its message", async () => {
      const row = deliveryRow();
      await run(row, hookRow(), jest.fn().mockRejectedValue(new Error("ECONNREFUSED")));
      expect(row.update).toHaveBeenCalledWith(expect.objectContaining({ lastError: "ECONNREFUSED" }));
    });
  });

  describe("dispatchDue — the dispatcher's tick", () => {
    it("claims a batch and attempts every row; one failure never stops another", async () => {
      const ok = deliveryRow({ id: "d1" });
      claims([
        { id: "d1", tenantId: "t1" },
        { id: "d2", tenantId: "t2" },
      ]);
      WebhookDelivery.findOne.mockImplementation(async ({ where }) => {
        if (where.id === "d2") {
          throw new Error("row read failed");
        }
        return ok;
      });
      Webhook.findOne.mockResolvedValue(hookRow());
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

      const summary = await webhookService.dispatchDue({ limit: 10 });
      expect(summary).toEqual({ claimed: 2, errors: 1 });
      expect(db.query.mock.calls[0][1].replacements.limit).toBe(10);
      expect(ok.update).toHaveBeenCalledWith(expect.objectContaining({ status: "success" }));
      expect(logger.error).toHaveBeenCalledWith("Webhook dispatch error: row read failed");
    });

    it("claims the default batch when called with no options", async () => {
      expect(await webhookService.dispatchDue()).toEqual({ claimed: 0, errors: 0 });
      expect(db.query.mock.calls[0][1].replacements.limit).toBe(50);
    });
  });

  describe("emitAfterCommit (A-11)", () => {
    it("with no transaction, emits now", async () => {
      Webhook.findAll.mockResolvedValue([]);
      webhookService.emitAfterCommit(null, "t1", "work_order.created", { workOrderId: "w" });
      await flush();
      expect(Webhook.findAll).toHaveBeenCalledTimes(1);
    });

    it("with a transaction, emits only from its afterCommit hook", async () => {
      Webhook.findAll.mockResolvedValue([]);
      const hooks = [];
      const transaction = { afterCommit: (fn) => hooks.push(fn) };
      webhookService.emitAfterCommit(transaction, "t1", "capa.created", {});
      await flush();
      expect(Webhook.findAll).not.toHaveBeenCalled(); // not before COMMIT
      hooks.forEach((h) => h());
      await flush();
      expect(Webhook.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: "t1" }) }),
      );
    });

    it("with a double that has no afterCommit, emits nothing and never throws", async () => {
      expect(() => webhookService.emitAfterCommit({ id: "tx" }, "t1", "capa.created", {})).not.toThrow();
      await flush();
      expect(Webhook.findAll).not.toHaveBeenCalled();
    });
  });

  describe("testWebhook", () => {
    it("makes one attempt and returns its result, reading the row back tenant-scoped", async () => {
      Webhook.findOne.mockResolvedValue(hookRow());
      const row = deliveryRow({ event: "webhook.test" });
      WebhookDelivery.create.mockResolvedValue(row);
      claims([{ id: "d1", tenantId: "t1" }]);
      WebhookDelivery.findOne.mockResolvedValue(row);
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

      const result = await webhookService.testWebhook("t1", "w1");
      expect(result).toEqual({ deliveryId: "d1", status: "success", responseStatus: 200, attempts: 1, lastError: null });
      expect(WebhookDelivery.create).toHaveBeenCalledWith(expect.objectContaining({ event: "webhook.test", tenantId: "t1" }));
      expect(WebhookDelivery.findOne).toHaveBeenLastCalledWith({ where: { id: "d1", tenantId: "t1" } });
    });

    it("logs a dispatch error and still answers with the row", async () => {
      Webhook.findOne.mockResolvedValue(hookRow());
      const row = deliveryRow({ event: "webhook.test", status: "pending" });
      WebhookDelivery.create.mockResolvedValue(row);
      db.query.mockRejectedValueOnce(new Error("claim failed"));
      WebhookDelivery.findOne.mockResolvedValue(row);

      const result = await webhookService.testWebhook("t1", "w1");
      expect(result.status).toBe("pending");
      expect(logger.error).toHaveBeenCalledWith("Webhook test delivery error: claim failed");
    });

    it("is a 404 for another tenant's webhook", async () => {
      Webhook.findOne.mockResolvedValue(null);
      await expect(webhookService.testWebhook("t2", "w1")).rejects.toMatchObject({ status: 404 });
      expect(WebhookDelivery.create).not.toHaveBeenCalled();
    });
  });
});
