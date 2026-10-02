/**
 * Supplier scorecards (ISO 13485 §7.4 supplier evaluation):
 * `/api/v1/supplier-scorecard`.
 *
 * P9-20/21 (ADR-097 Am. 5): the responses, published code-first. A-336
 * (2026-10-01): the request bodies, enforced by `validate()` on the routes —
 * before, `supplierScorecard.service` stored whatever body it was given.
 */
import { z } from "zod";
import { isoDate, numeric, optionalText, uuid } from "./fields";

const timestamp = z.iso.datetime();
const rowId = z.guid();

/** The values `supplierScorecard.model` names in its comment (the column is a free string). */
const SCORECARD_STATUSES = ["APPROVED", "PROBATION", "DISQUALIFIED"] as const;

/** A score: an integer 0–100 (a numeric string is read as its number). */
const score = numeric(z.number().int().min(0).max(100));

/**
 * A-336 (2026-10-01): the request bodies, mounted with `validate()` on
 * `POST /` and `PUT /:id`. An explicit allow-list: anything else — `id`,
 * `tenantId`, `evaluatedBy`, `overallScore`, the timestamps — is STRIPPED (the
 * parsed body replaces `req.body`). `vendorId` must be a vendor of the
 * caller's tenant, on create AND on an update that changes it (404 otherwise,
 * as for a vendor that does not exist). `status` is the evaluation's outcome,
 * the evaluator's judgement, so it is accepted within SCORECARD_STATUSES.
 */
const createScorecard = z.object({
  vendorId: uuid().meta({ description: "A vendor of the caller's tenant (else 404)" }),
  evaluationDate: isoDate(),
  qualityScore: score.optional().meta({ description: "0–100; defaults to 0" }),
  deliveryScore: score.optional().meta({ description: "0–100; defaults to 0" }),
  serviceScore: score.optional().meta({ description: "0–100; defaults to 0" }),
  status: z.enum(SCORECARD_STATUSES).optional().meta({ description: "Defaults to APPROVED" }),
  comments: optionalText(),
  nextEvaluationDate: isoDate().nullable().optional(),
});

/** An update: any subset of the create fields. */
const updateScorecard = createScorecard.partial();

const scorecardFields = {
  id: rowId,
  tenantId: rowId,
  vendorId: rowId,
  evaluationDate: timestamp,
  qualityScore: z.number().int(),
  deliveryScore: z.number().int(),
  serviceScore: z.number().int(),
  overallScore: z.number().int().meta({ description: "The rounded mean of the three scores (computed, not stored)" }),
  status: z.string(),
  comments: z.string().nullable(),
  evaluatedBy: rowId.nullable().meta({ description: "The user who evaluated (the caller on create)" }),
  nextEvaluationDate: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: timestamp.nullable(),
};

const scorecardExample = {
  id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
  tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
  vendorId: "5f0c2a8e-7c1d-4b6a-9e2f-3d4c5b6a7e81",
  evaluationDate: "2026-09-30T00:00:00.000Z",
  qualityScore: 92,
  deliveryScore: 85,
  serviceScore: 88,
  overallScore: 88,
  status: "APPROVED",
  comments: null,
  evaluatedBy: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  nextEvaluationDate: "2027-09-30T00:00:00.000Z",
  createdAt: "2026-09-30T09:00:00.000Z",
  updatedAt: "2026-09-30T09:00:00.000Z",
  deletedAt: null,
};

/** The vendor as the reads include it: `{ id, name }`, or null. */
const vendorRef = z.object({ id: rowId, name: z.string() }).nullable();
/** The evaluator as the reads include it: `{ id, firstName, lastName, email }`, or null. */
const userRef = z.object({ id: rowId, firstName: z.string(), lastName: z.string(), email: z.string() }).nullable();

/** A scorecard as created or updated. An update answers the row it read, so with its vendor and evaluator. */
const scorecardResponse = z
  .object({
    ...scorecardFields,
    vendor: vendorRef.optional().meta({ description: "Present when the row was read with its associations (update)" }),
    evaluator: userRef.optional().meta({ description: "Present when the row was read with its associations (update)" }),
  })
  .meta({ id: "SupplierScorecard", description: "One evaluation of a supplier.", example: scorecardExample });

/** A scorecard as listed or fetched by id: with its vendor and evaluator. */
const scorecardWithRefs = z
  .object({ ...scorecardFields, vendor: vendorRef, evaluator: userRef })
  .meta({ id: "SupplierScorecardWithRefs", description: "A scorecard with its vendor and evaluator." });

export { SCORECARD_STATUSES, createScorecard, updateScorecard, scorecardResponse, scorecardWithRefs };

/** What a client may send to create a scorecard. */
export type CreateScorecardInput = z.input<typeof createScorecard>;
/** What a client may send to update a scorecard. */
export type UpdateScorecardInput = z.input<typeof updateScorecard>;

/** A scorecard as the API answers it. */
export type ScorecardResponse = z.output<typeof scorecardResponse>;
