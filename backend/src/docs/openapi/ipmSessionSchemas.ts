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
