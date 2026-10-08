/**
 * The field app's administrator wipe, recorded (P21-03c; P19-08 spec § 11.3, G-O9; ADR-135: the
 * app sends this FIRST and deletes only after the audit row exists, so no offline evidence is
 * destroyed without its record).
 *
 * The wiped user must be a user of the caller's tenant, loaded in context (another tenant's, or a
 * missing one, is the same 404). Only counts are recorded — what the phone held, never its content.
 *
 * Named exports only (ADR-087 Am. 15).
 */
import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import { AppError } from "../utils/appError.util";
import { auditEntryActor, type AuditActorInput } from "../utils/auditPrincipal.util";
import type { FieldWipe } from "@callibrator/contracts/inspectionSessions";
import type { TenantId } from "../types/ids";

/** The wipe as recorded. */
export interface FieldWipeRecord {
  readonly wipedUserId: string;
  readonly captures: number;
  readonly photos: number;
  readonly recordedAt: string;
}

/**
 * `POST /field/wipes` — one audit row (`DELETE`, resource `User`, `FIELD_DATA_WIPED`).
 *
 * @param tenantId - the caller's tenant
 * @param input - the validated body
 * @param actor - the administrator
 * @returns the wipe as recorded
 */
export const recordFieldWipe = async (tenantId: TenantId, input: FieldWipe, actor: AuditActorInput): Promise<FieldWipeRecord> => {
  const user = await models.User.unscoped().findOne({ where: { id: input.wipedUserId, tenantId }, attributes: ["id"] });
  if (!user) {
    throw new AppError(404, "User not found");
  }
  const recordedAt = new Date();
  await db.transaction(async (transaction) => {
    await auditService.logAction(
      {
        tenantId,
        ...auditEntryActor(actor),
        action: "DELETE",
        resourceType: "User",
        resourceId: user.id,
        changes: { operation: "FIELD_DATA_WIPED", captures: input.captures, photos: input.photos },
      },
      { transaction },
    );
  });
  return { wipedUserId: user.id, captures: input.captures, photos: input.photos, recordedAt: recordedAt.toISOString() };
};
