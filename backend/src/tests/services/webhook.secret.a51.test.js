/**
 * A-51 — the webhook signing secret: server-generated only, envelope-encrypted
 * at rest, decrypted only to sign, rotatable, and never kept across a url change.
 *
 * These tests use the REAL kms.service (its development master key), not a mock
 * of it: "the stored value is not the plaintext" and "the signature still
 * verifies" are claims about the actual cipher, and a mocked cipher would only
 * prove this file agrees with itself.
 */
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

const TX = { id: "tx-1" };
jest.mock("../../config", () => ({
  db: { transaction: jest.fn((cb) => cb(TX)), query: jest.fn() },
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../utils/ssrf.util", () => ({
  assertSafeUrl: jest.fn(),
  assertResolvedHostIsPublic: jest.fn().mockResolvedValue(undefined),
  isBlockedIp: jest.fn(),
}));

const webhookService = require("../../services/webhook.service");
const { Webhook, WebhookDelivery, AuditLog } = require("../../models");
const { db } = require("../../config");
const kms = require("../../services/kms.service");

const TENANT = "11111111-1111-4111-8111-111111111111";
const ACTOR = { userId: "u-1", ipAddress: "10.0.0.1", userAgent: "jest" };

// A-10: the signature covers `${timestamp}.${body}` (X-Webhook-Timestamp).
const hmac = (secret, body, timestamp) =>
  `v1=${crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;

// A persisted-looking row: `update` applies the patch to the instance, the way
// Sequelize's instance update does.
const row = (fields) => {
  const r = { id: "w1", tenantId: TENANT, url: "https://old.example.com/hook", events: ["*"], ...fields };
  r.update = jest.fn(async (patch) => Object.assign(r, patch));
  return r;
};

// Dispatch one delivery for `webhook` and return what went over the wire.
const deliverOnce = async (webhook) => {
  const delivery = { id: "d1", tenantId: TENANT, webhookId: webhook.id, event: "test", payload: {}, attempts: 0, update: jest.fn() };
  Webhook.findAll.mockResolvedValue([webhook]);
  Webhook.findOne.mockResolvedValue({ isActive: true, ...webhook });
  WebhookDelivery.create.mockResolvedValue(delivery);
  WebhookDelivery.findOne.mockResolvedValue(delivery);
  db.query.mockResolvedValueOnce([[{ id: "d1", tenantId: TENANT }]]); // the claim
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  await webhookService.emitEvent(TENANT, "test", {});
  for (let i = 0; i < 5 && !global.fetch.mock.calls.length; i++) {
    await new Promise((r) => setImmediate(r));
  }
  const [, init] = global.fetch.mock.calls[0];
  return {
    body: init.body,
    signature: init.headers["X-Webhook-Signature"],
    previous: init.headers["X-Webhook-Signature-Previous"],
    timestamp: init.headers["X-Webhook-Timestamp"],
  };
};

describe("A-51 — webhook secret handling", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    db.transaction.mockImplementation((cb) => cb(TX));
    Webhook.create.mockImplementation(async (values) => ({ id: "w1", createdAt: new Date(), ...values }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("ignores a caller-supplied secret and generates one server-side", async () => {
    const result = await webhookService.createWebhook(TENANT, {
      url: "https://receiver.example.com/hook",
      events: ["*"],
      secret: "a",
      createdBy: "u-1",
    });

    expect(result.secret).not.toBe("a");
    expect(result.secret).toMatch(/^[0-9a-f]{64}$/);
    const stored = Webhook.create.mock.calls[0][0].secret;
    expect(kms.decryptData(TENANT, stored)).toBe(result.secret);
  });

  it("stores the secret envelope-encrypted, never as the plaintext it returns", async () => {
    const result = await webhookService.createWebhook(TENANT, {
      url: "https://receiver.example.com/hook",
      events: ["*"],
      createdBy: "u-1",
    });

    const stored = Webhook.create.mock.calls[0][0].secret;
    expect(typeof stored).toBe("string");
    expect(stored.startsWith("v2:")).toBe(true); // P6-10: names its master key
    expect(stored).not.toContain(result.secret);
    // Bound to its tenant: the AAD is the tenant id, so another tenant's
    // context cannot unwrap it.
    expect(() => kms.decryptData("22222222-2222-4222-8222-222222222222", stored)).toThrow();
  });

  it("signs with the decrypted secret, so a receiver's check still verifies", async () => {
    const created = await webhookService.createWebhook(TENANT, {
      url: "https://receiver.example.com/hook",
      events: ["*"],
      createdBy: "u-1",
    });
    const stored = Webhook.create.mock.calls[0][0].secret;

    const { body, signature, timestamp } = await deliverOnce(row({ secret: stored }));

    expect(signature).toBe(hmac(created.secret, body, timestamp));
    // And specifically NOT with the ciphertext, which is what signing the
    // stored column verbatim would produce.
    expect(signature).not.toBe(hmac(stored, body, timestamp));
  });

  it("signs an encrypted row with its plaintext, not with the stored ciphertext", async () => {
    const plaintext = "c".repeat(64);
    const { body, signature, timestamp } = await deliverOnce(row({ secret: kms.encryptData(TENANT, plaintext) }));
    expect(signature).toBe(hmac(plaintext, body, timestamp));
  });

  it("still signs a legacy plaintext row (before migration 0022 has run)", async () => {
    const { body, signature, timestamp } = await deliverOnce(row({ secret: "legacy-plaintext-secret" }));
    expect(signature).toBe(hmac("legacy-plaintext-secret", body, timestamp));
  });

  it("rotation with overlapHours 0 issues a new secret once, invalidates the old one at once, and writes an audit row in the same transaction", async () => {
    const oldSecret = "0".repeat(64);
    const webhook = row({ secret: kms.encryptData(TENANT, oldSecret) });
    Webhook.findOne.mockResolvedValue(webhook);

    const result = await webhookService.rotateSecret(TENANT, "w1", ACTOR, { overlapHours: 0 });

    expect(result.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(result.secret).not.toBe(oldSecret);
    expect(result.previousSecretExpiresAt).toBeNull();
    expect(webhook.update).toHaveBeenCalledWith(
      { secret: expect.stringMatching(/^v2:/), previousSecret: null, previousSecretExpiresAt: null },
      { transaction: TX },
    );
    expect(AuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        userId: "u-1",
        action: "UPDATE",
        resourceType: "Webhook",
        resourceId: "w1",
        ipAddress: "10.0.0.1",
        userAgent: "jest",
      }),
      { transaction: TX },
    );
    // The audit row must never carry the secret, old or new.
    const audited = JSON.stringify(AuditLog.create.mock.calls[0][0]);
    expect(audited).not.toContain(result.secret);
    expect(audited).not.toContain(oldSecret);

    const { body, signature, previous, timestamp } = await deliverOnce(webhook);
    expect(signature).toBe(hmac(result.secret, body, timestamp));
    expect(signature).not.toBe(hmac(oldSecret, body, timestamp));
    expect(previous).toBeUndefined();
  });

  // P6-13: this used to pass with a row "attributed to nobody". audit_logs has
  // required a named actor since A-124 (migration 0033), and the service now
  // writes through audit.service#logAction, which refuses one — inside the
  // transaction, so the rotation rolls back rather than commit unattributed.
  it("P6-13: rotation without an actor is refused, and the refusal is thrown inside the transaction", async () => {
    Webhook.findOne.mockResolvedValue(row({ secret: kms.encryptData(TENANT, "1".repeat(64)) }));

    await expect(webhookService.rotateSecret(TENANT, "w1")).rejects.toThrow(/must name its actor/);
    expect(AuditLog.create).not.toHaveBeenCalled();
  });

  it("rotation of another tenant's webhook is a 404", async () => {
    Webhook.findOne.mockResolvedValue(null);
    await expect(webhookService.rotateSecret(TENANT, "w-other", ACTOR)).rejects.toMatchObject({
      status: 404,
    });
    expect(AuditLog.create).not.toHaveBeenCalled();
  });

  it("a url change does not keep the old secret: it rotates, returns the new one once, and audits", async () => {
    const oldSecret = "f".repeat(64);
    const webhook = row({ secret: kms.encryptData(TENANT, oldSecret) });
    Webhook.findOne.mockResolvedValue(webhook);

    const result = await webhookService.updateWebhook(
      TENANT,
      "w1",
      { url: "https://new.example.com/hook" },
      ACTOR,
    );

    expect(result.url).toBe("https://new.example.com/hook");
    expect(result.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(result.secret).not.toBe(oldSecret);
    expect(webhook.update).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://new.example.com/hook", secret: expect.stringMatching(/^v2:/) }),
      { transaction: TX },
    );
    expect(AuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "UPDATE", resourceType: "Webhook", resourceId: "w1" }),
      { transaction: TX },
    );

    const { body, signature, timestamp } = await deliverOnce(webhook);
    expect(signature).toBe(hmac(result.secret, body, timestamp));
    expect(signature).not.toBe(hmac(oldSecret, body, timestamp));
  });

  it("a patch that does not change the url keeps the secret and returns none", async () => {
    const stored = kms.encryptData(TENANT, "e".repeat(64));
    const webhook = row({ secret: stored });
    Webhook.findOne.mockResolvedValue(webhook);

    const result = await webhookService.updateWebhook(
      TENANT,
      "w1",
      { url: "https://old.example.com/hook", description: "same host" },
      ACTOR,
    );

    expect(result.secret).toBeUndefined();
    expect(webhook.secret).toBe(stored);
    expect(webhook.update.mock.calls[0][0]).not.toHaveProperty("secret");
  });

  it("an update never accepts a secret from the caller", async () => {
    const stored = kms.encryptData(TENANT, "e".repeat(64));
    const webhook = row({ secret: stored });
    Webhook.findOne.mockResolvedValue(webhook);

    await webhookService.updateWebhook(TENANT, "w1", { secret: "a", description: "x" }, ACTOR);

    expect(webhook.secret).toBe(stored);
  });
});

describe("P6-13 — rotation with an overlap window (ADR-085)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    db.transaction.mockImplementation((cb) => cb(TX));
    Webhook.create.mockImplementation(async (values) => ({ id: "w1", createdAt: new Date(), ...values }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("P6-13: by default the replaced secret keeps signing for 24 hours, under X-Webhook-Signature-Previous", async () => {
    const oldSecret = "0".repeat(64);
    const oldEnvelope = kms.encryptData(TENANT, oldSecret);
    const webhook = row({ secret: oldEnvelope });
    Webhook.findOne.mockResolvedValue(webhook);
    const before = Date.now();

    const result = await webhookService.rotateSecret(TENANT, "w1", ACTOR);

    // The previous secret is kept as the envelope it was stored as — never plaintext.
    expect(webhook.previousSecret).toBe(oldEnvelope);
    const ends = new Date(result.previousSecretExpiresAt).getTime();
    expect(ends).toBeGreaterThanOrEqual(before + 24 * 3600 * 1000);
    expect(ends).toBeLessThanOrEqual(Date.now() + 24 * 3600 * 1000);

    const { body, signature, previous, timestamp } = await deliverOnce(webhook);
    expect(signature).toBe(hmac(result.secret, body, timestamp));
    expect(previous).toBe(hmac(oldSecret, body, timestamp));
  });

  it("P6-13: after the window the previous signature is gone, and the response says so", async () => {
    const webhook = row({
      secret: kms.encryptData(TENANT, "a".repeat(64)),
      previousSecret: kms.encryptData(TENANT, "b".repeat(64)),
      previousSecretExpiresAt: new Date(Date.now() - 1000),
    });
    Webhook.findOne.mockResolvedValue(webhook);

    expect((await webhookService.getWebhook(TENANT, "w1")).previousSecretExpiresAt).toBeNull();
    const { previous } = await deliverOnce(webhook);
    expect(previous).toBeUndefined();
  });

  it("P6-13: rotating again inside a window replaces the previous secret — only one old key is ever live", async () => {
    const first = kms.encryptData(TENANT, "1".repeat(64));
    const second = kms.encryptData(TENANT, "2".repeat(64));
    const webhook = row({ secret: second, previousSecret: first, previousSecretExpiresAt: new Date(Date.now() + 3600e3) });
    Webhook.findOne.mockResolvedValue(webhook);

    await webhookService.rotateSecret(TENANT, "w1", ACTOR, { overlapHours: 6 });

    expect(webhook.previousSecret).toBe(second);
  });

  it("P6-13: a url change ends the overlap — the new host is never signed with a key the old host holds", async () => {
    const webhook = row({
      secret: kms.encryptData(TENANT, "a".repeat(64)),
      previousSecret: kms.encryptData(TENANT, "b".repeat(64)),
      previousSecretExpiresAt: new Date(Date.now() + 3600e3),
    });
    Webhook.findOne.mockResolvedValue(webhook);

    const result = await webhookService.updateWebhook(TENANT, "w1", { url: "https://new.example.com/hook" }, ACTOR);

    expect(webhook.previousSecret).toBeNull();
    expect(result.previousSecretExpiresAt).toBeNull();
    const { previous } = await deliverOnce(webhook);
    expect(previous).toBeUndefined();
  });

  it("P6-13: no secret — new, old or previous — reaches a response body, a log line or audit_logs.changes", async () => {
    const { logger } = require("../../middlewares/activityLog.middleware");
    const oldSecret = "9".repeat(64);
    const oldEnvelope = kms.encryptData(TENANT, oldSecret);
    const webhook = row({ secret: oldEnvelope });
    webhook.softDelete = jest.fn(async () => undefined);
    Webhook.findOne.mockResolvedValue(webhook);
    Webhook.findAndCountAll.mockResolvedValue({ count: 1, rows: [webhook] });

    const created = await webhookService.createWebhook(TENANT, { url: "https://r.example.com/h", events: ["*"], createdBy: "u-1" });
    const rotated = await webhookService.rotateSecret(TENANT, "w1", ACTOR);
    const patched = await webhookService.updateWebhook(TENANT, "w1", { description: "x" }, ACTOR);
    const listed = await webhookService.listWebhooks(TENANT);
    const one = await webhookService.getWebhook(TENANT, "w1");
    await webhookService.deleteWebhook(TENANT, "w1", ACTOR);

    const secrets = [created.secret, rotated.secret, oldSecret, oldEnvelope, webhook.secret];
    // Only the issuing calls return a secret, and only their own.
    for (const body of [patched, listed, one]) {
      const text = JSON.stringify(body);
      for (const s of secrets) {
        expect(text).not.toContain(s);
      }
      expect(text).not.toMatch(/"(secret|previousSecret)":/);
    }
    expect(JSON.stringify(rotated)).not.toContain(oldSecret);
    const sinks = JSON.stringify([
      AuditLog.create.mock.calls,
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.error.mock.calls,
    ]);
    for (const s of secrets) {
      expect(sinks).not.toContain(s);
    }
    // Every change above wrote its audit row inside its transaction.
    expect(AuditLog.create.mock.calls.map(([v]) => v.action)).toEqual(["CREATE", "UPDATE", "UPDATE", "DELETE"]);
    for (const [, options] of AuditLog.create.mock.calls) {
      expect(options).toEqual({ transaction: TX });
    }
    expect(webhook.softDelete).toHaveBeenCalledWith({ transaction: TX });
  });
});
