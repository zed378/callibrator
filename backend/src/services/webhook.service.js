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
const { Webhook, WebhookDelivery } = require("../models");
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
exports.createWebhook = async (tenantId, { url, events, description, isActive, secret, createdBy }) => {
  if (!url) {
    throw new AppError(400, "url is required");
  }
  // SSRF: reject internal/loopback/link-local/metadata targets at registration.
  assertSafeUrl(url);
  if (!Array.isArray(events) || events.length === 0) {
    throw new AppError(400, "events must be a non-empty array");
  }
  const webhook = await Webhook.create({
    tenantId,
    url,
    events,
    description: description || null,
    isActive: isActive !== undefined ? isActive : true,
    ...(secret ? { secret } : {}),
    createdBy: createdBy || null,
  });
  // Return the secret exactly once, at creation time.
  return { ...publicWebhook(webhook), secret: webhook.secret };
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

exports.updateWebhook = async (tenantId, id, data) => {
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
  await webhook.update(patch);
  return publicWebhook(webhook);
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
  const signature = sign(webhook.secret, body);

  // SSRF backstop: resolve the host and block internal addresses immediately
  // before dispatch (defends against a hostname that resolves internally, or
  // DNS records changed after registration).
  await assertResolvedHostIsPublic(webhook.url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(webhook.url, {
      method: "POST",
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
        lastError: `HTTP ${result.status}`,
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
