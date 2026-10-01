/**
 * Aligned with the Subscription model and billing.service (which reads
 * `planId`, `billingCycle`, `status`): the previous `planName` field was
 * silently ignored by the service, and "Yearly" did not match the model's
 * "Annually" enum value.
 *
 * A-225: `reason` explains a manual status override (the service requires it
 * when the status changes); at least one updatable field must be sent.
 *
 * P9-11 (ADR-093): moved to Zod.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/billing.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the billing routes.
 */
import { z } from "zod";

const updateSubscription = z
  .object({
    planId: z.string().trim().min(1).max(100).optional(),
    status: z.enum(["Active", "PastDue", "Canceled", "Unpaid"]).optional(),
    billingCycle: z.enum(["Monthly", "Annually"]).optional(),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .refine((v) => v.planId !== undefined || v.status !== undefined || v.billingCycle !== undefined, {
    error: "Provide at least one of planId, status, billingCycle",
  });

export { updateSubscription };

// The client-side (input) and handler-side (output) types of each schema.
export type UpdateSubscriptionInput = z.input<typeof updateSubscription>;
export type UpdateSubscriptionBody = z.output<typeof updateSubscription>;
