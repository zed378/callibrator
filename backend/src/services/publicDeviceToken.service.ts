/**
 * A device's public link, for provider staff (P21-08; ADR-138 § 1, Am. 1 § 1, § 6, § 7; spec
 * MEMORY/specs/P19-07-public-device-page.md § 4 – § 6).
 *
 *  - `getLinkState` — whether the device has an active link, when and by whom it was issued, when
 *    the last one was revoked, and the tenant's page setting. Never the token or its hash.
 *  - `issueLink` / `rotateLink` / `revokeLink` — each in ONE transaction that locks the device row,
 *    writes the link row and ONE audit row. Issue refuses an active link (409 `PUBLIC_TOKEN_ACTIVE`);
 *    rotate and revoke refuse when there is none (409 `PUBLIC_TOKEN_NONE`). The token is minted here
 *    (16 CSPRNG bytes, base64url), returned once, and only its SHA-256 is stored.
 *  - `revokeLinkOfDeletedDevice` — called by the device's delete, in ITS transaction (`device_deleted`).
 *
 * Callers are unbound (the routes are not facility-accessible). The device is read in the caller's
 * context: another tenant's, or a deleted one, is the 404 (never a 403). Named exports only.
 */
import { createHash, randomBytes } from "node:crypto";
import { Op, type Transaction } from "sequelize";
import models from "../models";
import { db } from "../config";
import { env } from "../config/env";
import auditService from "./audit.service";
import { displayPeople } from "./personDisplay.service";
import { AppError } from "../utils/appError.util";
import { CodedError } from "../utils/codedError.util";
import { actorChanges, auditEntryActor, type AuditActorInput } from "../utils/auditPrincipal.util";
import {
  PUBLIC_DEVICE_CODES,
  PUBLIC_DEVICE_PAGE_SETTING_KEY,
  parsePublicDevicePageMode,
  type PublicDeviceTokenIssued,
  type PublicDeviceTokenRevokedReason,
  type PublicDeviceTokenState,
} from "@callibrator/contracts/publicDevices";
import type { PersonDisplay } from "@callibrator/contracts/people";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

type DeviceRow = ModelInstance<"CalibrationDevice">;
type LinkRow = ModelInstance<"PublicDeviceToken">;

const RESOURCE = "CalibrationDevice";
export const DEVICE_NOT_FOUND = "Calibration device not found";

/** A new token: 16 CSPRNG bytes, base64url (22 characters). */
export const newPublicDeviceToken = (): string => randomBytes(16).toString("base64url");

/** SHA-256 of a token, lower-case hex — what is stored and looked up. */
export const hashPublicDeviceToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

/** The first 8 hex characters of a token's hash — the only form a log or an audit row carries. */
export const tokenHashPrefix = (tokenHash: string): string => tokenHash.slice(0, 8);

/** The printed link of a token: from configuration only, never from the request (ADR-100). */
export const publicDeviceUrl = (token: string): string => {
  const explicit = env("PUBLIC_DEVICE_BASE_URL");
  const base = explicit ?? `${(env("FRONTEND_URL") ?? "http://localhost:3000").replace(/\/$/, "")}/d`;
  return `${base.replace(/\/$/, "")}/${token}`;
};

/** The tenant's page setting, read fail-closed (an unknown value is `off`). */
export const pageModeOf = async (tenantId: string): Promise<PublicDeviceTokenState["setting"]> => {
  const row = await models.TenantSettings.findOne({
    where: { tenantId, key: PUBLIC_DEVICE_PAGE_SETTING_KEY },
    attributes: ["key", "value"],
  });
  return parsePublicDevicePageMode(row?.value ?? null);
};

/** The device in the caller's context, locked; absent, another tenant's or deleted → 404. */
const lockDevice = async (deviceId: string, transaction: Transaction): Promise<DeviceRow> => {
  const device = await models.CalibrationDevice.findOne({ where: { id: deviceId }, transaction, lock: transaction.LOCK.UPDATE });
  if (!device) {
    throw new AppError(404, DEVICE_NOT_FOUND);
  }
  return device;
};

/** The device's active link; locked inside a mutation, except in the delete (its UPDATE of the device row already holds that row's lock, which every link mutation takes first). */
const activeLinkOf = (deviceId: string, transaction?: Transaction, lock = true): Promise<LinkRow | null> =>
  models.PublicDeviceToken.findOne({
    where: { deviceId, revokedAt: null },
    ...(transaction ? { transaction, ...(lock ? { lock: transaction.LOCK.UPDATE } : {}) } : {}),
  });

/** One audit row of a link act, in the transaction: the hash prefix, never the token. */
const auditLink = async (
  transaction: Transaction,
  tenantId: TenantId,
  device: DeviceRow,
  operation: string,
  link: { issued?: LinkRow; revoked?: LinkRow },
  actor: AuditActorInput,
): Promise<void> => {
  await auditService.logAction(
    {
      tenantId,
      ...auditEntryActor(actor),
      action: link.issued ? "CREATE" : "UPDATE",
      resourceType: RESOURCE,
      resourceId: device.id,
      clientFacilityId: device.clientFacilityId,
      changes: {
        operation,
        ...(link.issued ? { issued: { linkId: link.issued.id, hashPrefix: tokenHashPrefix(link.issued.tokenHash) } } : {}),
        ...(link.revoked
          ? { revoked: { linkId: link.revoked.id, hashPrefix: tokenHashPrefix(link.revoked.tokenHash), reason: link.revoked.revokedReason } }
          : {}),
        ...actorChanges(actor),
      },
    },
    { transaction },
  );
};

const revokeRow = async (link: LinkRow, reason: PublicDeviceTokenRevokedReason, userId: string | null, transaction: Transaction): Promise<void> => {
  link.revokedAt = new Date();
  link.revokedBy = userId as UserId | null;
  link.revokedReason = reason;
  await link.save({ transaction });
};

/** A new link row and its one-time answer. A racing second insert is the 409 (the partial UNIQUE). */
const insertLink = async (tenantId: TenantId, device: DeviceRow, userId: string, transaction: Transaction): Promise<{ row: LinkRow; token: string }> => {
  const token = newPublicDeviceToken();
  try {
    const row = await models.PublicDeviceToken.create(
      { tenantId, deviceId: device.id, tokenHash: hashPublicDeviceToken(token), createdBy: userId as UserId },
      { transaction },
    );
    return { row, token };
  } catch (err) {
    if (err instanceof Error && err.name === "SequelizeUniqueConstraintError") {
      throw activeConflict();
    }
    throw err;
  }
};

const activeConflict = (): CodedError =>
  new CodedError(
    409,
    PUBLIC_DEVICE_CODES.tokenActive,
    "This device already has a public link. Rotate it to print a new sticker; the printed one will stop working.",
  );

const noneConflict = (): CodedError =>
  new CodedError(409, PUBLIC_DEVICE_CODES.tokenNone, "This device has no active public link. Issue one first.");

/** The answer of an issue or a rotation — the only time the token is shown. */
const issuedAnswer = (row: LinkRow, token: string): PublicDeviceTokenIssued => ({
  token,
  url: publicDeviceUrl(token),
  issuedAt: row.createdAt.toISOString(),
});

/** The acting user; a link is always minted by a person (the routes refuse API keys). */
const userOf = (actor: AuditActorInput): string => {
  if (!actor.userId) {
    throw new AppError(403, "A public link is issued by a signed-in person.");
  }
  return actor.userId;
};

/**
 * GET /calibration-devices/:id/public-token.
 *
 * @param deviceId - the device
 * @returns the link's state
 * @throws AppError 404 when the device is out of view
 */
export const getLinkState = async (deviceId: string): Promise<PublicDeviceTokenState> => {
  const device = await models.CalibrationDevice.findOne({ where: { id: deviceId }, attributes: ["id", "tenantId"] });
  if (!device) {
    throw new AppError(404, DEVICE_NOT_FOUND);
  }
  const active = await activeLinkOf(device.id);
  const lastRevoked = await models.PublicDeviceToken.findOne({
    where: { deviceId: device.id, revokedAt: { [Op.ne]: null } },
    attributes: ["id", "revokedAt"],
    order: [
      ["revokedAt", "DESC"],
      ["id", "DESC"],
    ],
  });
  const people = active ? await displayPeople([active.createdBy]) : new Map<string, PersonDisplay>();
  return {
    active: active !== null,
    issuedAt: active ? active.createdAt.toISOString() : null,
    issuedBy: active ? (people.get(active.createdBy) ?? null) : null,
    lastRevokedAt: lastRevoked?.revokedAt ? lastRevoked.revokedAt.toISOString() : null,
    setting: await pageModeOf(device.tenantId),
  };
};

/**
 * POST /calibration-devices/:id/public-token — issue.
 *
 * @param tenantId - the caller's tenant
 * @param deviceId - the device
 * @param actor - the audit principal
 * @returns the token (shown once), its URL and the time
 */
export const issueLink = async (tenantId: TenantId, deviceId: string, actor: AuditActorInput): Promise<PublicDeviceTokenIssued> => {
  const userId = userOf(actor);
  return db.transaction(async (transaction) => {
    const device = await lockDevice(deviceId, transaction);
    if (await activeLinkOf(device.id, transaction)) {
      throw activeConflict();
    }
    const { row, token } = await insertLink(tenantId, device, userId, transaction);
    await auditLink(transaction, tenantId, device, "ISSUE_PUBLIC_DEVICE_LINK", { issued: row }, actor);
    return issuedAnswer(row, token);
  });
};

/**
 * POST /calibration-devices/:id/public-token/rotate — revoke the active link (`rotated`) and issue
 * a new one, in one transaction.
 *
 * @param tenantId - the caller's tenant
 * @param deviceId - the device
 * @param actor - the audit principal
 * @returns the new token (shown once), its URL and the time
 */
export const rotateLink = async (tenantId: TenantId, deviceId: string, actor: AuditActorInput): Promise<PublicDeviceTokenIssued> => {
  const userId = userOf(actor);
  return db.transaction(async (transaction) => {
    const device = await lockDevice(deviceId, transaction);
    const active = await activeLinkOf(device.id, transaction);
    if (!active) {
      throw noneConflict();
    }
    await revokeRow(active, "rotated", userId, transaction);
    const { row, token } = await insertLink(tenantId, device, userId, transaction);
    await auditLink(transaction, tenantId, device, "ROTATE_PUBLIC_DEVICE_LINK", { issued: row, revoked: active }, actor);
    return issuedAnswer(row, token);
  });
};

/**
 * DELETE /calibration-devices/:id/public-token — revoke (`revoked`).
 *
 * @param tenantId - the caller's tenant
 * @param deviceId - the device
 * @param actor - the audit principal
 * @returns when it was revoked
 */
export const revokeLink = async (tenantId: TenantId, deviceId: string, actor: AuditActorInput): Promise<{ revokedAt: string }> => {
  const userId = userOf(actor);
  return db.transaction(async (transaction) => {
    const device = await lockDevice(deviceId, transaction);
    const active = await activeLinkOf(device.id, transaction);
    if (!active) {
      throw noneConflict();
    }
    await revokeRow(active, "revoked", userId, transaction);
    await auditLink(transaction, tenantId, device, "REVOKE_PUBLIC_DEVICE_LINK", { revoked: active }, actor);
    return { revokedAt: (active.revokedAt as Date).toISOString() };
  });
};

/**
 * The device's delete revokes its active link in the delete's transaction (Am. 1 § 7), with its
 * own audit row. Reinstating the device does not re-issue one.
 *
 * @param tenantId - the device's tenant
 * @param device - the device being deleted
 * @param actor - the delete's principal
 * @param transaction - the delete's transaction
 * @returns whether a link was revoked
 */
export const revokeLinkOfDeletedDevice = async (
  tenantId: TenantId,
  device: DeviceRow,
  actor: AuditActorInput,
  transaction: Transaction,
): Promise<boolean> => {
  const active = await activeLinkOf(device.id, transaction, false);
  if (!active) {
    return false;
  }
  await revokeRow(active, "device_deleted", actor.userId ?? null, transaction);
  await auditLink(transaction, tenantId, device, "REVOKE_PUBLIC_DEVICE_LINK", { revoked: active }, actor);
  return true;
};
