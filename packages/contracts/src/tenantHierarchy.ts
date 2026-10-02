/**
 * Tenant Hierarchy Validators.
 *
 * P9-11 (ADR-093): moved to Zod; the file's `validate` helper, which nothing
 * called, is gone (`validators/input` is the one helper).
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/tenantHierarchy.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the tenantHierarchy routes.
 */
import { z } from "zod";
import { jsonObject } from "./fields";

/** Validate sub-organization creation. */
const createSubOrganization = z.object({
  name: z.string().min(2).max(255),
});

/** Validate add child tenant (POST /:tenantId/children, the parent; checked in the controller). */
const addChild = z.object({
  name: z.string().min(2).max(255),
  code: z.string().min(1).max(50).optional(),
  settings: jsonObject().optional(),
  plan: z.enum(["free", "professional", "business", "enterprise"]).default("free"),
});

// ADR-084 (Q-05): `assignRole` — a role granted "across the hierarchy" with a
// default scope of "subtree" — was removed. Its handler went under A-255, and
// a hierarchy grants no reach into another tenant.

export { createSubOrganization, addChild };

// The client-side (input) and handler-side (output) types of each schema.
export type CreateSubOrganizationInput = z.input<typeof createSubOrganization>;
export type CreateSubOrganizationBody = z.output<typeof createSubOrganization>;
export type AddChildInput = z.input<typeof addChild>;
export type AddChildBody = z.output<typeof addChild>;
