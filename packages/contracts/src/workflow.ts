/**
 * Approval workflow request bodies.
 *
 * P9-11 (ADR-093): moved to Zod.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/workflow.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the workflow routes.
 */
import { z } from "zod";
import { booleanish, nullableText, numeric, uuid } from "./fields";

const step = z.object({
  stepOrder: numeric(z.number().int().min(1)),
  roleId: uuid(),
  requiredApprovals: numeric(z.number().int().min(1)).optional(),
});

const createWorkflowSchema = z.object({
  name: z.string().min(1),
  resourceType: z.enum(["Certificate", "StockTransfer", "MaintenanceWorkOrder"]),
  isActive: booleanish().optional(),
  steps: z.array(step).min(1),
});

const updateWorkflowSchema = z.object({
  name: z.string().min(1).optional(),
  isActive: booleanish().optional(),
  steps: z.array(step).min(1).optional(),
});

// A-182 — approving a Certificate is an electronic signature, so the caller
// re-authenticates with the same three fields as POST /certificates/:id/approve.
// They are optional here because a StockTransfer or work-order decision, and
// any rejection, needs none; workflow.service#submitAction requires them when
// the instance decides on a Certificate. The approver is always the caller.
const submitActionSchema = z.object({
  action: z.enum(["APPROVED", "REJECTED"]),
  comments: nullableText(),
  authMethod: z.enum(["password", "mfa"]).optional(),
  authPayload: z.string().min(1).optional(),
  meaning: z.string().min(1).max(255).optional(),
});

export { createWorkflowSchema, updateWorkflowSchema, submitActionSchema };

// The client-side (input) and handler-side (output) types of each schema.
export type CreateWorkflowInput = z.input<typeof createWorkflowSchema>;
export type CreateWorkflowBody = z.output<typeof createWorkflowSchema>;
export type UpdateWorkflowInput = z.input<typeof updateWorkflowSchema>;
export type UpdateWorkflowBody = z.output<typeof updateWorkflowSchema>;
export type SubmitActionInput = z.input<typeof submitActionSchema>;
export type SubmitActionBody = z.output<typeof submitActionSchema>;
