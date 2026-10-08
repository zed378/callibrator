/**
 * The IPM session routes' request schemas (P21-03; ADR-126 and its Amendments 1 – 4; spec
 * MEMORY/specs/P19-02-ipm-session-aggregate.md § 9.4, § 10.2, § 10.3), and the field app's
 * administrator wipe (P19-08 spec § 11.3).
 *
 * Every body is STRICT: `tenantId`, `clientFacilityId`, `createdBy`, `performedBy`, `status` and
 * every other server-owned field is refused by the shape (FT-91 — attribution comes from the
 * principal, never the payload). A result row is a discriminated union on `inputKind`, so a reading
 * on a `check` item or an outcome on a `measured` one is refused before the service; the item's own
 * rules (its kind, outcomes, ranges and limit) run in the service through `normaliseResult`, against
 * the server's copy of the pinned version.
 *
 * Route forms carry the path parameter and the body together (`validate(schema, { from:
 * ["params", "body"] })`, the path-parameter trap); the `…Body` forms are the bodies alone (the
 * OpenAPI documents them).
 *
 * Imports nothing but `zod` and its siblings (both ends load it).
 */
import { z } from "zod";
import { booleanish, isoDate, numeric, uuid } from "./fields";
import { MAX_LIMIT } from "./pagination";
import { INSPECTION_SESSION_STATUSES } from "./states";
import {
  INSPECTION_CLEANLINESS,
  INSPECTION_OUTCOMES,
  INSPECTION_OVERALL_OUTCOMES,
  INSPECTION_RECOMMENDATIONS,
  INSPECTION_SECTIONS,
  INSPECTION_SECTION_RULES,
  IPM_MAX_AD_HOC_RESULTS,
  IPM_MAX_RESULTS,
  type InspectionSection,
} from "./inspectionValues";

const page = numeric(z.number().int().min(1)).default(1);
const limit = numeric(z.number().int().min(1).max(MAX_LIMIT)).default(25);
const revision = numeric(z.number().int().min(0));

/** A UUID v4 (the `clientRef` of an offline capture, the `Idempotency-Key` header). */
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidV4 = (): z.ZodString => z.string().regex(UUID_V4, { error: "Must be a UUID v4" });

/** A one-line text: inner whitespace collapsed, trimmed, `min` – `max` characters. */
const line = (min: number, max: number): z.ZodPipe<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>, z.ZodString> =>
  z
    .string()
    .transform((v) => v.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(min).max(max));

/** A reason (a correction's, a void's): 3 – 2000 characters, trimmed (spec § 4.1). */
const reason = z.string().trim().min(3).max(2000);

// ==========================================
// PARAMETERS AND LISTS
// ==========================================

/** `:sessionId`. */
export const ipmSessionIdParams = z.object({ sessionId: uuid() });
export type IpmSessionIdParams = z.output<typeof ipmSessionIdParams>;

/** The list orders (each ends in `id`, D-20). */
export const IPM_SESSION_SORTS = Object.freeze(["performedAt", "visitNumber"] as const);

/**
 * `GET /ipm/sessions` (spec § 10.2). `status` absent: the caller's drafts + submitted + voided
 * (`discarded` only on request); `effective` true: submitted and not superseded.
 */
export const ipmSessionListQuery = z.strictObject({
  page,
  limit,
  deviceId: uuid().optional(),
  clientFacilityId: uuid().optional(),
  status: z.enum(INSPECTION_SESSION_STATUSES).optional(),
  effective: booleanish().optional(),
  recommendation: z.enum(INSPECTION_RECOMMENDATIONS).optional(),
  performedBy: uuid().optional(),
  from: isoDate().optional(),
  to: isoDate().optional(),
  q: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(IPM_SESSION_SORTS).default("performedAt"),
});
export type IpmSessionListQuery = z.output<typeof ipmSessionListQuery>;

/** `GET /calibration-devices/:calibrationDeviceId/ipm-sessions` (params + paging). */
export const deviceIpmSessionsQuery = z.strictObject({ calibrationDeviceId: uuid(), page, limit });
export type DeviceIpmSessionsQuery = z.output<typeof deviceIpmSessionsQuery>;

// ==========================================
// CREATE, HEADER, CORRECTION, DISCARD
// ==========================================

const createShape = {
  deviceId: uuid(),
  templateVersionId: uuid().optional(),
  clientRef: uuidV4().optional(),
  capturedOffline: z.boolean().optional(),
  clientCapturedAt: isoDate().optional(),
  performedAt: isoDate().optional(),
};

/** `POST /ipm/sessions` — a root draft (spec § 7.1). */
export const ipmSessionCreate = z.strictObject(createShape);
export type IpmSessionCreate = z.output<typeof ipmSessionCreate>;

const headerShape = {
  revision,
  performedAt: isoDate().optional(),
  locationId: uuid().nullable().optional(),
  inspectionOutcome: z.enum(INSPECTION_OVERALL_OUTCOMES).nullable().optional(),
  maintenanceOutcome: z.enum(INSPECTION_OVERALL_OUTCOMES).nullable().optional(),
  recommendation: z.enum(INSPECTION_RECOMMENDATIONS).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
};
/** `PATCH /ipm/sessions/:sessionId` — the body alone. */
export const ipmSessionHeaderUpdateBody = z.strictObject(headerShape);
/** `PATCH /ipm/sessions/:sessionId` (params + body): a draft's header, at the revision last read. */
export const ipmSessionHeaderUpdate = z.strictObject({ sessionId: uuid(), ...headerShape });
export type IpmSessionHeaderUpdate = z.output<typeof ipmSessionHeaderUpdate>;

const discardShape = { reason: z.string().trim().max(500).optional() };
/** `POST /ipm/sessions/:sessionId/discard` — the body alone. */
export const ipmSessionDiscardBody = z.strictObject(discardShape);
/** `POST /ipm/sessions/:sessionId/discard` (params + body). */
export const ipmSessionDiscard = z.strictObject({ sessionId: uuid(), ...discardShape });
export type IpmSessionDiscard = z.output<typeof ipmSessionDiscard>;

const correctionShape = { reason, clientRef: uuidV4().optional() };
/** `POST /ipm/sessions/:sessionId/corrections` — the body alone. */
export const ipmSessionCorrectionBody = z.strictObject(correctionShape);
/** `POST /ipm/sessions/:sessionId/corrections` (params + body): a correction draft of an effective session. */
export const ipmSessionCorrection = z.strictObject({ sessionId: uuid(), ...correctionShape });
export type IpmSessionCorrection = z.output<typeof ipmSessionCorrection>;

// ==========================================
// RESULTS (§ 9.4)
// ==========================================

/** The sections a session may add its own rows to (P19-01 § 5.1). */
export const AD_HOC_SECTIONS: readonly InspectionSection[] = Object.freeze(INSPECTION_SECTIONS.filter((s) => INSPECTION_SECTION_RULES[s].adHoc));

/** An ad-hoc row's own text: its label and, by kind, its unit, symbol, setting and reference as typed. */
export const ipmAdHocItem = z.strictObject({
  section: z.enum(INSPECTION_SECTIONS).refine((s) => AD_HOC_SECTIONS.includes(s), { error: "This section takes no ad-hoc rows" }),
  label: line(1, 255),
  unit: z.string().trim().max(20).nullable().optional(),
  symbol: z.string().trim().max(50).nullable().optional(),
  settingText: z.string().trim().max(50).nullable().optional(),
  referenceText: z.string().trim().max(100).nullable().optional(),
});
export type IpmAdHocItem = z.output<typeof ipmAdHocItem>;

/** A reading as typed: a decimal string (`0,7` allowed) or a number. */
const reading = z.union([z.string().max(32), z.number()]).nullable().optional();

const itemRef = { templateItemId: uuid().optional(), adHoc: ipmAdHocItem.optional() };

/** One result row: what the technician answered, by the item's kind. */
export const ipmResultInput = z
  .discriminatedUnion("inputKind", [
    z.strictObject({ inputKind: z.literal("check"), ...itemRef, outcome: z.enum(["done", "not_done"]).nullable().optional() }),
    z.strictObject({ inputKind: z.literal("tri_state"), ...itemRef, outcome: z.enum(INSPECTION_OUTCOMES).nullable().optional() }),
    z.strictObject({
      inputKind: z.literal("condition_clean"),
      ...itemRef,
      outcome: z.enum(["good", "minor_damage", "major_damage"]).nullable().optional(),
      cleanliness: z.enum(INSPECTION_CLEANLINESS).nullable().optional(),
    }),
    z.strictObject({ inputKind: z.literal("measured"), ...itemRef, value: reading, notApplicable: z.boolean().optional() }),
    z.strictObject({
      inputKind: z.literal("measured_with_limit"),
      ...itemRef,
      value: reading,
      notApplicable: z.boolean().optional(),
      outcome: z.enum(["pass", "fail", "not_applicable"]).nullable().optional(),
    }),
    z.strictObject({
      inputKind: z.literal("setting_measured_reference"),
      ...itemRef,
      value1: reading,
      value2: reading,
      outcome: z.enum(["pass", "fail"]).nullable().optional(),
    }),
    z.strictObject({ inputKind: z.literal("text"), ...itemRef, text: z.string().max(500).nullable().optional() }),
  ])
  .superRefine((row, ctx) => {
    if ((row.templateItemId === undefined) === (row.adHoc === undefined)) {
      ctx.addIssue({ code: "custom", path: ["templateItemId"], message: "Name exactly one of templateItemId or adHoc" });
      return;
    }
    if (row.adHoc && INSPECTION_SECTION_RULES[row.adHoc.section].inputKinds[0] !== row.inputKind) {
      ctx.addIssue({ code: "custom", path: ["inputKind"], message: `An ad-hoc row of ${row.adHoc.section} is a ${String(INSPECTION_SECTION_RULES[row.adHoc.section].inputKinds[0])} row` });
    }
  });
export type IpmResultInput = z.output<typeof ipmResultInput>;

const resultsShape = { revision, results: z.array(ipmResultInput).max(IPM_MAX_RESULTS) };

/** The same template item twice, or more than 100 ad-hoc rows, is refused. */
const checkResults = (value: { results: readonly IpmResultInput[] }, ctx: z.RefinementCtx): void => {
  const ids = value.results.flatMap((r) => (r.templateItemId === undefined ? [] : [r.templateItemId]));
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: "custom", path: ["results"], message: "A checklist item appears twice" });
  }
  if (value.results.length - ids.length > IPM_MAX_AD_HOC_RESULTS) {
    ctx.addIssue({ code: "custom", path: ["results"], message: `At most ${String(IPM_MAX_AD_HOC_RESULTS)} ad-hoc rows` });
  }
};

/** `PUT /ipm/sessions/:sessionId/results` — the body alone. */
export const ipmResultsReplaceBody = z.strictObject(resultsShape).superRefine(checkResults);
/** `PUT /ipm/sessions/:sessionId/results` (params + body): a draft's results, replaced wholesale. */
export const ipmResultsReplace = z.strictObject({ sessionId: uuid(), ...resultsShape }).superRefine(checkResults);
export type IpmResultsReplace = z.output<typeof ipmResultsReplace>;

// ==========================================
// THE FIELD APP'S ADMINISTRATOR WIPE (P19-08 § 11.3, G-O9)
// ==========================================

/** `POST /field/wipes`: counts only — what was deleted on the phone, never its content. */
export const fieldWipe = z.strictObject({
  wipedUserId: uuid(),
  captures: numeric(z.number().int().min(0).max(100000)),
  photos: numeric(z.number().int().min(0).max(1000000)),
});
export type FieldWipe = z.output<typeof fieldWipe>;
