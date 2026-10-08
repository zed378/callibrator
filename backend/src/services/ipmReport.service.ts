/**
 * P21-04 — the IPM report: the document of a session (ADR-126 Amendment 2 and Amendment 5; spec
 * MEMORY/specs/P19-06-ipm-report-document.md § 4 – § 10).
 *
 * THE SESSION IS THE ISSUED RECORD; THE REPORT IS ITS DOCUMENT (G-R1). No certificate row, no PDF:
 * the browser renders the data this module serves (ADR-095 § 4, the owner's rule of 2026-10-07).
 *
 *  - ISSUANCE (`snapshotsFor`, `issuerOf`, `newVerificationToken`, `reportPayload`, `contentHash`)
 *    — the submit (ipmSubmit.service) writes the report number, the token, the content hash of
 *    scheme `ipm-report-v1` and the issuer snapshot in the submitting UPDATE, with the device,
 *    facility, room and performer snapshots this module takes.
 *  - THE DOCUMENT (`getReportDocument`) — `GET /ipm/sessions/:sessionId/report-document`: a draft
 *    previews to its creator only; an issued report to anyone with `ipm` read in scope. The hash is
 *    RECOMPUTED at every read and compared with the stored one: a mismatch is shown
 *    (`integrity.state: "mismatch"`), logged as an error naming the session (no content) and
 *    counted — never silently re-hashed (G-R4). `?render=` audits the read BEFORE the document is
 *    sent (G-R10, the ADR-114 order): a failed audit write fails the read.
 *  - THE PUBLIC VERIFICATION (`verifyReport`) — by the 192-bit token only (G-R3): absent, unknown or
 *    mismatched → one identical 404; the token is resolved with the reviewed `skipTenantScope` +
 *    `skipFacilityScope` (the one public read of this card), then the number compared in constant
 *    time.
 *
 * Never in a document or a verdict: user ids, people's e-mails or phones, the tenant id, the client
 * ref, the legacy key, work-order ids, side effects, signature addresses or agents, the void reason
 * (FT-71). Named exports only.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Transaction } from "sequelize";
import models from "../models";
import { db } from "../config";
import { env } from "../config/env";
import auditService from "./audit.service";
import tenantService from "./tenant.service";
import { displayPeople } from "./personDisplay.service";
import type { PersonDisplay } from "@callibrator/contracts/people";
import { ipmSettingsOf } from "./ipmSettings.service";
import { AppError } from "../utils/appError.util";
import { CodedError } from "../utils/codedError.util";
import { auditEntryActor, type AuditActorInput } from "../utils/auditPrincipal.util";
import { logger } from "../middlewares/activityLog.middleware";
import { runForTenant } from "../utils/jobContext.util";
import { INSPECTION_SECTIONS, type InspectionSection } from "@callibrator/contracts/inspectionValues";
import {
  IPM_REPORT_NUMBER,
  IPM_REPORT_SCHEME,
  IPM_VERIFY_TOKEN,
  canonicalIpmReportPayload,
  ipmReportReadOrder,
  type IpmReportDocumentQuery,
  type IpmReportPayloadInput,
  type IpmReportResult,
} from "@callibrator/contracts/ipmReport";
import type { IpmDeviceSnapshot, IpmFacilitySnapshot, IpmIssuerSnapshot, IpmPersonSnapshot } from "../utils/jsonShape.util";
import type { ModelInstance } from "../types/models";

type SessionRow = ModelInstance<"InspectionSession">;
type ResultRow = ModelInstance<"InspectionResult">;
type ItemRow = ModelInstance<"InspectionTemplateItem">;
type VersionRow = ModelInstance<"InspectionTemplateVersion">;
type DeviceRow = ModelInstance<"CalibrationDevice">;
type SignatureRow = ModelInstance<"InspectionSessionSignature">;
type FacilityRow = ModelInstance<"ClientFacility">;

/** The resource type of the render audit row. */
const RESOURCE = "InspectionSession";
const SESSION_NOT_FOUND = "IPM session not found";
/** The one answer of the public verification for anything that is not a verdict (§ 9.2). */
export const IPM_VERIFY_NOT_FOUND = "No IPM report matches this link.";

/** A person's printed name when the account has none. */
const UNNAMED = "Unnamed user";

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const dateOnly = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** A column the database answers as NULL, normalised so an absent value is printed and hashed as `null`. */
export const orNull = <T>(value: T | null | undefined): T | null => value ?? null;

// ------------------------------------------------------------------
// ISSUANCE
// ------------------------------------------------------------------

/** A new verification token: 24 CSPRNG bytes, base64url (ADR-100; never from a body). */
export const newVerificationToken = (): string => randomBytes(24).toString("base64url");

/** SHA-256 of the canonical payload, lower-case hex. */
export const contentHash = (input: IpmReportPayloadInput): string => createHash("sha256").update(canonicalIpmReportPayload(input), "utf8").digest("hex");

/**
 * The issuer at submit (ADR-107's fields of the tenant) and the tenant's time zone — kept in the
 * snapshot so the hash recomputed later binds the zone the report was issued in (ADR-126 Am. 5).
 */
export const issuerOf = async (tenantId: string, timeZone: string, transaction: Transaction | null = null): Promise<IpmIssuerSnapshot> => {
  const tenant = await models.Tenant.findOne({
    where: { id: tenantId },
    attributes: ["id", "name", "email", "phone", "address", "city", "state", "zipCode", "country", "website"],
    transaction,
  });
  const text = (key: "name" | "email" | "phone" | "address" | "city" | "state" | "zipCode" | "country" | "website"): string | null =>
    tenant?.get(key) ?? null;
  return {
    version: 1,
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    zipCode: text("zipCode"),
    country: text("country"),
    website: text("website"),
    timeZone,
  };
};

/** What a submit (or a draft's preview) snapshots of the device, its facility, the room and the performer. */
export interface SessionSnapshots {
  readonly device: IpmDeviceSnapshot;
  readonly facility: IpmFacilitySnapshot;
  readonly room: string | null;
  readonly floor: string | null;
  readonly performer: IpmPersonSnapshot;
}

/**
 * The snapshots of a session at submit (P19-02 § 4.1; G-S6): the device with its type's name and
 * its last and next calibration dates (`09` L-1), the facility, the confirmed room (else the
 * device's) and the performer as printed (`organisation` the tenant's name for an unbound performer,
 * the facility's for a bound one — P19-04 § 12).
 *
 * @param session - the draft
 * @param device - its device (locked by the caller when submitting)
 * @param transaction - the caller's transaction, if any
 * @returns the snapshots
 */
export const snapshotsFor = async (session: SessionRow, device: DeviceRow, transaction: Transaction | null = null): Promise<SessionSnapshots> => {
  const type = device.deviceTypeId
    ? await models.DeviceType.findOne({ where: { id: device.deviceTypeId }, attributes: ["id", "name"], transaction })
    : null;
  const lastRecord = await models.CalibrationRecord.findOne({
    where: { deviceId: device.id, supersededById: null },
    attributes: ["id", "calibrationDate"],
    order: [
      ["calibrationDate", "DESC"],
      ["createdAt", "DESC"],
      ["id", "DESC"],
    ],
    transaction,
  });
  // The session's own facility: in context (a bound caller's own one) and held by the composite key.
  const facility = (await models.ClientFacility.findOne({
    where: { id: session.clientFacilityId },
    attributes: ["id", "name", "code", "kind", "address"],
    transaction,
  })) as FacilityRow;
  const roomId = session.locationId ?? device.locationId;
  const room = roomId ? await models.Warehouse.findOne({ where: { id: roomId }, attributes: ["id", "name", "floor"], transaction }) : null;
  // A captured session's performer is its creator (CHECK inspection_sessions_captured_actor); displayPeople answers every id.
  const performerId = session.performedBy as string;
  const person = (await displayPeople([performerId])).get(performerId) as PersonDisplay;
  return {
    device: {
      name: device.name,
      manufacturer: orNull(device.manufacturer),
      model: orNull(device.model),
      serialNumber: orNull(device.serialNumber),
      qrCode: orNull(device.qrCode),
      deviceTypeId: orNull(device.deviceTypeId),
      deviceTypeName: type ? type.name : null,
      lastCalibrationDate: dateOnly(lastRecord?.calibrationDate),
      nextCalibrationDate: dateOnly(device.nextCalibrationDate),
    },
    facility: {
      id: session.clientFacilityId,
      name: facility.name,
      code: orNull(facility.code),
      kind: orNull(facility.kind),
      address: orNull(facility.address),
    },
    room: room?.name ?? null,
    floor: room?.floor ?? null,
    performer: { name: person.name ?? UNNAMED, role: person.role, organisation: person.organisation },
  };
};

/** The pinned version's items by id. */
export const pinnedItemsOf = async (versionId: string | null, transaction: Transaction | null): Promise<Map<string, ItemRow>> => {
  const items = versionId ? await models.InspectionTemplateItem.findAll({ where: { versionId }, transaction }) : [];
  return new Map(items.map((item) => [item.id as string, item]));
};

/** One stored result as the report prints it (template rows read their unit, setting and limit from the pinned item). */
export const reportResultOf = (row: ResultRow, item: ItemRow | undefined): IpmReportResult => ({
  section: row.section,
  inputKind: row.inputKind,
  label: row.labelSnapshot,
  templateItemId: row.templateItemId,
  adHoc: row.isAdHoc,
  unit: row.unit ?? item?.unit ?? null,
  symbol: row.symbol ?? item?.symbol ?? null,
  setting: row.settingText ?? item?.settingText ?? null,
  reference: row.referenceText,
  limitText: item?.limitText ?? row.referenceText,
  outcome: row.outcome,
  cleanliness: row.cleanliness,
  measuredValue: row.measuredValue,
  measuredValue1: row.measuredValue1,
  measuredValue2: row.measuredValue2,
  textValue: row.textValue,
  rawValue: row.rawValue,
  computedOutcome: row.computedOutcome,
  outcomeSource: row.outcomeSource,
  warnFlag: row.warnFlag,
  disagreementFlag: row.disagreementFlag,
  sortOrder: row.sortOrder,
  id: row.id,
});

/** The issued fields a payload reads — the stored row's, or the values a submit is about to write. */
export interface IssuedSource {
  readonly id: string;
  readonly reportNumber: string;
  readonly supersedesReportNumber: string | null;
  readonly issuer: IpmIssuerSnapshot;
  readonly snapshots: SessionSnapshots;
  readonly visitNumber: number;
  readonly legacyVisitNumber: number | null;
  readonly performedAt: Date;
  readonly submittedAt: Date;
  readonly version: Pick<VersionRow, "id" | "versionNumber" | "contentHash"> | null;
  readonly inspectionOutcome: string | null;
  readonly maintenanceOutcome: string | null;
  readonly recommendation: string | null;
  readonly notes: string | null;
  readonly capturedOffline: boolean;
  readonly imported: boolean;
}

/**
 * The canonical payload's input (scheme `ipm-report-v1`, § 6) — one function for the submit and
 * every read, so they cannot drift.
 *
 * @param source - the issued fields
 * @param results - the session's results with their pinned items
 * @returns the payload input
 */
export const reportPayload = (source: IssuedSource, results: readonly IpmReportResult[]): IpmReportPayloadInput => {
  const { issuer, snapshots } = source;
  return {
    reportNumber: source.reportNumber,
    sessionId: source.id,
    supersedesReportNumber: source.supersedesReportNumber,
    issuer: {
      name: issuer.name,
      email: issuer.email,
      phone: issuer.phone,
      address: issuer.address,
      city: issuer.city,
      state: issuer.state,
      zipCode: issuer.zipCode,
      country: issuer.country,
      website: issuer.website,
    },
    facility: snapshots.facility,
    device: snapshots.device,
    room: snapshots.room,
    floor: snapshots.floor,
    visitNumber: source.visitNumber,
    legacyVisitNumber: source.legacyVisitNumber,
    performedAt: source.performedAt.toISOString(),
    submittedAt: source.submittedAt.toISOString(),
    timeZone: issuer.timeZone,
    checklist: source.version
      ? { templateVersionId: source.version.id, versionNumber: source.version.versionNumber, contentHash: source.version.contentHash }
      : { imported: true },
    results,
    inspectionOutcome: source.inspectionOutcome,
    maintenanceOutcome: source.maintenanceOutcome,
    recommendation: source.recommendation,
    notes: source.notes,
    performer: snapshots.performer,
    capturedOffline: source.capturedOffline,
    imported: source.imported,
  };
};

/** The session's results as printed, in read order. */
const reportResults = async (session: SessionRow, transaction: Transaction | null = null): Promise<{ results: IpmReportResult[]; items: Map<string, ItemRow> }> => {
  const rows = await models.InspectionResult.findAll({ where: { sessionId: session.id }, transaction });
  const items = await pinnedItemsOf(session.templateVersionId, transaction);
  return { results: ipmReportReadOrder(rows.map((row) => reportResultOf(row, row.templateItemId ? items.get(row.templateItemId) : undefined))), items };
};

/** The report number of another session of the chain (in context), or null. */
const numberOf = async (id: string | null, transaction: Transaction | null = null): Promise<string | null> => {
  if (!id) {
    return null;
  }
  // The chain stays on one device, so the other session is in the same context (it exists: RESTRICT keys).
  const row = (await models.InspectionSession.findOne({ where: { id }, attributes: ["id", "reportNumber"], transaction })) as SessionRow;
  return orNull(row.reportNumber);
};

/** An issued row's fields, as stored. */
const storedSource = async (session: SessionRow, transaction: Transaction | null): Promise<IssuedSource> => {
  const version = session.templateVersionId
    ? await models.InspectionTemplateVersion.findOne({ where: { id: session.templateVersionId }, attributes: ["id", "versionNumber", "contentHash"], transaction })
    : null;
  const device = session.deviceSnapshot as IpmDeviceSnapshot;
  return {
    id: session.id,
    reportNumber: session.reportNumber as string,
    supersedesReportNumber: await numberOf(session.supersedesId, transaction),
    issuer: session.issuerSnapshot as IpmIssuerSnapshot,
    snapshots: {
      device,
      facility: session.facilitySnapshot as IpmFacilitySnapshot,
      room: session.roomSnapshot,
      floor: session.floorSnapshot,
      performer: session.performerSnapshot as IpmPersonSnapshot,
    },
    visitNumber: session.visitNumber as number,
    legacyVisitNumber: session.legacyVisitNumber,
    performedAt: session.performedAt,
    submittedAt: session.submittedAt as Date,
    version,
    inspectionOutcome: session.inspectionOutcome,
    maintenanceOutcome: session.maintenanceOutcome,
    recommendation: session.recommendation,
    notes: session.notes,
    capturedOffline: session.capturedOffline,
    imported: Boolean(session.legacyKey),
  };
};

// ------------------------------------------------------------------
// INTEGRITY (§ 6, § 7.4)
// ------------------------------------------------------------------

/** Mismatches seen by this process since it started (the signal an operator alert reads; ADR-126 Am. 5). */
let integrityMismatches = 0;

/** How many integrity mismatches this process has seen. */
export const integrityMismatchCount = (): number => integrityMismatches;

/** The integrity of an issued session: the stored hash against the one recomputed now. */
export interface ReportIntegrity {
  readonly scheme: string;
  readonly hash: string;
  readonly recomputed: string;
  readonly state: "match" | "mismatch";
}

/**
 * Recompute an issued session's content hash and compare it with the stored one. A mismatch is
 * logged as an error naming the session (never its content) and counted.
 *
 * @param session - a submitted or voided session (the hooks loaded it in context)
 * @param transaction - the caller's transaction, if any
 * @returns the integrity, the payload results and the pinned items (for the document)
 */
export const checkIntegrity = async (
  session: SessionRow,
  transaction: Transaction | null = null,
): Promise<{ integrity: ReportIntegrity; source: IssuedSource; results: IpmReportResult[]; items: Map<string, ItemRow> }> => {
  const source = await storedSource(session, transaction);
  const { results, items } = await reportResults(session, transaction);
  const recomputed = contentHash(reportPayload(source, results));
  const stored = session.reportContentHash as string;
  const state = recomputed === stored ? "match" : "mismatch";
  if (state === "mismatch") {
    integrityMismatches += 1;
    logger.error("IPM report integrity mismatch", { code: "IPM_REPORT_INTEGRITY_MISMATCH", sessionId: session.id, scheme: session.reportHashScheme });
  }
  return { integrity: { scheme: session.reportHashScheme ?? IPM_REPORT_SCHEME, hash: stored, recomputed, state }, source, results, items };
};

// ------------------------------------------------------------------
// THE DOCUMENT (§ 10)
// ------------------------------------------------------------------

/** The verification link of a report: from configuration only, never from the request (ADR-100). */
export const ipmVerifyUrl = (reportNumber: string, token: string): string => {
  const explicit = env("IPM_VERIFY_BASE_URL") ?? (env("CERT_VERIFY_BASE_URL") ? `${(env("CERT_VERIFY_BASE_URL") as string).replace(/\/$/, "")}/ipm` : undefined);
  if (explicit) {
    return `${explicit.replace(/\/$/, "")}/${reportNumber}?t=${encodeURIComponent(token)}`;
  }
  const base = (env("PUBLIC_BASE_URL") ?? "http://localhost:5000").replace(/\/$/, "");
  return `${base}/api/v1/ipm/verify/${reportNumber}?token=${encodeURIComponent(token)}`;
};

/** A signature as the document prints it (§ 10.2): never the signer's id, address or agent. */
const signatureView = (row: SignatureRow, stored: string | null, recomputed: string | null): Record<string, unknown> => ({
  kind: row.kind,
  name: row.signerSnapshot.name,
  role: row.signerSnapshot.role,
  organisation: row.signerSnapshot.organisation,
  meaning: row.meaning,
  signedAt: iso(row.signedAt),
  authMethod: row.authMethod,
  valid: stored !== null && row.documentHash === stored && row.documentHash === recomputed,
});

/** The sections of the document, in INSPECTION_SECTIONS order, each item with whether it was required. */
const sectionsOf = (results: readonly IpmReportResult[], items: Map<string, ItemRow>): Record<string, unknown>[] => {
  const bySection = new Map<InspectionSection, Record<string, unknown>[]>();
  for (const r of results) {
    const printed: Record<string, unknown> = { ...r, required: r.templateItemId ? (items.get(r.templateItemId)?.required ?? false) : false };
    delete printed["sortOrder"];
    delete printed["id"];
    const list = bySection.get(r.section) ?? [];
    list.push(printed);
    bySection.set(r.section, list);
  }
  return INSPECTION_SECTIONS.filter((s) => bySection.has(s)).map((section) => ({ section, items: bySection.get(section) }));
};

/** The status a document prints. */
const statusOf = (session: SessionRow): "submitted" | "superseded" | "voided" =>
  session.status === "voided" ? "voided" : session.supersededById ? "superseded" : "submitted";

/** The issuer block of a document: the snapshot's letterhead and the tenant's live logo (unhashed). */
const issuerView = async (issuer: IpmIssuerSnapshot, tenantId: string): Promise<Record<string, unknown>> => {
  const tenant = await models.Tenant.findOne({ where: { id: tenantId }, attributes: ["id", "logo"] });
  return {
    name: issuer.name,
    email: issuer.email,
    phone: issuer.phone,
    address: issuer.address,
    city: issuer.city,
    state: issuer.state,
    zipCode: issuer.zipCode,
    country: issuer.country,
    website: issuer.website,
    logoUrl: tenantService.logoUrl(tenant?.logo),
  };
};

/** The document of an ISSUED session (submitted or voided; superseded included). */
export const issuedDocument = async (session: SessionRow, options: { withVerifyUrl: boolean }): Promise<Record<string, unknown>> => {
  const { integrity, source, results, items } = await checkIntegrity(session);
  const signatures = await models.InspectionSessionSignature.findAll({ where: { sessionId: session.id }, order: [["signedAt", "ASC"], ["id", "ASC"]] });
  const settings = await ipmSettingsOf(session.tenantId);
  const supersededBy = session.supersededById
    ? await models.InspectionSession.findOne({ where: { id: session.supersededById }, attributes: ["id", "reportNumber"] })
    : null;
  const version = source.version;
  return {
    scheme: IPM_REPORT_SCHEME,
    kind: "issued",
    sessionId: session.id,
    reportNumber: session.reportNumber,
    verifyUrl: options.withVerifyUrl ? ipmVerifyUrl(session.reportNumber as string, session.verificationToken as string) : null,
    status: statusOf(session),
    lineage: {
      supersedesReportNumber: source.supersedesReportNumber,
      supersededByReportNumber: supersededBy?.reportNumber ?? null,
      supersededAt: iso(session.supersededAt),
      voidedAt: iso(session.voidedAt),
    },
    issuer: await issuerView(source.issuer, session.tenantId),
    facility: source.snapshots.facility,
    device: source.snapshots.device,
    room: source.snapshots.room,
    floor: source.snapshots.floor,
    visitNumber: session.visitNumber,
    legacyVisitNumber: orNull(session.legacyVisitNumber),
    performedAt: iso(session.performedAt),
    submittedAt: iso(session.submittedAt),
    timeZone: source.issuer.timeZone,
    checklist: version
      ? { templateVersionId: version.id, versionNumber: version.versionNumber, deviceTypeName: source.snapshots.device.deviceTypeName, contentHash: version.contentHash }
      : { imported: true },
    sections: sectionsOf(results, items),
    inspectionOutcome: session.inspectionOutcome,
    maintenanceOutcome: session.maintenanceOutcome,
    recommendation: session.recommendation,
    notes: orNull(session.notes),
    performer: source.snapshots.performer,
    signatures: signatures.map((s) => signatureView(s, session.reportContentHash, integrity.recomputed)),
    countersignEnabled: settings.countersignEnabled,
    integrity: { scheme: integrity.scheme, hash: integrity.hash, state: integrity.state },
    flags: { capturedOffline: session.capturedOffline, imported: Boolean(session.legacyKey) },
    generatedAt: new Date().toISOString(),
  };
};

/** A draft's preview (§ 10.1): the same function's shape, from the live rows — no number, link, integrity or signatures. */
const previewDocument = async (session: SessionRow): Promise<Record<string, unknown>> => {
  const device = await models.CalibrationDevice.findOne({ where: { id: session.deviceId } });
  if (!device) {
    throw new AppError(404, SESSION_NOT_FOUND);
  }
  const settings = await ipmSettingsOf(session.tenantId);
  const snapshots = await snapshotsFor(session, device);
  const issuer = await issuerOf(session.tenantId, settings.timeZone);
  const { results, items } = await reportResults(session);
  const version = session.templateVersionId
    ? await models.InspectionTemplateVersion.findOne({ where: { id: session.templateVersionId }, attributes: ["id", "versionNumber", "contentHash"] })
    : null;
  return {
    scheme: IPM_REPORT_SCHEME,
    kind: "preview",
    sessionId: session.id,
    reportNumber: null,
    verifyUrl: null,
    status: "draft",
    lineage: { supersedesReportNumber: await numberOf(session.supersedesId), supersededByReportNumber: null, supersededAt: null, voidedAt: null },
    issuer: await issuerView(issuer, session.tenantId),
    facility: snapshots.facility,
    device: snapshots.device,
    room: snapshots.room,
    floor: snapshots.floor,
    visitNumber: null,
    legacyVisitNumber: orNull(session.legacyVisitNumber),
    performedAt: iso(session.performedAt),
    submittedAt: null,
    timeZone: settings.timeZone,
    checklist: version
      ? { templateVersionId: version.id, versionNumber: version.versionNumber, deviceTypeName: snapshots.device.deviceTypeName, contentHash: version.contentHash }
      : { imported: true },
    sections: sectionsOf(results, items),
    inspectionOutcome: session.inspectionOutcome,
    maintenanceOutcome: session.maintenanceOutcome,
    recommendation: session.recommendation,
    notes: orNull(session.notes),
    performer: snapshots.performer,
    signatures: [],
    countersignEnabled: settings.countersignEnabled,
    integrity: null,
    flags: { capturedOffline: session.capturedOffline, imported: false },
    generatedAt: new Date().toISOString(),
  };
};

/** Who reads the document. */
export interface ReportReader extends AuditActorInput {
  readonly userId: string | null;
}

/**
 * `GET /ipm/sessions/:sessionId/report-document` (§ 10).
 *
 * @param tenantId - the caller's tenant
 * @param query - the session, `render`, `lang`
 * @param reader - the caller
 * @returns the document (the response's `data`)
 */
export const getReportDocument = async (tenantId: string, query: IpmReportDocumentQuery, reader: ReportReader): Promise<Record<string, unknown>> => {
  const session = await models.InspectionSession.findOne({ where: { id: query.sessionId } });
  if (!session) {
    throw new AppError(404, SESSION_NOT_FOUND);
  }
  if (session.status === "discarded") {
    throw new CodedError(409, "IPM_NOT_SUBMITTED", "A discarded draft has no report.");
  }
  if (session.status === "draft" && session.createdBy !== reader.userId) {
    throw new AppError(403, "Only the technician who started this IPM can preview it.");
  }
  const document = session.status === "draft" ? await previewDocument(session) : await issuedDocument(session, { withVerifyUrl: true });
  if (query.render) {
    // G-R10: the read for a download or a print is audited BEFORE the document is sent; a failed
    // audit write fails the read (nothing rendered).
    await db.transaction((transaction) =>
      auditService.logAction(
        {
          tenantId,
          ...auditEntryActor(reader),
          action: "EXPORT",
          resourceType: RESOURCE,
          resourceId: session.id,
          clientFacilityId: session.clientFacilityId,
          changes: { operation: "RENDER_IPM_REPORT", format: query.render, language: query.lang ?? null, reportNumber: session.reportNumber ?? null, kind: document["kind"] },
        },
        { transaction },
      ),
    );
  }
  return document;
};

// ------------------------------------------------------------------
// THE PUBLIC VERIFICATION (§ 9)
// ------------------------------------------------------------------

const notFound = (): AppError => new AppError(404, IPM_VERIFY_NOT_FOUND);

/** Constant-time equality of two strings (lengths compared first: a length is not the secret). */
const sameText = (a: string, b: string): boolean => {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * `GET /ipm/verify/:reportNumber?token=` — the verdict for the holder of the printed report's QR.
 *
 * @param reportNumber - the number in the link
 * @param token - the link's token
 * @returns the verdict (`ipmVerification`)
 * @throws AppError 404 "No IPM report matches this link." — identical for a malformed, unknown or mismatched link
 */
export const verifyReport = async (reportNumber: string, token: string | undefined): Promise<Record<string, unknown>> => {
  if (!token || !IPM_VERIFY_TOKEN.test(token) || !IPM_REPORT_NUMBER.test(reportNumber)) {
    throw notFound();
  }
  const session = await models.InspectionSession.findOne({
    where: { verificationToken: token },
    skipTenantScope: true,
    // skipFacilityScope: the public verification resolves the 192-bit capability token without a
    // principal, and skipTenantScope with it (FACILITY_SCOPE_SKIPS; ADR-126 Am. 2 § 3; ADR-100).
    skipFacilityScope: true,
  });
  if (!session?.reportNumber || !sameText(session.reportNumber, reportNumber)) {
    throw notFound();
  }
  const supersededBy = session.supersededById
    ? await models.InspectionSession.findOne({
      where: { id: session.supersededById, tenantId: session.tenantId },
      attributes: ["id", "reportNumber", "submittedAt"],
      skipTenantScope: true,
      // skipFacilityScope: the superseding report's NUMBER only, of the token's own tenant (FACILITY_SCOPE_SKIPS).
      skipFacilityScope: true,
    })
    : null;
  const document = await runAsTenantRead(session, () => issuedDocument(session, { withVerifyUrl: false }));
  const device = document["device"] as IpmDeviceSnapshot;
  return {
    found: true,
    reportNumber: session.reportNumber,
    status: session.status === "voided" ? "voided" : session.supersededById ? "superseded" : "issued",
    supersededBy: supersededBy ? { reportNumber: supersededBy.reportNumber, at: iso(session.supersededAt) } : null,
    voidedAt: iso(session.voidedAt),
    issuedAt: iso(session.submittedAt),
    issuer: { name: (document["issuer"] as { name: string | null }).name },
    facility: { name: (document["facility"] as IpmFacilitySnapshot).name },
    device: { name: device.name, manufacturer: device.manufacturer, model: device.model, serialNumber: device.serialNumber, qrCode: device.qrCode },
    visitNumber: session.visitNumber,
    performedAt: iso(session.performedAt),
    recommendation: session.recommendation,
    signatures: document["signatures"],
    countersignEnabled: document["countersignEnabled"],
    integrity: document["integrity"],
    document,
  };
};

/**
 * Run the document read of a verified session inside its own tenant's context: the public request
 * has no principal, and the document's reads (results, pinned items, signatures, settings) must see
 * exactly that tenant's rows (runForTenant: the hooks confine every read to it).
 */
const runAsTenantRead = async <T>(session: SessionRow, read: () => Promise<T>): Promise<T> => runForTenant(session.tenantId, read);
