/**
 * P21-03 (ADR-103, ADR-126) — an IPM session as the routes answer it, shared by
 * ipmSessions.openapi.ts and calibrationDevices.openapi.ts. Response documentation only: nothing
 * validates against it. The fields are services/ipmSession.service's views: never the legacy key
 * (FT-104) and never the report's verification token. Examples are synthetic.
 */
import { z } from "zod";
import {
  INSPECTION_CLEANLINESS,
  INSPECTION_INPUT_KINDS,
  INSPECTION_OUTCOMES,
  INSPECTION_OUTCOME_SOURCES,
  INSPECTION_OVERALL_OUTCOMES,
  INSPECTION_RECOMMENDATIONS,
  INSPECTION_SECTIONS,
} from "@callibrator/contracts/inspectionValues";
import { INSPECTION_SESSION_STATUSES } from "@callibrator/contracts/states";

const decimal = z.string().nullable().meta({ description: "An exact decimal as a string (never a binary float)", example: "0.5" });
const text = z.string().nullable();
const at = z.iso.datetime();
const id = z.guid();

const person = z
  .object({ name: text, role: text, organisation: text, redacted: z.boolean() })
  .nullable()
  .meta({ description: "Who performed it: the submit's snapshot once submitted, else the user's display (A-90)" });

export const IpmResult = z
  .object({
    id,
    section: z.enum(INSPECTION_SECTIONS),
    inputKind: z.enum(INSPECTION_INPUT_KINDS),
    templateItemId: id.nullable(),
    itemDefinitionId: id.nullable(),
    isAdHoc: z.boolean(),
    label: z.string().meta({ description: "The server's copy of the item's label (the technician's text on an ad-hoc row)" }),
    unit: text,
    symbol: text,
    settingText: text,
    referenceText: text,
    outcome: z.enum(INSPECTION_OUTCOMES).nullable(),
    cleanliness: z.enum(INSPECTION_CLEANLINESS).nullable(),
    measuredValue: decimal,
    measuredValue1: decimal,
    measuredValue2: decimal,
    textValue: text,
    computedOutcome: z.enum(INSPECTION_OVERALL_OUTCOMES).nullable(),
    outcomeSource: z.enum(INSPECTION_OUTCOME_SOURCES).nullable(),
    warnFlag: z.boolean(),
    disagreementFlag: z.boolean(),
    sortOrder: z.number().int(),
  })
  .meta({ id: "IpmResult", description: "One answered checklist item, in read order (section, then sort order)" });

const header = {
  id,
  deviceId: id,
  clientFacilityId: id,
  templateVersionId: id.nullable(),
  status: z.enum(INSPECTION_SESSION_STATUSES),
  effective: z.boolean().meta({ description: "Submitted and not superseded: the visit's current record" }),
  revision: z.number().int().meta({ description: "A draft's save counter; every write sends the revision it last read" }),
  supersedesId: id.nullable(),
  correctionReason: text,
  supersededById: id.nullable(),
  supersededAt: at.nullable(),
  performedAt: at,
  receivedAt: at,
  capturedOffline: z.boolean(),
  clientCapturedAt: at.nullable().meta({ description: "The phone's claim; never used for ordering, numbering or due" }),
  clientRef: id.nullable(),
  createdBy: id.nullable(),
  performedBy: id.nullable(),
  submittedAt: at.nullable(),
  visitNumber: z.number().int().nullable(),
  legacyVisitNumber: z.number().int().nullable(),
  inspectionOutcome: z.enum(INSPECTION_OVERALL_OUTCOMES).nullable(),
  maintenanceOutcome: z.enum(INSPECTION_OVERALL_OUTCOMES).nullable(),
  recommendation: z.enum(INSPECTION_RECOMMENDATIONS).nullable(),
  notes: text,
  locationId: id.nullable(),
  performerSnapshot: z.object({ name: z.string(), role: text, organisation: text }).nullable(),
  roomSnapshot: text,
  floorSnapshot: text,
  deviceSnapshot: z.record(z.string(), z.unknown()).nullable(),
  facilitySnapshot: z.record(z.string(), z.unknown()).nullable(),
  sideEffects: z.record(z.string(), z.unknown()).nullable(),
  workOrderId: id.nullable(),
  followUpWorkOrderId: id.nullable(),
  reportNumber: text,
  voidReason: text,
  voidedAt: at.nullable(),
  discardedAt: at.nullable(),
  createdAt: at,
  updatedAt: at,
  performerDisplay: person,
};

export const IpmSessionSummary = z.object(header).meta({ id: "IpmSessionSummary", description: "An IPM session's header (lists)" });

export const IpmSession = z
  .object({
    ...header,
    templateVersionNumber: z.number().int().nullable(),
    templateContentHash: text.meta({ description: "The pinned version's content hash (the client renders its catalogue copy of it)" }),
    device: z
      .object({
        id,
        name: z.string(),
        manufacturer: text,
        model: text,
        serialNumber: text,
        qrCode: text,
        deviceTypeId: id.nullable(),
        locationId: id.nullable(),
        status: text,
      })
      .nullable()
      .meta({ description: "The device prefill, read in the caller's context" }),
    results: z.array(IpmResult),
    notices: z.array(z.string()).meta({ description: "What the server noted (e.g. an offline capture on a non-current checklist)" }),
  })
  .meta({ id: "IpmSession", description: "An IPM session with its results (ADR-126)" });

// ── P21-04: the report document, its signatures, the public verdict and "due" (P19-06 § 9, § 10) ──

const hash = z.string().regex(/^[0-9a-f]{64}$/).meta({ example: "0".repeat(64) });

/** A signature as the document prints it: never the signer's id, address or agent (FT-71). */
export const IpmReportSignature = z
  .object({
    kind: z.enum(["performer", "countersign"]),
    name: z.string(),
    role: text,
    organisation: text,
    meaning: z.enum(["authorship", "review"]),
    signedAt: at.nullable(),
    authMethod: z.enum(["password", "mfa"]),
    valid: z.boolean().meta({ description: "Its document hash equals the stored and the recomputed content hash" }),
  })
  .meta({ id: "IpmReportSignature", description: "An electronic signature on an IPM report (Part 11: name, time, meaning)" });

/** The data document the browser renders (`ipm-report-v1`). */
export const IpmReportDocument = z
  .object({
    scheme: z.literal("ipm-report-v1"),
    kind: z.enum(["issued", "preview"]),
    sessionId: id,
    reportNumber: text.meta({ example: "IPM-F-0001-20261008-003" }),
    verifyUrl: text.meta({ description: "The QR's link (issued only; absent from the public verdict's copy)" }),
    status: z.enum(["draft", "submitted", "superseded", "voided"]),
    lineage: z.object({ supersedesReportNumber: text, supersededByReportNumber: text, supersededAt: at.nullable(), voidedAt: at.nullable() }),
    issuer: z.record(z.string(), z.string().nullable()).meta({ description: "The letterhead at submit, and the live logo (unhashed)" }),
    facility: z.object({ id, name: z.string(), code: text, kind: text, address: text }),
    device: z.record(z.string(), z.string().nullable()),
    room: text,
    floor: text,
    visitNumber: z.number().int().nullable(),
    legacyVisitNumber: z.number().int().nullable(),
    performedAt: at,
    submittedAt: at.nullable(),
    timeZone: z.string(),
    checklist: z.record(z.string(), z.unknown()),
    sections: z.array(z.object({ section: z.enum(INSPECTION_SECTIONS), items: z.array(z.record(z.string(), z.unknown())) })),
    inspectionOutcome: text,
    maintenanceOutcome: text,
    recommendation: text,
    notes: text,
    performer: z.object({ name: z.string(), role: text, organisation: text }),
    signatures: z.array(IpmReportSignature),
    countersignEnabled: z.boolean(),
    integrity: z.object({ scheme: z.string(), hash, state: z.enum(["match", "mismatch"]) }).nullable(),
    flags: z.object({ capturedOffline: z.boolean(), imported: z.boolean() }),
    generatedAt: at,
  })
  .meta({ id: "IpmReportDocument", description: "The IPM report's data document — the browser renders it (no PDF is stored)" });

/** The public verdict. */
export const IpmVerification = z
  .object({
    found: z.literal(true),
    reportNumber: z.string(),
    status: z.enum(["issued", "superseded", "voided"]),
    supersededBy: z.object({ reportNumber: text, at: at.nullable() }).nullable(),
    voidedAt: at.nullable(),
    issuedAt: at.nullable(),
    issuer: z.object({ name: text }),
    facility: z.object({ name: z.string() }),
    device: z.record(z.string(), z.string().nullable()),
    visitNumber: z.number().int().nullable(),
    performedAt: at.nullable(),
    recommendation: text,
    signatures: z.array(IpmReportSignature),
    countersignEnabled: z.boolean(),
    integrity: z.object({ scheme: z.string(), hash, state: z.enum(["match", "mismatch"]) }),
    document: IpmReportDocument,
  })
  .meta({ id: "IpmVerification", description: "The verdict for the holder of the printed report's QR; never an id, tenant, token or void reason" });

/** One device of the "due" list. */
export const IpmDueDevice = z
  .object({
    id,
    name: z.string(),
    qrCode: text,
    serialNumber: text,
    clientFacilityId: id,
    status: text,
    ipmIntervalMonths: z.number().int().nullable(),
    ipmDue: z
      .object({
        state: z.enum(["not_scheduled", "never_inspected", "due", "ok"]),
        dueMonth: z.string().optional().meta({ example: "2026-11" }),
        lastPerformedAt: at.optional(),
        intervalMonths: z.number().int().optional(),
      })
      .meta({ description: "computeIpmDue (contracts) — the server's and the field app's answer" }),
  })
  .meta({ id: "IpmDueDevice", description: "A device whose IPM is due (ADR-126 § 6: computed at read, never enforced)" });
