/**
 * P21-04 — the IPM session's submit, the correction's submit and the void, with the report's
 * issuance and the recommendation's side effects, each in ONE transaction (ADR-126 § 3, Am. 1, Am. 2,
 * Am. 4, Am. 5; specs MEMORY/specs/P19-02-ipm-session-aggregate.md § 6, § 7.2, § 8, § 14 and
 * MEMORY/specs/P19-06-ipm-report-document.md § 5, § 6, § 14).
 *
 * UD-17 IS A WORKING DECISION (2026-10-08), not owner-confirmed. The recommendation's side effects
 * (`needs_repair` → a Repair work order, `not_fit_for_use` → device status `maintenance`,
 * `needs_calibration` → the calibration request flag) are switched per tenant by
 * `ipm_recommendation_side_effects` (unset = on; ipmSettings.service): with it off a submit records
 * the recommendation and does nothing else, and says so in `sideEffects.notices`. The Preventative
 * work order of a visit (UD-12) and the room confirmation (F-53) are not part of that switch.
 *
 * THE SUBMIT (root or correction), in this order inside one transaction (lock order device →
 * original → session, the same everywhere — spec § 6):
 *  1. the 404 / 409 / 403 / 400 of spec § 7.2, each 409 with its top-level `code`;
 *  2. the visit number (root: max + 1 over the device's issued roots; correction: the original's);
 *  3. the issuance (P19-06 § 5, § 6): the report number `IPM-<facility code>-<YYYYMMDD>-<NNN>` per
 *     tenant, facility and day (tenant zone) under an advisory lock, a 192-bit token, the issuer and
 *     the snapshots, and the content hash of scheme `ipm-report-v1`;
 *  4. the side effects (§ 8.1 for a root, the § 8.3 delta for a correction), each with its audit row;
 *  5. ONE UPDATE of the session to `submitted` with every issued field (0126's issued-fields CHECK),
 *     then — for a correction — the original's `superseded_by_id` / `superseded_at`;
 *  6. the submit's audit row (`APPROVE`, `SUBMIT_IPM` / `SUBMIT_IPM_CORRECTION`, with the report
 *     number, hash and scheme) and the idempotency key's completion.
 * After the commit: `ipm:submitted` to the tenant room and the session's facility room (AM-19).
 *
 * THE VOID (§ 7.2, § 8.4): the chain's head, by an UNBOUND tenant administrator (the route's rbac,
 * re-checked here — FT-37's two layers); the visit's Preventative order is cancelled and a calibration
 * request raised by any session of the chain is cleared; nothing else is reversed (the response's
 * `notices` say what to review).
 *
 * Named exports only.
 */
import { Op, type CreationAttributes, type Transaction } from "sequelize";
import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import notificationService from "./notification.service";
import { completeIdempotentRequest } from "./idempotency.service";
import { recipientsFor } from "./notificationRecipients";
import { emitForRow } from "./realtime";
import { ipmSettingsOf, type IpmSettings } from "./ipmSettings.service";
import { contentHash, issuerOf, newVerificationToken, pinnedItemsOf, reportPayload, reportResultOf, snapshotsFor } from "./ipmReport.service";
import {
  IPM_SESSION_RESOURCE,
  assertFacilityOpen,
  conflict,
  day,
  facilityBound,
  headOf,
  lockDevice,
  lockSession,
  personOf,
  sessionView,
  type IpmActor,
  type IpmWriteResult,
} from "./ipmSession.service";
import { AppError } from "../utils/appError.util";
import { auditEntryActor } from "../utils/auditPrincipal.util";
import { sql, type SqlRunner } from "../utils/sql.util";
import { compactDay, missingRequiredItems, zonedDay, type InspectionRecommendation } from "@callibrator/contracts/inspectionValues";
import { IPM_REPORT_SCHEME, ipmReportNumber, ipmReportReadOrder } from "@callibrator/contracts/ipmReport";
import type { IpmSessionSubmit, IpmSessionVoid } from "@callibrator/contracts/inspectionSessions";
import type { IpmSideEffects } from "../utils/jsonShape.util";
import type { TenantId } from "../types/ids";
import type { ModelInstance } from "../types/models";

type SessionRow = ModelInstance<"InspectionSession">;
type DeviceRow = ModelInstance<"CalibrationDevice">;
type WorkOrderRow = ModelInstance<"MaintenanceWorkOrder">;
type VersionRow = ModelInstance<"InspectionTemplateVersion">;

const SESSION_NOT_FOUND = "IPM session not found";
const WORK_ORDER = "MaintenanceWorkOrder";
const DEVICE = "CalibrationDevice";

/** The recommendation's printed label (`09` § 2.2 row 9), for a work order's title and description. */
const RECOMMENDATION_LABELS: Readonly<Record<InspectionRecommendation, string>> = Object.freeze({
  fit_for_use: "Device fit for use",
  needs_calibration: "Device needs calibration",
  not_fit_for_use: "Device not fit for use",
  needs_repair: "Device must be repaired",
});

/** One audit row of this module, in the caller's transaction, stamped with the session's facility. */
const auditRow = async (
  transaction: Transaction,
  tenantId: TenantId,
  actor: IpmActor,
  clientFacilityId: string,
  entry: { action: "CREATE" | "UPDATE" | "APPROVE" | "DELETE"; resourceType: string; resourceId: string; changes: Record<string, unknown> },
): Promise<void> => {
  await auditService.logAction(
    { tenantId, ...auditEntryActor(actor), action: entry.action, resourceType: entry.resourceType, resourceId: entry.resourceId, clientFacilityId, changes: entry.changes },
    { transaction },
  );
};

// ------------------------------------------------------------------
// NUMBERS (§ 6; P19-06 § 5)
// ------------------------------------------------------------------

/** The next visit number of a device: max + 1 over its issued roots (gaps after voids are evidence). */
const nextVisitNumber = async (deviceId: string, transaction: Transaction): Promise<number> => {
  const last = await models.InspectionSession.findOne({
    where: { deviceId, supersedesId: null, status: ["submitted", "voided"], visitNumber: { [Op.ne]: null } },
    attributes: ["id", "visitNumber"],
    order: [["visitNumber", "DESC"]],
    transaction,
  });
  return (last?.visitNumber ?? 0) + 1;
};

/**
 * The next report number of a facility's day (P19-06 § 5): serialised per tenant, facility code and
 * day by a transaction-scoped advisory lock (two facilities never contend), then max + 1 over the
 * tenant's numbers with that prefix.
 */
const nextReportNumber = async (tenantId: string, facilityCode: string, submittedAt: Date, timeZone: string, transaction: Transaction): Promise<string> => {
  const localDay = compactDay(zonedDay(submittedAt, timeZone));
  await sql(db as unknown as SqlRunner, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`ipm-report:${tenantId}:${facilityCode}:${localDay}`], { transaction });
  const prefix = `IPM-${facilityCode}-${localDay}-`;
  const taken = await models.InspectionSession.findAll({
    where: { reportNumber: { [Op.startsWith]: prefix } },
    attributes: ["id", "reportNumber"],
    // skipFacilityScope: a device moved away keeps its numbers; the sequence counts the tenant's whole day (FACILITY_SCOPE_SKIPS).
    skipFacilityScope: true,
    transaction,
  });
  const highest = taken.reduce((max, row) => {
    const tail = (row.reportNumber as string).slice(prefix.length);
    return /^\d+$/.test(tail) ? Math.max(max, Number(tail)) : max;
  }, 0);
  return ipmReportNumber(facilityCode, localDay, highest + 1);
};

// ------------------------------------------------------------------
// SIDE EFFECTS (§ 8)
// ------------------------------------------------------------------

/** What one submit's side effects need to know. */
interface EffectContext {
  readonly tenantId: TenantId;
  readonly actor: IpmActor;
  readonly userId: string;
  readonly session: SessionRow;
  readonly device: DeviceRow;
  readonly visitNumber: number;
  readonly settings: IpmSettings;
  readonly transaction: Transaction;
}

/** What the side effects did: the work-order links and the `side_effects` column. */
interface EffectResult {
  readonly workOrderId: string | null;
  readonly followUpWorkOrderId: string | null;
  readonly sideEffects: IpmSideEffects;
  readonly repairOrder: WorkOrderRow | null;
}

const createOrder = async (ctx: EffectContext, values: Partial<Record<keyof WorkOrderRow, unknown>>, operation: string): Promise<WorkOrderRow> => {
  const order = await models.MaintenanceWorkOrder.create(
    {
      tenantId: ctx.tenantId,
      deviceId: ctx.device.id,
      clientFacilityId: ctx.device.clientFacilityId,
      vendorId: null,
      autoScheduled: false,
      estimatedCost: null,
      actualCost: null,
      ...values,
    } as unknown as CreationAttributes<WorkOrderRow>,
    { transaction: ctx.transaction },
  );
  await auditRow(ctx.transaction, ctx.tenantId, ctx.actor, ctx.session.clientFacilityId, {
    action: "CREATE",
    resourceType: WORK_ORDER,
    resourceId: order.id,
    changes: { operation, sessionId: ctx.session.id, deviceId: ctx.device.id, type: order.type, status: order.status },
  });
  return order;
};

/** The visit's Preventative work order (UD-12): completed, never open, outside the auto-scheduled index. */
const preventiveOrder = (ctx: EffectContext): Promise<WorkOrderRow> =>
  createOrder(
    ctx,
    {
      title: `IPM visit ${String(ctx.visitNumber)}`,
      description: null,
      type: "Preventative",
      status: "Completed",
      priority: "Medium",
      assignedTo: ctx.userId,
      scheduledDate: ctx.session.performedAt,
      completedDate: ctx.session.performedAt,
      resolutionNotes: `Recorded by IPM ${ctx.session.id}`,
    },
    "IPM_PREVENTIVE_WORK_ORDER",
  );

/** `needs_repair` (UD-17): an open, high-priority Repair work order — no free text copied. */
const repairOrder = (ctx: EffectContext): Promise<WorkOrderRow> =>
  createOrder(
    ctx,
    {
      title: `Repair after IPM visit ${String(ctx.visitNumber)}`,
      description: `${RECOMMENDATION_LABELS.needs_repair}. IPM session ${ctx.session.id}.`,
      type: "Repair",
      status: "Open",
      priority: "High",
      assignedTo: null,
      scheduledDate: null,
      completedDate: null,
      resolutionNotes: null,
    },
    "IPM_REPAIR_WORK_ORDER",
  );

/** `not_fit_for_use` (UD-17): an active device goes to `maintenance`; already there, nothing; inactive, unchanged and noted. */
const takeOutOfService = async (ctx: EffectContext, notices: string[]): Promise<{ from: string; to: string } | null> => {
  const status = ctx.device.status;
  if (status !== "active") {
    if (status !== "maintenance") {
      notices.push(`The device is ${String(status)}; its status was not changed.`);
    }
    return null;
  }
  await ctx.device.update({ status: "maintenance" }, { transaction: ctx.transaction });
  await auditRow(ctx.transaction, ctx.tenantId, ctx.actor, ctx.session.clientFacilityId, {
    action: "UPDATE",
    resourceType: DEVICE,
    resourceId: ctx.device.id,
    changes: { operation: "IPM_DEVICE_STATUS", sessionId: ctx.session.id, from: "active", to: "maintenance" },
  });
  return { from: "active", to: "maintenance" };
};

/** `needs_calibration` (UD-17; P19-05 § 4.2): the calibration request flag, unless one is still open. */
const requestCalibration = async (ctx: EffectContext, notices: string[]): Promise<boolean> => {
  if (ctx.device.calibrationRequestedAt) {
    notices.push(`A calibration was already requested on ${day(ctx.device.calibrationRequestedAt)}; that request stands.`);
    return false;
  }
  await ctx.device.update({ calibrationRequestedAt: ctx.session.performedAt, calibrationRequestedBySessionId: ctx.session.id }, { transaction: ctx.transaction });
  await auditRow(ctx.transaction, ctx.tenantId, ctx.actor, ctx.session.clientFacilityId, {
    action: "UPDATE",
    resourceType: DEVICE,
    resourceId: ctx.device.id,
    changes: { operation: "IPM_CALIBRATION_REQUESTED", sessionId: ctx.session.id, from: null, to: ctx.session.performedAt.toISOString() },
  });
  return true;
};

/** A calibration request raised by one of `sessionIds` is cleared (derived evidence, not a person's act — § 8.3, § 8.4). */
const clearCalibrationRequest = async (ctx: Omit<EffectContext, "visitNumber" | "settings" | "userId">, sessionIds: readonly string[]): Promise<boolean> => {
  const by = ctx.device.calibrationRequestedBySessionId;
  if (!by || !sessionIds.includes(by)) {
    return false;
  }
  // Both or neither (CHECK calibration_devices_calibration_request_pair, 0128).
  const from = ctx.device.calibrationRequestedAt as Date;
  await ctx.device.update({ calibrationRequestedAt: null, calibrationRequestedBySessionId: null }, { transaction: ctx.transaction });
  await auditRow(ctx.transaction, ctx.tenantId, ctx.actor, ctx.session.clientFacilityId, {
    action: "UPDATE",
    resourceType: DEVICE,
    resourceId: ctx.device.id,
    changes: { operation: "IPM_CALIBRATION_REQUEST_CLEARED", sessionId: ctx.session.id, from: from.toISOString(), to: null, requestedBy: by },
  });
  return true;
};

/** The room the technician confirmed (F-53, § 8.2): the device follows it, audited. */
const confirmRoom = async (ctx: EffectContext): Promise<{ from: string | null; to: string } | null> => {
  const to = ctx.session.locationId;
  if (!to || to === ctx.device.locationId) {
    return null;
  }
  const from = ctx.device.locationId ?? null;
  await ctx.device.update({ locationId: to }, { transaction: ctx.transaction });
  await auditRow(ctx.transaction, ctx.tenantId, ctx.actor, ctx.session.clientFacilityId, {
    action: "UPDATE",
    resourceType: DEVICE,
    resourceId: ctx.device.id,
    changes: { operation: "IPM_DEVICE_LOCATION", sessionId: ctx.session.id, from, to },
  });
  return { from, to };
};

const SWITCHED_OFF = "The recommendation's side effects are switched off for this tenant; nothing beyond the record was changed.";

/** One recommendation's effect, entering it (§ 8.1; for a correction: only what the original did not say — § 8.3). */
const enter = async (
  ctx: EffectContext,
  recommendation: InspectionRecommendation,
  notices: string[],
): Promise<{ repair: WorkOrderRow | null; deviceStatus: { from: string; to: string } | null; calibrationRequested: boolean }> => {
  const none = { repair: null, deviceStatus: null, calibrationRequested: false };
  switch (recommendation) {
    case "needs_repair":
      return { ...none, repair: await repairOrder(ctx) };
    case "not_fit_for_use":
      return { ...none, deviceStatus: await takeOutOfService(ctx, notices) };
    case "needs_calibration":
      return { ...none, calibrationRequested: await requestCalibration(ctx, notices) };
    case "fit_for_use":
      return none;
  }
};

/** § 8.1 — the first submit of a chain. */
const rootEffects = async (ctx: EffectContext): Promise<EffectResult> => {
  const notices: string[] = [];
  const preventive = await preventiveOrder(ctx);
  const recommendation = ctx.session.recommendation as InspectionRecommendation;
  const entered = ctx.settings.sideEffectsEnabled ? await enter(ctx, recommendation, notices) : { repair: null, deviceStatus: null, calibrationRequested: false };
  if (!ctx.settings.sideEffectsEnabled && recommendation !== "fit_for_use") {
    notices.push(SWITCHED_OFF);
  }
  const deviceLocation = await confirmRoom(ctx);
  return {
    workOrderId: preventive.id,
    followUpWorkOrderId: entered.repair?.id ?? null,
    repairOrder: entered.repair,
    sideEffects: {
      preventiveWorkOrderId: preventive.id,
      repairWorkOrderId: entered.repair?.id ?? null,
      deviceStatus: entered.deviceStatus,
      deviceLocation,
      calibrationRequested: entered.calibrationRequested,
      notices,
    },
  };
};

/** § 8.3 — a correction's submit: re-use the visit's order, apply what it enters, reverse nothing but the derived flag. */
const correctionEffects = async (ctx: EffectContext, original: SessionRow): Promise<EffectResult> => {
  const notices: string[] = [];
  let workOrderId = original.workOrderId;
  if (workOrderId) {
    // The visit's own Preventative order (RESTRICT key): completed, so it has a completion date.
    const order = (await models.MaintenanceWorkOrder.findOne({ where: { id: workOrderId }, transaction: ctx.transaction })) as WorkOrderRow;
    const from = order.completedDate as Date;
    if (from.getTime() !== ctx.session.performedAt.getTime()) {
      await order.update({ completedDate: ctx.session.performedAt, scheduledDate: ctx.session.performedAt }, { transaction: ctx.transaction });
      await auditRow(ctx.transaction, ctx.tenantId, ctx.actor, ctx.session.clientFacilityId, {
        action: "UPDATE",
        resourceType: WORK_ORDER,
        resourceId: order.id,
        changes: { operation: "IPM_PREVENTIVE_WORK_ORDER", sessionId: ctx.session.id, from: from.toISOString(), to: ctx.session.performedAt.toISOString() },
      });
    }
  } else {
    // An imported original has no order (UD-12); the correction is a captured record of the visit.
    workOrderId = (await preventiveOrder(ctx)).id;
  }
  const now = ctx.session.recommendation as InspectionRecommendation;
  const before = original.recommendation;
  let entered: Awaited<ReturnType<typeof enter>> = { repair: null, deviceStatus: null, calibrationRequested: false };
  if (now !== before) {
    if (ctx.settings.sideEffectsEnabled) {
      entered = await enter(ctx, now, notices);
    } else if (now !== "fit_for_use") {
      notices.push(SWITCHED_OFF);
    }
    if (before === "needs_repair" && original.followUpWorkOrderId) {
      notices.push(`Repair work order ${original.followUpWorkOrderId} was opened by the previous version; review it.`);
    }
    if (before === "not_fit_for_use") {
      notices.push("The previous version took the device out of service; review its status.");
    }
    if (before === "needs_calibration") {
      await clearCalibrationRequest(ctx, [original.id]);
    }
  }
  const followUp = entered.repair?.id ?? (now === "needs_repair" ? original.followUpWorkOrderId : null);
  const deviceLocation = await confirmRoom(ctx);
  return {
    workOrderId,
    followUpWorkOrderId: followUp,
    repairOrder: entered.repair,
    sideEffects: {
      preventiveWorkOrderId: workOrderId,
      repairWorkOrderId: entered.repair?.id ?? null,
      deviceStatus: entered.deviceStatus,
      deviceLocation,
      calibrationRequested: entered.calibrationRequested,
      notices,
    },
  };
};

/** The Repair order's notification (§ 8.1; AM-21): the tenant broadcast and the facility's bound maintenance readers. */
const notifyRepair = async (ctx: EffectContext, order: WorkOrderRow): Promise<void> => {
  const audience = await recipientsFor({ tenantId: ctx.tenantId, clientFacilityId: order.clientFacilityId }, "maintenance", { transaction: ctx.transaction });
  for (const userId of [null, ...audience.boundUserIds]) {
    const notification = await notificationService.emitNotification(
      {
        tenantId: ctx.tenantId,
        userId,
        type: "MAINTENANCE",
        title: "Repair requested by an IPM",
        message: `${ctx.device.name}: ${order.title}.`,
        actionUrl: `/dashboard/maintenance/${order.id}`,
      },
      { transaction: ctx.transaction },
    );
    await auditRow(ctx.transaction, ctx.tenantId, ctx.actor, ctx.session.clientFacilityId, {
      action: "CREATE",
      resourceType: "Notification",
      resourceId: (notification as { id: string }).id,
      changes: { operation: "IPM_REPAIR_NOTICE", audience: userId === null ? "tenant" : "facility-user", workOrderId: order.id, sessionId: ctx.session.id },
    });
  }
};

// ------------------------------------------------------------------
// SUBMIT (§ 7.2)
// ------------------------------------------------------------------

/** The 409 of a session that is no longer a draft (spec § 7.2's submit row). */
const notSubmittable = (session: SessionRow): AppError => {
  if (session.status === "submitted") {
    return conflict("IPM_NOT_DRAFT", `This IPM was already submitted on ${day(session.submittedAt)}.`);
  }
  if (session.status === "voided") {
    return conflict("IPM_NOT_DRAFT", `This IPM was voided on ${day(session.voidedAt)}; start a new IPM.`);
  }
  return conflict("IPM_NOT_DRAFT", `This IPM draft was discarded on ${day(session.discardedAt)}; start a new IPM.`);
};

/** The original of a correction must still be the chain's effective head (§ 7.2). */
const assertOriginalEffective = (original: SessionRow): void => {
  if (original.status === "voided") {
    throw conflict("IPM_ORIGINAL_NOT_EFFECTIVE", `The IPM you corrected was voided on ${day(original.voidedAt)}; discard this draft.`);
  }
  if (original.supersededById) {
    throw conflict("IPM_ORIGINAL_NOT_EFFECTIVE", `The IPM you corrected was corrected by someone else on ${day(original.supersededAt)}; discard this draft.`);
  }
};

const HEADER_LABELS = Object.freeze({ inspectionOutcome: "inspection result", maintenanceOutcome: "maintenance result", recommendation: "recommendation" });

/** The 400 of an incomplete draft: the header fields and the required items it misses, by section and label. */
const assertComplete = async (session: SessionRow, transaction: Transaction): Promise<void> => {
  const header = (Object.keys(HEADER_LABELS) as (keyof typeof HEADER_LABELS)[]).filter((field) => (session[field] ?? null) === null).map((field) => HEADER_LABELS[field]);
  const items = [...(await pinnedItemsOf(session.templateVersionId, transaction)).values()];
  const results = await models.InspectionResult.findAll({ where: { sessionId: session.id }, transaction });
  const missing = missingRequiredItems(
    items.map((i) => ({ id: i.id, section: i.section, label: i.label, inputKind: i.inputKind, required: i.required })),
    results.map((r) => ({ templateItemId: r.templateItemId, outcome: r.outcome, cleanliness: r.cleanliness, measuredValue: r.measuredValue, measuredValue1: r.measuredValue1, textValue: r.textValue })),
  );
  if (header.length === 0 && missing.length === 0) {
    return;
  }
  const parts = [
    ...(header.length ? [`the ${header.join(", ")}`] : []),
    ...missing.map((m) => `${m.section.replace(/_/g, " ")}: "${m.label}"`),
  ];
  throw new AppError(400, `This IPM cannot be submitted yet — complete ${parts.join("; ")}.`);
};

/**
 * `POST /ipm/sessions/:sessionId/submit` — a root's or a correction's submit (spec § 7.2, § 8; P19-06 § 5, § 6).
 *
 * @param tenantId - the caller's tenant
 * @param input - the validated params + body (`revision`)
 * @param actor - the person (the draft's creator)
 * @returns 200 and the submitted session (with `sideEffects` and the report number)
 */
export const submitSession = async (tenantId: TenantId, input: IpmSessionSubmit, actor: IpmActor): Promise<IpmWriteResult> => {
  const userId = personOf(actor);
  const result = await db.transaction(async (transaction) => {
    const found = await models.InspectionSession.findOne({ where: { id: input.sessionId }, attributes: ["id", "deviceId", "supersedesId"], transaction });
    if (!found) {
      throw new AppError(404, SESSION_NOT_FOUND);
    }
    const device = await lockDevice(found.deviceId, transaction);
    const original = found.supersedesId ? await lockSession(found.supersedesId, transaction) : null;
    const session = await lockSession(found.id, transaction);
    if (session.status !== "draft") {
      throw notSubmittable(session);
    }
    if (session.createdBy !== userId) {
      throw new AppError(403, "Only the technician who started this IPM can submit it.");
    }
    if (session.revision !== input.revision) {
      throw conflict("IPM_REVISION_CONFLICT", `This draft was saved at ${session.updatedAt.toISOString()} (revision ${String(session.revision)}); reload it before submitting.`);
    }
    if (device.status === "retired") {
      throw conflict("IPM_DEVICE_RETIRED", "This device was retired after the IPM started; discard the draft (a tenant administrator can reinstate the device first).");
    }
    await assertFacilityOpen(session.clientFacilityId, transaction);
    if (original) {
      assertOriginalEffective(original);
    }
    await assertComplete(session, transaction);

    const settings = await ipmSettingsOf(tenantId, { transaction });
    const submittedAt = new Date();
    const visitNumber = original ? (original.visitNumber as number) : await nextVisitNumber(device.id, transaction);
    const snapshots = await snapshotsFor(session, device, transaction);
    const issuer = await issuerOf(tenantId, settings.timeZone, transaction);
    const reportNumber = await nextReportNumber(tenantId, snapshots.facility.code ?? "SELF", submittedAt, settings.timeZone, transaction);
    // A captured draft always pins a version (CHECK inspection_sessions_version_or_import; RESTRICT key).
    const version = (await models.InspectionTemplateVersion.findOne({
      where: { id: session.templateVersionId as string },
      attributes: ["id", "versionNumber", "contentHash"],
      transaction,
    })) as VersionRow;
    const items = await pinnedItemsOf(session.templateVersionId, transaction);
    const rows = await models.InspectionResult.findAll({ where: { sessionId: session.id }, transaction });
    const results = ipmReportReadOrder(rows.map((row) => reportResultOf(row, row.templateItemId ? items.get(row.templateItemId) : undefined)));
    const hash = contentHash(
      reportPayload(
        {
          id: session.id,
          reportNumber,
          supersedesReportNumber: original?.reportNumber ?? null,
          issuer,
          snapshots,
          visitNumber,
          legacyVisitNumber: session.legacyVisitNumber,
          performedAt: session.performedAt,
          submittedAt,
          version,
          inspectionOutcome: session.inspectionOutcome,
          maintenanceOutcome: session.maintenanceOutcome,
          recommendation: session.recommendation,
          notes: session.notes,
          capturedOffline: session.capturedOffline,
          imported: false,
        },
        results,
      ),
    );

    const ctx: EffectContext = { tenantId, actor, userId, session, device, visitNumber, settings, transaction };
    const effects = original ? await correctionEffects(ctx, original) : await rootEffects(ctx);
    if (effects.repairOrder) {
      await notifyRepair(ctx, effects.repairOrder);
    }

    await session.update(
      {
        status: "submitted",
        submittedAt,
        submittedBy: userId as SessionRow["submittedBy"],
        updatedBy: userId as SessionRow["updatedBy"],
        visitNumber,
        performerSnapshot: snapshots.performer,
        deviceSnapshot: snapshots.device,
        facilitySnapshot: snapshots.facility,
        roomSnapshot: snapshots.room,
        floorSnapshot: snapshots.floor,
        workOrderId: effects.workOrderId,
        followUpWorkOrderId: effects.followUpWorkOrderId,
        sideEffects: effects.sideEffects,
        reportNumber,
        verificationToken: newVerificationToken(),
        reportContentHash: hash,
        reportHashScheme: IPM_REPORT_SCHEME,
        issuerSnapshot: issuer,
      },
      { transaction },
    );
    if (original) {
      await original.update({ supersededById: session.id, supersededAt: submittedAt, updatedBy: userId as SessionRow["updatedBy"] }, { transaction });
      await auditRow(transaction, tenantId, actor, original.clientFacilityId, {
        action: "UPDATE",
        resourceType: IPM_SESSION_RESOURCE,
        resourceId: original.id,
        changes: { operation: "SUPERSEDE_IPM", originalId: original.id, correctionId: session.id },
      });
    }
    await auditRow(transaction, tenantId, actor, session.clientFacilityId, {
      action: "APPROVE",
      resourceType: IPM_SESSION_RESOURCE,
      resourceId: session.id,
      changes: {
        operation: original ? "SUBMIT_IPM_CORRECTION" : "SUBMIT_IPM",
        ...(original ? { originalId: original.id } : {}),
        visitNumber,
        recommendation: session.recommendation,
        inspectionOutcome: session.inspectionOutcome,
        maintenanceOutcome: session.maintenanceOutcome,
        templateVersionId: session.templateVersionId,
        templateContentHash: version.contentHash,
        resultCount: rows.length,
        sideEffects: { preventiveWorkOrderId: effects.workOrderId, repairWorkOrderId: effects.sideEffects.repairWorkOrderId ?? null },
        reportNumber,
        reportHash: hash,
        hashScheme: IPM_REPORT_SCHEME,
      },
    });
    await completeIdempotentRequest(transaction, 200, IPM_SESSION_RESOURCE, session.id);
    return { session, view: await sessionView(session, transaction) };
  });
  // AM-19: after the commit, to the tenant room and the session's facility room only.
  emitForRow(result.session, "ipm:submitted", { sessionId: result.session.id, deviceId: result.session.deviceId, reportNumber: result.session.reportNumber });
  return { status: 200, session: result.view };
};

// ------------------------------------------------------------------
// VOID (§ 7.2, § 8.4)
// ------------------------------------------------------------------

/** Every session of the chain ending at `head` (in context), head included. */
const chainOf = async (head: SessionRow, transaction: Transaction): Promise<string[]> => {
  const ids = [head.id as string];
  let at: string | null = head.supersedesId;
  for (let hops = 0; at && hops < 1000; hops += 1) {
    ids.push(at);
    const previous: SessionRow | null = await models.InspectionSession.findOne({ where: { id: at }, attributes: ["id", "supersedesId"], transaction });
    at = previous?.supersedesId ?? null;
  }
  return ids;
};

/**
 * `POST /ipm/sessions/:sessionId/void` — the chain's head, by an UNBOUND tenant administrator.
 *
 * @param tenantId - the caller's tenant
 * @param input - the validated params + body (`reason`)
 * @param actor - the person (`tenantAdmin` from the route's rbac)
 * @returns 200 and the voided session (its `notices` name what was not reversed)
 */
export const voidSession = async (tenantId: TenantId, input: IpmSessionVoid, actor: IpmActor): Promise<IpmWriteResult> => {
  const userId = personOf(actor);
  if (!actor.tenantAdmin || facilityBound()) {
    throw new AppError(403, "Only a tenant administrator of the provider can void an IPM.");
  }
  const result = await db.transaction(async (transaction) => {
    const found = await models.InspectionSession.findOne({ where: { id: input.sessionId }, attributes: ["id", "deviceId"], transaction });
    if (!found) {
      throw new AppError(404, SESSION_NOT_FOUND);
    }
    const device = await lockDevice(found.deviceId, transaction);
    const session = await lockSession(found.id, transaction);
    if (session.status === "draft" || session.status === "discarded") {
      throw conflict("IPM_NOT_SUBMITTED", "Only a submitted IPM can be voided; discard a draft instead.");
    }
    if (session.status === "voided") {
      throw conflict("IPM_VOIDED", `This IPM was already voided on ${day(session.voidedAt)}.`);
    }
    if (session.supersededById) {
      const head = await headOf(session, transaction);
      throw conflict("IPM_SUPERSEDED", `This IPM was corrected on ${day(session.supersededAt)}; void the latest version (visit ${String(session.visitNumber)}).`, {
        headId: head.id,
      });
    }
    const notices: string[] = [];
    const ctx = { tenantId, actor, session, device, transaction };
    if (session.workOrderId) {
      const order = await models.MaintenanceWorkOrder.findOne({ where: { id: session.workOrderId }, transaction });
      if (order && order.status !== "Cancelled") {
        const from = order.status;
        await order.update({ status: "Cancelled", resolutionNotes: `IPM visit ${String(session.visitNumber)} voided` }, { transaction });
        await auditRow(transaction, tenantId, actor, session.clientFacilityId, {
          action: "UPDATE",
          resourceType: WORK_ORDER,
          resourceId: order.id,
          changes: { operation: "IPM_WORK_ORDER_CANCELLED", sessionId: session.id, from, to: "Cancelled" },
        });
      }
    }
    await clearCalibrationRequest(ctx, await chainOf(session, transaction));
    if (session.followUpWorkOrderId) {
      notices.push(`Repair work order ${session.followUpWorkOrderId} stays open; review it.`);
    }
    const effects = session.sideEffects;
    if (effects?.deviceStatus) {
      notices.push(`The device status set by this IPM (${effects.deviceStatus.to ?? "maintenance"}) was not changed; review it.`);
    }
    await session.update(
      { status: "voided", voidReason: input.reason, voidedBy: userId as SessionRow["voidedBy"], voidedAt: new Date(), updatedBy: userId as SessionRow["updatedBy"] },
      { transaction },
    );
    await auditRow(transaction, tenantId, actor, session.clientFacilityId, {
      action: "DELETE",
      resourceType: IPM_SESSION_RESOURCE,
      resourceId: session.id,
      changes: { operation: "VOID_IPM", reasonLength: input.reason.length, notices },
    });
    return { session, view: await sessionView(session, transaction, notices) };
  });
  emitForRow(result.session, "ipm:voided", { sessionId: result.session.id, deviceId: result.session.deviceId, reportNumber: result.session.reportNumber });
  return { status: 200, session: result.view };
};
