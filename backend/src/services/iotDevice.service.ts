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
 *
 * P9-14 (ADR-087, Stage C leaves): converted from iotDevice.service.js with no
 * behaviour change. `export =` keeps the exact object `require()` returned (the
 * same keys, in the same order). `crypto` and `auditService` are the module
 * objects, read at call time (so a spy on `crypto.randomBytes` still applies);
 * `CalibrationDevice` and `db` are captured once at load, as before.
 */
import crypto from "crypto";
import type { Transaction } from "sequelize";
import models from "../models";
import auditService from "./audit.service";
import { db as loadedDb } from "../config";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const { CalibrationDevice } = models;
const db = loadedDb;

type DeviceRow = ModelInstance<"CalibrationDevice">;

/** What a caller may change (validated upstream). */
type IotConfigInput = Partial<Pick<DeviceRow, "iotEnabled" | "readingTolerance">>;

/** Who acted, for the audit row (auditActor(req)). */
interface IotActor {
  userId?: UserId | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** The provisioning state a client may see. */
interface IotView {
  deviceId: string;
  name: DeviceRow["name"];
  iotEnabled: DeviceRow["iotEnabled"];
  readingTolerance: DeviceRow["readingTolerance"] | null;
  hasToken: boolean;
  tokenIssuedAt: DeviceRow["iotTokenIssuedAt"] | null;
}

/** The service's answer (the controller sends it through success() or error()). */
interface IotResult<T = unknown> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

/** Distinguishes an ingest token from an API key or a JWT at a glance. */
const TOKEN_PREFIX = "iot_";

/**
 * The hex SHA-256 of a token — what `iotTokenHash` stores and ingest looks up.
 * Migration 0044 computes the same value in SQL for pre-existing tokens.
 * @param raw - the plaintext token
 * @returns 64 hex characters
 */
const hashIotToken = (raw: string): string => crypto.createHash("sha256").update(raw).digest("hex");

/** @returns a fresh token: the prefix and 32 random bytes, base64url */
const generateIotToken = (): string => TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");

const NOT_FOUND: IotResult<null> = { success: false, status: 404, message: "Calibration device not found", data: null };

/** The attributes this module reads. The hash is read only to say whether one exists. */
const ATTRIBUTES = ["id", "tenantId", "name", "iotEnabled", "readingTolerance", "iotTokenHash", "iotTokenIssuedAt"];

/**
 * The device in the caller's tenant, or null. `.unscoped()` because the
 * defaultScope excludes `iotTokenHash`; the soft-delete predicate it also
 * drops is carried explicitly, and the global tenant hooks still apply.
 * @param tenantId - the caller's tenant
 * @param deviceId - the device
 * @param transaction - to lock the row inside a mutation
 * @returns the device
 */
const findDevice = (tenantId: TenantId, deviceId: string, transaction?: Transaction): Promise<DeviceRow | null> =>
  CalibrationDevice.unscoped().findOne({
    where: { id: deviceId, tenantId, isDeleted: false },
    attributes: ATTRIBUTES as (keyof DeviceRow)[],
    ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}),
  });

/**
 * The provisioning state a client may see — never the token, never its hash.
 * @param device - the device row
 * @returns the view
 */
const iotView = (device: DeviceRow): IotView => ({
  deviceId: device.id,
  name: device.name,
  iotEnabled: device.iotEnabled,
  readingTolerance: device.readingTolerance ?? null,
  hasToken: Boolean(device.iotTokenHash),
  tokenIssuedAt: device.iotTokenIssuedAt ?? null,
});

/**
 * @param transaction - the mutation's transaction
 * @param tenantId - the tenant
 * @param deviceId - the device
 * @param changes - what changed; never a token or a hash
 * @param actor - who
 * @returns the audit row
 */
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: an empty value also records null */
const audit = (
  transaction: Transaction,
  tenantId: TenantId,
  deviceId: string,
  changes: Record<string, unknown>,
  actor: IotActor,
): Promise<unknown> =>
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
/* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

/**
 * Run `work(device, transaction)` on the locked device in one transaction.
 * @param tenantId - the caller's tenant
 * @param deviceId - the device
 * @param work - returns the result to send
 * @returns the result, or the 404
 */
const mutate = (
  tenantId: TenantId,
  deviceId: string,
  work: (device: DeviceRow, transaction: Transaction) => Promise<IotResult>,
): Promise<IotResult> =>
  db.transaction(async (transaction: Transaction): Promise<IotResult> => {
    const device = await findDevice(tenantId, deviceId, transaction);
    return device ? work(device, transaction) : NOT_FOUND;
  });

/**
 * GET — a device's IoT provisioning state.
 * @param tenantId - the caller's tenant
 * @param deviceId - the device
 * @returns the result
 */
const getIotConfig = async (tenantId: TenantId, deviceId: string): Promise<IotResult<IotView | null>> => {
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
 * @param tenantId - the caller's tenant
 * @param deviceId - the device
 * @param input - validated
 * @param actor - auditActor(req)
 * @returns the result
 */
const updateIotConfig = (tenantId: TenantId, deviceId: string, input: IotConfigInput, actor: IotActor = {}): Promise<IotResult> =>
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
    // As built: every key the caller sent is read back from the row (null when absent).
    const before = Object.fromEntries(
      Object.keys(input).map((key) => [key, (device as unknown as Record<string, unknown>)[key] ?? null]),
    );
    await device.update(input, { transaction });
    await audit(transaction, tenantId, device.id, { iot: "CONFIG_UPDATED", before, after: input }, actor);
    return { success: true, status: 200, message: "IoT configuration updated", data: iotView(device) };
  });

/**
 * POST — issue a token, or rotate it: the old one stops working at once.
 * Issuing enables ingest. The plaintext is in THIS response only.
 *
 * @param tenantId - the caller's tenant
 * @param deviceId - the device
 * @param actor - auditActor(req)
 * @returns the result, with `data.token`
 */
const issueToken = (tenantId: TenantId, deviceId: string, actor: IotActor = {}): Promise<IotResult> =>
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
 * @param tenantId - the caller's tenant
 * @param deviceId - the device
 * @param actor - auditActor(req)
 * @returns the result
 */
const revokeToken = (tenantId: TenantId, deviceId: string, actor: IotActor = {}): Promise<IotResult> =>
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

export = { getIotConfig, updateIotConfig, issueToken, revokeToken, hashIotToken, TOKEN_PREFIX };
