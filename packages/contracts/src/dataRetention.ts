/**
 * Data retention request schemas. The controller checks the merge of the path
 * and the body (`{ ...req.params, ...req.body }` — the body wins there, AUDIT
 * A-273).
 *
 * P9-11 (ADR-093): moved to Zod.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/dataRetention.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the dataRetention routes.
 */
import { z } from "zod";
import { booleanish, numeric, uuid } from "./fields";

const tenantIdSchema = z.object({
  tenantId: uuid(),
});

const retentionPolicySchema = z.object({
  tenantId: uuid(),
  policyKey: z.string().min(1),
  days: numeric(z.number().int().min(0)),
});

const legalHoldSchema = z.object({
  tenantId: uuid(),
  reason: z.string().min(1).optional(),
});

const ids = z.array(uuid()).min(1);

// A-135: masking the audit trail is per DATA SUBJECT (their user ids, in
// `subjectIds`), never per audit row id — naming rows would let an operator
// blank chosen rows' IP addresses, and an audit row id passed where a subject
// was meant would silently match nothing. `users` masking keeps `recordIds`.
const piiMaskSchema = z
  .object({
    tenantId: uuid(),
    entityType: z.string().min(1),
    recordIds: ids.optional(),
    subjectIds: ids.optional(),
  })
  .superRefine((value, ctx) => {
    const auditLogs = value.entityType === "audit_logs";
    const [wanted, refused] = auditLogs ? (["subjectIds", "recordIds"] as const) : (["recordIds", "subjectIds"] as const);
    if (value[wanted] === undefined) {
      ctx.addIssue({ code: "custom", path: [wanted], message: `${wanted} is required when entityType is ${value.entityType}` });
    }
    if (value[refused] !== undefined) {
      ctx.addIssue({ code: "custom", path: [refused], message: `${refused} is not allowed when entityType is ${value.entityType}` });
    }
  });

const anonymizeSchema = z.object({
  tenantId: uuid(),
  entityType: z.string().min(1),
  options: z
    .object({
      keepDates: booleanish().optional(),
      keepNumericIds: booleanish().optional(),
    })
    .optional(),
});

export { tenantIdSchema, retentionPolicySchema, legalHoldSchema, piiMaskSchema, anonymizeSchema };

// The client-side (input) and handler-side (output) types of each schema.
export type TenantIdInput = z.input<typeof tenantIdSchema>;
export type TenantIdBody = z.output<typeof tenantIdSchema>;
export type RetentionPolicyInput = z.input<typeof retentionPolicySchema>;
export type RetentionPolicyBody = z.output<typeof retentionPolicySchema>;
export type LegalHoldInput = z.input<typeof legalHoldSchema>;
export type LegalHoldBody = z.output<typeof legalHoldSchema>;
export type PiiMaskInput = z.input<typeof piiMaskSchema>;
export type PiiMaskBody = z.output<typeof piiMaskSchema>;
export type AnonymizeInput = z.input<typeof anonymizeSchema>;
export type AnonymizeBody = z.output<typeof anonymizeSchema>;
