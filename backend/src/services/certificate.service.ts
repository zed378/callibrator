/**
 * Certificate Service
 *
 * Handles certificate CRUD operations, approval, signing, and revocation.
 *
 * P9-20 (ADR-087, Stage C): converted from certificate.service.js with no
 * behaviour change. `export =` keeps the exact object `require()` returned (the
 * same keys, in the same order). The `.js` called its helpers (`isAuthorOf`,
 * `verifySignerCredentials`) as local bindings, never through `exports`, and so
 * does this. `Op`, `Transaction`, the six models and `Sequelize`, `logger`,
 * `AppError`, `DEFAULT_LIMIT`, the auth, mfa, audit and webhook services, the
 * two audit helpers, `WEBHOOK_EVENTS`, `db`, `PLATFORM_TENANT_ID` and `crypto`
 * are captured once at load, in the `.js`'s require order. The two validator
 * modules, `workflow.service`, `attachment.service`, `certificateDocument.service`
 * and `sequelize` (in getCertificateStats) are still required inside the
 * methods, at call time, as the `.js` did.
 */
import { Op as LoadedOp, Transaction as LoadedTransaction, type CreationAttributes, type WhereOptions } from "sequelize";
import models from "../models";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { DEFAULT_LIMIT as LOADED_DEFAULT_LIMIT } from "../constants";
import loadedAuthService from "./auth.service";
import loadedMfaService from "./mfa.service";
import loadedAuditService from "./audit.service";
import {
  auditEntryActor as loadedAuditEntryActor,
  actorChanges as loadedActorChanges,
  type AuditActorInput,
} from "../utils/auditPrincipal.util";
import loadedWebhookService from "./webhook.service";
import { WEBHOOK_EVENTS as LOADED_WEBHOOK_EVENTS } from "../constants/webhookEvents";
import { db as loadedDb } from "../config";
import { PLATFORM_TENANT_ID as LOADED_PLATFORM_TENANT_ID } from "../constants/platformTenant";
import loadedCrypto from "crypto";
import type * as CertificateValidator from "../validators/certificate.validator";
import type * as InputValidator from "../validators/input";
import type WorkflowService from "./workflow.service";
import type AttachmentService from "./attachment.service";
import type * as CertificateDocumentService from "./certificateDocument.service";
import type * as SequelizeModule from "sequelize";
import type { AuditAction } from "../constants/auditActions";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const Op = LoadedOp;
const Transaction = LoadedTransaction;
const {
  Certificate,
  CalibrationDevice,
  // The `.js` destructured CalibrationRecord and never used it.
  Tenant,
  User,
  ESignatureRecord,
  Sequelize,
} = models;
const logger = loadedLogger;
const AppError = LoadedAppError;
const DEFAULT_LIMIT = LOADED_DEFAULT_LIMIT;
const authService = loadedAuthService;
const mfaService = loadedMfaService;
const auditService = loadedAuditService;
const auditEntryActor = loadedAuditEntryActor;
const actorChanges = loadedActorChanges;
const webhookService = loadedWebhookService;
const WEBHOOK_EVENTS = LOADED_WEBHOOK_EVENTS;
const db = loadedDb;
const PLATFORM_TENANT_ID = LOADED_PLATFORM_TENANT_ID;
const crypto = loadedCrypto;

type CertificateRow = ModelInstance<"Certificate">;
type SqlTransaction = InstanceType<typeof LoadedTransaction>;
/** The models the certificate statics take: the barrel's `Sequelize` is the class with `Op` on it. */
type CertificateStaticModels = NonNullable<Parameters<typeof Certificate.generateCertificateNumber>[1]>;
/** The same `Sequelize` object (the class carries `Op` as a static), viewed as the statics take it. */
const SequelizeWithOp = Sequelize as CertificateStaticModels["Sequelize"];

/** A service answer the controller forwards. */
interface Outcome<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

/** A caught value's `message`, read exactly as the `.js` read it (a thrown `null` still throws here). */
const messageOf = (error: unknown): unknown => (error as { message?: unknown }).message;

/** The re-authentication a signature carries (the controller builds it from the request). */
interface AuthOptions {
  authMethod?: unknown;
  authPayload?: unknown;
  meaning?: unknown;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
}

/** What a signature is for, on the SIGNATURE_AUTH_FAILED row (A-126). */
interface SignatureContext {
  tenantId?: string | null | undefined;
  resourceType?: string | null | undefined;
  resourceId?: string | null | undefined;
  operation?: string | null | undefined;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
}

/** The fields of one certificate audit row. */
interface CertificateAuditFields {
  tenantId: TenantId;
  userId?: UserId | null;
  principal?: AuditActorInput;
  action: AuditAction;
  operation: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
}

/**
 * A-41 — every certificate mutation writes its audit row inside the SAME
 * transaction as the change (MEMORY/specs/A-41-audit-inside-transaction.md,
 * rows 1-7). A rollback takes the row with it; a failed audit insert is
 * re-thrown by logAction and rolls the change back — a certificate is never
 * issued, approved, signed or revoked unattributed.
 *
 * `changes` carries statuses and identifiers only. Never the re-authentication
 * payload (password / MFA code): audit_logs is permanent.
 */
const auditCertificate = (
  transaction: SqlTransaction,
  certificate: { id: string; certificateNumber?: string | null },
  { tenantId, userId, principal, action, operation, before, after, ipAddress, userAgent }: CertificateAuditFields,
): Promise<unknown> =>
  auditService.logAction(
    {
      tenantId,
      // A-282 (ADR-100): a `principal` (auditPrincipal(req)) records an API
      // key as `system:api-key` with its id in `changes`, never in user_id
      // (an FK to users). The signature paths pass the re-authenticated user.
      ...(principal ? auditEntryActor(principal) : { userId, ipAddress, userAgent }),
      action,
      resourceType: "Certificate",
      resourceId: certificate.id,
      changes: {
        operation,
        certificateNumber: certificate.certificateNumber,
        before,
        after,
        ...(principal ? actorChanges(principal) : {}),
      },
    },
    { transaction },
  );

/**
 * A-64 — what a caller who tried to edit `status` should do instead, keyed by
 * the certificate's current status. Signed and revoked certificates are not
 * editable at all and are refused before this is consulted.
 */
const NEXT_TRANSITION: Record<string, string | undefined> = {
  draft: "Submit it for approval with POST /certificates/:id/submit.",
  pending_approval:
    "Approve it with POST /certificates/:id/approve, which requires re-authentication.",
  approved:
    "Sign it with POST /certificates/:id/sign, or revoke it with POST /certificates/:id/revoke; both require re-authentication.",
};

/**
 * A-85 — why a signed or revoked certificate refuses an edit, keyed by status.
 * These are state conflicts (409), not malformed requests: the same body is
 * accepted while the certificate is a draft.
 */
const LOCKED_EDIT_EXPLANATION: Record<string, string | undefined> = {
  signed:
    'This certificate is "signed" and can no longer be edited: its signature covers the content as signed. ' +
    "To correct it, revoke it with POST /certificates/:id/revoke and issue a new certificate.",
  revoked:
    'This certificate is "revoked" and can no longer be edited: revocation is final. ' +
    "Issue a new certificate instead.",
};

/**
 * A-92 / A-130 (ADR-051 A-107) — why a certificate refuses deletion (a state
 * conflict, 409), keyed by the statuses that refuse it. `draft` and
 * `pending_approval` are not keys: they may still be deleted. An `approved`
 * certificate has been attested by its approver's re-authenticated signature,
 * a `signed` one is issued, and a `revoked` one is the permanent record that it
 * was withdrawn — which the public verification page must go on reporting.
 */
const DELETE_REFUSAL_EXPLANATIONS: Record<string, string | undefined> = {
  approved:
    'This certificate is "approved" and cannot be deleted: its approval is a signed record. ' +
    "Revoke it with POST /certificates/:id/revoke instead.",
  signed:
    'This certificate is "signed" and cannot be deleted: a signed certificate is a controlled record ' +
    "whose signature must stay verifiable. Revoke it with POST /certificates/:id/revoke instead.",
  revoked:
    'This certificate is "revoked" and cannot be deleted: a revoked certificate is the permanent record ' +
    "that it was withdrawn, and its verification page goes on showing it as revoked.",
};

/** A status transition a certificate goes through. */
type TransitionName = "submitted" | "approved" | "signed" | "revoked";

/**
 * A-167 — why a status transition is refused (409), keyed by the transition
 * and then by the certificate's current status. Only the statuses that refuse
 * the transition are keys.
 */
const TRANSITION_REFUSALS: Record<TransitionName, Record<string, string | undefined>> = {
  submitted: {
    pending_approval: "it has already been submitted and is waiting for approval",
    approved: "it has already been approved; sign it with POST /certificates/:id/sign",
    signed: "it has already been approved and signed",
    revoked: "revocation is final; issue a new certificate instead",
  },
  approved: {
    draft: "it has not been submitted yet; submit it with POST /certificates/:id/submit first",
    approved: "it has already been approved; sign it with POST /certificates/:id/sign",
    signed: "it has already been approved and signed",
    revoked: "revocation is final; issue a new certificate instead",
  },
  signed: {
    draft:
      "only an approved certificate can be signed; submit it with POST /certificates/:id/submit, then approve it",
    pending_approval:
      "only an approved certificate can be signed; approve it with POST /certificates/:id/approve first",
    signed: "it has already been signed, and a certificate is signed once",
    revoked: "revocation is final; issue a new certificate instead",
  },
  revoked: {
    revoked: "it has already been revoked, and revocation is final",
  },
};

/**
 * A-167 — the state explanation for a refused transition.
 *
 * @param status - the certificate's current (locked) status
 * @param transition
 * @returns the refusal, or null when the transition is allowed
 */
const explainRefusedTransition = (status: string | null, transition: TransitionName): string | null => {
  const reason = TRANSITION_REFUSALS[transition][status as string];
  return reason
    ? `This certificate is "${String(status)}" and cannot be ${transition}: ${reason}.`
    : null;
};

/**
 * A-167 — load a certificate for a status transition INSIDE the transition's
 * transaction, locked (SELECT ... FOR UPDATE), as A-157 does for
 * deleteCertificate. The status that decides the transition used to be read
 * before the transaction with no lock: an approval could update a certificate
 * that a concurrent delete had just removed, and two concurrent transitions
 * could both pass the same check. Under the lock a concurrent delete or
 * transition either commits first — and this read, which waits for it, sees
 * the row gone (404) or its new status (409) — or waits for this one.
 *
 * @returns the locked certificate, or null (404)
 */
const lockCertificate = (tenantId: TenantId, certificateId: string, transaction: SqlTransaction): Promise<CertificateRow | null> =>
  Certificate.findOne({
    where: { id: certificateId, tenantId },
    transaction,
    lock: Transaction.LOCK.UPDATE,
  });

/** The 404 result the transitions return (not thrown: the controller renders it). */
const CERTIFICATE_NOT_FOUND = {
  success: false,
  status: 404,
  message: "Certificate not found",
  data: null,
};

/**
 * ADR-101 — separation of duties. The approval of a certificate is its
 * independent review (ISO/IEC 17025 §7.8.1.2; 21 CFR Part 11 §11.10(g)
 * authority checks): the user who drafted it (`createdBy`) or submitted it
 * (`submittedBy`) may not approve it — directly or at any step of its approval
 * workflow. Another user holding `certificate` write may.
 *
 * A 403, not a 409 (CLAUDE.md, Status Codes That Carry Meaning): the
 * certificate is in the caller's own tenant and its state allows approval —
 * a different approver succeeds on the same row, unchanged. What is refused is
 * this caller's authority over this record, which is a permission failure
 * inside the caller's tenant. The message says which rule refused it, so it is
 * not read as a missing grant.
 */
const SELF_APPROVAL_REFUSAL =
  "You drafted or submitted this certificate, so you cannot approve it: separation of duties " +
  "requires its approval to come from another user with certificate approval rights. Nothing was recorded.";

/** Who authored a certificate, as the separation-of-duties check reads it. */
interface Authored {
  createdBy?: unknown;
  submittedBy?: unknown;
}

/**
 * @param certificate - `createdBy` and `submittedBy` are read
 * @param approverId - the authenticated caller
 * @returns whether `approverId` authored (drafted or submitted) it
 */
const isAuthorOf = (certificate: Authored, approverId: unknown): boolean =>
  [certificate.createdBy, certificate.submittedBy]
    .filter((id) => id !== null && id !== undefined)
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: an id is a string (or a number), compared as text (ADR-038 rule 3)
    .some((id) => String(id) === String(approverId));

/**
 * ADR-101 — refuse an approval by the certificate's author (403, explained).
 * Called before re-authentication, so a refusal consumes no one-time MFA code
 * and writes nothing — no approval audit row, no signature record.
 *
 * @throws {AppError} 403 with the explanation
 */
const refuseSelfApproval = (certificate: Authored, approverId: unknown): void => {
  if (isAuthorOf(certificate, approverId)) {
    throw new AppError(403, SELF_APPROVAL_REFUSAL);
  }
};

/**
 * ADR-101 — the workflow path's separation-of-duties check, for EVERY
 * approving step (not only the final one): an author may not review their own
 * certificate at any step. Reads the certificate in the decision's
 * transaction; a certificate that is gone is left to lockForWorkflowDecision.
 *
 * @throws {AppError} 403, explained
 */
const refuseSelfApprovalInWorkflow = async (
  transaction: SqlTransaction,
  tenantId: TenantId,
  certificateId: string,
  approverId: UserId,
): Promise<void> => {
  const certificate = await Certificate.findOne({
    where: { id: certificateId, tenantId },
    attributes: ["id", "createdBy", "submittedBy"],
    transaction,
  });
  if (certificate) {
    refuseSelfApproval(certificate, approverId);
  }
};

/**
 * Re-authenticate the signer. MUST be called BEFORE the state change it
 * authorises.
 *
 * This used to be fused with the record-writing step and invoked AFTER the
 * certificate had already been mutated and saved — so a caller with a valid
 * session but a wrong password got a 401 while the certificate was already
 * approved/signed/revoked in the database, and no ESignatureRecord was
 * written. Under 21 CFR Part 11 the signature must gate the act, not trail it.
 *
 * @param userId - the authenticated caller
 * @param authOptions - authMethod, authPayload, meaning, ipAddress, userAgent
 * @param context - A-126: what is being signed (tenantId, resourceType,
 *   resourceId, operation), for the SIGNATURE_AUTH_FAILED row
 * @throws {AppError} 400 on a missing/invalid payload, 401 on failed re-auth.
 */
const verifySignatureAuth = async (
  userId: UserId,
  authOptions: AuthOptions | null | undefined,
  context: SignatureContext | undefined,
): Promise<void> => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy options read as none (ADR-038 rule 3)
  const { authMethod, authPayload, meaning } = authOptions || {};

  if (!authMethod || !authPayload || !meaning) {
    throw new AppError(400, "Missing required E-signature authentication payload.");
  }

  // A-126: `context` says what was being signed, for a SIGNATURE_AUTH_FAILED row.
  await verifySignerCredentials(userId, authMethod, authPayload, {
    ...context,
    // authOptions is set: the payload check above read its members.
    ipAddress: (authOptions as AuthOptions).ipAddress,
    userAgent: (authOptions as AuthOptions).userAgent,
  });
};

/**
 * A-126 (ADR-051 Q-15) — a wrong signing credential is an audit row,
 * `SIGNATURE_AUTH_FAILED`: 21 CFR 11.300(d) wants attempts to use signature
 * credentials without authority detected and reported.
 *
 * Written in its OWN transaction, committed before the 401 is thrown. The
 * certificate transitions re-authenticate inside the transition's transaction,
 * which the 401 rolls back — a row written there would vanish with it. If
 * the row cannot be written the error propagates and the caller gets a 500,
 * not the 401: an attempt that cannot be recorded is not answered.
 *
 * The actor is the signed-in caller (whose session is being used); the row
 * never carries the payload, only which method failed. It goes in the tenant
 * of the record being signed; with no context, in the signer's own tenant
 * (PLATFORM for an account with none, ADR-051 Q-14).
 *
 * @param userId - the authenticated caller
 * @param authMethod
 * @param context
 */
const recordSignatureAuthFailure = async (userId: UserId, authMethod: string, context: SignatureContext): Promise<void> => {
  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built (ADR-038 rule 3): an empty value falls back */
  const tenantId =
    context.tenantId ||
    (await User.findByPk(userId, { attributes: ["id", "tenantId"] }))?.tenantId ||
    PLATFORM_TENANT_ID;
  // A new, independent transaction: Sequelize never makes db.transaction() a
  // child of the CLS one unless it is passed as `transaction`.
  await db.transaction(
    (transaction) =>
      auditService.logAction(
        {
          tenantId,
          userId,
          action: "SIGNATURE_AUTH_FAILED",
          resourceType: context.resourceType || "User",
          resourceId: context.resourceId || userId,
          changes: { method: authMethod, operation: context.operation || null },
          ipAddress: context.ipAddress || null,
          userAgent: context.userAgent || null,
        },
        { transaction },
      ),
  );
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
};

/**
 * Check the signer's own credential — their password, or a current code from
 * their authenticator — at the moment of signing (21 CFR 11.200(a)).
 *
 * Shared by certificate approve / sign / revoke and by e-signature workflow
 * signing (A-65), so every signature in the system re-authenticates the same
 * way. It checks the credential only; the caller decides who `userId` is, and
 * it must be the authenticated caller, never a body field (A-62).
 *
 * @param userId - the authenticated caller
 * @param authMethod - "password" or "mfa"
 * @param authPayload - the password or the MFA code
 * @param context - A-126: what is being signed, for the
 *   SIGNATURE_AUTH_FAILED row a wrong credential writes
 *   (recordSignatureAuthFailure)
 * @throws {AppError} 400 on an unknown method or an account without MFA,
 *   401 when the credential is wrong or missing.
 */
const verifySignerCredentials = async (
  userId: UserId,
  authMethod: unknown,
  authPayload: unknown,
  context: SignatureContext = {},
): Promise<void> => {
  if (authMethod !== "password" && authMethod !== "mfa") {
    throw new AppError(400, "Invalid auth method.");
  }
  if (!authPayload) {
    throw new AppError(401, "Re-authentication is required to sign.");
  }

  if (authMethod === "password") {
    const valid = await authService.passIsValid(userId, authPayload);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: the .js tested the envelope too (ADR-038 rule 3)
    if (!valid || !(valid["data"] as { valid?: unknown }).valid) {
      await recordSignatureAuthFailure(userId, authMethod, context);
      throw new AppError(401, "Invalid password for e-signature.");
    }
    return;
  }

  const user = await User.findByPk(userId);
  // mfaService.verifyLogin throws a plain Error for an account without MFA,
  // which surfaced as a 500. It is a request the account cannot satisfy: 400.
  if (!user || !user.mfaEnabled || !user.mfaSecret) {
    throw new AppError(400, "MFA is not enabled for this account; sign with your password.");
  }
  // A-115: verifyLogin consumes the code — a code that signed once cannot
  // sign (or sign in) again inside its window.
  if (!(await mfaService.verifyLogin(user, authPayload))) {
    await recordSignatureAuthFailure(userId, authMethod, context);
    throw new AppError(401, "Invalid MFA code for e-signature.");
  }
};

/** What a Part 11 signature record hashes and names. */
type SignedCertificate = Pick<CertificateRow, "id" | "certificateNumber" | "deviceId" | "calibrationRecordId" | "status" | "digitalSignature">;

/**
 * Write the Part 11 compliance record. Called AFTER the state change so the
 * document hash captures the state that was actually signed.
 */
const logSignature = async (
  tenantId: TenantId,
  certificate: SignedCertificate,
  userId: UserId,
  action: string,
  authOptions: AuthOptions,
  transaction: SqlTransaction,
): Promise<void> => {
  // No `|| {}` guard: this only runs after verifySignatureAuth, which throws
  // 400 unless authMethod/authPayload/meaning are all present.
  const { authMethod, meaning, ipAddress, userAgent } = authOptions;

  // Document hash (SHA-256 of the signed certificate state)
  const certDataString = JSON.stringify({
    id: certificate.id,
    certificateNumber: certificate.certificateNumber,
    deviceId: certificate.deviceId,
    calibrationRecordId: certificate.calibrationRecordId,
    status: certificate.status,
    digitalSignature: certificate.digitalSignature,
  });
  const documentHash = crypto.createHash("sha256").update(certDataString).digest("hex");

  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built (ADR-038 rule 3): an empty value is "unknown" */
  const values: Record<string, unknown> = {
    tenantId,
    entityType: "Certificate",
    entityId: certificate.id,
    userId,
    action,
    meaning,
    authMethod,
    documentHash,
    ipAddress: ipAddress || "unknown",
    userAgent: userAgent || "unknown",
  };
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
  await ESignatureRecord.create(values as CreationAttributes<ModelInstance<"ESignatureRecord">>, { transaction });
};

/** The list query as the controller passes it (validated; a JavaScript caller may pass anything). */
interface CertificateListQuery {
  tenantId: TenantId;
  page?: number | string | undefined;
  limit?: number | string | undefined;
  deviceId?: string | null | undefined;
  status?: unknown;
  type?: unknown;
  certificateNumber?: string | null | undefined;
  from?: string | Date | null | undefined;
  to?: string | Date | null | undefined;
  sortBy?: string | undefined;
  sortOrder?: string | undefined;
}

interface CertificateListData {
  rows: CertificateRow[];
  count: number;
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/**
 * Fetch all certificates for a tenant with pagination and filtering
 */
const fetchCertificates = async ({
  tenantId,
  page = 1,
  limit = DEFAULT_LIMIT,
  deviceId,
  status,
  type,
  certificateNumber,
  from,
  to,
  sortBy = "created_at",
  sortOrder = "DESC",
}: CertificateListQuery): Promise<Outcome<CertificateListData>> => {
  try {
    const whereClause: Record<string, unknown> = { tenantId };

    if (deviceId) {
      whereClause["deviceId"] = deviceId;
    }

    if (status && Array.isArray(status) && status.length > 0) {
      whereClause["status"] = { [Op.in]: status };
    }

    if (type && Array.isArray(type) && type.length > 0) {
      whereClause["type"] = { [Op.in]: type };
    }

    if (certificateNumber) {
      whereClause["certificateNumber"] = {
        [Op.like]: `%${certificateNumber}%`,
      };
    }

    if (from || to) {
      const issuedAt: Record<symbol, unknown> = {};
      whereClause["issuedAt"] = issuedAt;
      if (from) {issuedAt[Op.gte] = from;}
      if (to) {issuedAt[Op.lte] = to;}
    }

    // Map sortBy to database column
    const sortMap: Record<string, string | undefined> = {
      certificate_number: "certificateNumber",
      issued_at: "issuedAt",
      created_at: "createdAt",
      status: "status",
      device_name: "deviceName",
    };
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built (ADR-038 rule 3)
    const orderColumn = sortMap[sortBy] || "createdAt";
    const orderDirection = sortOrder === "ASC" ? "ASC" : "DESC";

    const { rows, count } = await Certificate.findAndCountAll({
      where: whereClause as WhereOptions,
      order: [[orderColumn, orderDirection]],
      limit: Number(limit),
      offset: (Number(page) - 1) * Number(limit),
      // required:false -> LEFT JOINs. Without it these default to INNER JOINs,
      // and the User associations carry a default scope (deleted_at IS NULL),
      // so any certificate with a null optional FK (e.g. a draft with no
      // approver/signer) is silently dropped from the list.
      include: [
        {
          association: "device",
          attributes: ["id", "name", "serialNumber", "manufacturer", "model"],
          required: false,
        },
        {
          association: "calibratedByUser",
          attributes: ["id", "firstName", "lastName", "email"],
          required: false,
        },
        {
          association: "approvedByUser",
          attributes: ["id", "firstName", "lastName", "email"],
          required: false,
        },
        {
          association: "signedByUser",
          attributes: ["id", "firstName", "lastName", "email"],
          required: false,
        },
      ],
    });

    return {
      success: true,
      status: 200,
      message: "Fetch certificates successful",
      data: {
        rows,
        count,
        meta: {
          total: count,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(count / Number(limit)),
        },
      },
    };
  } catch (error) {
    logger.error("Error fetching certificates", {
      error: messageOf(error),
    });
    throw error;
  }
};

/**
 * Fetch a specific certificate by ID
 */
const fetchSpecificCertificate = async (tenantId: TenantId, certificateId: string): Promise<Outcome<CertificateRow | null>> => {
  try {
    const certificate = await Certificate.findOne({
      where: { id: certificateId, tenantId },
      include: [
        {
          association: "device",
          attributes: [
            "id",
            "name",
            "serialNumber",
            "manufacturer",
            "model",
            "category",
          ],
          required: false,
        },
        {
          association: "calibrationRecord",
          attributes: ["id", "calibrationDate", "isCompliant", "notes"],
          required: false,
        },
        {
          association: "calibratedByUser",
          attributes: ["id", "firstName", "lastName", "email"],
          required: false,
        },
        {
          association: "approvedByUser",
          attributes: ["id", "firstName", "lastName", "email"],
          required: false,
        },
        {
          association: "signedByUser",
          attributes: ["id", "firstName", "lastName", "email"],
          required: false,
        },
        {
          association: "tenant",
          attributes: ["id", "name", "code"],
          required: false,
        },
      ],
    });

    if (!certificate) {
      return {
        success: false,
        status: 404,
        message: "Certificate not found",
        data: null,
      };
    }

    return {
      success: true,
      status: 200,
      message: "Fetch certificate successful",
      data: certificate,
    };
  } catch (error) {
    logger.error("Error fetching specific certificate", {
      error: messageOf(error),
      certificateId,
    });
    throw error;
  }
};

/** The validator modules, required at call time as the `.js` did. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: required inside the writing methods (see the file header)
const certificateSchemas = (): typeof CertificateValidator => require("../validators/certificate.validator") as typeof CertificateValidator;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: required inside the writing methods (see the file header)
const inputValidator = (): typeof InputValidator => require("../validators/input") as typeof InputValidator;
/** workflow.service, required at call time as the `.js` did (it requires this module lazily too). */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: a lazy require (see the file header)
const workflowService = (): typeof WorkflowService => require("./workflow.service") as typeof WorkflowService;

/**
 * Create a new certificate
 */
const createCertificate = async (
  tenantId: TenantId,
  userId: UserId | null,
  inputData: unknown,
  actor: AuditActorInput = {},
): Promise<Outcome<CertificateRow | null>> => {
  try {
    const { createCertificateSchema } = certificateSchemas();
    const { validateInput: validate } = inputValidator();
    const validated = validate(inputData, createCertificateSchema);

    // Verify device belongs to tenant
    const device = await CalibrationDevice.findOne({
      where: { id: validated.deviceId, tenantId },
    });

    if (!device) {
      return {
        success: false,
        status: 404,
        message: "Device not found or not belonging to this tenant",
        data: null,
      };
    }

    // Get tenant for certificate number generation
    const tenant = await Tenant.findByPk(tenantId);
    // D-40: certificate_number is unique PLATFORM-wide — it is the key the
    // public verification page resolves (ADR-063). The prefix must
    // therefore be distinct per tenant. `tenants.code` is globally unique but
    // nullable; every code-less tenant used to share the prefix "T", and the
    // generator's tenant-scoped lookup could not see the other tenant's
    // numbers, so the second code-less tenant to issue a certificate on a
    // given day collided with the first and failed with a unique violation.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty code falls back (ADR-038 rule 3)
    const tenantCode = tenant?.code || `T${String(tenantId).replace(/-/g, "").slice(0, 8).toUpperCase()}`;

    // Generate unique certificate number
    const certificateNumber = await Certificate.generateCertificateNumber(
      tenantCode,
      { Certificate, Sequelize: SequelizeWithOp },
    );

    const workflow = workflowService();
    const certificate = await db.transaction(async (transaction) => {
      const values: Record<string, unknown> = {
        ...validated,
        tenantId,
        certificateNumber,
        issueDate: new Date(),
        createdBy: userId,
      };
      const created = await Certificate.create(
        values as CreationAttributes<CertificateRow>,
        { transaction },
      );
      // A-190 — the certificate's approval workflow starts in the SAME
      // transaction. It used to start after the commit, so a failure there
      // left a certificate with no workflow: one that could never pass
      // through the approval chain its tenant had configured. Now a failure
      // rolls the certificate back with it, and the caller gets the error.
      const instance = await workflow.startWorkflow(
        tenantId,
        "Certificate",
        created.id,
        transaction,
      );
      await auditCertificate(transaction, created, {
        tenantId,
        principal: actor,
        action: "CREATE",
        operation: "ISSUE",
        before: {},
        after: {
          status: created.status,
          deviceId: created.deviceId,
          calibrationRecordId: created.calibrationRecordId,
          workflowInstanceId: instance ? instance.id : null,
        },
      });
      return created;
    });

    logger.info("Certificate created", {
      certificateId: certificate.id,
      certificateNumber: certificate.certificateNumber,
      tenantId,
      userId,
    });

    return {
      success: true,
      status: 201,
      message: "Certificate created successfully",
      data: certificate,
    };
  } catch (error) {
    logger.error("Error creating certificate", {
      error: messageOf(error),
    });
    throw error;
  }
};

/**
 * Update an existing certificate
 */
const updateCertificate = async (
  tenantId: TenantId,
  certificateId: string,
  inputData: unknown,
  actor: AuditActorInput = {},
): Promise<Outcome<CertificateRow | null>> => {
  try {
    const { updateCertificateSchema } = certificateSchemas();
    const { validateInput: validate } = inputValidator();
    const validated = validate(inputData, updateCertificateSchema);

    const certificate = await Certificate.findOne({
      where: { id: certificateId, tenantId },
    });

    if (!certificate) {
      return {
        success: false,
        status: 404,
        message: "Certificate not found",
        data: null,
      };
    }

    // Cannot update signed or revoked certificates. A-85: a state conflict,
    // so 409 with the state and the way forward — not a 400.
    if (
      certificate.status === Certificate.STATUS.SIGNED ||
      certificate.status === Certificate.STATUS.REVOKED
    ) {
      return {
        success: false,
        status: 409,
        message: LOCKED_EDIT_EXPLANATION[certificate.status] as string,
        data: null,
      };
    }

    // A-64 — status is not editable. It changes only through its own
    // transitions (submit / approve / sign / revoke), each of which
    // re-authenticates where Part 11 requires it and writes its own audit row.
    // The schema still accepts `status` so an attempted transition can be
    // REFUSED with a state explanation rather than silently dropped; the
    // current status repeated back (a client round-tripping the record) is not
    // a transition and is simply removed from the edit.
    const { status: requestedStatus, ...edit } = validated;
    if (requestedStatus && requestedStatus !== certificate.status) {
      throw new AppError(
        409,
        `This certificate is in "${String(certificate.status)}" and editing it cannot change its status. ` +
          String(NEXT_TRANSITION[certificate.status as string]),
      );
    }

    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a falsy updatedBy is none (ADR-038 rule 3)
    const updatedBy = (inputData as { updatedBy?: unknown }).updatedBy || null;
    const before = Object.fromEntries(
      Object.keys(edit).map((key) => [key, (certificate as unknown as Record<string, unknown>)[key]]),
    );

    await db.transaction(async (transaction) => {
      const changes: Record<string, unknown> = { ...edit, updatedBy };
      await certificate.update(changes as Parameters<CertificateRow["update"]>[0], { transaction });
      await auditCertificate(transaction, certificate, {
        tenantId,
        principal: actor,
        action: "UPDATE",
        operation: "UPDATE",
        before,
        after: edit,
      });
    });

    logger.info("Certificate updated", {
      certificateId,
      tenantId,
    });

    return {
      success: true,
      status: 200,
      message: "Certificate updated successfully",
      data: certificate,
    };
  } catch (error) {
    logger.error("Error updating certificate", {
      error: messageOf(error),
    });
    throw error;
  }
};

/**
 * Soft-delete a certificate
 */
const deleteCertificate = async (tenantId: TenantId, certificateId: string, actor: AuditActorInput = {}): Promise<Outcome<null>> => {
  try {
    // A-157 — the status that decides whether a delete is allowed is read
    // INSIDE the delete's transaction, with the row locked (SELECT ... FOR
    // UPDATE). It used to be read before the transaction with no lock, so an
    // approval committing between that read and the destroy was deleted
    // anyway: the refusal below checked a status that was no longer true.
    // Under the lock, a concurrent approval either commits first (and this
    // read, which waits for it, sees "approved") or waits for this delete.
    // The static Transaction.LOCK is the same constant as transaction.LOCK.
    const outcome = await db.transaction(async (transaction) => {
      const certificate = await Certificate.findOne({
        where: { id: certificateId, tenantId },
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });

      if (!certificate) {
        return null;
      }

      // Only a draft or a certificate pending approval may be deleted (A-130,
      // ADR-051 A-107; until then only `signed` was refused, so a revoked
      // certificate could be deleted and its public verification then answered
      // "no certificate matches" — F-11). A-92: a state conflict, so 409 with
      // the state and the way forward — not a 400. Thrown, not returned: the
      // controller renders a returned result through success(), which would
      // have sent `success: true` with the 409.
      if (Object.prototype.hasOwnProperty.call(DELETE_REFUSAL_EXPLANATIONS, certificate.status as string)) {
        throw new AppError(409, DELETE_REFUSAL_EXPLANATIONS[certificate.status as string]);
      }

      await certificate.destroy({ transaction });
      // D-22 (ADR-070): its attachments go with it, in this transaction.
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: a lazy require (see the file header)
      await (require("./attachment.service") as typeof AttachmentService).softDeleteForResource(
        tenantId,
        "Certificate",
        certificate.id,
        { transaction, actor },
      );
      await auditCertificate(transaction, certificate, {
        tenantId,
        principal: actor,
        action: "DELETE",
        operation: "DELETE",
        before: { status: certificate.status },
        after: { deleted: true },
      });
      return certificate;
    });

    if (!outcome) {
      return {
        success: false,
        status: 404,
        message: "Certificate not found",
        data: null,
      };
    }

    logger.info("Certificate deleted", {
      certificateId,
      tenantId,
    });

    return {
      success: true,
      status: 200,
      message: "Certificate deleted successfully",
      data: null,
    };
  } catch (error) {
    logger.error("Error deleting certificate", {
      error: messageOf(error),
    });
    throw error;
  }
};

/** One status transition, as runTransition runs it. */
interface TransitionParams {
  tenantId: TenantId;
  certificateId: string;
  transition: TransitionName;
  /** who re-authenticates, or null for a transition that is not a signature */
  reauth: { userId: UserId; authOptions: AuthOptions } | null;
  /** the state change, on the LOCKED row */
  mutate: (transaction: SqlTransaction, certificate: CertificateRow, previousStatus: CertificateRow["status"]) => Promise<void>;
  /** a further refusal, checked after the status and BEFORE re-authentication */
  guard?: (transaction: SqlTransaction, certificate: CertificateRow) => Promise<void>;
}

/**
 * A-167 — run one status transition: lock the certificate inside the
 * transaction (lockCertificate), refuse a transition its current status does
 * not allow (409, explained), re-authenticate when the transition is a
 * signature, then apply `mutate` to the LOCKED row. Everything, audit row
 * included, commits together or not at all.
 *
 * Re-authentication runs inside the transaction and after the status check:
 * a refused transition then consumes no one-time MFA code, and the check
 * still comes BEFORE the state change it authorises (Part 11). With CLS on,
 * a consumed MFA code (users.mfa_last_used_step) commits or rolls back with
 * the transition it authorised; the password check writes nothing.
 *
 * @returns the transitioned certificate, or null (404)
 * @throws {AppError} 409 with the state explanation; 400/401 from re-auth
 */
const runTransition = ({ tenantId, certificateId, transition, reauth, mutate, guard }: TransitionParams): Promise<CertificateRow | null> =>
  db.transaction(async (transaction) => {
    const certificate = await lockCertificate(tenantId, certificateId, transaction);
    if (!certificate) {
      return null;
    }

    const refusal = explainRefusedTransition(certificate.status, transition);
    if (refusal) {
      throw new AppError(409, refusal);
    }
    if (guard) {
      await guard(transaction, certificate);
    }

    if (reauth) {
      await verifySignatureAuth(reauth.userId, reauth.authOptions, {
        tenantId,
        resourceType: "Certificate",
        resourceId: certificateId,
        operation: transition,
      });
    }

    await mutate(transaction, certificate, certificate.status);
    return certificate;
  });

/**
 * A-203 (ADR-065) — the workflow is mandatory once it has started: a
 * certificate whose approval workflow is PENDING is approved through that
 * workflow (where every step's approver re-authenticates, A-182), never
 * directly. The direct route stays for a tenant with no workflow configured.
 * Checked under the certificate's row lock, before re-authentication, so a
 * refusal consumes no one-time MFA code.
 */
const refuseWhileWorkflowPending = async (transaction: SqlTransaction, certificate: CertificateRow): Promise<void> => {
  const pending = await workflowService().findPendingInstance(
    certificate.tenantId,
    "Certificate",
    certificate.id,
    transaction,
  );
  if (pending) {
    throw new AppError(
      409,
      `This certificate is in its approval workflow "${pending.workflow.name}" (step ` +
        `${String(pending.currentStepOrder)}) and is approved there, not directly: act on it with ` +
        "POST /workflows/instances/:instanceId/action. Nothing was recorded.",
    );
  }
};

/**
 * Approve a certificate (move from pending_approval to approved)
 */
const approveCertificate = async (
  tenantId: TenantId,
  certificateId: string,
  approvedBy: UserId,
  authOptions: AuthOptions,
): Promise<Outcome<CertificateRow | null>> => {
  try {
    const certificate = await runTransition({
      tenantId,
      certificateId,
      transition: "approved",
      guard: async (transaction, locked) => {
        // ADR-101 — the author may not approve; checked before the workflow
        // rule and before re-authentication, so nothing is consumed or written.
        refuseSelfApproval(locked, approvedBy);
        await refuseWhileWorkflowPending(transaction, locked);
      },
      // Re-authenticate BEFORE mutating: the signature authorises the approval.
      reauth: { userId: approvedBy, authOptions },
      mutate: async (transaction, locked, previousStatus) => {
        await locked.approve({ transaction });
        locked.approvedBy = approvedBy;
        locked.issueDate = new Date();
        await locked.save({ transaction });

        // Logged after the save so the hash captures the approved state.
        await logSignature(tenantId, locked, approvedBy, "approve", authOptions, transaction);

        await auditCertificate(transaction, locked, {
          tenantId,
          userId: approvedBy,
          action: "APPROVE",
          operation: "APPROVE",
          before: { status: previousStatus },
          after: { status: locked.status, approvedBy, meaning: authOptions.meaning },
          ipAddress: authOptions.ipAddress,
          userAgent: authOptions.userAgent,
        });
        // A-11: announced only after this transaction commits.
        webhookService.emitAfterCommit(transaction, tenantId, WEBHOOK_EVENTS.CERTIFICATE_APPROVED, {
          certificateId: locked.id, certificateNumber: locked.certificateNumber, deviceId: locked.deviceId, status: locked.status, approvedBy,
        });
      },
    });

    if (!certificate) {
      return CERTIFICATE_NOT_FOUND;
    }

    logger.info("Certificate approved", {
      certificateId,
      certificateNumber: certificate.certificateNumber,
      approvedBy,
      tenantId,
    });

    return {
      success: true,
      status: 200,
      message: "Certificate approved successfully",
      data: certificate,
    };
  } catch (error) {
    logger.error("Error approving certificate", {
      error: messageOf(error),
    });
    throw error;
  }
};

/**
 * A-182 — why a workflow REJECTION is refused (409), keyed by the statuses that
 * refuse it. A rejection returns a certificate to `draft` for its author to
 * rework; that is only meaningful before it is approved. It used to reset the
 * certificate to `draft` from ANY state — including an approved, signed or
 * revoked one, silently un-issuing a signed record.
 */
const WORKFLOW_REJECTION_REFUSALS: Record<string, string | undefined> = {
  approved:
    "its approval is a signed record and a workflow rejection cannot undo it; " +
    "revoke it with POST /certificates/:id/revoke instead",
  signed:
    "a signed certificate is a controlled record and a workflow rejection cannot undo it; " +
    "revoke it with POST /certificates/:id/revoke instead",
  revoked: "revocation is final; issue a new certificate instead",
};

/** A-182 — the certificate a workflow instance decides on was deleted after the workflow started. */
const WORKFLOW_TARGET_GONE =
  "The certificate this workflow decides on no longer exists (it was deleted), so it can be " +
  "neither approved nor rejected. Nothing was recorded.";

/**
 * A-182 — lock the certificate a workflow decision acts on, INSIDE the
 * decision's transaction (SELECT ... FOR UPDATE, as runTransition does), and
 * refuse a decision its current status does not allow: 409 with the state
 * explanation. Called BEFORE re-authentication, so a refused decision consumes
 * no one-time MFA code.
 *
 * - `approve`: the certificate state machine's own rule (ADR-035) — only a
 *   `pending_approval` certificate can be approved. The workflow used to set
 *   APPROVED from any status, a draft included.
 * - `reject`: only a `draft` or `pending_approval` certificate.
 *
 * @param transaction - the workflow decision's transaction
 * @param tenantId
 * @param certificateId - the workflow instance's resourceId
 * @param decision
 * @returns the locked certificate
 * @throws {AppError} 409 with the state explanation, or when the certificate is gone
 */
const lockForWorkflowDecision = async (
  transaction: SqlTransaction,
  tenantId: TenantId,
  certificateId: string,
  decision: "approve" | "reject",
): Promise<CertificateRow> => {
  const certificate = await lockCertificate(tenantId, certificateId, transaction);
  if (!certificate) {
    throw new AppError(409, WORKFLOW_TARGET_GONE);
  }
  const refusal =
    decision === "approve"
      ? explainRefusedTransition(certificate.status, "approved")
      : WORKFLOW_REJECTION_REFUSALS[certificate.status as string] &&
        `This certificate is "${String(certificate.status)}" and cannot be rejected: ` +
          `${String(WORKFLOW_REJECTION_REFUSALS[certificate.status as string])}.`;
  if (refusal) {
    throw new AppError(409, refusal);
  }
  return certificate;
};

/**
 * A-182 — apply a workflow's FINAL approval to the certificate locked by
 * lockForWorkflowDecision, exactly as POST /certificates/:id/approve does:
 * the transition, the approver (the re-authenticated caller — never a body
 * field, A-62), the Part 11 ESignatureRecord, the audit row and the webhook,
 * all in the workflow decision's transaction.
 *
 * The caller must already have re-authenticated `approverId`
 * (verifySignatureAuth) inside that transaction.
 *
 * The workflow path used to write `approvedById` and `approvedAt`, neither of
 * which is a Certificate attribute (the column is `approvedBy`), so a
 * workflow-approved certificate recorded no approver at all (A-200).
 *
 * @param transaction
 * @param certificate - locked, status `pending_approval`
 * @param params - tenantId; approverId (the authenticated caller); authOptions
 *   (authMethod, authPayload, meaning, ipAddress, userAgent); workflowInstanceId
 *   (recorded in the audit row)
 */
const applyWorkflowApproval = async (
  transaction: SqlTransaction,
  certificate: CertificateRow,
  { tenantId, approverId, authOptions, workflowInstanceId }: {
    tenantId: TenantId;
    approverId: UserId;
    authOptions: AuthOptions;
    workflowInstanceId: string;
  },
): Promise<void> => {
  const previousStatus = certificate.status;
  await certificate.approve({ transaction });
  certificate.approvedBy = approverId;
  certificate.issueDate = new Date();
  await certificate.save({ transaction });

  await logSignature(tenantId, certificate, approverId, "approve", authOptions, transaction);

  await auditCertificate(transaction, certificate, {
    tenantId,
    userId: approverId,
    action: "APPROVE",
    operation: "APPROVE",
    before: { status: previousStatus },
    after: {
      status: certificate.status,
      approvedBy: approverId,
      meaning: authOptions.meaning,
      workflowInstanceId,
    },
    ipAddress: authOptions.ipAddress,
    userAgent: authOptions.userAgent,
  });
  webhookService.emitAfterCommit(transaction, tenantId, WEBHOOK_EVENTS.CERTIFICATE_APPROVED, {
    certificateId: certificate.id,
    certificateNumber: certificate.certificateNumber,
    deviceId: certificate.deviceId,
    status: certificate.status,
    approvedBy: approverId,
  });
};

/**
 * A-182 — apply a workflow REJECTION to the certificate locked by
 * lockForWorkflowDecision: a `pending_approval` certificate returns to
 * `draft` for rework, with its own audit row in the decision's transaction.
 * A `draft` is left as it is — nothing about the certificate changes, and
 * the workflow instance's own audit row records the rejection.
 *
 * @param transaction
 * @param certificate - locked, status `draft` or `pending_approval`
 * @param params - tenantId; userId (the rejecting caller); workflowInstanceId; comments
 */
const applyWorkflowRejection = async (
  transaction: SqlTransaction,
  certificate: CertificateRow,
  { tenantId, userId, workflowInstanceId, comments }: {
    tenantId: TenantId;
    userId: UserId;
    workflowInstanceId: string;
    comments?: string | null;
  },
): Promise<void> => {
  if (certificate.status !== "pending_approval") {
    return;
  }
  certificate.status = "draft";
  await certificate.save({ transaction });
  await auditCertificate(transaction, certificate, {
    tenantId,
    userId,
    action: "UPDATE",
    operation: "WORKFLOW_REJECT",
    before: { status: "pending_approval" },
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: empty comments are none (ADR-038 rule 3)
    after: { status: "draft", workflowInstanceId, comments: comments || null },
  });
};

/**
 * A-182 — the workflow decision's re-authentication: the same check, and the
 * same SIGNATURE_AUTH_FAILED row on a wrong credential, as every other
 * certificate signature (verifySignatureAuth).
 */
const verifyWorkflowApprovalAuth = (userId: UserId, authOptions: AuthOptions, context: SignatureContext): Promise<void> =>
  verifySignatureAuth(userId, authOptions, context);

/**
 * Submit a DRAFT certificate for approval (DRAFT -> PENDING_APPROVAL) so it can
 * then be approved. Without this transition, approve() is unreachable and 500s.
 */
const submitCertificateForApproval = async (
  tenantId: TenantId,
  certificateId: string,
  actor: AuditActorInput = {},
): Promise<Outcome<CertificateRow | null>> => {
  const certificate = await runTransition({
    tenantId,
    certificateId,
    transition: "submitted",
    reauth: null,
    mutate: async (transaction, locked, previousStatus) => {
      // ADR-101 — the submitter is recorded so it cannot also approve. Set
      // before submitForApproval(), whose save() writes it with the status.
      // An API key has no user id (A-282): the column, an FK to users, stays
      // null, and the approval guard falls back to createdBy.
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty id is none (ADR-038 rule 3)
      locked.submittedBy = (actor.userId || null) as UserId | null;
      await locked.submitForApproval({ transaction });
      // A-203 (ADR-065) — a certificate re-submitted after its workflow
      // rejected it goes through the chain again: a new instance starts, in
      // this transaction. Without it the rejected instance was the last word,
      // and the re-submitted certificate could be approved directly.
      const workflow = workflowService();
      const pending = await workflow.findPendingInstance(tenantId, "Certificate", locked.id, transaction);
      const instance =
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built (ADR-038 rule 3)
        pending || (await workflow.startWorkflow(tenantId, "Certificate", locked.id, transaction));
      await auditCertificate(transaction, locked, {
        tenantId,
        principal: actor,
        action: "UPDATE",
        operation: "SUBMIT_FOR_APPROVAL",
        before: { status: previousStatus },
        after: {
          status: locked.status,
          submittedBy: locked.submittedBy,
          workflowInstanceId: instance ? instance.id : null,
        },
      });
    },
  });

  if (!certificate) {
    return CERTIFICATE_NOT_FOUND;
  }

  logger.info("Certificate submitted for approval", {
    certificateId,
    certificateNumber: certificate.certificateNumber,
    tenantId,
  });

  return {
    success: true,
    status: 200,
    message: "Certificate submitted for approval",
    data: certificate,
  };
};

/**
 * Sign a certificate digitally.
 *
 * A-167 — only an approved certificate can be signed. The model's sign()
 * refused anything else with a plain Error, which answered 500; the refusal
 * is now a 409 with the state explanation, decided under the row lock.
 */
const signCertificate = async (
  tenantId: TenantId,
  certificateId: string,
  signatureData: string,
  keyId: string,
  signedBy: UserId,
  authOptions: AuthOptions,
): Promise<Outcome<CertificateRow | null>> => {
  try {
    const certificate = await runTransition({
      tenantId,
      certificateId,
      transition: "signed",
      // Re-authenticate BEFORE mutating: the signature authorises the signing.
      reauth: { userId: signedBy, authOptions },
      mutate: async (transaction, locked, previousStatus) => {
        await locked.sign(signatureData, keyId, { transaction });
        locked.signedBy = signedBy;
        // ADR-107 (Q-50, ISO/IEC 17025 7.8): what the certificate prints —
        // issuer name/address/contact, instrument, people — is fixed HERE, as
        // it stands at signing, and bound by the v3 hash. Read in this
        // transaction, after the signer is set; written by the same save.
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: a lazy require (see the file header)
        locked.signedSnapshot = await (require("./certificateDocument.service") as typeof CertificateDocumentService).captureSignedSnapshot(
          locked,
          transaction,
        );
        await locked.save({ transaction });

        // Logged after the save so the hash captures the signed state.
        await logSignature(tenantId, locked, signedBy, "sign", authOptions, transaction);

        // A signature is a decision, not a field change: APPROVE, with the
        // operation named (audit_logs.action has no SIGN member).
        await auditCertificate(transaction, locked, {
          tenantId,
          userId: signedBy,
          action: "APPROVE",
          operation: "SIGN",
          before: { status: previousStatus },
          after: { status: locked.status, signedBy, keyId, meaning: authOptions.meaning },
          ipAddress: authOptions.ipAddress,
          userAgent: authOptions.userAgent,
        });
        // A-11: announced only after this transaction commits.
        webhookService.emitAfterCommit(transaction, tenantId, WEBHOOK_EVENTS.CERTIFICATE_SIGNED, {
          certificateId: locked.id, certificateNumber: locked.certificateNumber, deviceId: locked.deviceId, status: locked.status, signedBy,
        });
      },
    });

    if (!certificate) {
      return CERTIFICATE_NOT_FOUND;
    }

    logger.info("Certificate signed", {
      certificateId,
      certificateNumber: certificate.certificateNumber,
      signedBy,
      tenantId,
    });

    return {
      success: true,
      status: 200,
      message: "Certificate signed successfully",
      data: certificate,
    };
  } catch (error) {
    logger.error("Error signing certificate", {
      error: messageOf(error),
    });
    throw error;
  }
};

/**
 * Revoke a certificate.
 *
 * A-167 — revoking a revoked certificate is a 409. The model's revoke()
 * returned silently for it, and this then wrote a second REVOKE signature
 * record and audit row for a revocation that did not happen.
 */
const revokeCertificate = async (
  tenantId: TenantId,
  certificateId: string,
  reason: string,
  revokedBy: UserId,
  authOptions: AuthOptions,
): Promise<Outcome<CertificateRow | null>> => {
  try {
    const certificate = await runTransition({
      tenantId,
      certificateId,
      transition: "revoked",
      // Re-authenticate BEFORE mutating: the signature authorises the revocation.
      reauth: { userId: revokedBy, authOptions },
      mutate: async (transaction, locked, previousStatus) => {
        await locked.revoke(reason, { transaction });

        // Logged after the mutation so the hash captures the revoked state.
        await logSignature(tenantId, locked, revokedBy, "revoke", authOptions, transaction);

        // No REVOKE member in audit_logs.action: UPDATE, with the operation named.
        await auditCertificate(transaction, locked, {
          tenantId,
          userId: revokedBy,
          action: "UPDATE",
          operation: "REVOKE",
          before: { status: previousStatus },
          after: { status: locked.status, reason },
          ipAddress: authOptions.ipAddress,
          userAgent: authOptions.userAgent,
        });
        // A-11: announced only after this transaction commits.
        webhookService.emitAfterCommit(transaction, tenantId, WEBHOOK_EVENTS.CERTIFICATE_REVOKED, {
          certificateId: locked.id, certificateNumber: locked.certificateNumber, deviceId: locked.deviceId, status: locked.status, revokedBy,
        });
      },
    });

    if (!certificate) {
      return CERTIFICATE_NOT_FOUND;
    }

    logger.info("Certificate revoked", {
      certificateId,
      certificateNumber: certificate.certificateNumber,
      reason,
      revokedBy,
      tenantId,
    });

    return {
      success: true,
      status: 200,
      message: "Certificate revoked successfully",
      data: certificate,
    };
  } catch (error) {
    logger.error("Error revoking certificate", {
      error: messageOf(error),
    });
    throw error;
  }
};

/** The certificate statistics of a tenant. */
interface CertificateStats {
  totalCertificates: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  latestCertificate: CertificateRow | null;
}

/**
 * Get certificate statistics for a tenant
 */
const getCertificateStats = async (tenantId: TenantId): Promise<Outcome<CertificateStats>> => {
  try {
    const totalCertificates = await Certificate.count({ where: { tenantId } });
    const byStatus = await Certificate.countByStatus(tenantId, {
      Certificate,
      Sequelize: SequelizeWithOp,
    });

    // Get certificates by type
    const byTypeResult = (await Certificate.findAll({
      where: { tenantId },
      attributes: [
        "type",
        [
          /* eslint-disable @typescript-eslint/no-require-imports -- as built: `sequelize` required here, at call time, twice */
          (require("sequelize") as typeof SequelizeModule).fn("COUNT", (require("sequelize") as typeof SequelizeModule).col("id")),
          /* eslint-enable @typescript-eslint/no-require-imports */
          "count",
        ],
      ],
      group: ["type"],
      raw: true,
    })) as unknown as { type: string; count: string }[];

    const byType = byTypeResult.reduce<Record<string, number>>((acc, row) => {
      acc[row.type] = parseInt(row.count, 10);
      return acc;
    }, {});

    // Get latest certificate
    const latestCertificate = await Certificate.findOne({
      where: { tenantId },
      order: [["issueDate", "DESC"]],
      include: [
        {
          association: "device",
          attributes: ["id", "name", "serialNumber"],
          // A-109: LEFT. CalibrationDevice's defaultScope made this an
          // implicit INNER JOIN, so when the newest certificate's device was
          // soft-deleted (or foreign), "latest certificate" silently became
          // an older one — or null.
          required: false,
        },
      ],
    });

    return {
      success: true,
      status: 200,
      message: "Certificate statistics retrieved successfully",
      data: {
        totalCertificates,
        byStatus,
        byType,
        latestCertificate,
      },
    };
  } catch (error) {
    logger.error("Error fetching certificate statistics", {
      error: messageOf(error),
    });
    throw error;
  }
};

export = {
  isAuthorOf,
  SELF_APPROVAL_REFUSAL,
  refuseSelfApprovalInWorkflow,
  verifySignerCredentials,
  fetchCertificates,
  fetchSpecificCertificate,
  createCertificate,
  updateCertificate,
  deleteCertificate,
  approveCertificate,
  lockForWorkflowDecision,
  applyWorkflowApproval,
  applyWorkflowRejection,
  verifyWorkflowApprovalAuth,
  submitCertificateForApproval,
  signCertificate,
  revokeCertificate,
  getCertificateStats,
};
