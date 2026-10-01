/**
 * A-174 — the body of `PATCH /admin/tenants/:id/flags` (super admin).
 *
 * `admin.service#updateTenantFlags` merges `flags` into the `tenants.settings`
 * JSONB column. Before A-174 there was no validator: a string was spread into
 * the column one character per key (`"ab"` -> `{ "0": "a", "1": "b" }`), and a
 * secret-named key (`smtp_password`, `oidc_client_secret`, `oidc_rp_*`) was
 * written there in plaintext — re-planting exactly what A-150 and migration
 * 0035 take out. A tenant's credentials live only in `tenant_settings`,
 * encrypted, and are written only through their own endpoints.
 *
 * A flag is a short identifier-shaped key with a scalar value.
 *
 * P9-11 (ADR-093): moved to Zod.
 */
import { z } from "zod";
import { isRedactedSettingKey } from "../constants/tenantSecretSettings";

const TENANT_FLAG_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const MAX_TENANT_FLAGS = 50;
const MAX_FLAG_STRING_LENGTH = 1000;

/**
 * Why `flags` cannot be merged, or null when it can. Shared by the route
 * validator and the service, so a direct service caller is held to the same
 * rules as the route.
 *
 * @param flags - the `flags` value of the request body
 * @returns the problem, naming the key, or null
 */
const tenantFlagsProblem = (flags: unknown): string | null => {
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) {
    return "flags must be an object of flag keys to values";
  }
  const entries = Object.entries(flags);
  if (entries.length > MAX_TENANT_FLAGS) {
    return `flags may set at most ${String(MAX_TENANT_FLAGS)} keys`;
  }
  for (const [key, value] of entries) {
    if (!TENANT_FLAG_KEY_PATTERN.test(key)) {
      return `flag "${key}" is not a valid flag key`;
    }
    if (isRedactedSettingKey(key)) {
      return `flag "${key}" names a secret; secrets are never stored in tenant flags`;
    }
    const scalar =
      value === null ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value)) ||
      (typeof value === "string" && value.length <= MAX_FLAG_STRING_LENGTH);
    if (!scalar) {
      return `flag "${key}" must be a boolean, finite number, null or a string of at most ${String(MAX_FLAG_STRING_LENGTH)} characters`;
    }
  }
  return null;
};

/** A flag value, as `tenantFlagsProblem` accepts it. */
export type TenantFlagValue = boolean | number | string | null;

/** `flags`: required, and every key and value as `tenantFlagsProblem` allows. */
const flags = z
  .unknown()
  .superRefine((value, ctx) => {
    const problem = value === undefined ? "flags is required" : tenantFlagsProblem(value);
    if (problem) {
      ctx.addIssue({ code: "custom", message: problem });
    }
  })
  // tenantFlagsProblem has just proved this shape; Zod cannot narrow through it.
  .transform((value) => value as Record<string, TenantFlagValue>);

const updateTenantFlagsSchema = z.object({ flags });

export { updateTenantFlagsSchema, tenantFlagsProblem, TENANT_FLAG_KEY_PATTERN };
