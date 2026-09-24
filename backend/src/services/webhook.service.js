/* global fetch, AbortController */
// src/services/webhook.service.js
//
// Outbound webhooks. Tenants register subscriptions (url + subscribed events);
// domain code calls emitEvent(tenantId, event, payload) and every matching
// active webhook receives an HMAC-signed POST. Each attempt is recorded in
// webhook_deliveries with retries + exponential backoff.
//
// Delivery is in-process (async, DB-tracked). For a multi-instance deployment
// this dispatch would move behind a durable queue (RabbitMQ) with a dedicated
// worker + DLQ — deferred, as one process is sufficient for the single-binary
// deploy and the delivery log already provides an audit trail + retry state.

const crypto = require("crypto");
const { Op } = require("sequelize");
// `db` from config, NOT from the models barrel (CLAUDE.md, traps).
const { db } = require("../config");
const { Webhook, WebhookDelivery, AuditLog } = require("../models");
const { encryptData, decryptData } = require("./kms.service");
const { AppError } = require("../utils/appError.util");
const { DEFAULT_LIMIT, MAX_LIMIT } = require("../constants");
const { logger } = require("../middlewares/activityLog.middleware");
const {
  assertSafeUrl,
  assertResolvedHostIsPublic,
} = require("../utils/ssrf.util");

const MAX_ATTEMPTS = Number(process.env.WEBHOOK_MAX_ATTEMPTS) || 5;
const TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS) || 8000;

const sign = (secret, body) =>
  crypto.createHmac("sha256", secret).update(body).digest("hex");

// ------------------------------------------------------------------
// THE SIGNING SECRET (A-51)
// ------------------------------------------------------------------
// Generated here and nowhere else — never accepted from a caller. 32 random
// bytes as 64 lowercase hex characters; the HMAC key is that hex STRING's
// UTF-8 bytes, exactly as before (docs/WEBHOOK/03-WEBHOOK-SECURITY.md).
const generateSecret = () => crypto.randomBytes(32).toString("hex");

// At rest the column holds a kms.service envelope (`v1:...`), with the tenant
// id as additional authenticated data — the same treatment as the tenant
// secrets in tenantSettings.model.js. The plaintext exists only in the
// response that issues it and, transiently, in the signing call below.
const sealSecret = (tenantId, plaintext) => encryptData(tenantId, plaintext);

// decryptData returns a value that is not a `v1:` envelope unchanged, so a row
// written before migration 0022 still signs with its plaintext secret.
const secretForSigning = (webhook) => decryptData(webhook.tenantId, webhook.secret);

// The audit row for a secret change. It records THAT the secret changed and
// why, never the secret itself — old or new.
const auditSecretRotation = (webhook, actor, reason, extra, transaction) =>
  AuditLog.create(
    {
      tenantId: webhook.tenantId,
      userId: actor.userId || null,
      action: "UPDATE",
      resourceType: "Webhook",
      resourceId: webhook.id,
      changes: { secretRotated: true, reason, ...extra },
      ipAddress: actor.ipAddress || null,
      userAgent: actor.userAgent || null,
    },
    { transaction },
  );

const publicWebhook = (w) => ({
  id: w.id,
  tenantId: w.tenantId,
  url: w.url,
  events: w.events,
  description: w.description,
  isActive: w.isActive,
  createdBy: w.createdBy,
  createdAt: w.createdAt,
  // secret is returned only on creation (see createWebhook)
});

// ------------------------------------------------------------------
// CRUD
// ------------------------------------------------------------------
// A-51: there is no `secret` parameter. Until 2026-09-24 one was honoured, and
// the controller spread the request body into it — `{"secret":"a"}` created a
// webhook whose signatures anyone could forge.
exports.createWebhook = async (tenantId, { url, events, description, isActive, createdBy }) => {
  if (!url) {
    throw new AppError(400, "url is required");
  }
  // SSRF: reject internal/loopback/link-local/metadata targets at registration.
  assertSafeUrl(url);
  if (!Array.isArray(events) || events.length === 0) {
    throw new AppError(400, "events must be a non-empty array");
  }
  const secret = generateSecret();
  const webhook = await Webhook.create({
    tenantId,
    url,
    events,
    description: description || null,
    isActive: isActive !== undefined ? isActive : true,
    secret: sealSecret(tenantId, secret),
    createdBy: createdBy || null,
  });
  // Return the plaintext secret exactly once, at creation time.
  return { ...publicWebhook(webhook), secret };
};

exports.listWebhooks = async (tenantId, { page = 1, limit = DEFAULT_LIMIT } = {}) => {
  const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const { count, rows } = await Webhook.findAndCountAll({
    where: { tenantId },
    limit: safeLimit,
    offset: (Number(page) - 1) * safeLimit,
    order: [["createdAt", "DESC"]],
  });
  return {
    rows: rows.map(publicWebhook),
    meta: {
      total: count,
      page: Number(page),
      limit: safeLimit,
      totalPages: Math.ceil(count / safeLimit),
    },
  };
};

const loadOwned = async (tenantId, id) => {
  const webhook = await Webhook.findOne({ where: { id, tenantId } });
  if (!webhook) {
    throw new AppError(404, "Webhook not found");
  }
  return webhook;
};

exports.getWebhook = async (tenantId, id) => publicWebhook(await loadOwned(tenantId, id));

// A url change ROTATES the secret, in the same transaction, and the new secret
// is returned once in this response. Keeping it would sign the new host with a
// key the old host already holds; refusing the change unless a rotation came
// with it would add a second step that can be forgotten, for no benefit — the
// new receiver has to be configured with a secret either way.
exports.updateWebhook = async (tenantId, id, data, actor = {}) => {
  const webhook = await loadOwned(tenantId, id);
  const patch = {};
  for (const k of ["url", "events", "description", "isActive"]) {
    if (data[k] !== undefined) {
      patch[k] = data[k];
    }
  }
  // SSRF: re-validate the target if the URL is being changed.
  if (patch.url !== undefined) {
    assertSafeUrl(patch.url);
  }
  if (patch.events && (!Array.isArray(patch.events) || patch.events.length === 0)) {
    throw new AppError(400, "events must be a non-empty array");
  }
  const urlChanged = patch.url !== undefined && patch.url !== webhook.url;
  if (!urlChanged) {
    await webhook.update(patch);
    return publicWebhook(webhook);
  }

  const previousUrl = webhook.url;
  const secret = generateSecret();
  await db.transaction(async (transaction) => {
    await webhook.update({ ...patch, secret: sealSecret(tenantId, secret) }, { transaction });
    await auditSecretRotation(
      webhook,
      actor,
      "url_changed",
      { before: { url: previousUrl }, after: { url: patch.url } },
      transaction,
    );
  });
  return { ...publicWebhook(webhook), secret };
};

// Issue a new secret, invalidating the old one immediately. There is no
// overlap window: a delivery signed after this call carries the new secret,
// so the receiver must be updated before the next event (or it rejects it and
// the delivery retries — see 04-WEBHOOK-RETRY.md).
exports.rotateSecret = async (tenantId, id, actor = {}) => {
  const webhook = await loadOwned(tenantId, id);
  const secret = generateSecret();
  await db.transaction(async (transaction) => {
    await webhook.update({ secret: sealSecret(tenantId, secret) }, { transaction });
    await auditSecretRotation(webhook, actor, "rotated", {}, transaction);
  });
  return { ...publicWebhook(webhook), secret };
};

exports.deleteWebhook = async (tenantId, id) => {
  const webhook = await loadOwned(tenantId, id);
  await webhook.softDelete();
  return { id };
};

exports.listDeliveries = async (tenantId, id, { page = 1, limit = DEFAULT_LIMIT } = {}) => {
  await loadOwned(tenantId, id); // ensures the webhook belongs to the tenant
  const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const { count, rows } = await WebhookDelivery.findAndCountAll({
    where: { tenantId, webhookId: id },
    limit: safeLimit,
    offset: (Number(page) - 1) * safeLimit,
    order: [["createdAt", "DESC"]],
  });
  return {
    rows,
    meta: {
      total: count,
      page: Number(page),
      limit: safeLimit,
      totalPages: Math.ceil(count / safeLimit),
    },
  };
};

// ------------------------------------------------------------------
// DELIVERY
// ------------------------------------------------------------------
const attemptDelivery = async (webhook, delivery) => {
  const bodyObj = {
    id: delivery.id,
    event: delivery.event,
    createdAt: delivery.createdAt,
    data: delivery.payload,
  };
  const body = JSON.stringify(bodyObj);
  const signature = sign(secretForSigning(webhook), body);

  // SSRF backstop: resolve the host and block internal addresses immediately
  // before dispatch (defends against a hostname that resolves internally, or
  // DNS records changed after registration).
  await assertResolvedHostIsPublic(webhook.url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(webhook.url, {
      method: "POST",
      // `redirect: "manual"` is the point of this call, not a detail. Node's
      // fetch follows redirects by default, and assertResolvedHostIsPublic
      // above validates only the REGISTERED url — so a host that passes both
      // SSRF layers could answer `302 Location: http://169.254.169.254/...`
      // and this process would fetch it from inside the deployment. A 3xx is
      // treated as a delivery failure below; a receiver that wants to move
      // must be re-registered at its new url.
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Event": delivery.event,
        "X-Webhook-Id": webhook.id,
        "X-Webhook-Delivery": delivery.id,
        "X-Webhook-Signature": `sha256=${signature}`,
      },
      body,
      signal: controller.signal,
    });
    if (res.status >= 300 && res.status < 400) {
      return {
        ok: false,
        status: res.status,
        error: `Redirect (${res.status}) not followed: re-register the webhook at its new url`,
      };
    }
    return { ok: res.ok, status: res.status };
  } finally {
    clearTimeout(timer);
  }
};

// Deliver with retries + exponential backoff. Runs in the background; each
// attempt updates the delivery row.
const deliverWithRetry = async (webhook, delivery) => {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await attemptDelivery(webhook, delivery);
      if (result.ok) {
        await delivery.update({
          status: "success",
          attempts: attempt,
          responseStatus: result.status,
          deliveredAt: new Date(),
          lastError: null,
        });
        return;
      }
      await delivery.update({
        status: attempt >= MAX_ATTEMPTS ? "exhausted" : "failed",
        attempts: attempt,
        responseStatus: result.status,
        lastError: result.error || `HTTP ${result.status}`,
      });
    } catch (err) {
      await delivery.update({
        status: attempt >= MAX_ATTEMPTS ? "exhausted" : "failed",
        attempts: attempt,
        lastError: err.name === "AbortError" ? "timeout" : err.message,
      });
    }
    if (attempt < MAX_ATTEMPTS) {
      const backoff = Math.min(2 ** attempt * 500, 30000);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  logger.warn(`Webhook delivery exhausted: ${delivery.id} -> ${webhook.url}`);
};

// ------------------------------------------------------------------
// EMIT EVENT — fan a domain event out to subscribed webhooks
// ------------------------------------------------------------------
exports.emitEvent = async (tenantId, event, payload = {}) => {
  try {
    const webhooks = await Webhook.findAll({
      where: {
        tenantId,
        isActive: true,
        [Op.or]: [{ events: { [Op.contains]: [event] } }, { events: { [Op.contains]: ["*"] } }],
      },
    });
    if (!webhooks.length) {
      return { matched: 0 };
    }
    for (const webhook of webhooks) {
      const delivery = await WebhookDelivery.create({
        tenantId,
        webhookId: webhook.id,
        event,
        payload,
        status: "pending",
      });
      // Fire-and-forget; never block the caller on delivery.
      deliverWithRetry(webhook, delivery).catch((e) =>
        logger.error(`Webhook delivery error: ${e.message}`),
      );
    }
    return { matched: webhooks.length };
  } catch (err) {
    logger.error(`emitEvent failed for "${event}": ${err.message}`);
    return { matched: 0, error: err.message };
  }
};

// Send a synthetic test event to a single webhook.
exports.testWebhook = async (tenantId, id) => {
  const webhook = await loadOwned(tenantId, id);
  const delivery = await WebhookDelivery.create({
    tenantId,
    webhookId: webhook.id,
    event: "webhook.test",
    payload: { message: "This is a test webhook delivery", at: new Date().toISOString() },
    status: "pending",
  });
  await deliverWithRetry(webhook, delivery).catch(() => {});
  const fresh = await WebhookDelivery.findByPk(delivery.id);
  return {
    deliveryId: fresh.id,
    status: fresh.status,
    responseStatus: fresh.responseStatus,
    attempts: fresh.attempts,
    lastError: fresh.lastError,
  };
};

exports._sign = sign; // exported for tests
