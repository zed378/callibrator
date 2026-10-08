/**
 * The IPM session aggregate's draft life (P21-03a; ADR-126 § 3, Am. 1, Am. 3, Am. 4; spec
 * MEMORY/specs/P19-02-ipm-session-aggregate.md § 3, § 7, § 9.3, § 9.4, § 10, § 14).
 *
 * THE AGGREGATE. One visit is one chain: a root session and its linear corrections. This module
 * owns the DRAFT side — create (a root, or a correction of an effective session), edit the header,
 * replace the results, discard — and the reads. The submit, the correction's submit and the void
 * write the report's issuance in the same row (migration 0126's `inspection_sessions_issued_fields`
 * makes the report number, token, hash and issuer NOT NULL on a submitted row), so they are built
 * with that issuance and the side effects by P21-04 (ADR-126 Am. 4 § 1).
 *
 * RULES (each a state explanation with a top-level `code`, `IPM_CONFLICT_CODES`):
 *  - the device and the session are always loaded IN the caller's context (tenant + facility hooks):
 *    another tenant's or another facility's row is the 404 a missing id gets (AM-17);
 *  - one open root draft per device per technician (`IPM_DRAFT_EXISTS`, with the caller's own
 *    `draftId`); `clientRef` per creator, resolved in context — the caller's own capture is answered
 *    200 (AM-16);
 *  - only the draft's creator edits it (403); an unbound tenant administrator may also discard it;
 *    every write carries the `revision` it last read (`IPM_REVISION_CONFLICT`);
 *  - results are checked against the PINNED version's items (the server's copy, `normaliseResult`);
 *  - lock order device → original → session, the same everywhere (spec § 6);
 *  - every write's audit row and the idempotency key's completion are in the write's transaction.
 *
 * The database holds the same rules for every role (0126 keys, 0127 triggers); this module's own
 * answers come first, so a client meets an explanation rather than a trigger's refusal.
 *
 * Named exports only (ADR-087 Am. 15).
 */
import { createHash } from "node:crypto";
import { Op, UniqueConstraintError, type CreationAttributes, type Transaction, type WhereOptions } from "sequelize";
import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import { completeIdempotentRequest } from "./idempotency.service";
import { displayPeople, withDisplays } from "./personDisplay.service";
import { AppError } from "../utils/appError.util";
import { CodedError } from "../utils/codedError.util";
import { auditEntryActor, type AuditActorInput } from "../utils/auditPrincipal.util";
import { tenantStorage } from "../middlewares/tenantContext.middleware";
import {
  INSPECTION_SECTIONS,
  TEMPLATE_ITEM_ORIGINS,
  normaliseResult,
  resolveTemplateVersion,
  type IpmConflictCode,
  type NormalisableItem,
} from "@callibrator/contracts/inspectionValues";
import type {
  DeviceIpmSessionsQuery,
  IpmResultInput,
  IpmResultsReplace,
  IpmSessionCorrection,
  IpmSessionCreate,
  IpmSessionDiscard,
  IpmSessionHeaderUpdate,
  IpmSessionListQuery,
} from "@callibrator/contracts/inspectionSessions";
import type { InspectionSessionId, TenantId } from "../types/ids";
import type { ModelInstance } from "../types/models";

type SessionRow = ModelInstance<"InspectionSession">;
type ResultRow = ModelInstance<"InspectionResult">;
type DeviceRow = ModelInstance<"CalibrationDevice">;
type ItemRow = ModelInstance<"InspectionTemplateItem">;
type VersionRow = ModelInstance<"InspectionTemplateVersion">;

/** The resource type an idempotency key and an audit row name. */
export const IPM_SESSION_RESOURCE = "InspectionSession";

const SESSION_NOT_FOUND = "IPM session not found";
const DEVICE_NOT_FOUND = "Calibration device not found";
/** A capture's `performedAt` may lead the server's clock by this much (spec § 4.1). */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Who acts: the person (IPM writes refuse API keys) and whether an administrator's discard applies. */
export interface IpmActor extends AuditActorInput {
  readonly userId: string | null;
  /** Holds the tenant-administrator tier (rbac); the service adds "and is not facility-bound". */
  readonly tenantAdmin: boolean;
}

/** One result as answered (the stored row, without its tenant and facility keys). */
export interface IpmResultView {
  readonly id: string;
  readonly section: string;
  readonly inputKind: string;
  readonly templateItemId: string | null;
  readonly itemDefinitionId: string | null;
  readonly isAdHoc: boolean;
  readonly label: string;
  readonly unit: string | null;
  readonly symbol: string | null;
  readonly settingText: string | null;
  readonly referenceText: string | null;
  readonly outcome: string | null;
  readonly cleanliness: string | null;
  readonly measuredValue: string | null;
  readonly measuredValue1: string | null;
  readonly measuredValue2: string | null;
  readonly textValue: string | null;
  readonly computedOutcome: string | null;
  readonly outcomeSource: string | null;
  readonly warnFlag: boolean;
  readonly disagreementFlag: boolean;
  readonly sortOrder: number;
}

/** A write's answer: the status the route sends (201 created, 200 an idempotent replay or an edit) and the session. */
export interface IpmWriteResult {
  readonly status: 200 | 201;
  readonly session: Record<string, unknown>;
}

// ------------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------------

const day = (date: Date | null | undefined): string => (date ? date.toISOString().slice(0, 10) : "an unknown date");

const conflict = (code: IpmConflictCode, message: string, fields: Readonly<Record<string, string>> = {}): CodedError =>
  new CodedError(409, code, message, fields);

const facilityBound = (): boolean => tenantStorage.getStore()?.facilityBound === true;

/** The acting person; an IPM is a person's record (the route refuses keys too — G-S8). */
const personOf = (actor: IpmActor): string => {
  if (!actor.userId) {
    throw new AppError(403, "An IPM is recorded by a person, not by an API key.");
  }
  return actor.userId;
};

const audit = async (
  transaction: Transaction,
  tenantId: TenantId,
  actor: IpmActor,
  session: SessionRow,
  entry: { action: "CREATE" | "UPDATE"; changes: Record<string, unknown> },
): Promise<void> => {
  await auditService.logAction(
    {
      tenantId,
      ...auditEntryActor(actor),
      action: entry.action,
      resourceType: IPM_SESSION_RESOURCE,
      resourceId: session.id,
      clientFacilityId: session.clientFacilityId,
      changes: entry.changes,
    },
    { transaction },
  );
};

/** The 409 of a session that is not a draft, naming its state and what to do instead (spec § 7.2). */
const notADraft = (session: SessionRow, verb: string): CodedError => {
  if (session.status === "submitted") {
    return conflict("IPM_NOT_DRAFT", `This IPM was submitted on ${day(session.submittedAt)} and cannot be ${verb} — submit a correction instead.`);
  }
  if (session.status === "voided") {
    return conflict("IPM_NOT_DRAFT", `This IPM was voided on ${day(session.voidedAt)} and cannot be ${verb} — start a new IPM.`);
  }
  return conflict("IPM_NOT_DRAFT", `This IPM draft was discarded on ${day(session.discardedAt)} and cannot be ${verb} — start a new IPM.`);
};

/** A draft the actor created, at the revision the actor last read. */
const assertOwnDraft = (session: SessionRow, userId: string, revision: number): void => {
  if (session.status !== "draft") {
    throw notADraft(session, "edited");
  }
  if (session.createdBy !== userId) {
    throw new AppError(403, "Only the technician who started this IPM can edit it.");
  }
  if (session.revision !== revision) {
    throw conflict(
      "IPM_REVISION_CONFLICT",
      `This draft was saved at ${session.updatedAt.toISOString()} (revision ${String(session.revision)}); reload it before saving.`,
    );
  }
};

const assertPerformedAt = (performedAt: Date | undefined): void => {
  if (performedAt && performedAt.getTime() > Date.now() + CLOCK_SKEW_MS) {
    throw new AppError(400, "The inspection cannot be dated in the future.");
  }
};

/** The session `id`, locked FOR UPDATE, in the caller's context — or the 404. */
const lockSession = async (id: string, transaction: Transaction): Promise<SessionRow> => {
  const session = await models.InspectionSession.findOne({ where: { id }, transaction, lock: transaction.LOCK.UPDATE });
  if (!session) {
    throw new AppError(404, SESSION_NOT_FOUND);
  }
  return session;
};

/** The device `id`, locked FOR UPDATE, in the caller's context — or the 404. */
const lockDevice = async (id: string, transaction: Transaction): Promise<DeviceRow> => {
  const device = await models.CalibrationDevice.findOne({ where: { id }, transaction, lock: transaction.LOCK.UPDATE });
  if (!device) {
    throw new AppError(404, DEVICE_NOT_FOUND);
  }
  return device;
};

/** An ended facility takes no new records (0117's `facility_accepts_inserts`; spec § 7.1). */
const assertFacilityOpen = async (clientFacilityId: string, transaction: Transaction): Promise<void> => {
  const facility = await models.ClientFacility.findOne({ where: { id: clientFacilityId }, attributes: ["id", "name", "status"], transaction });
  if (facility?.status === "ended") {
    throw conflict("IPM_FACILITY_ENDED", `${facility.name} has ended; new records cannot be added. Reinstate it first.`);
  }
};

/** The published versions with their device type, for `resolveTemplateVersion` (active templates only). */
const publishedVersions = async (transaction: Transaction): Promise<(VersionRow & { deviceTypeId: string | null })[]> => {
  const templates = await models.InspectionTemplate.findAll({ where: { status: "active" }, attributes: ["id", "deviceTypeId"], transaction });
  const typeOf = new Map(templates.map((t) => [t.id as string, t.deviceTypeId as string | null]));
  const versions = await models.InspectionTemplateVersion.findAll({
    where: { status: "published", templateId: [...typeOf.keys()] },
    transaction,
  });
  return versions.map((v) => Object.assign(v, { deviceTypeId: typeOf.get(v.templateId) ?? null }));
};

/**
 * The version a new root draft pins (spec § 7.1): the one sent, held to ADR-125 § 3 — a retired
 * version only for an offline capture, a stale one only offline — or the device's current one.
 */
const pinVersion = async (
  device: DeviceRow,
  input: IpmSessionCreate,
  transaction: Transaction,
): Promise<{ version: VersionRow; notices: string[] }> => {
  const current = resolveTemplateVersion(await publishedVersions(transaction), device.deviceTypeId);
  if (!input.templateVersionId) {
    if (!current) {
      throw conflict("IPM_NO_CHECKLIST", "No checklist is published for this device type; an IPM cannot be started.");
    }
    return { version: current, notices: [] };
  }
  const sent = await models.InspectionTemplateVersion.findOne({ where: { id: input.templateVersionId }, transaction });
  if (!sent || sent.status === "draft" || sent.status === "discarded") {
    throw new AppError(400, "Unknown checklist version.");
  }
  const offline = input.capturedOffline === true;
  if (sent.status === "retired" && !offline) {
    const replacement = current ? `version ${String(current.versionNumber)}` : "a newer version";
    throw conflict("IPM_VERSION_RETIRED", `This checklist was replaced by ${replacement} on ${day(sent.retiredAt)}; reload to start with it.`);
  }
  if (sent.id !== current?.id) {
    if (!offline) {
      throw conflict("IPM_VERSION_STALE", "The checklist for this device type changed; reload.");
    }
    return { version: sent, notices: ["This IPM uses a checklist that is not the device's current one (captured offline)."] };
  }
  return { version: sent, notices: [] };
};

// ------------------------------------------------------------------
// VIEWS
// ------------------------------------------------------------------

const sectionIndex = (s: string): number => (INSPECTION_SECTIONS as readonly string[]).indexOf(s);
const originIndex = (o: string): number => (TEMPLATE_ITEM_ORIGINS as readonly string[]).indexOf(o);

/** A sortable key: the parts' order, zero-padded (section, then the given numbers, then the id). */
const orderKey = (section: string, numbers: readonly number[], id: string): string =>
  [String(sectionIndex(section)).padStart(2, "0"), ...numbers.map((n) => String(n).padStart(6, "0")), id].join("|");

/** Results in read order: section, then sort order (unique per section and session). */
const byReadOrder = (a: { section: string; sortOrder: number; id: string }, b: { section: string; sortOrder: number; id: string }): number =>
  orderKey(a.section, [a.sortOrder], a.id) < orderKey(b.section, [b.sortOrder], b.id) ? -1 : 1;

const resultView = (row: ResultRow): IpmResultView => ({
  id: row.id,
  section: row.section,
  inputKind: row.inputKind,
  templateItemId: row.templateItemId,
  itemDefinitionId: row.itemDefinitionId,
  isAdHoc: row.isAdHoc,
  label: row.labelSnapshot,
  unit: row.unit,
  symbol: row.symbol,
  settingText: row.settingText,
  referenceText: row.referenceText,
  outcome: row.outcome,
  cleanliness: row.cleanliness,
  measuredValue: row.measuredValue,
  measuredValue1: row.measuredValue1,
  measuredValue2: row.measuredValue2,
  textValue: row.textValue,
  computedOutcome: row.computedOutcome,
  outcomeSource: row.outcomeSource,
  warnFlag: row.warnFlag,
  disagreementFlag: row.disagreementFlag,
  sortOrder: row.sortOrder,
});

/** The header every read answers — never `legacyKey` (FT-104), never the report's token. */
const headerOf = (s: SessionRow): Record<string, unknown> => ({
  id: s.id,
  deviceId: s.deviceId,
  clientFacilityId: s.clientFacilityId,
  templateVersionId: s.templateVersionId,
  status: s.status,
  effective: s.status === "submitted" && s.supersededById === null,
  revision: s.revision,
  supersedesId: s.supersedesId,
  correctionReason: s.correctionReason,
  supersededById: s.supersededById,
  supersededAt: s.supersededAt,
  performedAt: s.performedAt,
  receivedAt: s.receivedAt,
  capturedOffline: s.capturedOffline,
  clientCapturedAt: s.clientCapturedAt,
  clientRef: s.clientRef,
  createdBy: s.createdBy,
  performedBy: s.performedBy,
  submittedAt: s.submittedAt,
  visitNumber: s.visitNumber,
  legacyVisitNumber: s.legacyVisitNumber,
  inspectionOutcome: s.inspectionOutcome,
  maintenanceOutcome: s.maintenanceOutcome,
  recommendation: s.recommendation,
  notes: s.notes,
  locationId: s.locationId,
  performerSnapshot: s.performerSnapshot,
  roomSnapshot: s.roomSnapshot,
  floorSnapshot: s.floorSnapshot,
  deviceSnapshot: s.deviceSnapshot,
  facilitySnapshot: s.facilitySnapshot,
  sideEffects: s.sideEffects,
  workOrderId: s.workOrderId,
  followUpWorkOrderId: s.followUpWorkOrderId,
  reportNumber: s.reportNumber,
  voidReason: s.voidReason,
  voidedAt: s.voidedAt,
  discardedAt: s.discardedAt,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

/** The performer as printed: the snapshot once submitted (G-24), else the user's display (A-90). */
const withPerformer = async (rows: readonly SessionRow[], extra: readonly Record<string, unknown>[]): Promise<Record<string, unknown>[]> =>
  withDisplays(
    rows.map((row, i) => ({ ...headerOf(row), ...extra[i] })),
    { performerDisplay: "performedBy" },
    (row) => {
      const snapshot = row["performerSnapshot"] as { name: string; role: string | null; organisation: string | null } | null | undefined;
      return snapshot ? { name: snapshot.name, role: snapshot.role, organisation: snapshot.organisation, redacted: false } : null;
    },
  );

/** One session's full view: header, results in read order, the pinned version's hash, the device. */
const sessionView = async (session: SessionRow, transaction: Transaction | null = null, notices: readonly string[] = []): Promise<Record<string, unknown>> => {
  const results = await models.InspectionResult.findAll({ where: { sessionId: session.id }, transaction });
  const version = session.templateVersionId
    ? await models.InspectionTemplateVersion.findOne({ where: { id: session.templateVersionId }, attributes: ["id", "versionNumber", "contentHash"], transaction })
    : null;
  const device = await models.CalibrationDevice.findOne({
    where: { id: session.deviceId },
    attributes: ["id", "name", "manufacturer", "model", "serialNumber", "qrCode", "deviceTypeId", "locationId", "status"],
    transaction,
  });
  const [view] = await withPerformer(
    [session],
    [
      {
        templateVersionNumber: version?.versionNumber ?? null,
        templateContentHash: version?.contentHash ?? null,
        device: device
          ? {
            id: device.id,
            name: device.name,
            manufacturer: device.manufacturer,
            model: device.model,
            serialNumber: device.serialNumber,
            qrCode: device.qrCode,
            deviceTypeId: device.deviceTypeId,
            locationId: device.locationId,
            status: device.status,
          }
          : null,
        results: results.map(resultView).sort(byReadOrder),
        notices: [...notices],
      },
    ],
  );
  return view as Record<string, unknown>;
};

// ------------------------------------------------------------------
// READS (§ 10.2)
// ------------------------------------------------------------------

/** A page of session summaries and its meta. */
export interface IpmSessionPage {
  readonly rows: Record<string, unknown>[];
  readonly meta: { total: number; page: number; limit: number; totalPages: number };
}

const pageOf = async (where: WhereOptions, query: { page: number; limit: number; sort?: string }): Promise<IpmSessionPage> => {
  const { rows, count } = await models.InspectionSession.findAndCountAll({
    where,
    order: [...(query.sort === "visitNumber" ? [["visitNumber", "DESC"] as [string, string]] : []), ["performedAt", "DESC"], ["id", "DESC"]],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });
  return {
    rows: await withPerformer(rows, rows.map(() => ({}))),
    meta: { total: count, page: query.page, limit: query.limit, totalPages: Math.ceil(count / query.limit) },
  };
};

/** Submitted and voided sessions, and the caller's own drafts (spec § 10.2's default). */
const defaultStatuses = (userId: string | null): WhereOptions => ({
  [Op.or]: [{ status: ["submitted", "voided"] }, ...(userId ? [{ status: "draft", createdBy: userId }] : [])],
});

/**
 * `GET /ipm/sessions` — the sessions in the caller's context (the hooks add the tenant and, for a
 * bound caller, the facility predicate: a foreign `clientFacilityId` answers an empty page).
 *
 * @param userId - the caller (its own drafts are listed by default)
 * @param query - the validated query
 * @returns rows and meta
 */
export const listSessions = async (userId: string | null, query: IpmSessionListQuery): Promise<IpmSessionPage> => {
  const and: WhereOptions[] = [query.status ? { status: query.status } : defaultStatuses(userId)];
  if (query.effective !== undefined) {
    and.push(query.effective ? { status: "submitted", supersededById: null } : { [Op.or]: [{ status: { [Op.ne]: "submitted" } }, { supersededById: { [Op.ne]: null } }] });
  }
  for (const key of ["deviceId", "clientFacilityId", "recommendation", "performedBy"] as const) {
    if (query[key] !== undefined) {
      and.push({ [key]: query[key] });
    }
  }
  if (query.from) {
    and.push({ performedAt: { [Op.gte]: query.from } });
  }
  if (query.to) {
    and.push({ performedAt: { [Op.lte]: query.to } });
  }
  if (query.q) {
    const devices = await models.CalibrationDevice.findAll({
      where: { [Op.or]: [{ name: { [Op.iLike]: `%${query.q}%` } }, { qrCode: { [Op.iLike]: `%${query.q}%` } }] },
      attributes: ["id"],
      limit: 1000,
    });
    and.push({ deviceId: devices.map((d) => d.id) });
  }
  return pageOf({ [Op.and]: and }, query);
};

/**
 * `GET /calibration-devices/:calibrationDeviceId/ipm-sessions` — a device's history with its chain
 * links; the device is loaded in context first (another tenant's or facility's is the 404).
 *
 * @param userId - the caller
 * @param query - the device and the page
 * @returns rows and meta
 */
export const deviceSessions = async (userId: string | null, query: DeviceIpmSessionsQuery): Promise<IpmSessionPage> => {
  const device = await models.CalibrationDevice.findOne({ where: { id: query.calibrationDeviceId }, attributes: ["id"] });
  if (!device) {
    throw new AppError(404, DEVICE_NOT_FOUND);
  }
  return pageOf({ [Op.and]: [{ deviceId: device.id }, defaultStatuses(userId)] }, { ...query, sort: "performedAt" });
};

/**
 * `GET /ipm/sessions/:sessionId`.
 *
 * @param id - the session
 * @returns the session's full view
 */
export const getSession = async (id: InspectionSessionId): Promise<Record<string, unknown>> => {
  const session = await models.InspectionSession.findOne({ where: { id } });
  if (!session) {
    throw new AppError(404, SESSION_NOT_FOUND);
  }
  return sessionView(session);
};

// ------------------------------------------------------------------
// CREATE (§ 7.1, § 9.3)
// ------------------------------------------------------------------

/** The caller's own capture with this `clientRef`, in context (AM-16). */
const ownCapture = async (userId: string, clientRef: string | undefined, transaction: Transaction): Promise<SessionRow | null> =>
  clientRef ? models.InspectionSession.findOne({ where: { createdBy: userId, clientRef }, transaction }) : null;

/** A `client_ref` unique violation (a ref the caller used in a facility it can no longer read). */
const isClientRefCollision = (err: unknown): boolean =>
  err instanceof UniqueConstraintError && JSON.stringify(err.fields).includes("client_ref");

const insertSession = async (values: CreationAttributes<SessionRow>, transaction: Transaction): Promise<SessionRow> => {
  try {
    return await models.InspectionSession.create(values, { transaction });
  } catch (err) {
    if (isClientRefCollision(err)) {
      throw conflict("IPM_CLIENT_REF_REUSED", "This capture reference was already used.");
    }
    throw err;
  }
};

/**
 * `POST /ipm/sessions` — a root draft for a device, pinned to a checklist version (spec § 7.1).
 *
 * @param tenantId - the caller's tenant (stamped, never read from the body)
 * @param input - the validated body
 * @param actor - the person
 * @returns 201 and the draft, or 200 and the caller's own capture with the same `clientRef`
 */
export const createSession = async (tenantId: TenantId, input: IpmSessionCreate, actor: IpmActor): Promise<IpmWriteResult> => {
  const userId = personOf(actor);
  assertPerformedAt(input.performedAt);
  return db.transaction(async (transaction) => {
    const replay = await ownCapture(userId, input.clientRef, transaction);
    if (replay) {
      await completeIdempotentRequest(transaction, 200, IPM_SESSION_RESOURCE, replay.id);
      return { status: 200, session: await sessionView(replay, transaction) };
    }
    const device = await lockDevice(input.deviceId, transaction);
    if (device.status === "retired") {
      throw conflict("IPM_DEVICE_RETIRED", "This device was retired; an IPM cannot be started. A tenant administrator can reinstate it.");
    }
    if (device.status === "inactive") {
      throw conflict("IPM_DEVICE_INACTIVE", "This device is inactive; activate it before an IPM.");
    }
    await assertFacilityOpen(device.clientFacilityId, transaction);
    const open = await models.InspectionSession.findOne({
      where: { deviceId: device.id, createdBy: userId, status: "draft", supersedesId: null },
      attributes: ["id", "createdAt"],
      transaction,
    });
    if (open) {
      throw conflict(
        "IPM_DRAFT_EXISTS",
        `You already have an IPM draft for this device, started ${day(open.createdAt)} — resume or discard it.`,
        { draftId: open.id },
      );
    }
    const { version, notices } = await pinVersion(device, input, transaction);
    const session = await insertSession(
      {
        tenantId,
        clientFacilityId: device.clientFacilityId,
        deviceId: device.id,
        templateVersionId: version.id,
        status: "draft",
        revision: 0,
        performedAt: input.performedAt ?? new Date(),
        capturedOffline: input.capturedOffline === true,
        clientCapturedAt: input.clientCapturedAt ?? null,
        clientRef: input.clientRef ?? null,
        createdBy: userId as SessionRow["createdBy"],
        updatedBy: userId as SessionRow["updatedBy"],
        performedBy: userId as SessionRow["performedBy"],
      },
      transaction,
    );
    await audit(transaction, tenantId, actor, session, {
      action: "CREATE",
      changes: {
        operation: "CREATE_IPM_DRAFT",
        deviceId: device.id,
        templateVersionId: version.id,
        capturedOffline: session.capturedOffline,
        clientRef: input.clientRef !== undefined,
      },
    });
    await completeIdempotentRequest(transaction, 201, IPM_SESSION_RESOURCE, session.id);
    return { status: 201, session: await sessionView(session, transaction, notices) };
  });
};

// ------------------------------------------------------------------
// HEADER (§ 7.2)
// ------------------------------------------------------------------

const HEADER_FIELDS = ["performedAt", "locationId", "inspectionOutcome", "maintenanceOutcome", "recommendation", "notes"] as const;

/** A room the technician confirms must be a room of the session's facility (spec § 8.2). */
const assertRoom = async (session: SessionRow, locationId: string, transaction: Transaction): Promise<void> => {
  const room = await models.Warehouse.findOne({
    where: { id: locationId, clientFacilityId: session.clientFacilityId, kind: "room" },
    attributes: ["id"],
    transaction,
  });
  if (!room) {
    throw new AppError(400, "Choose a room of this device's facility.");
  }
};

/**
 * `PATCH /ipm/sessions/:sessionId` — a draft's header, by its creator, at the revision last read.
 *
 * @param tenantId - the caller's tenant
 * @param input - the validated params + body
 * @param actor - the person
 * @returns 200 and the draft
 */
export const updateHeader = async (tenantId: TenantId, input: IpmSessionHeaderUpdate, actor: IpmActor): Promise<IpmWriteResult> => {
  const userId = personOf(actor);
  assertPerformedAt(input.performedAt);
  return db.transaction(async (transaction) => {
    const session = await lockSession(input.sessionId, transaction);
    assertOwnDraft(session, userId, input.revision);
    if (input.locationId) {
      await assertRoom(session, input.locationId, transaction);
    }
    const changed = HEADER_FIELDS.filter((field) => input[field] !== undefined);
    const before = session.revision;
    const values: Record<string, unknown> = { revision: before + 1, updatedBy: userId };
    for (const field of changed) {
      values[field] = input[field];
    }
    await session.update(values, { transaction });
    await audit(transaction, tenantId, actor, session, {
      action: "UPDATE",
      changes: { operation: "EDIT_IPM_DRAFT", revisionBefore: before, revisionAfter: before + 1, fields: changed },
    });
    await completeIdempotentRequest(transaction, 200, IPM_SESSION_RESOURCE, session.id);
    return { status: 200, session: await sessionView(session, transaction) };
  });
};

// ------------------------------------------------------------------
// RESULTS (§ 9.4)
// ------------------------------------------------------------------

/** The item a template row answers, as `normaliseResult` reads it. */
const itemOf = (item: ItemRow): NormalisableItem => ({
  section: item.section,
  label: item.label,
  inputKind: item.inputKind,
  limitOp: item.limitOp,
  limitValue: item.limitValue,
  limitLow: item.limitLow,
  limitHigh: item.limitHigh,
  limitNominal: item.limitNominal,
  limitTolerance: item.limitTolerance,
  limitText: item.limitText,
  settingValue: item.settingValue,
  validMin: item.validMin,
  validMax: item.validMax,
  warnMin: item.warnMin,
  warnMax: item.warnMax,
  allowedOutcomes: item.allowedOutcomes,
});

/** The pinned version's items in read order, each with its position inside its section (the row's sort order). */
const pinnedItems = async (versionId: string | null, transaction: Transaction): Promise<Map<string, { item: ItemRow; position: number }>> => {
  const items = versionId ? await models.InspectionTemplateItem.findAll({ where: { versionId }, transaction }) : [];
  const keyOf = (item: ItemRow): string => orderKey(item.section, [originIndex(item.origin), item.sortOrder], item.id);
  items.sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : 1));
  const positions = new Map<string, number>();
  const out = new Map<string, { item: ItemRow; position: number }>();
  for (const item of items) {
    const position = (positions.get(item.section) ?? 0) + 1;
    positions.set(item.section, position);
    out.set(item.id, { item, position });
  }
  return out;
};

/** The stored rows of a draft's new results, or the 400 naming every problem. */
const resultRows = (
  session: SessionRow,
  results: readonly IpmResultInput[],
  items: Map<string, { item: ItemRow; position: number }>,
): CreationAttributes<ResultRow>[] => {
  const problems: string[] = [];
  const adHocPositions = new Map<string, number>();
  const rows = results.map((input, index) => {
    const pinned = input.templateItemId === undefined ? undefined : items.get(input.templateItemId);
    if (input.templateItemId !== undefined && !pinned) {
      problems.push(`Row ${String(index + 1)}: this item is not part of the checklist this IPM uses.`);
      return null;
    }
    const adHoc = input.adHoc;
    const section = pinned ? pinned.item.section : (adHoc as NonNullable<typeof adHoc>).section;
    const item: NormalisableItem = pinned
      ? itemOf(pinned.item)
      : { section, label: (adHoc as NonNullable<typeof adHoc>).label, inputKind: input.inputKind, limitOp: null, allowedOutcomes: [] };
    const normal = normaliseResult(item, input);
    if (!normal.ok) {
      problems.push(normal.problem);
      return null;
    }
    // Ad-hoc rows follow the section's template rows (spec § 4.2).
    const adHocPosition = (adHocPositions.get(section) ?? 1000) + 1;
    if (!pinned) {
      adHocPositions.set(section, adHocPosition);
    }
    return {
      tenantId: session.tenantId,
      clientFacilityId: session.clientFacilityId,
      sessionId: session.id,
      section,
      inputKind: input.inputKind,
      templateItemId: pinned ? pinned.item.id : null,
      itemDefinitionId: pinned ? pinned.item.itemDefinitionId : null,
      isAdHoc: !pinned,
      labelSnapshot: pinned ? pinned.item.label : (adHoc as NonNullable<typeof adHoc>).label,
      unit: pinned ? null : (adHoc?.unit ?? null),
      symbol: pinned ? null : (adHoc?.symbol ?? null),
      settingText: pinned ? null : (adHoc?.settingText ?? null),
      referenceText: pinned ? null : (adHoc?.referenceText ?? null),
      ...normal.result,
      sortOrder: pinned ? pinned.position : adHocPosition,
    };
  });
  if (problems.length > 0) {
    throw new AppError(400, `These results cannot be saved: ${problems.join(" ")}`);
  }
  return rows as CreationAttributes<ResultRow>[];
};

/** The SHA-256 of a draft's results in read order (the audit row's before/after, spec § 14). */
const resultsHash = (rows: readonly IpmResultView[]): string =>
  createHash("sha256")
    .update(JSON.stringify([...rows].sort(byReadOrder).map((row) => ({ ...row, id: undefined }))))
    .digest("hex");

/**
 * `PUT /ipm/sessions/:sessionId/results` — a draft's results, replaced wholesale and checked
 * against the pinned version's items (the server's copy).
 *
 * @param tenantId - the caller's tenant
 * @param input - the validated params + body
 * @param actor - the person
 * @returns 200 and the draft
 */
export const replaceResults = async (tenantId: TenantId, input: IpmResultsReplace, actor: IpmActor): Promise<IpmWriteResult> => {
  const userId = personOf(actor);
  return db.transaction(async (transaction) => {
    const session = await lockSession(input.sessionId, transaction);
    assertOwnDraft(session, userId, input.revision);
    await assertFacilityOpen(session.clientFacilityId, transaction);
    const rows = resultRows(session, input.results, await pinnedItems(session.templateVersionId, transaction));
    const previous = (await models.InspectionResult.findAll({ where: { sessionId: session.id }, transaction })).map(resultView);
    await models.InspectionResult.destroy({ where: { sessionId: session.id }, transaction });
    const created = await models.InspectionResult.bulkCreate(rows, { transaction });
    const before = session.revision;
    await session.update({ revision: before + 1, updatedBy: userId as SessionRow["updatedBy"] }, { transaction });
    await audit(transaction, tenantId, actor, session, {
      action: "UPDATE",
      changes: {
        operation: "EDIT_IPM_RESULTS",
        revisionBefore: before,
        revisionAfter: before + 1,
        resultCountBefore: previous.length,
        resultCountAfter: created.length,
        hashBefore: resultsHash(previous),
        hashAfter: resultsHash(created.map(resultView)),
      },
    });
    await completeIdempotentRequest(transaction, 200, IPM_SESSION_RESOURCE, session.id);
    return { status: 200, session: await sessionView(session, transaction) };
  });
};

// ------------------------------------------------------------------
// DISCARD (§ 7.2)
// ------------------------------------------------------------------

/**
 * `POST /ipm/sessions/:sessionId/discard` — by the draft's creator, or an UNBOUND tenant
 * administrator. The row is kept (`discarded` is final).
 *
 * @param tenantId - the caller's tenant
 * @param input - the validated params + body
 * @param actor - the person
 * @returns 200 and the discarded draft
 */
export const discardSession = async (tenantId: TenantId, input: IpmSessionDiscard, actor: IpmActor): Promise<IpmWriteResult> => {
  const userId = personOf(actor);
  return db.transaction(async (transaction) => {
    const session = await lockSession(input.sessionId, transaction);
    if (session.status !== "draft") {
      throw conflict("IPM_NOT_DRAFT", "Only a draft can be discarded.");
    }
    const byCreator = session.createdBy === userId;
    if (!byCreator && !(actor.tenantAdmin && !facilityBound())) {
      throw new AppError(403, "Only the technician who started this IPM, or a tenant administrator, can discard it.");
    }
    await session.update(
      { status: "discarded", discardedBy: userId as SessionRow["discardedBy"], discardedAt: new Date(), updatedBy: userId as SessionRow["updatedBy"] },
      { transaction },
    );
    await audit(transaction, tenantId, actor, session, {
      action: "UPDATE",
      changes: { operation: "DISCARD_IPM_DRAFT", by: byCreator ? "creator" : "administrator", reasonLength: input.reason?.length ?? 0 },
    });
    await completeIdempotentRequest(transaction, 200, IPM_SESSION_RESOURCE, session.id);
    return { status: 200, session: await sessionView(session, transaction) };
  });
};

// ------------------------------------------------------------------
// CORRECTION (§ 7.2, § 8.3)
// ------------------------------------------------------------------

/** The latest member of the chain `session` belongs to, following `supersededById` in context. */
const headOf = async (session: SessionRow, transaction: Transaction): Promise<SessionRow> => {
  let head = session;
  for (let hops = 0; head.supersededById && hops < 1000; hops += 1) {
    const next = await models.InspectionSession.findOne({ where: { id: head.supersededById }, transaction });
    if (!next) {
      break;
    }
    head = next;
  }
  return head;
};

/** The 409 of an original that cannot be corrected (spec § 7.2). */
const assertCorrectable = async (original: SessionRow, transaction: Transaction): Promise<void> => {
  if (original.status === "voided") {
    throw conflict("IPM_VOIDED", `This IPM was voided on ${day(original.voidedAt)} and cannot be corrected — a void is final.`);
  }
  if (original.status !== "submitted") {
    throw conflict("IPM_NOT_SUBMITTED", "Only a submitted IPM can be corrected; edit or discard the draft instead.");
  }
  if (original.supersededById) {
    const head = await headOf(original, transaction);
    throw conflict(
      "IPM_SUPERSEDED",
      `This IPM was corrected on ${day(original.supersededAt)}; correct the latest version (visit ${String(original.visitNumber)}).`,
      { headId: head.id },
    );
  }
  const open = await models.InspectionSession.findOne({
    where: { supersedesId: original.id, status: "draft" },
    attributes: ["id", "createdBy", "createdAt"],
    transaction,
  });
  if (open) {
    const people = await displayPeople([open.createdBy]);
    const name = (open.createdBy ? people.get(open.createdBy)?.name : null) ?? "another user";
    throw conflict("IPM_CORRECTION_OPEN", `A correction of this IPM is already open (started by ${name} on ${day(open.createdAt)}).`);
  }
};

/**
 * `POST /ipm/sessions/:sessionId/corrections` — a new draft that supersedes an effective session
 * once submitted: header and results copied, `revision` 0. An imported original (no pinned
 * version, results without template items) pins the device's current checklist and copies the
 * header only (ADR-126 Am. 4 § 4).
 *
 * @param tenantId - the caller's tenant
 * @param input - the validated params + body
 * @param actor - the person
 * @returns 201 and the correction draft, or 200 and the caller's own capture with the same `clientRef`
 */
export const createCorrection = async (tenantId: TenantId, input: IpmSessionCorrection, actor: IpmActor): Promise<IpmWriteResult> => {
  const userId = personOf(actor);
  return db.transaction(async (transaction) => {
    const replay = await ownCapture(userId, input.clientRef, transaction);
    if (replay) {
      await completeIdempotentRequest(transaction, 200, IPM_SESSION_RESOURCE, replay.id);
      return { status: 200, session: await sessionView(replay, transaction) };
    }
    const found = await models.InspectionSession.findOne({ where: { id: input.sessionId }, attributes: ["id", "deviceId"], transaction });
    if (!found) {
      throw new AppError(404, SESSION_NOT_FOUND);
    }
    const device = await lockDevice(found.deviceId, transaction);
    const original = await lockSession(found.id, transaction);
    await assertCorrectable(original, transaction);
    await assertFacilityOpen(original.clientFacilityId, transaction);
    const imported = original.templateVersionId === null;
    const versionId = imported ? resolveTemplateVersion(await publishedVersions(transaction), device.deviceTypeId)?.id : original.templateVersionId;
    if (!versionId) {
      throw conflict("IPM_NO_CHECKLIST", "No checklist is published for this device type; an imported IPM cannot be corrected yet.");
    }
    const correction = await insertSession(
      {
        tenantId,
        clientFacilityId: original.clientFacilityId,
        deviceId: original.deviceId,
        templateVersionId: versionId,
        status: "draft",
        revision: 0,
        supersedesId: original.id,
        correctionReason: input.reason,
        performedAt: original.performedAt,
        clientRef: input.clientRef ?? null,
        createdBy: userId as SessionRow["createdBy"],
        updatedBy: userId as SessionRow["updatedBy"],
        performedBy: userId as SessionRow["performedBy"],
        locationId: original.locationId,
        inspectionOutcome: original.inspectionOutcome,
        maintenanceOutcome: original.maintenanceOutcome,
        recommendation: original.recommendation,
        notes: original.notes,
      },
      transaction,
    );
    if (!imported) {
      const results = await models.InspectionResult.findAll({ where: { sessionId: original.id }, transaction });
      await models.InspectionResult.bulkCreate(
        results.map((r) => ({
          tenantId: r.tenantId,
          clientFacilityId: r.clientFacilityId,
          sessionId: correction.id,
          section: r.section,
          inputKind: r.inputKind,
          templateItemId: r.templateItemId,
          itemDefinitionId: r.itemDefinitionId,
          isAdHoc: r.isAdHoc,
          labelSnapshot: r.labelSnapshot,
          unit: r.unit,
          symbol: r.symbol,
          settingText: r.settingText,
          referenceText: r.referenceText,
          outcome: r.outcome,
          cleanliness: r.cleanliness,
          measuredValue: r.measuredValue,
          measuredValue1: r.measuredValue1,
          measuredValue2: r.measuredValue2,
          textValue: r.textValue,
          rawValue: r.rawValue,
          computedOutcome: r.computedOutcome,
          outcomeSource: r.outcomeSource,
          warnFlag: r.warnFlag,
          disagreementFlag: r.disagreementFlag,
          sortOrder: r.sortOrder,
        })),
        { transaction },
      );
    }
    await audit(transaction, tenantId, actor, correction, {
      action: "CREATE",
      changes: { operation: "CREATE_IPM_CORRECTION", originalId: original.id, reasonLength: input.reason.length, resultsCopied: !imported },
    });
    await completeIdempotentRequest(transaction, 201, IPM_SESSION_RESOURCE, correction.id);
    return { status: 201, session: await sessionView(correction, transaction) };
  });
};
