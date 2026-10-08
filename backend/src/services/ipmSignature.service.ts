/**
 * P21-04 — the electronic signatures of an IPM report: the performer's (authorship) and the IPSRS
 * countersignature (review) (ADR-126 Amendment 2 § 5 – § 8, Amendment 5; spec
 * MEMORY/specs/P19-06-ipm-report-document.md § 7, § 8, § 13, § 14).
 *
 * UD-17 IS A WORKING DECISION (2026-10-08): the countersignature is offered only where the tenant
 * switched on `ipm_countersign_enabled` (unset = off — ipmSettings.service), so switching it off
 * (or never on) is the reversal; an existing countersignature is never hidden, and nothing is ever
 * gated by a signature (the record is complete at submit).
 *
 * `POST /ipm/sessions/:sessionId/signatures`, online only (a credential is never in the outbox):
 *  1. the session is loaded IN CONTEXT (another tenant's or another facility's is the 404 a missing
 *     id gets) and locked FOR SHARE;
 *  2. the rules of § 7.1, in the table's order, each refusal a top-level `code` and its explanation:
 *     the state (`IPM_NOT_SUBMITTED`, `IPM_VOIDED`, `IPM_SUPERSEDED` + `headId`, `IPM_REPORT_IMPORTED`),
 *     then — performer — `IPM_SIGNATURE_NOT_PERFORMER` (403), `IPM_ALREADY_SIGNED`; — countersign —
 *     `IPM_COUNTERSIGN_SOD`, `IPM_COUNTERSIGN_ROLE`, `IPM_COUNTERSIGN_FACILITY` (403s),
 *     `IPM_COUNTERSIGN_DISABLED`, `IPM_REPORT_NOT_SIGNED`, `IPM_ALREADY_COUNTERSIGNED` (409s);
 *  3. the credential, re-entered now, through certificate.service#verifySignerCredentials (Part 11
 *     § 11.200 (a); a wrong one is the existing 401 with its `SIGNATURE_AUTH_FAILED` row);
 *  4. the content hash recomputed (a mismatch → 409 `IPM_REPORT_INTEGRITY`, logged and counted);
 *  5. the signature row (`document_hash` = the stored hash, the signer snapshot — name, role,
 *     organisation only, FT-15) and its audit row, in one transaction — the 0127 trigger is the floor;
 *  6. a performer's signature with countersigning on notifies the facility's bound IPSRS (AM-21);
 *     after the commit `ipm:signed` goes to the tenant room and the session's facility room (AM-19).
 *
 * `e_signature_records` is NOT written for an IPM (G-R6): it is provider-internal. Named exports only.
 */
import { UniqueConstraintError, type Transaction } from "sequelize";
import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import certificateService from "./certificate.service";
import notificationService from "./notification.service";
import { displayPeople } from "./personDisplay.service";
import type { PersonDisplay } from "@callibrator/contracts/people";
import { recipientsFor } from "./notificationRecipients";
import { emitForRow } from "./realtime";
import { ipmSettingsOf } from "./ipmSettings.service";
import { checkIntegrity, orNull } from "./ipmReport.service";
import { conflict, day, facilityBound, headOf } from "./ipmSession.service";
import { AppError } from "../utils/appError.util";
import { CodedError } from "../utils/codedError.util";
import { auditEntryActor, type AuditActorInput } from "../utils/auditPrincipal.util";
import { ROLE_NAMES } from "../constants";
import type { IpmSignatureRefusal, IpmSignature } from "@callibrator/contracts/ipmReport";
import type { InspectionSignatureKind } from "@callibrator/contracts/inspectionValues";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

type SessionRow = ModelInstance<"InspectionSession">;

const SESSION_NOT_FOUND = "IPM session not found";
const RESOURCE = "InspectionSession";

/** Who signs: the person and the request's address and agent (stored on the row, never returned). Its role is read from the user row. */
export interface IpmSigner extends AuditActorInput {
  readonly userId: string | null;
}

const refuse = (code: IpmSignatureRefusal, message: string): CodedError => new CodedError(403, code, message);

/** The state rules every signature shares (§ 7.1, § 7.4): an issued, effective, captured report. */
const assertSignable = async (session: SessionRow, transaction: Transaction): Promise<void> => {
  if (session.status === "draft" || session.status === "discarded") {
    throw conflict("IPM_NOT_SUBMITTED", "Only a submitted IPM report can be signed.");
  }
  if (session.status === "voided") {
    throw conflict("IPM_VOIDED", `This IPM was voided on ${day(session.voidedAt)}; a voided report is never signed.`);
  }
  if (session.supersededById) {
    const head = await headOf(session, transaction);
    throw conflict("IPM_SUPERSEDED", `This IPM was corrected on ${day(session.supersededAt)}; sign the latest version (report ${head.reportNumber ?? "pending"}).`, {
      headId: head.id,
    });
  }
  if (session.legacyKey) {
    throw conflict("IPM_REPORT_IMPORTED", "This report was imported from the previous system; imported reports are not signed electronically.");
  }
};

/** The performer's own rules (§ 7.1 row 1). */
const assertPerformer = (session: SessionRow, userId: string, existing: ReadonlySet<InspectionSignatureKind>): void => {
  if (session.performedBy !== userId) {
    throw refuse("IPM_SIGNATURE_NOT_PERFORMER", "Only the technician who performed this IPM can sign its report.");
  }
  if (existing.has("performer")) {
    throw conflict("IPM_ALREADY_SIGNED", "The technician has already signed this report.");
  }
};

/** The IPSRS countersignature's rules (§ 7.1 row 2), in the table's order. */
const assertCountersigner = async (
  session: SessionRow,
  signer: { userId: string; role: string | null },
  existing: ReadonlySet<InspectionSignatureKind>,
  countersignEnabled: boolean,
  transaction: Transaction,
): Promise<void> => {
  if (signer.userId === session.submittedBy || signer.userId === session.performedBy) {
    throw refuse("IPM_COUNTERSIGN_SOD", "The technician who performed and submitted this IPM cannot countersign it; another person must review it.");
  }
  if (signer.role !== ROLE_NAMES.FACILITY_MAINTENANCE) {
    throw refuse("IPM_COUNTERSIGN_ROLE", "Only the facility's IPSRS (FACILITY MAINTENANCE) can countersign an IPM report.");
  }
  if (!facilityBound()) {
    const facility = await models.ClientFacility.findOne({ where: { id: session.clientFacilityId }, attributes: ["id", "isSelf"], transaction });
    if (!facility?.isSelf) {
      throw refuse("IPM_COUNTERSIGN_FACILITY", "Provider staff cannot countersign for a client facility; the facility's own IPSRS countersigns.");
    }
  }
  if (!countersignEnabled) {
    throw conflict("IPM_COUNTERSIGN_DISABLED", "Electronic countersigning is switched off for this tenant; the IPSRS signs the printed report instead.");
  }
  if (!existing.has("performer")) {
    throw conflict("IPM_REPORT_NOT_SIGNED", "The technician has not signed this report yet; it can be countersigned after the technician's signature.");
  }
  if (existing.has("countersign")) {
    throw conflict("IPM_ALREADY_COUNTERSIGNED", "This report has already been countersigned.");
  }
};

/** The facility's bound IPSRS who may countersign (AM-21) — never another facility's users. */
const notifyCountersigners = async (tenantId: TenantId, session: SessionRow, signer: IpmSigner, transaction: Transaction): Promise<void> => {
  const audience = await recipientsFor({ tenantId, clientFacilityId: session.clientFacilityId }, "esignature", { transaction });
  const ipsrs = audience.boundUserIds.length
    ? (
      await models.User.findAll({
        where: { id: audience.boundUserIds },
        attributes: ["id", "roleId"],
        include: [{ model: models.Roles, as: "role", attributes: ["name"], required: false }],
        transaction,
      })
    ).filter((u) => (u as unknown as { role?: { name?: string } | null }).role?.name === ROLE_NAMES.FACILITY_MAINTENANCE)
    : [];
  for (const user of ipsrs) {
    const notification = await notificationService.emitNotification(
      {
        tenantId,
        userId: user.id,
        type: "MAINTENANCE",
        title: "IPM report awaits your countersignature",
        message: `IPM report ${String(session.reportNumber)} awaits your countersignature.`,
        actionUrl: `/dashboard/ipm/sessions/${session.id}/report`,
      },
      { transaction },
    );
    await auditService.logAction(
      {
        tenantId,
        ...auditEntryActor(signer),
        action: "CREATE",
        resourceType: "Notification",
        resourceId: (notification as { id: string }).id,
        clientFacilityId: session.clientFacilityId,
        changes: { operation: "IPM_COUNTERSIGN_NOTICE", audience: "facility-user", sessionId: session.id },
      },
      { transaction },
    );
  }
};

/**
 * `POST /ipm/sessions/:sessionId/signatures` — sign an issued IPM report (§ 7.2).
 *
 * @param tenantId - the caller's tenant
 * @param input - the validated params + body (kind, method, credential, the meaning acknowledged)
 * @param signer - the person, its role, the request's address and agent
 * @returns the signature as the document prints it
 */
export const signReport = async (tenantId: TenantId, input: IpmSignature, signer: IpmSigner): Promise<Record<string, unknown>> => {
  if (!signer.userId) {
    throw new AppError(403, "An IPM report is signed by a person, not by an API key.");
  }
  const userId = signer.userId;
  const result = await db.transaction(async (transaction) => {
    const session = await models.InspectionSession.findOne({ where: { id: input.sessionId }, transaction, lock: transaction.LOCK.SHARE });
    if (!session) {
      throw new AppError(404, SESSION_NOT_FOUND);
    }
    await assertSignable(session, transaction);
    const existing = new Set(
      (await models.InspectionSessionSignature.findAll({ where: { sessionId: session.id }, attributes: ["id", "kind"], transaction })).map((s) => s.kind),
    );
    const settings = await ipmSettingsOf(tenantId, { transaction });
    // The signer as printed — and its role, from its own user row (never from the request): displayPeople answers every id.
    const person = (await displayPeople([userId])).get(userId) as PersonDisplay;
    if (input.kind === "performer") {
      assertPerformer(session, userId, existing);
    } else {
      await assertCountersigner(session, { userId, role: person.role }, existing, settings.countersignEnabled, transaction);
    }
    const operation = input.kind === "performer" ? "SIGN_IPM_REPORT" : "COUNTERSIGN_IPM_REPORT";
    await certificateService.verifySignerCredentials(userId as UserId, input.authMethod, input.authPayload, {
      tenantId,
      resourceType: RESOURCE,
      resourceId: session.id,
      operation,
      ipAddress: orNull(signer.ipAddress),
      userAgent: orNull(signer.userAgent),
    });
    const { integrity } = await checkIntegrity(session, transaction);
    if (integrity.state === "mismatch") {
      throw conflict("IPM_REPORT_INTEGRITY", "This report failed its integrity check and cannot be signed. The operator has been alerted.");
    }
    let row: ModelInstance<"InspectionSessionSignature">;
    try {
      row = await models.InspectionSessionSignature.create(
        {
          tenantId,
          clientFacilityId: session.clientFacilityId,
          sessionId: session.id,
          kind: input.kind,
          signerId: userId as UserId,
          signerSnapshot: { name: person.name ?? "Unnamed user", role: person.role, organisation: person.organisation },
          meaning: input.kind === "performer" ? "authorship" : "review",
          authMethod: input.authMethod,
          documentHash: session.reportContentHash as string,
          signedAt: new Date(),
          ipAddress: orNull(signer.ipAddress),
          userAgent: signer.userAgent ? signer.userAgent.slice(0, 500) : null,
        },
        { transaction },
      );
    } catch (err) {
      if (err instanceof UniqueConstraintError) {
        throw input.kind === "performer"
          ? conflict("IPM_ALREADY_SIGNED", "The technician has already signed this report.")
          : conflict("IPM_ALREADY_COUNTERSIGNED", "This report has already been countersigned.");
      }
      throw err;
    }
    await auditService.logAction(
      {
        tenantId,
        ...auditEntryActor(signer),
        action: "APPROVE",
        resourceType: RESOURCE,
        resourceId: session.id,
        clientFacilityId: session.clientFacilityId,
        changes: { operation, kind: input.kind, reportNumber: session.reportNumber, documentHash: row.documentHash, authMethod: input.authMethod },
      },
      { transaction },
    );
    if (input.kind === "performer" && settings.countersignEnabled) {
      await notifyCountersigners(tenantId, session, signer, transaction);
    }
    return { session, row };
  });
  emitForRow(result.session, "ipm:signed", { sessionId: result.session.id, kind: result.row.kind });
  const { row } = result;
  return {
    kind: row.kind,
    name: row.signerSnapshot.name,
    role: row.signerSnapshot.role,
    organisation: row.signerSnapshot.organisation,
    meaning: row.meaning,
    signedAt: row.signedAt.toISOString(),
    authMethod: row.authMethod,
    valid: true,
  };
};
