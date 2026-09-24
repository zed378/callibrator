/**
 * IoT device provisioning (A-29, A-46).
 *
 * Until this module, nothing could provision a device for ingest: no service
 * set the token, no validator accepted it, and `readingTolerance` — the only
 * input to anomaly detection — was unsettable too. `POST /api/v1/iot/ingest`
 * answered 401 for every device, and the anomaly path could never run.
 *
 * The ingest token is 32 random bytes, shown ONCE in the response that issues
 * it and stored only as its SHA-256 hash (`iotTokenHash`, migration 0044) —
 * the API-key pattern (apiKey.service.js). Rotation issues a new token over
 * the old one; revocation clears it and disables ingest.
 *
 * Every mutation writes its audit row inside the same transaction (A-41). The
 * audit row never carries the token or its hash: `audit_logs` is permanent.
 *
 * Every lookup carries the caller's tenant id, and a device in another tenant
 * answers 404 exactly as a missing or deleted one does (CLAUDE.md).
 */
const crypto = require("crypto");
const { CalibrationDevice } = require("../models");
const auditService = require("./audit.service");
const { db } = require("../config");

/** Distinguishes an ingest token from an API key or a JWT at a glance. */
const TOKEN_PREFIX = "iot_";

/**
 * The hex SHA-256 of a token — what `iotTokenHash` stores and ingest looks up.
 * Migration 0044 computes the same value in SQL for pre-existing tokens.
 * @param {string} raw - the plaintext token
 * @returns {string} 64 hex characters
 */
const hashIotToken = (raw) => crypto.createHash("sha256").update(raw).digest("hex");

/** @returns {string} a fresh token: the prefix and 32 random bytes, base64url */
const generateIotToken = () => TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");

const NOT_FOUND = { success: false, status: 404, message: "Calibration device not found", data: null };

/** The attributes this module reads. The hash is read only to say whether one exists. */
const ATTRIBUTES = ["id", "tenantId", "name", "iotEnabled", "readingTolerance", "iotTokenHash", "iotTokenIssuedAt"];

/**
 * The device in the caller's tenant, or null. `.unscoped()` because the
 * defaultScope excludes `iotTokenHash`; the soft-delete predicate it also
 * drops is carried explicitly, and the global tenant hooks still apply.
 * @param {string} tenantId - the caller's tenant
 * @param {string} deviceId - the device
 * @param {object} [transaction] - to lock the row inside a mutation
 * @returns {Promise<object|null>} the device
 */
const findDevice = (tenantId, deviceId, transaction) =>
  CalibrationDevice.unscoped().findOne({
    where: { id: deviceId, tenantId, isDeleted: false },
    attributes: ATTRIBUTES,
    ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}),
  });

/**
 * The provisioning state a client may see — never the token, never its hash.
 * @param {object} device - the device row
 * @returns {object} the view
 */
const iotView = (device) => ({
  deviceId: device.id,
  name: device.name,
  iotEnabled: device.iotEnabled,
  readingTolerance: device.readingTolerance ?? null,
  hasToken: Boolean(device.iotTokenHash),
  tokenIssuedAt: device.iotTokenIssuedAt ?? null,
});

/**
 * @param {object} transaction - the mutation's transaction
 * @param {string} tenantId - the tenant
 * @param {string} deviceId - the device
 * @param {object} changes - what changed; never a token or a hash
 * @param {{userId?: string|null, ipAddress?: string|null, userAgent?: string|null}} actor - who
 * @returns {Promise<object>} the audit row
 */
const audit = (transaction, tenantId, deviceId, changes, actor) =>
  auditService.logAction(
    {
      tenantId,
      userId: actor.userId || null,
      action: "UPDATE",
      resourceType: "CalibrationDevice",
      resourceId: deviceId,
      changes,
      ipAddress: actor.ipAddress || null,
      userAgent: actor.userAgent || null,
    },
    { transaction },
  );

/**
 * Run `work(device, transaction)` on the locked device in one transaction.
 * @param {string} tenantId - the caller's tenant
 * @param {string} deviceId - the device
 * @param {Function} work - returns the result to send
 * @returns {Promise<object>} the result, or the 404
 */
const mutate = (tenantId, deviceId, work) =>
  db.transaction(async (transaction) => {
    const device = await findDevice(tenantId, deviceId, transaction);
    return device ? work(device, transaction) : NOT_FOUND;
  });

/**
 * GET — a device's IoT provisioning state.
 * @param {string} tenantId - the caller's tenant
 * @param {string} deviceId - the device
 * @returns {Promise<object>} the result
 */
exports.getIotConfig = async (tenantId, deviceId) => {
  const device = await findDevice(tenantId, deviceId);
  if (!device) {
    return NOT_FOUND;
  }
  return { success: true, status: 200, message: "IoT configuration", data: iotView(device) };
};

/**
 * PATCH — enable/disable ingest and set the reading tolerance (A-46).
 *
 * Enabling a device that has no token is a 409: the MQTT path authenticates by
 * topic alone (docs/DEVELOPER/07-IOT-INGEST.md), so an enabled device with no
 * token is open on MQTT while closed on HTTP — a state nobody means.
 *
 * @param {string} tenantId - the caller's tenant
 * @param {string} deviceId - the device
 * @param {{iotEnabled?: boolean, readingTolerance?: object|null}} input - validated
 * @param {object} actor - auditActor(req)
 * @returns {Promise<object>} the result
 */
exports.updateIotConfig = (tenantId, deviceId, input, actor = {}) =>
  mutate(tenantId, deviceId, async (device, transaction) => {
    if (input.iotEnabled === true && !device.iotTokenHash) {
      return {
        success: false,
        status: 409,
        message:
          "This device has no IoT ingest token, so ingest cannot be enabled. " +
          "Issue a token first — issuing one also enables ingest.",
        data: null,
      };
    }
    const before = Object.fromEntries(Object.keys(input).map((key) => [key, device[key] ?? null]));
    await device.update(input, { transaction });
    await audit(transaction, tenantId, device.id, { iot: "CONFIG_UPDATED", before, after: input }, actor);
    return { success: true, status: 200, message: "IoT configuration updated", data: iotView(device) };
  });

/**
 * POST — issue a token, or rotate it: the old one stops working at once.
 * Issuing enables ingest. The plaintext is in THIS response only.
 *
 * @param {string} tenantId - the caller's tenant
 * @param {string} deviceId - the device
 * @param {object} actor - auditActor(req)
 * @returns {Promise<object>} the result, with `data.token`
 */
exports.issueToken = (tenantId, deviceId, actor = {}) =>
  mutate(tenantId, deviceId, async (device, transaction) => {
    const rotated = Boolean(device.iotTokenHash);
    const wasEnabled = device.iotEnabled;
    const token = generateIotToken();
    await device.update(
      { iotTokenHash: hashIotToken(token), iotTokenIssuedAt: new Date(), iotEnabled: true },
      { transaction },
    );
    await audit(
      transaction,
      tenantId,
      device.id,
      {
        iot: rotated ? "TOKEN_ROTATED" : "TOKEN_ISSUED",
        before: { iotEnabled: wasEnabled },
        after: { iotEnabled: true },
      },
      actor,
    );
    return {
      success: true,
      status: 201,
      message: rotated
        ? "IoT ingest token rotated. The previous token no longer works. Copy this one now — it is not shown again."
        : "IoT ingest token issued. Copy it now — it is not shown again.",
      data: { ...iotView(device), token, rotated },
    };
  });

/**
 * DELETE — revoke the token and disable ingest.
 * @param {string} tenantId - the caller's tenant
 * @param {string} deviceId - the device
 * @param {object} actor - auditActor(req)
 * @returns {Promise<object>} the result
 */
exports.revokeToken = (tenantId, deviceId, actor = {}) =>
  mutate(tenantId, deviceId, async (device, transaction) => {
    if (!device.iotTokenHash) {
      return {
        success: false,
        status: 409,
        message: "This device has no IoT ingest token to revoke.",
        data: null,
      };
    }
    const wasEnabled = device.iotEnabled;
    await device.update({ iotTokenHash: null, iotTokenIssuedAt: null, iotEnabled: false }, { transaction });
    await audit(
      transaction,
      tenantId,
      device.id,
      { iot: "TOKEN_REVOKED", before: { iotEnabled: wasEnabled }, after: { iotEnabled: false } },
      actor,
    );
    return { success: true, status: 200, message: "IoT ingest token revoked; ingest is disabled", data: iotView(device) };
  });

exports.hashIotToken = hashIotToken;
exports.TOKEN_PREFIX = TOKEN_PREFIX;
