/**
 * The risk register (ISO 14971 / ISO 13485 risk management file):
 * `/api/v1/risk`.
 *
 * P9-20/21 (ADR-097 Am. 5): the responses, published code-first. A-335
 * (2026-10-01): the request bodies, enforced by `validate()` on the routes —
 * before, `risk.service` stored whatever body it was given.
 */
import { z } from "zod";
import { isoDate, numeric, optionalText, uuid } from "./fields";

const timestamp = z.iso.datetime();
const rowId = z.guid();

/** The values `risk.model` names in its comments (the columns are free strings). */
const RISK_CATEGORIES = ["OPERATIONAL", "FINANCIAL", "COMPLIANCE", "STRATEGIC", "SAFETY"] as const;
const RISK_STATUSES = ["OPEN", "MITIGATED", "CLOSED", "ACCEPTED"] as const;

/**
 * A-335 (2026-10-01): the request bodies, mounted with `validate()` on
 * `POST /` and `PUT /:id`. An explicit allow-list: anything else in a body —
 * `id`, `tenantId`, `identifiedBy`, `rpn`, the timestamps — is STRIPPED (the
 * parsed body replaces `req.body`), so a client can never set a server-owned
 * attribute. On create `status` is server-owned too (a risk starts OPEN); an
 * update may move it within RISK_STATUSES, which is how a mitigation, an
 * acceptance or a closure is recorded.
 */
const createRisk = z
  .object({
    title: z.string().trim().min(1).max(255),
    description: optionalText(),
    category: z.enum(RISK_CATEGORIES).optional().meta({ description: "Defaults to OPERATIONAL" }),
    severity: numeric(z.number().int().min(1).max(5)).optional().meta({ description: "1–5; defaults to 1" }),
    likelihood: numeric(z.number().int().min(1).max(5)).optional().meta({ description: "1–5; defaults to 1" }),
    mitigationPlan: optionalText(),
    assignedTo: uuid().nullable().optional().meta({ description: "A user of the caller's tenant (else 404, A-277)" }),
    dueDate: isoDate().nullable().optional(),
  });

/** An update: any subset of the create fields, and `status`. */
const updateRisk = createRisk
  .partial()
  .extend({ status: z.enum(RISK_STATUSES).optional().meta({ description: "OPEN, MITIGATED, CLOSED or ACCEPTED" }) });

const riskFields = {
  id: rowId,
  tenantId: rowId,
  title: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  severity: z.number().int(),
  likelihood: z.number().int(),
  rpn: z.number().int().meta({ description: "severity × likelihood (computed, not stored)" }),
  status: z.string(),
  mitigationPlan: z.string().nullable(),
  identifiedBy: rowId.nullable().meta({ description: "The user who recorded it (the caller on create)" }),
  assignedTo: rowId.nullable(),
  dueDate: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: timestamp.nullable(),
};

const riskExample = {
  id: "8e7d6c5b-4a3f-4e2d-9c1b-0a9f8e7d6c5b",
  tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
  title: "Infusion pump occlusion alarm not audible in ward",
  description: null,
  category: "SAFETY",
  severity: 4,
  likelihood: 2,
  rpn: 8,
  status: "OPEN",
  mitigationPlan: "Relocate the alarm repeater; retest quarterly.",
  identifiedBy: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  assignedTo: null,
  dueDate: "2026-12-01T00:00:00.000Z",
  createdAt: "2026-10-01T08:00:00.000Z",
  updatedAt: "2026-10-01T08:00:00.000Z",
  deletedAt: null,
};

/** A user as the risk reads include it: `{ id, firstName, lastName, email }`, or null. */
const userRef = z.object({ id: rowId, firstName: z.string(), lastName: z.string(), email: z.string() }).nullable();

/** A risk as created or updated. An update answers the row it read, so with its people included. */
const riskResponse = z
  .object({
    ...riskFields,
    identifier: userRef.optional().meta({ description: "Present when the row was read with its people (update)" }),
    assignee: userRef.optional().meta({ description: "Present when the row was read with its people (update)" }),
  })
  .meta({ id: "Risk", description: "An entry of the risk register.", example: riskExample });

/** A risk as listed or fetched by id: with the identifier and the assignee. */
const riskWithPeople = z
  .object({ ...riskFields, identifier: userRef, assignee: userRef })
  .meta({ id: "RiskWithPeople", description: "A risk with who recorded it and who owns it." });

export { RISK_CATEGORIES, RISK_STATUSES, createRisk, updateRisk, riskResponse, riskWithPeople };

/** What a client may send to create a risk. */
export type CreateRiskInput = z.input<typeof createRisk>;
/** What a client may send to update a risk. */
export type UpdateRiskInput = z.input<typeof updateRisk>;

/** A risk as the API answers it. */
export type RiskResponse = z.output<typeof riskResponse>;
