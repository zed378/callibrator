/**
 * P9-21 / P9-25 (ADR-103) — the Tenant row as the tenancy routes answer it,
 * shared by tenant.openapi.ts, tenantLifecycle.openapi.ts and
 * tenantHierarchy.openapi.ts. Response documentation only: nothing validates
 * against it.
 *
 * The fields are the Tenant model's attributes (models/tenant.model.ts) as
 * JSON. `settings` leaves the server without the credentials mirrored into it
 * (A-179, A-263: `withoutRedactedSettings`). It replaces the JSDoc `Tenant`
 * component of docs/components.js, which listed neither the profile (A-303),
 * hierarchy nor lifecycle columns.
 */
import { z } from "zod";
import { TENANT_LIFECYCLE_STATUSES } from "@callibrator/contracts/states";

/** The `plan` ENUM (models/tenant.model.ts TENANT_PLANS). */
export const TENANT_PLANS = ["free", "professional", "business", "enterprise"] as const;
/** The `status` ENUM (models/tenant.model.ts TENANT_STATUSES). */
export const TENANT_STATUSES = TENANT_LIFECYCLE_STATUSES; // P9-05: the one list

const nullableString = z.string().nullable();
const nullableDate = z.iso.datetime().nullable();

const tenantFields = {
  id: z.guid(),
  name: z.string().meta({ example: "General Hospital Example" }),
  subdomain: z.string().meta({ example: "general-hospital" }),
  email: z.string(),
  domain: nullableString,
  logo: nullableString,
  logoBaseUrl: nullableString.optional().meta({ description: "The logo's public URL (tenant.service answers only)" }),
  primaryColor: nullableString,
  plan: z.enum(TENANT_PLANS).nullable(),
  status: z.enum(TENANT_STATUSES).nullable(),
  trialEndsAt: nullableDate,
  billingCycle: z.enum(["monthly", "yearly"]).nullable(),
  billingEmail: nullableString,
  contactName: nullableString,
  contactEmail: nullableString,
  contactPhone: nullableString,
  description: nullableString,
  phone: nullableString,
  address: nullableString,
  city: nullableString,
  state: nullableString,
  zipCode: nullableString,
  country: nullableString,
  website: nullableString,
  settings: z.record(z.string(), z.unknown()).nullable().meta({ description: "Tenant settings (JSONB)" }),
  limitSeats: z.number().int().nullable(),
  limitStorageMb: z.number().int().nullable(),
  code: nullableString,
  parentId: z.guid().nullable().meta({ description: "The parent tenant (hierarchy); null for a root tenant" }),
  isDeleted: z.boolean(),
  suspensionReason: nullableString,
  suspendedAt: nullableDate,
  suspendedBy: z.guid().nullable(),
  gracePeriodExpiresAt: nullableDate,
  offboardedAt: nullableDate,
  offboardRetentionExpiresAt: nullableDate,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: nullableDate,
};

/** A tenant as the lifecycle, hierarchy and tenant routes answer it: settings without credentials. */
export const tenantRow = z
  .looseObject(tenantFields)
  .meta({ id: "Tenant", description: "A tenant (organisation) as JSON, its settings without credentials" });

/**
 * A tenant as the platform operator's admin routes answer it: the model row
 * as JSON, `settings` AS STORED (admin.service does not redact them).
 */
export const storedTenantRow = z
  .looseObject(tenantFields)
  .meta({ id: "TenantAsStored", description: "A tenant (organisation) as JSON, its settings as stored (super admin only)" });

/** `:tenantId`, with an example (the controllers check the UUID shape). */
export const tenantIdParams = z.object({
  tenantId: z.guid().meta({ description: "The tenant's id", example: "2b7c9e41-5d3a-4f6e-8a1b-0c9d8e7f6a5b" }),
});
