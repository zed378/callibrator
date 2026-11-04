/**
 * P21-15 — a user's personal e-signature: create, replace, revoke (ADR-140; spec
 * MEMORY/specs/P21-15-operator-esignature.md v2 § 2.1, § 4).
 *
 *  - `getMine` — the caller's active e-signature (specimen, fingerprint, version) or null, and every
 *    earlier version. Never a key's private half.
 *  - `createOrReplace` — the specimen checked against the allow-list (400 `ESIG_SPECIMEN_INVALID`);
 *    the credential re-entered (certificate.service#verifySignerCredentials, Part 11 § 11.200 (a));
 *    an RSA-3072 key pair generated here, its private half wrapped under the KMS ring
 *    (signingKeyWrap.service, as `tenant_keys`); in ONE transaction the active row becomes
 *    `superseded`, the new version is inserted and the audit row written. The platform operator,
 *    who has no tenant, cannot have one (403 `ESIG_PLATFORM`).
 *  - `revokeMine` / `revokeUser` — "do not use from now on": the past applications still verify. A
 *    tenant administrator may revoke another user's (a departed employee), never create or replace one.
 *  - `requireActive` / `signWith` — what the application service uses: the signer's active row, or the
 *    409 `ESIG_NONE`; the payload signed with the unwrapped private key (never logged).
 *
 * Named exports only (ADR-087 Am. 15).
 */
import { createHash, createPublicKey, generateKeyPair, sign as rsaSign } from "node:crypto";
import { promisify } from "node:util";
import { UniqueConstraintError, type Transaction } from "sequelize";
import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import certificateService from "./certificate.service";
import signingKeyWrap from "./signingKeyWrap.service";
import { tenantStorage } from "../middlewares/tenantContext.middleware";
import { AppError } from "../utils/appError.util";
import { CodedError } from "../utils/codedError.util";
import { auditEntryActor, type AuditActorInput } from "../utils/auditPrincipal.util";
import { ESIG_CODES, specimenProblem, type CreateMyEsignature, type RevokeMyEsignature, type RevokeUserEsignature } from "@callibrator/contracts/esignatures";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

type EsignatureRow = ModelInstance<"UserEsignature">;

const RESOURCE = "UserEsignature";
/** RSA-3072 (spec § 2.1): the personal key's size. */
export const PERSONAL_KEY_BITS = 3072;

/** Who acts: the person, the request's address and agent. */
export interface EsigActor extends AuditActorInput {
  readonly userId: string | null;
}

const generate = promisify(generateKeyPair);

/** The key pair generator — an object, so a test can replace it with a pre-generated pair. */
export const keyPairs = {
  /** A new RSA-3072 pair, PEM (SPKI public, PKCS#8 private). */
  generate: async (): Promise<{ publicKeyPem: string; privateKeyPem: string }> => {
    const { publicKey, privateKey } = await generate("rsa", {
      modulusLength: PERSONAL_KEY_BITS,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    return { publicKeyPem: publicKey, privateKeyPem: privateKey };
  },
};

/** SHA-256 of a public key's SPKI DER, lower-case hex — what the verification shows. */
export const fingerprintOf = (publicKeyPem: string): string =>
  createHash("sha256").update(createPublicKey(publicKeyPem).export({ type: "spki", format: "der" })).digest("hex");

const iso = (at: Date | null | undefined): string | null => (at ? new Date(at).toISOString() : null);

/** An e-signature as its owner sees it: never the private key. */
export const esignatureView = (row: EsignatureRow): Record<string, unknown> => ({
  id: row.id,
  version: row.version,
  status: row.status,
  specimenSvg: row.specimenSvg,
  keyFingerprint: row.keyFingerprint,
  createdAt: iso(row.createdAt),
  supersededAt: iso(row.supersededAt),
  revokedAt: iso(row.revokedAt),
});

const personOf = (actor: EsigActor): string => {
  if (!actor.userId) {
    throw new AppError(403, "An e-signature belongs to a person, not to an API key.");
  }
  return actor.userId;
};

const noneError = (): CodedError => new CodedError(409, ESIG_CODES.none, "Create your e-signature first, in Profile → E-signature.");

/**
 * `GET /esignature/me`.
 *
 * @param userId - the caller
 * @returns the active e-signature or null, and the earlier versions, newest first
 */
export const getMine = async (userId: string): Promise<Record<string, unknown>> => {
  const rows = await models.UserEsignature.findAll({ where: { userId }, order: [["version", "DESC"]] });
  const active = rows.find((r) => r.status === "active") ?? null;
  return { active: active ? esignatureView(active) : null, history: rows.filter((r) => r !== active).map(esignatureView) };
};

/**
 * `POST /esignature/me` — create the caller's e-signature, or replace the active one (201).
 *
 * @param tenantId - the caller's tenant (none for the platform operator: 403 `ESIG_PLATFORM`)
 * @param input - the specimen and the re-entered credential
 * @param actor - the person, the request's address and agent
 * @returns the new version (no private key)
 */
export const createOrReplace = async (tenantId: TenantId | null | undefined, input: CreateMyEsignature, actor: EsigActor): Promise<Record<string, unknown>> => {
  const userId = personOf(actor);
  if (!tenantId || tenantStorage.getStore()?.isSuperAdmin === true) {
    throw new CodedError(403, ESIG_CODES.platform, "The platform operator has no tenant, so it cannot hold an e-signature.");
  }
  const problem = specimenProblem(input.specimenSvg);
  if (problem) {
    throw new CodedError(400, ESIG_CODES.specimen, `The signature image is not accepted: ${problem}.`);
  }
  await certificateService.verifySignerCredentials(userId as UserId, input.authMethod, input.credential, {
    tenantId,
    resourceType: RESOURCE,
    resourceId: userId,
    operation: "ESIGNATURE_CREATE",
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
  });
  const { publicKeyPem, privateKeyPem } = await keyPairs.generate();
  const privateKeyEnc = signingKeyWrap.wrapPrivateKey(tenantId, privateKeyPem);
  if (!privateKeyEnc) {
    throw new AppError(500, "The e-signature key could not be protected (KMS).");
  }
  const keyFingerprint = fingerprintOf(publicKeyPem);
  try {
    const row = await db.transaction(async (transaction) => {
      const existing = await models.UserEsignature.findAll({ where: { userId }, attributes: ["id", "version", "status"], transaction, lock: transaction.LOCK.UPDATE });
      const active = existing.find((r) => r.status === "active");
      const now = new Date();
      if (active) {
        await models.UserEsignature.update({ status: "superseded", supersededAt: now }, { where: { id: active.id }, transaction });
      }
      const created = await models.UserEsignature.create(
        {
          tenantId,
          userId: userId as UserId,
          version: Math.max(0, ...existing.map((r) => r.version)) + 1,
          specimenSvg: input.specimenSvg,
          publicKeyPem,
          privateKeyEnc,
          keyFingerprint,
          status: "active",
        },
        { transaction },
      );
      await auditService.logAction(
        {
          tenantId,
          ...auditEntryActor(actor),
          action: active ? "UPDATE" : "CREATE",
          resourceType: RESOURCE,
          resourceId: created.id,
          changes: { operation: active ? "ESIGNATURE_REPLACED" : "ESIGNATURE_CREATED", version: created.version, keyFingerprint, supersededId: active?.id ?? null, authMethod: input.authMethod },
        },
        { transaction },
      );
      return created;
    });
    return esignatureView(row);
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new AppError(409, "Your e-signature was changed by another request at the same time; reload and try again.");
    }
    throw err;
  }
};

/** Revoke an active row, with its audit row, in one transaction. */
const revokeActive = async (tenantId: TenantId, userId: string, reason: string, actor: EsigActor, operation: string): Promise<Record<string, unknown>> =>
  db.transaction(async (transaction) => {
    const active = await models.UserEsignature.findOne({ where: { userId, status: "active" }, transaction, lock: transaction.LOCK.UPDATE });
    if (!active) {
      throw noneError();
    }
    const revokedAt = new Date();
    await models.UserEsignature.update({ status: "revoked", revokedAt, revokedReason: reason }, { where: { id: active.id }, transaction });
    await auditService.logAction(
      {
        tenantId,
        ...auditEntryActor(actor),
        action: "UPDATE",
        resourceType: RESOURCE,
        resourceId: active.id,
        changes: { operation, ownerId: userId, version: active.version, reason },
      },
      { transaction },
    );
    return esignatureView(Object.assign(active, { status: "revoked", revokedAt, revokedReason: reason }));
  });

/**
 * `POST /esignature/me/revoke` — the caller revokes its own active e-signature (re-authenticated).
 *
 * @param tenantId - the caller's tenant
 * @param input - the credential and the reason
 * @param actor - the person
 * @returns the revoked version
 */
export const revokeMine = async (tenantId: TenantId, input: RevokeMyEsignature, actor: EsigActor): Promise<Record<string, unknown>> => {
  const userId = personOf(actor);
  await certificateService.verifySignerCredentials(userId as UserId, input.authMethod, input.credential, {
    tenantId,
    resourceType: RESOURCE,
    resourceId: userId,
    operation: "ESIGNATURE_REVOKE",
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
  });
  return revokeActive(tenantId, userId, input.reason, actor, "ESIGNATURE_REVOKED");
};

/**
 * `POST /esignature/users/:userId/revoke` — a tenant administrator revokes another user's active
 * e-signature. The user is read in the caller's context: another tenant's is the 404 a missing id gets.
 *
 * @param tenantId - the caller's tenant
 * @param input - the user and the reason
 * @param actor - the administrator
 * @returns the revoked version
 */
export const revokeUser = async (tenantId: TenantId, input: RevokeUserEsignature, actor: EsigActor): Promise<Record<string, unknown>> => {
  personOf(actor);
  const user = await models.User.unscoped().findOne({ where: { id: input.userId }, attributes: ["id"] });
  if (!user) {
    throw new AppError(404, "User not found");
  }
  return revokeActive(tenantId, user.id, input.reason, actor, "ESIGNATURE_REVOKED_BY_ADMIN");
};

/**
 * The signer's ACTIVE e-signature, locked for the application's transaction, or the 409 `ESIG_NONE`.
 *
 * @param userId - the signer
 * @param transaction - the application's transaction
 * @returns the active row (with its private envelope)
 */
export const requireActive = async (userId: string, transaction: Transaction): Promise<EsignatureRow> => {
  const active = await models.UserEsignature.findOne({ where: { userId, status: "active" }, transaction, lock: transaction.LOCK.SHARE });
  if (!active) {
    throw noneError();
  }
  return active;
};

/**
 * Sign a payload with an e-signature's private key (unwrapped from its KMS envelope; never logged).
 *
 * @param row - the e-signature
 * @param payload - the canonical payload text
 * @returns the base64 RSA-SHA256 signature
 */
export const signWith = (row: EsignatureRow, payload: string): string => {
  let privateKeyPem: string;
  try {
    privateKeyPem = signingKeyWrap.unwrapPrivateKey(row.tenantId, row.privateKeyEnc);
  } catch {
    throw new AppError(500, "The e-signature key could not be unlocked (KMS). Existing signatures still verify.");
  }
  return rsaSign("sha256", Buffer.from(payload, "utf8"), privateKeyPem).toString("base64");
};
