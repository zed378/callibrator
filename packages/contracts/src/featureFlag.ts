/**
 * Feature flag request schemas. The controller checks the merge of the path
 * and the body (`{ ...req.params, ...req.body }` — the body wins there, AUDIT
 * A-273).
 *
 * P9-11 (ADR-093): moved to Zod.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/featureFlag.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the featureFlag routes.
 */
import { z } from "zod";
import { booleanish, uuid } from "./fields";

const flagKeySchema = z.object({
  tenantId: uuid(),
  flagKey: z.string().min(1),
});

const flagValueSchema = z.object({
  tenantId: uuid(),
  flagKey: z.string().min(1),
  enabled: booleanish(),
});

const tenantFlagQuerySchema = z.object({
  tenantId: uuid(),
});

export { flagKeySchema, flagValueSchema, tenantFlagQuerySchema };

// The client-side (input) and handler-side (output) types of each schema.
export type FlagKeyInput = z.input<typeof flagKeySchema>;
export type FlagKeyBody = z.output<typeof flagKeySchema>;
export type FlagValueInput = z.input<typeof flagValueSchema>;
export type FlagValueBody = z.output<typeof flagValueSchema>;
export type TenantFlagQueryInput = z.input<typeof tenantFlagQuerySchema>;
export type TenantFlagQueryBody = z.output<typeof tenantFlagQuerySchema>;
