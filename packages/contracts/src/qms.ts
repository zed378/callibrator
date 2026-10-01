/**
 * QMS request validators. Without these, an out-of-enum value reached the DB
 * and produced an unhandled 500 (raw SQL enum error) instead of a 400. The
 * value sets are the models' own ENUMs (constants/qmsConstants), not a
 * restatement of them.
 *
 * None of these schemas accepts `tenantId`: it is stamped from the caller's
 * context, never read from a body (unknown keys are stripped).
 *
 * P9-11 (ADR-093): moved to Zod.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/qms.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for C:/Program Files/Git/api/v1/qms (non-conformance and CAPA create/update bodies).
 */
import { z } from "zod";
import { CAPA_STATUSES, NC_SEVERITIES, NC_STATUSES } from "./qmsValues";
import { dateLike, isoDate, nullableText, uuid } from "./fields";

const atLeastOneKey = (value: object): boolean => Object.keys(value).length >= 1;
const NOTHING_TO_UPDATE = { error: "Provide at least one field to update" };

// A-74 — POST /qms/nc. `title` and `description` are NOT NULL columns; a
// missing one used to reach the INSERT and 500.
const createNCSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1),
  severity: z.enum(NC_SEVERITIES).optional(),
  // Must be a device of the caller's tenant — checked in the service (A-75),
  // which answers 404 for another tenant's device.
  deviceId: uuid().nullable().optional(),
  dateIdentified: isoDate().optional(),
  rootCause: nullableText(),
});

// Partial update. `deviceId` is deliberately absent: an NC's device is fixed at
// creation (the service's allow-list never contained it).
const updateNCSchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().optional(),
    status: z.enum(NC_STATUSES).optional(),
    severity: z.enum(NC_SEVERITIES).optional(),
    rootCause: nullableText(),
  })
  .refine(atLeastOneKey, NOTHING_TO_UPDATE);

// A-74 — POST /qms/capa. `status` is not accepted: a CAPA is always created as
// DRAFT (qms.service#createCapa).
const createCapaSchema = z.object({
  ncId: uuid(),
  title: z.string().trim().min(1).max(255),
  actionPlan: z.string().trim().min(1),
  // Must be a user of the caller's tenant — checked in the service (A-75).
  assignedTo: uuid().nullable().optional(),
  dueDate: isoDate().nullable().optional(),
});

const updateCapaSchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    actionPlan: z.string().min(1).optional(),
    status: z.enum(CAPA_STATUSES).optional(),
    // A-75: a non-null value must be a user of the caller's tenant (service).
    assignedTo: uuid().nullable().optional(),
    dueDate: dateLike().nullable().optional(),
    completedDate: dateLike().nullable().optional(),
    // A-62: accepted for compatibility, but the id is IGNORED — a value records
    // the authenticated caller as approver (qms.service#updateCapa), null clears.
    approvedBy: uuid().nullable().optional(),
    verificationNotes: nullableText(),
  })
  .refine(atLeastOneKey, NOTHING_TO_UPDATE);

export { createNCSchema, updateNCSchema, createCapaSchema, updateCapaSchema };

// The client-side (input) and handler-side (output) types of each schema.
export type CreateNCInput = z.input<typeof createNCSchema>;
export type CreateNCBody = z.output<typeof createNCSchema>;
export type UpdateNCInput = z.input<typeof updateNCSchema>;
export type UpdateNCBody = z.output<typeof updateNCSchema>;
export type CreateCapaInput = z.input<typeof createCapaSchema>;
export type CreateCapaBody = z.output<typeof createCapaSchema>;
export type UpdateCapaInput = z.input<typeof updateCapaSchema>;
export type UpdateCapaBody = z.output<typeof updateCapaSchema>;
