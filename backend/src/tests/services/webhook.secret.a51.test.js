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
    findByPk: jest.fn(),
    findAndCountAll: jest.fn(),
  },
  AuditLog: { create: jest.fn() },
}));

const TX = { id: "tx-1" };
jest.mock("../../config", () => ({
  db: { transaction: jest.fn((cb) => cb(TX)) },
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

const hmac = (secret, body) =>
  `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;

// A persisted-looking row: `update` applies the patch to the instance, the way
// Sequelize's instance update does.
const row = (fields) => {
  const r = { id: "w1", tenantId: TENANT, url: "https://old.example.com/hook", events: ["*"], ...fields };
  r.update = jest.fn(async (patch) => Object.assign(r, patch));
  return r;
};

// Dispatch one delivery for `webhook` and return what went over the wire.
const deliverOnce = async (webhook) => {
  Webhook.findAll.mockResolvedValue([webhook]);
  WebhookDelivery.create.mockResolvedValue({ id: "d1", event: "test", payload: {}, update: jest.fn() });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  await webhookService.emitEvent(TENANT, "test", {});
  await new Promise((r) => setImmediate(r));
  const [, init] = global.fetch.mock.calls[0];
  return { body: init.body, signature: init.headers["X-Webhook-Signature"] };
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
    });

    const stored = Webhook.create.mock.calls[0][0].secret;
    expect(typeof stored).toBe("string");
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain(result.secret);
    // Bound to its tenant: the AAD is the tenant id, so another tenant's
    // context cannot unwrap it.
    expect(() => kms.decryptData("22222222-2222-4222-8222-222222222222", stored)).toThrow();
  });

  it("signs with the decrypted secret, so a receiver's check still verifies", async () => {
    const created = await webhookService.createWebhook(TENANT, {
      url: "https://receiver.example.com/hook",
      events: ["*"],
    });
    const stored = Webhook.create.mock.calls[0][0].secret;

    const { body, signature } = await deliverOnce(row({ secret: stored }));

    expect(signature).toBe(hmac(created.secret, body));
    // And specifically NOT with the ciphertext, which is what signing the
    // stored column verbatim would produce.
    expect(signature).not.toBe(hmac(stored, body));
  });

  it("signs an encrypted row with its plaintext, not with the stored ciphertext", async () => {
    const plaintext = "c".repeat(64);
    const { body, signature } = await deliverOnce(row({ secret: kms.encryptData(TENANT, plaintext) }));
    expect(signature).toBe(hmac(plaintext, body));
  });

  it("still signs a legacy plaintext row (before migration 0022 has run)", async () => {
    const { body, signature } = await deliverOnce(row({ secret: "legacy-plaintext-secret" }));
    expect(signature).toBe(hmac("legacy-plaintext-secret", body));
  });

  it("rotation issues a new secret once, invalidates the old one, and writes an audit row in the same transaction", async () => {
    const oldSecret = "0".repeat(64);
    const webhook = row({ secret: kms.encryptData(TENANT, oldSecret) });
    Webhook.findOne.mockResolvedValue(webhook);

    const result = await webhookService.rotateSecret(TENANT, "w1", ACTOR);

    expect(result.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(result.secret).not.toBe(oldSecret);
    expect(webhook.update).toHaveBeenCalledWith(
      { secret: expect.stringMatching(/^v1:/) },
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

    const { body, signature } = await deliverOnce(webhook);
    expect(signature).toBe(hmac(result.secret, body));
    expect(signature).not.toBe(hmac(oldSecret, body));
  });

  it("rotation without an actor still writes an audit row, attributed to nobody", async () => {
    Webhook.findOne.mockResolvedValue(row({ secret: kms.encryptData(TENANT, "1".repeat(64)) }));

    await webhookService.rotateSecret(TENANT, "w1");

    expect(AuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, ipAddress: null, userAgent: null }),
      { transaction: TX },
    );
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
      expect.objectContaining({ url: "https://new.example.com/hook", secret: expect.stringMatching(/^v1:/) }),
      { transaction: TX },
    );
    expect(AuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "UPDATE", resourceType: "Webhook", resourceId: "w1" }),
      { transaction: TX },
    );

    const { body, signature } = await deliverOnce(webhook);
    expect(signature).toBe(hmac(result.secret, body));
    expect(signature).not.toBe(hmac(oldSecret, body));
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
