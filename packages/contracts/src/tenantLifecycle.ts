/**
 * Tenant lifecycle request schemas. The controller checks the merge of the
 * path and the body (`{ ...req.params, ...req.body }` — the body wins there,
 * AUDIT A-273).
 *
 * P9-11 (ADR-093): moved to Zod.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/tenantLifecycle.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the tenantLifecycle routes.
 */
import { z } from "zod";
import { booleanish, uuid } from "./fields";

const tenantIdSchema = z.object({
  tenantId: uuid(),
});

const suspendTenantSchema = z.object({
  tenantId: uuid(),
  reason: z.string().min(1),
});

/**
 * A-338 — POST /tenants/:tenantId/offboard: the path tenant and an optional
 * `force`. Offboarding is idempotent unless `force` (module reference §11): a
 * forced call re-offboards a tenant already offboarded, restarting its
 * retention window (it never shortens one). Super admin only (the route), and
 * audited with `force` by the service.
 */
const offboardTenantSchema = z.object({
  tenantId: uuid(),
  force: booleanish().optional(),
});

export { tenantIdSchema, suspendTenantSchema, offboardTenantSchema };

// The client-side (input) and handler-side (output) types of each schema.
export type TenantIdInput = z.input<typeof tenantIdSchema>;
export type TenantIdBody = z.output<typeof tenantIdSchema>;
export type SuspendTenantInput = z.input<typeof suspendTenantSchema>;
export type SuspendTenantBody = z.output<typeof suspendTenantSchema>;
export type OffboardTenantInput = z.input<typeof offboardTenantSchema>;
export type OffboardTenantBody = z.output<typeof offboardTenantSchema>;
