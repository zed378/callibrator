/**
 * P21-15 — applying a personal e-signature to a document, and verifying an application publicly
 * (ADR-140; spec MEMORY/specs/P21-15-operator-esignature.md v2 § 2.2 – § 4).
 *
 *  - `applyToRecord` — `POST /calibration-records/:calibrationRecordId/esignatures`. In ONE transaction:
 *    the record IN CONTEXT, FOR SHARE (another tenant's or a missing one: the same 404); its state —
 *    `CALREC_VOIDED`, `CALREC_SUPERSEDED` (+ `headId`), `CALREC_EXTERNAL` (409s); who may give the
 *    meaning — `performed` the performer only (403 `ESIG_NOT_PERFORMER`), `reviewed` anyone else;
 *    once per (record, signer, meaning) (409 `ESIG_ALREADY_APPLIED`); the signer's ACTIVE e-signature
 *    (409 `ESIG_NONE`); the credential re-entered; the canonical data hashed (`calrec-data-v1`); the
 *    application signed with the personal key; the application, its audit row and its
 *    `e_signature_records` row (Part 11). After the commit, `esignature:applied` to the record's rooms.
 *  - `signDocument` — `POST /esignature/documents`: any file by its SHA-256, computed in the browser;
 *    the file is never uploaded or stored.
 *  - `listForRecord` / `myApplications` — the staff reads, each application with its link, its
 *    specimen and the content recomputed now (`intact` | `changed`; null for a document).
 *  - `verifyPublic` — by id plus a constant-time comparison of the 192-bit token, under the reviewed
 *    `skipTenantScope`; every later read runs in the row's own tenant (runForTenant). A malformed,
 *    unknown or mismatched link is ONE identical 404.
 *
 * Never returned: the signer's user id outside the canonical content, an e-mail, the address or
 * agent, the token (except inside the link). Named exports only.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual, verify as rsaVerify } from "node:crypto";
import { UniqueConstraintError, type Transaction } from "sequelize";
import models from "../models";
import { db } from "../config";
import { env } from "../config/env";
import auditService from "./audit.service";
import certificateService from "./certificate.service";
import { displayPeople } from "./personDisplay.service";
import { emitForRow } from "./realtime";
import { requireActive, signWith } from "./userEsignature.service";
import { AppError } from "../utils/appError.util";
import { CodedError } from "../utils/codedError.util";
import { auditEntryActor, type AuditActorInput } from "../utils/auditPrincipal.util";
import { logger } from "../middlewares/activityLog.middleware";
import { runForTenant } from "../utils/jobContext.util";
import {
  CALREC_DATA_SCHEME,
  ESIG_CODES,
  ESIG_VERIFY_TOKEN,
  FILE_SHA256_SCHEME,
  calibrationRecordDataPairs,
  canonicalCalibrationRecordData,
  esignatureSignedPayload,
  type ApplyRecordEsignature,
  type EsigContentScheme,
  type EsigDocumentState,
  type EsigDocumentType,
  type EsigIntegrityState,
  type EsigMeaning,
  type EsigVerdict,
  type MyApplicationsQuery,
  type PublicEsignatureVerdict,
  type SignDocument,
} from "@callibrator/contracts/esignatures";
import type { PersonDisplay } from "@callibrator/contracts/people";
import type { EsignatureApplicationId, TenantId, UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

type RecordRow = ModelInstance<"CalibrationRecord">;
type ApplicationRow = ModelInstance<"EsignatureApplication">;
type EsignatureRow = ModelInstance<"UserEsignature">;

export const RECORD_NOT_FOUND = "Calibration record not found";
/** The one answer of the public verification for anything that is not a verdict. */
export const ESIG_VERIFY_NOT_FOUND = "No e-signature matches this link.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who signs: the person and the request's address and agent (stored on the row, never returned). */
export interface EsigSigner extends AuditActorInput {
  readonly userId: string | null;
}

const day = (at: Date | null | undefined): string => (at ? new Date(at).toISOString().slice(0, 10) : "an unknown date");
const dayText = (at: Date | null | undefined): string | null => (at ? new Date(at).toISOString().slice(0, 10) : null);
const sha256Hex = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** A record's content hash now (`calrec-data-v1`). */
export const recordContentHash = (record: RecordRow): string => sha256Hex(canonicalCalibrationRecordData(record));

/** A new verification token: 24 CSPRNG bytes, base64url (32 characters; ADR-100). */
export const newApplicationToken = (): string => randomBytes(24).toString("base64url");

/** The public verification link: from configuration only, never from the request (ADR-100). */
export const esigVerifyUrl = (applicationId: string, token: string): string => {
  const app = env("PUBLIC_APP_URL");
  if (app) {
    return `${app.replace(/\/$/, "")}/s/${applicationId}?t=${encodeURIComponent(token)}`;
  }
  const base = (env("PUBLIC_BASE_URL") ?? "http://localhost:5000").replace(/\/$/, "");
  return `${base}/api/v1/public/esignatures/${applicationId}?token=${encodeURIComponent(token)}`;
};

const signerOf = (row: ApplicationRow): Record<string, unknown> => ({
  name: row.signerSnapshot.name,
  role: row.signerSnapshot.role ?? null,
  organisation: row.signerSnapshot.organisation ?? null,
});

/**
 * An application as the staff routes answer it (§ 4): never the signer's id, address, agent or token
 * (except inside its own link).
 */
export const applicationView = (row: ApplicationRow, esig: EsignatureRow | null | undefined, integrity: EsigIntegrityState | null): Record<string, unknown> => ({
  id: row.id,
  documentType: row.documentType,
  documentId: row.documentId,
  documentTitle: row.documentTitle,
  meaning: row.meaning,
  signer: signerOf(row),
  specimenSvg: esig?.specimenSvg ?? "",
  keyFingerprint: esig?.keyFingerprint ?? "",
  contentScheme: row.contentScheme,
  contentHash: row.contentHash,
  authMethod: row.authMethod,
  signedAt: new Date(row.signedAt).toISOString(),
  verifyUrl: esigVerifyUrl(row.id, row.verificationToken),
  integrity,
});

const conflict = (code: string, message: string, fields: Readonly<Record<string, string>> = {}): CodedError => new CodedError(409, code, message, fields);

/** The latest record of a correction chain. */
const headOf = async (record: RecordRow, transaction: Transaction): Promise<RecordRow> => {
  let head = record;
  for (let hops = 0; head.supersededById && hops < 1000; hops += 1) {
    const next = await models.CalibrationRecord.unscoped().findOne({ where: { id: head.supersededById }, paranoid: false, transaction });
    if (!next) {
      break;
    }
    head = next;
  }
  return head;
};

/** The record's state and who may give which meaning (§ 4), in order. */
const assertRecordSignable = async (record: RecordRow, userId: string, meaning: EsigMeaning, transaction: Transaction): Promise<void> => {
  if (record.isDeleted) {
    throw conflict(ESIG_CODES.recordVoided, `This record was voided on ${day(record.deletedAt ?? record.updatedAt)}; a voided record is not signed.`);
  }
  if (record.supersededById) {
    const head = await headOf(record, transaction);
    throw conflict(ESIG_CODES.recordSuperseded, `This record was corrected on ${day(record.supersededAt)}; sign the latest version.`, { headId: head.id });
  }
  if (record.entryKind !== "full_record" || !record.performedBy) {
    throw conflict(ESIG_CODES.recordExternal, "Records from an external laboratory or the previous system are not signed electronically.");
  }
  if (meaning === "performed" && record.performedBy !== userId) {
    throw new CodedError(403, ESIG_CODES.notPerformer, "Only the technician who performed this calibration can sign it as performed; sign it as reviewed instead.");
  }
  if (meaning === "reviewed" && record.performedBy === userId) {
    throw new CodedError(403, ESIG_CODES.notPerformer, "The technician who performed this calibration signs it as performed, not as reviewed.");
  }
};

/** What one application binds, before it is signed. */
interface ApplicationDraft {
  readonly tenantId: TenantId;
  readonly signerUserId: string;
  readonly documentType: EsigDocumentType;
  readonly documentId: string | null;
  readonly documentTitle: string;
  readonly meaning: EsigMeaning;
  readonly contentScheme: EsigContentScheme;
  readonly contentHash: string;
  readonly authMethod: "password" | "mfa";
  /** The audit row's resource: the record, or the application itself for a document. */
  readonly auditResource: { readonly type: string; readonly id: string | null };
  /** The Part 11 log's entity: the record, or the application itself for a document. */
  readonly entityType: string;
}

/** Sign and insert an application, its audit row and its Part 11 row — inside the caller's transaction. */
const createApplication = async (draft: ApplicationDraft, esig: EsignatureRow, signer: EsigSigner, transaction: Transaction): Promise<ApplicationRow> => {
  const person = (await displayPeople([draft.signerUserId])).get(draft.signerUserId) as PersonDisplay;
  const id = randomUUID() as EsignatureApplicationId;
  // One clock reading: the payload signs exactly the instant the row stores.
  const signedAt = new Date();
  const payload = esignatureSignedPayload({
    tenantId: draft.tenantId,
    applicationId: id,
    esignatureId: esig.id,
    keyFingerprint: esig.keyFingerprint,
    documentType: draft.documentType,
    documentId: draft.documentId,
    contentScheme: draft.contentScheme,
    contentHash: draft.contentHash,
    meaning: draft.meaning,
    signerUserId: draft.signerUserId,
    signedAt: signedAt.toISOString(),
    authMethod: draft.authMethod,
  });
  const signatureValue = signWith(esig, payload);
  let row: ApplicationRow;
  try {
    row = await models.EsignatureApplication.create(
      {
        id,
        tenantId: draft.tenantId,
        esignatureId: esig.id,
        signerUserId: draft.signerUserId as UserId,
        signerSnapshot: { name: person.name ?? "Unnamed user", role: person.role, organisation: person.organisation },
        documentType: draft.documentType,
        documentId: draft.documentId,
        documentTitle: draft.documentTitle.slice(0, 255),
        meaning: draft.meaning,
        contentHash: draft.contentHash,
        contentScheme: draft.contentScheme,
        authMethod: draft.authMethod,
        signatureValue,
        signedAt,
        verificationToken: newApplicationToken(),
        ipAddress: signer.ipAddress ?? null,
        userAgent: signer.userAgent ? signer.userAgent.slice(0, 500) : null,
      },
      { transaction },
    );
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw conflict(ESIG_CODES.alreadyApplied, `You have already signed this ${draft.documentType.replace("_", " ")} as ${draft.meaning}.`);
    }
    throw err;
  }
  await auditService.logAction(
    {
      tenantId: draft.tenantId,
      ...auditEntryActor(signer),
      action: "APPROVE",
      resourceType: draft.auditResource.type,
      resourceId: draft.auditResource.id ?? row.id,
      changes: {
        operation: "ESIGNATURE_APPLIED",
        applicationId: row.id,
        documentType: draft.documentType,
        meaning: draft.meaning,
        contentScheme: draft.contentScheme,
        contentHash: draft.contentHash,
        keyFingerprint: esig.keyFingerprint,
        authMethod: draft.authMethod,
      },
    },
    { transaction },
  );
  // The Part 11 signature log (as certificate.service#logSignature writes it): the same transaction.
  await models.ESignatureRecord.create(
    {
      tenantId: draft.tenantId,
      entityType: draft.entityType,
      entityId: draft.documentId ?? row.id,
      userId: draft.signerUserId as UserId,
      action: "sign",
      meaning: draft.meaning,
      authMethod: draft.authMethod,
      documentHash: draft.contentHash,
      ipAddress: signer.ipAddress ?? "unknown",
      userAgent: signer.userAgent ? signer.userAgent.slice(0, 500) : "unknown",
    },
    { transaction },
  );
  return row;
};

const personOf = (signer: EsigSigner): string => {
  if (!signer.userId) {
    throw new AppError(403, "An e-signature is applied by a person, not by an API key.");
  }
  return signer.userId;
};

const verifyCredential = (tenantId: TenantId, userId: string, input: { authMethod: string; credential: string }, signer: EsigSigner, resourceType: string, resourceId: string): Promise<void> =>
  certificateService.verifySignerCredentials(userId as UserId, input.authMethod, input.credential, {
    tenantId,
    resourceType,
    resourceId,
    operation: "ESIGNATURE_APPLY",
    ipAddress: signer.ipAddress ?? null,
    userAgent: signer.userAgent ?? null,
  });

/**
 * `POST /calibration-records/:calibrationRecordId/esignatures` — apply the caller's e-signature (201).
 *
 * @param tenantId - the caller's tenant
 * @param input - the validated params + body (meaning, method, credential)
 * @param signer - the person, the request's address and agent
 * @returns the application (no address, agent or token outside its link)
 */
export const applyToRecord = async (tenantId: TenantId, input: ApplyRecordEsignature, signer: EsigSigner): Promise<Record<string, unknown>> => {
  const userId = personOf(signer);
  const result = await db.transaction(async (transaction) => {
    const record = await models.CalibrationRecord.unscoped().findOne({
      where: { id: input.calibrationRecordId, tenantId },
      paranoid: false,
      transaction,
      lock: transaction.LOCK.SHARE,
    });
    if (!record) {
      throw new AppError(404, RECORD_NOT_FOUND);
    }
    await assertRecordSignable(record, userId, input.meaning, transaction);
    const already = await models.EsignatureApplication.findOne({
      where: { documentType: "calibration_record", documentId: record.id, signerUserId: userId, meaning: input.meaning },
      attributes: ["id", "signedAt"],
      transaction,
    });
    if (already) {
      throw conflict(ESIG_CODES.alreadyApplied, `You signed this record as ${input.meaning} on ${day(already.signedAt)}.`);
    }
    const esig = await requireActive(userId, transaction);
    await verifyCredential(tenantId, userId, input, signer, "CalibrationRecord", record.id);
    const device = await models.CalibrationDevice.unscoped().findOne({ where: { id: record.deviceId }, attributes: ["id", "name"], paranoid: false, transaction });
    const row = await createApplication(
      {
        tenantId,
        signerUserId: userId,
        documentType: "calibration_record",
        documentId: record.id,
        documentTitle: `Calibration record ${device?.name ?? ""} ${dayText(record.calibrationDate) ?? ""}`.replace(/\s+/g, " ").trim(),
        meaning: input.meaning,
        contentScheme: CALREC_DATA_SCHEME,
        contentHash: recordContentHash(record),
        authMethod: input.authMethod,
        auditResource: { type: "CalibrationRecord", id: record.id },
        entityType: "CalibrationRecord",
      },
      esig,
      signer,
      transaction,
    );
    return { record, row, esig };
  });
  emitForRow(result.record, "esignature:applied", { documentType: "calibration_record", documentId: result.record.id, applicationId: result.row.id });
  return applicationView(result.row, result.esig, "intact");
};

/**
 * `POST /esignature/documents` — sign any file by its SHA-256 (201). The file is never uploaded.
 *
 * @param tenantId - the caller's tenant
 * @param input - the title, the hash, the size, the meaning and the credential
 * @param signer - the person
 * @returns the application
 */
export const signDocument = async (tenantId: TenantId, input: SignDocument, signer: EsigSigner): Promise<Record<string, unknown>> => {
  const userId = personOf(signer);
  const result = await db.transaction(async (transaction) => {
    const esig = await requireActive(userId, transaction);
    await verifyCredential(tenantId, userId, input, signer, "EsignatureApplication", userId);
    const row = await createApplication(
      {
        tenantId,
        signerUserId: userId,
        documentType: "document",
        documentId: null,
        documentTitle: input.title,
        meaning: input.meaning,
        contentScheme: FILE_SHA256_SCHEME,
        contentHash: input.contentHash,
        authMethod: input.authMethod,
        auditResource: { type: "EsignatureApplication", id: null },
        entityType: "EsignatureDocument",
      },
      esig,
      signer,
      transaction,
    );
    return { row, esig };
  });
  return applicationView(result.row, result.esig, null);
};

/** The e-signatures of some applications, by id. */
const esignaturesOf = async (rows: readonly ApplicationRow[]): Promise<Map<string, EsignatureRow>> => {
  const ids = [...new Set(rows.map((r) => r.esignatureId))];
  const found = ids.length ? await models.UserEsignature.findAll({ where: { id: ids } }) : [];
  return new Map(found.map((e) => [e.id as string, e]));
};

/**
 * `GET /calibration-records/:calibrationRecordId/esignatures` — the record's applications, oldest first.
 *
 * @param calibrationRecordId - the record, read in the caller's context (another tenant's: 404)
 * @returns each application with its link, specimen and integrity now
 */
export const listForRecord = async (calibrationRecordId: string): Promise<Record<string, unknown>[]> => {
  const record = await models.CalibrationRecord.findOne({ where: { id: calibrationRecordId } });
  if (!record) {
    throw new AppError(404, RECORD_NOT_FOUND);
  }
  const rows = await models.EsignatureApplication.findAll({
    where: { documentType: "calibration_record", documentId: record.id },
    order: [["signedAt", "ASC"], ["id", "ASC"]],
  });
  const esigs = await esignaturesOf(rows);
  const hash = recordContentHash(record);
  return rows.map((r) => applicationView(r, esigs.get(r.esignatureId), hash === r.contentHash ? "intact" : "changed"));
};

/**
 * `GET /esignature/me/applications` — what the caller has signed, newest first.
 *
 * @param userId - the caller
 * @param query - page and limit
 * @returns the rows (integrity not recomputed here: null) and the page meta
 */
export const myApplications = async (userId: string, query: MyApplicationsQuery): Promise<{ rows: Record<string, unknown>[]; meta: Record<string, number> }> => {
  const { rows, count } = await models.EsignatureApplication.findAndCountAll({
    where: { signerUserId: userId },
    order: [["signedAt", "DESC"], ["id", "DESC"]],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });
  const esigs = await esignaturesOf(rows);
  return {
    rows: rows.map((r) => applicationView(r, esigs.get(r.esignatureId), null)),
    meta: { total: count, page: query.page, limit: query.limit, totalPages: Math.ceil(count / query.limit) },
  };
};

// ------------------------------------------------------------------
// THE PUBLIC VERIFICATION (§ 4)
// ------------------------------------------------------------------

const notFound = (): AppError => new AppError(404, ESIG_VERIFY_NOT_FOUND);

/** Constant-time equality of two strings (lengths compared first: a length is not the secret). */
const sameText = (a: string, b: string): boolean => {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The explanation of each verdict, in both public languages. */
const EXPLANATIONS: Readonly<Record<EsigVerdict, { id: string; en: string }>> = Object.freeze({
  valid: {
    id: "Tanda tangan elektronik sah dan isi dokumen tidak berubah sejak ditandatangani.",
    en: "The e-signature is valid and the document's content has not changed since it was signed.",
  },
  content_changed: {
    id: "Tanda tangan elektronik asli, tetapi isi dokumen telah berubah sejak ditandatangani.",
    en: "The e-signature is genuine, but the document's content has changed since it was signed.",
  },
  invalid: {
    id: "Tanda tangan elektronik tidak cocok dengan apa yang ditandatangani.",
    en: "The e-signature does not match what was signed.",
  },
});

/** The explanation of a `document` verdict: the server has no file, the reader compares it. */
const DOCUMENT_VALID = Object.freeze({
  id: "Tanda tangan elektronik sah. Bandingkan berkas Anda dengan sidik SHA-256 di bawah untuk memastikan isinya sama.",
  en: "The e-signature is valid. Compare your file with the SHA-256 below to confirm its content is the same.",
});

let contentChangedSignals = 0;

/** How many `content_changed` verdicts this process has answered (a tamper signal; logged at warn). */
export const esigContentChangedSignals = (): number => contentChangedSignals;

/** The cryptographic check of an application against its e-signature's public key. */
const applicationVerifies = (row: ApplicationRow, esig: EsignatureRow): boolean => {
  const payload = esignatureSignedPayload({
    tenantId: row.tenantId,
    applicationId: row.id,
    esignatureId: row.esignatureId,
    keyFingerprint: esig.keyFingerprint,
    documentType: row.documentType,
    documentId: row.documentId,
    contentScheme: row.contentScheme,
    contentHash: row.contentHash,
    meaning: row.meaning,
    signerUserId: row.signerUserId,
    signedAt: new Date(row.signedAt).toISOString(),
    authMethod: row.authMethod,
  });
  try {
    return rsaVerify("sha256", Buffer.from(payload, "utf8"), esig.publicKeyPem, Buffer.from(row.signatureValue, "base64"));
  } catch {
    // A malformed key or signature is a failed check, never a 500.
    return false;
  }
};

/** A record's part of the verdict: its canonical content, its state and its summary. */
const recordPart = async (row: ApplicationRow): Promise<{
  pairs: string[][];
  hash: string;
  state: EsigDocumentState;
  stateAt: string | null;
  summary: PublicEsignatureVerdict["summary"];
} | null> => {
  // A record application always names its record (0149's CHECK esignature_applications_document_id).
  const record = await models.CalibrationRecord.unscoped().findOne({ where: { id: String(row.documentId) }, paranoid: false });
  if (!record) {
    return null;
  }
  const device = await models.CalibrationDevice.unscoped().findOne({ where: { id: record.deviceId }, attributes: ["id", "name", "manufacturer", "model", "serialNumber"], paranoid: false });
  const pairs = calibrationRecordDataPairs(record).map(([name, value]) => [name, value]);
  const state: EsigDocumentState = record.isDeleted ? "voided" : record.supersededById ? "superseded" : "current";
  return {
    pairs,
    hash: sha256Hex(JSON.stringify(pairs)),
    state,
    stateAt: state === "voided" ? dayText(record.deletedAt ?? record.updatedAt) : state === "superseded" ? dayText(record.supersededAt) : null,
    summary: {
      deviceName: device?.name ?? null,
      brand: device?.manufacturer ?? null,
      model: device?.model ?? null,
      serialNumber: device?.serialNumber ?? null,
      calibrationDate: dayText(record.calibrationDate),
      dueDate: dayText(record.dueDate),
      isCompliant: record.isCompliant ?? null,
    },
  };
};

/** The verdict, read in the application's own tenant. */
const verdictInTenant = async (row: ApplicationRow): Promise<PublicEsignatureVerdict> => {
  const esig = await models.UserEsignature.findOne({ where: { id: row.esignatureId } });
  if (!esig) {
    throw notFound();
  }
  const tenant = await models.Tenant.findOne({ where: { id: row.tenantId }, attributes: ["id", "name"] });
  const record = row.documentType === "calibration_record" ? await recordPart(row) : null;
  let verdict: EsigVerdict;
  if (!applicationVerifies(row, esig)) {
    verdict = "invalid";
  } else if (record && record.hash !== row.contentHash) {
    verdict = "content_changed";
    contentChangedSignals += 1;
    logger.warn("A document changed after it was e-signed", { code: "ESIG_CONTENT_CHANGED", applicationId: row.id, documentType: row.documentType });
  } else {
    verdict = "valid";
  }
  return {
    verdict,
    explanation: verdict === "valid" && row.documentType === "document" ? DOCUMENT_VALID : EXPLANATIONS[verdict],
    esignatureState: esig.status,
    esignatureStateAt: esig.status === "revoked" ? dayText(esig.revokedAt) : esig.status === "superseded" ? dayText(esig.supersededAt) : null,
    documentState: record?.state ?? null,
    documentStateAt: record?.stateAt ?? null,
    signedAt: new Date(row.signedAt).toISOString(),
    meaning: row.meaning,
    signer: { name: row.signerSnapshot.name, role: row.signerSnapshot.role ?? null, organisation: row.signerSnapshot.organisation ?? null },
    specimenSvg: esig.specimenSvg,
    keyFingerprint: esig.keyFingerprint,
    publicKeyPem: esig.publicKeyPem,
    organisation: { name: tenant?.name ?? null },
    documentType: row.documentType,
    documentTitle: row.documentTitle,
    contentScheme: row.contentScheme,
    contentHash: row.contentHash,
    canonicalContent: record?.pairs ?? null,
    summary: record?.summary ?? null,
  };
};

/**
 * `GET /public/esignatures/:applicationId?token=` — the verdict for the holder of the link.
 *
 * @param applicationId - the id in the link
 * @param token - the link's token
 * @returns the verdict (`publicEsignatureVerdict`)
 * @throws AppError 404 "No e-signature matches this link." — identical for a malformed, unknown or mismatched link
 */
export const verifyPublic = async (applicationId: string, token: string | undefined): Promise<PublicEsignatureVerdict> => {
  if (!token || !ESIG_VERIFY_TOKEN.test(token) || !UUID.test(applicationId)) {
    throw notFound();
  }
  const row = await models.EsignatureApplication.findOne({
    where: { id: applicationId },
    // skipTenantScope: the public verification has no principal; the 192-bit token compared below is
    // the capability (ADR-100, ADR-140 § 4, reviewed). Every later read runs in the row's tenant.
    skipTenantScope: true,
  });
  if (!row || !sameText(row.verificationToken, token)) {
    throw notFound();
  }
  return runForTenant(row.tenantId, () => verdictInTenant(row));
};
