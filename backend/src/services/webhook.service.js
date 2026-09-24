/* global fetch, AbortController */
// src/services/webhook.service.js
//
// Outbound webhooks. Tenants register subscriptions (url + subscribed events);
// domain code calls emitAfterCommit(transaction, tenantId, event, payload) (or
// emitEvent directly when there is no transaction) and every matching active
// webhook receives an HMAC-signed POST.
//
// DURABLE DELIVERY (A-10, ADR-054). `webhook_deliveries` is the outbox: one
// row per webhook per event, carrying the attempt count, `next_attempt_at`
// and the outcome. Nothing about a pending retry lives only in memory:
//
//   emit      -> row (pending, next_attempt_at = now) + an immediate attempt
//   attempt   -> claim the row (UPDATE ... FOR UPDATE SKIP LOCKED, pushing
//                next_attempt_at forward by a LEASE), POST, record the result
//   failure   -> failed, next_attempt_at = now + backoff(attempt)
//   attempt N -> exhausted (the dead letter), next_attempt_at = NULL
//   restart   -> the dispatcher (middlewares/webhookDeliveryScheduler) claims
//                every due row; a row whose sender died mid-attempt comes due
//                again when its lease expires. Delivery is at-least-once, and
//                receivers deduplicate on X-Webhook-Delivery.
//
// SKIP LOCKED makes two replicas claim disjoint rows, and the lease keeps a
// claimed row invisible to every other claimer while its POST is in flight.

const crypto = require("crypto");
const { Op, fn } = require("sequelize");
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

const { WEBHOOK_TEST_EVENT } = require("../constants/webhookEvents");

const MAX_ATTEMPTS = Number(process.env.WEBHOOK_MAX_ATTEMPTS) || 12;
const TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS) || 8000;
// Backoff after attempt n is min(BASE × 2^(n-1), CAP): at the defaults 1, 2,
// 4, 8, 16, 32, 64, 128, 256, 360, 360 minutes — 11 waits, ~20.5 h from the
// first attempt to the dead letter.
const BACKOFF_BASE_MS = Number(process.env.WEBHOOK_BACKOFF_BASE_MS) || 60 * 1000;
const BACKOFF_CAP_MS = Number(process.env.WEBHOOK_BACKOFF_CAP_MS) || 6 * 60 * 60 * 1000;
// How long a claimed row stays invisible to other claimers. Must comfortably
// exceed TIMEOUT_MS (plus DNS + the result write): a lease that expires while
// the POST is still in flight lets a second replica send it again.
const LEASE_MS = Number(process.env.WEBHOOK_LEASE_MS) || 5 * 60 * 1000;
const BATCH_SIZE = Number(process.env.WEBHOOK_DISPATCH_BATCH) || 50;

/** @param {number} attempt - 1-based number of the attempt that just failed */
const backoffMs = (attempt) => Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_CAP_MS);

/**
 * The signature receivers verify (docs/WEBHOOK/03-WEBHOOK-SECURITY.md):
 * hex HMAC-SHA256 over `${timestamp}.${body}` — the timestamp is signed, so a
 * captured delivery cannot be replayed with a fresh one.
 *
 * @param {string} secret
 * @param {string|number} timestamp - unix seconds, as sent in X-Webhook-Timestamp
 * @param {string} body - the exact bytes sent
 * @returns {string}
 */
const sign = (secret, timestamp, body) =>
  crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

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

// One POST. The body is identical on every attempt (the delivery id is the
// receiver's deduplication key); the timestamp — and so the signature — is
// fresh on every attempt, so a receiver can refuse a stale one.
const attemptDelivery = async (webhook, delivery) => {
  const bodyObj = {
    id: delivery.id,
    event: delivery.event,
    createdAt: delivery.createdAt,
    data: delivery.payload,
  };
  const body = JSON.stringify(bodyObj);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign(secretForSigning(webhook), timestamp, body);

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
        "X-Webhook-Timestamp": String(timestamp),
        "X-Webhook-Signature": `v1=${signature}`,
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

/**
 * Claim due deliveries: rows with status pending|failed whose next_attempt_at
 * has passed. The claim pushes next_attempt_at forward by LEASE_MS, so no
 * other claimer — another replica, or this process's next tick — sees the row
 * again until the attempt has recorded its result or the lease has expired
 * (the sender died mid-attempt; the row is simply due again).
 *
 * `FOR UPDATE SKIP LOCKED`: two replicas claiming at the same instant lock
 * disjoint rows instead of one waiting for, and then re-claiming, the other's.
 *
 * RAW SQL — the tenant hooks do not apply. With `id`, the claim carries
 * `tenant_id = :tenantId` explicitly (the request-path first attempt). Without
 * it, the claim is deliberately cross-tenant: it is the system dispatcher,
 * which runs outside any request (like the calibration scan) and serves every
 * tenant's queue. Each claimed row returns its own tenant_id, and every read
 * after the claim is scoped by it — see deliverClaimed.
 *
 * @param {{id?: string|null, tenantId?: string|null, limit?: number}} [opts]
 * @returns {Promise<Array<{id: string, tenantId: string}>>}
 */
const claim = async ({ id = null, tenantId = null, limit = BATCH_SIZE } = {}) => {
  const one = id !== null;
  const [rows] = await db.query(
    `UPDATE webhook_deliveries
        SET next_attempt_at = now() + make_interval(secs => :leaseSeconds),
            updated_at = now()
      WHERE id IN (
        SELECT id FROM webhook_deliveries
         WHERE status IN ('pending', 'failed')
           AND next_attempt_at <= now()${one ? "\n           AND id = :id AND tenant_id = :tenantId" : ""}
         ORDER BY next_attempt_at
         LIMIT :limit
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, tenant_id AS "tenantId"`,
    { replacements: { leaseSeconds: LEASE_MS / 1000, id, tenantId, limit: one ? 1 : limit } },
  );
  return rows;
};

/**
 * Make one attempt on a row this process has claimed, and record the outcome:
 * success; failed with the next attempt scheduled; or exhausted — the dead
 * letter — after MAX_ATTEMPTS (a `webhook.test` delivery gets one attempt: its
 * caller is waiting for the answer, not for a retry tomorrow).
 *
 * A webhook deleted since the event, or deactivated, dead-letters the row
 * rather than posting to an endpoint its owner has switched off. A test
 * delivery to an inactive webhook is still sent — testing a receiver before
 * activating it is the point of the button.
 *
 * @param {{id: string, tenantId: string}} claimed
 * @returns {Promise<Object|null>} the delivery row, or null if it has gone
 */
const deliverClaimed = async ({ id, tenantId }) => {
  const delivery = await WebhookDelivery.findOne({ where: { id, tenantId } });
  if (!delivery) {
    return null;
  }
  const isTest = delivery.event === WEBHOOK_TEST_EVENT;
  const webhook = await Webhook.findOne({ where: { id: delivery.webhookId, tenantId } });
  if (!webhook || (!webhook.isActive && !isTest)) {
    await delivery.update({
      status: "exhausted",
      nextAttemptAt: null,
      lastError: webhook ? "webhook deactivated" : "webhook deleted",
    });
    return delivery;
  }

  const attempt = delivery.attempts + 1;
  let result;
  try {
    result = await attemptDelivery(webhook, delivery);
  } catch (err) {
    result = { ok: false, status: null, error: err.name === "AbortError" ? "timeout" : err.message };
  }

  if (result.ok) {
    await delivery.update({
      status: "success",
      attempts: attempt,
      responseStatus: result.status,
      deliveredAt: new Date(),
      lastError: null,
      nextAttemptAt: null,
    });
    return delivery;
  }

  const exhausted = attempt >= (isTest ? 1 : MAX_ATTEMPTS);
  await delivery.update({
    status: exhausted ? "exhausted" : "failed",
    attempts: attempt,
    responseStatus: result.status,
    lastError: result.error || `HTTP ${result.status}`,
    nextAttemptAt: exhausted ? null : new Date(Date.now() + backoffMs(attempt)),
  });
  if (exhausted) {
    logger.warn(`Webhook delivery exhausted after ${attempt} attempt(s): ${delivery.id}`);
  }
  return delivery;
};

/**
 * Attempt one specific delivery now, if it is due and nobody else holds it.
 * @returns {Promise<Object|null>} the delivery row, or null if not claimed
 */
const dispatchDelivery = async (id, tenantId) => {
  const [claimed] = await claim({ id, tenantId });
  return claimed ? deliverClaimed(claimed) : null;
};

/**
 * The dispatcher's tick: claim up to `limit` due deliveries across every
 * tenant and attempt them concurrently. One delivery's failure never stops
 * another's. Called by middlewares/webhookDeliveryScheduler.middleware.js —
 * at boot (which is what makes a restart resume) and on its schedule.
 *
 * @param {{limit?: number}} [opts]
 * @returns {Promise<{claimed: number, errors: number}>}
 */
exports.dispatchDue = async ({ limit = BATCH_SIZE } = {}) => {
  const claimed = await claim({ limit });
  const results = await Promise.allSettled(claimed.map(deliverClaimed));
  const rejected = results.filter((r) => r.status === "rejected");
  rejected.forEach((r) => logger.error(`Webhook dispatch error: ${r.reason.message}`));
  return { claimed: claimed.length, errors: rejected.length };
};

// ------------------------------------------------------------------
// EMIT EVENT — fan a domain event out to subscribed webhooks
// ------------------------------------------------------------------
// Best-effort towards its caller: it never throws. Each matching webhook gets
// a durable row first; the first attempt then runs off the caller's path. If
// that attempt never happens (the process dies), the row is already due and
// the dispatcher sends it.
const emitEvent = async (tenantId, event, payload = {}) => {
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
    const deliveries = [];
    for (const webhook of webhooks) {
      deliveries.push(
        await WebhookDelivery.create({
          tenantId,
          webhookId: webhook.id,
          event,
          payload,
          status: "pending",
          // The database's clock, not this process's: the claim compares
          // against now(), and a skewed app clock must not delay the first try.
          nextAttemptAt: fn("now"),
        }),
      );
    }
    for (const delivery of deliveries) {
      dispatchDelivery(delivery.id, tenantId).catch((e) =>
        logger.error(`Webhook delivery error: ${e.message}`),
      );
    }
    return { matched: webhooks.length };
  } catch (err) {
    logger.error(`emitEvent failed for "${event}": ${err.message}`);
    return { matched: 0, error: err.message };
  }
};
exports.emitEvent = emitEvent;

/**
 * Announce a domain event once — and only if — `transaction` commits (A-11).
 *
 * Call it inside the transaction, next to the audit row; the emit itself runs
 * from `transaction.afterCommit`, so a rolled-back action never fires a
 * webhook. With no transaction (an autocommitted write that has already
 * happened) it emits now. It never throws and never delays the caller.
 *
 * @param {Object|null} transaction - a Sequelize transaction, or null
 * @param {string} tenantId - the tenant the changed record belongs to
 * @param {string} event - a name from constants/webhookEvents.js
 * @param {Object} payload - identifiers and statuses only; this leaves the tenant
 */
exports.emitAfterCommit = (transaction, tenantId, event, payload) => {
  if (!transaction) {
    emitEvent(tenantId, event, payload);
    return;
  }
  if (typeof transaction.afterCommit !== "function") {
    // Not a Sequelize transaction — only a unit-test double reaches here, as
    // every real Transaction (managed or unmanaged) has afterCommit. There is
    // no commit to wait for, and emitting now could announce a change that is
    // then rolled back, so nothing is emitted. Deliberately silent: the
    // doubles in other suites mock the logger partially, and this must never
    // throw into the mutation that called it.
    return;
  }
  transaction.afterCommit(() => emitEvent(tenantId, event, payload));
};

// Send a synthetic test event to a single webhook: one attempt, synchronously,
// and its result. It bypasses subscription matching.
exports.testWebhook = async (tenantId, id) => {
  const webhook = await loadOwned(tenantId, id);
  const delivery = await WebhookDelivery.create({
    tenantId,
    webhookId: webhook.id,
    event: WEBHOOK_TEST_EVENT,
    payload: { message: "This is a test webhook delivery", at: new Date().toISOString() },
    status: "pending",
    nextAttemptAt: fn("now"),
  });
  await dispatchDelivery(delivery.id, tenantId).catch((e) =>
    logger.error(`Webhook test delivery error: ${e.message}`),
  );
  const fresh = await WebhookDelivery.findOne({ where: { id: delivery.id, tenantId } });
  return {
    deliveryId: fresh.id,
    status: fresh.status,
    responseStatus: fresh.responseStatus,
    attempts: fresh.attempts,
    lastError: fresh.lastError,
  };
};

// Exported for tests.
exports._sign = sign;
exports._backoffMs = backoffMs;
exports._claim = claim;
exports._dispatchDelivery = dispatchDelivery;
exports._config = Object.freeze({ MAX_ATTEMPTS, BACKOFF_BASE_MS, BACKOFF_CAP_MS, LEASE_MS, BATCH_SIZE });
