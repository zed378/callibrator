/**
 * Tenant validation schemas.
 *
 * P9-11 (ADR-093): moved to Zod. `status` is matched case-insensitively and
 * output upper-case, which is what the previous schemas' object-level custom step
 * did after the match.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/tenant.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for /api/v1/tenants (list query, id params, create, update, settings and domain bodies).
 */
import { z } from "zod";
// P7-08 / ADR-071 (amendment): a logo is an uploaded file name, never a URL.
import { STORED_LOGO_NAME } from "./tenantLogo";
import { caseless, email as emailAddress, nullableText, numeric, optionalText, uuid } from "./fields";

const TENANT_STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED"] as const;

const logoField = z
  .string()
  .regex(STORED_LOGO_NAME, { error: "logo must be an uploaded file name, not a URL or a path" })
  .or(z.literal(""))
  .nullable()
  .optional();

// ADR-090 amendment (2026-09-29): the brand colour is checked for FORM only,
// never refused for contrast. No single colour can be read at 4.5:1 on both
// the light card (#ffffff) and the dark one (#1e293b), so a contrast rule here
// could only refuse every colour for one theme. The frontend derives an
// accessible shade per theme from whatever is stored
// (frontend/src/lib/brandColor.ts) and shows it on the form before saving.
// Pinned by tests/validators/tenant.brandColor.adr090.test.ts.
const primaryColor = z
  .string()
  .regex(/^#([0-9a-fA-F]{6})$/, { error: "primaryColor must be a #RRGGBB colour" })
  .or(z.literal(""))
  .nullable()
  .optional();

const optionalId = uuid().or(z.literal("")).nullable().optional();
const email = emailAddress().or(z.literal("")).nullable().optional();
// A-303: the profile is stored now (migration 0100), and printed on every
// certificate as the issuing laboratory's contact (ISO/IEC 17025 7.8.2), so its
// form is checked and each length fits its column (a longer value would be a
// PostgreSQL "value too long" 500, not a 400).
//  - website: an absolute http(s) URL only. `z.url()` alone accepts any scheme
//    — `javascript:`, `data:`, `ftp:` — and the value is rendered as a link.
//  - phone: digits with the usual separators ( + space ( ) . - / ), an
//    optional extension, 6–20 digits in all, at most 50 characters (the column).
const website = z
  .url({ protocol: /^https?$/, error: "website must be an http:// or https:// address" })
  .max(255)
  .or(z.literal(""))
  .nullable()
  .optional();
const PHONE_PATTERN = /^\+?[0-9 ()./-]+(?:\s*(?:ext\.?|x)\s*[0-9]{1,6})?$/i;
const phone = z
  .string()
  .trim()
  .max(50)
  .regex(PHONE_PATTERN, { error: "phone may contain only digits, spaces, + ( ) . - / and an extension" })
  .refine((value) => {
    const digits = value.replace(/[^0-9]/g, "").length;
    return digits >= 6 && digits <= 20;
  }, { error: "phone must have 6 to 20 digits" })
  .or(z.literal(""))
  .nullable()
  .optional();
/** The profile fields both schemas take (A-303). */
const profileFields = {
  description: optionalText(),
  email,
  phone,
  address: nullableText(),
  city: nullableText(100),
  state: nullableText(100),
  zipCode: nullableText(20),
  country: nullableText(100),
  website,
};

// ==========================================
// GET ALL TENANTS QUERY
// ==========================================

const getAllTenantsQuery = z.object({
  page: numeric(z.number().int().min(1)).default(1),
  limit: numeric(z.number().int().min(1).max(100)).default(20),
  find: nullableText(),
  status: caseless(TENANT_STATUSES, "upper").or(z.literal("")).nullable().optional(),
});

// ==========================================
// GET TENANT BODY/PARAMS
// ==========================================

const getTenantSchema = z.object({
  tenantId: uuid(),
});

// ==========================================
// CREATE TENANT
// ==========================================

const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(100),
  code: z.string().trim().min(2).max(50),
  logo: logoField,
  primaryColor,
  status: caseless(TENANT_STATUSES, "upper").nullable().default("ACTIVE"),
  // Seat limit (coordinator decision 2026-09-30): `limitSeats` is the single
  // source. Platform-set — POST /tenants/create is superAdminOnly. null =
  // unlimited (quota.service); absent = the model default. `maxUsers` is not
  // accepted (it was never an attribute; an unknown key is stripped).
  limitSeats: numeric(z.number().int().min(1)).nullable().optional(),
  createdBy: optionalId,
  ...profileFields,
});

// ==========================================
// UPDATE TENANT
// ==========================================

const updateTenantSchema = z.object({
  tenantId: uuid().optional(),
  name: z.string().trim().min(2).max(100).optional(),
  code: z.string().trim().min(2).max(50).optional(),
  logo: logoField,
  primaryColor,
  status: caseless(TENANT_STATUSES, "upper").or(z.literal("")).nullable().optional(),
  // A-303: no `maxUsers`. The seat limit is a plan value the platform sets
  // (`limitSeats`); `maxUsers` was never a Tenant attribute, so an edit of it
  // stored nothing. As an unknown key it is now STRIPPED (validators/input.ts).
  updatedBy: optionalId,
  ...profileFields,
});

// ==========================================
// DELETE TENANT QUERY/PARAMS
// ==========================================

// A-95: no `deletedBy`. The actor of a delete is the authenticated caller
// (tenant.controller#deleteTenant); a body or query value is stripped.
const deleteTenantSchema = z.object({
  tenantId: uuid(),
});

// ==========================================
// TENANT SETTINGS
// ==========================================

const tenantIdSchema = z.object({
  tenantId: uuid(),
});

export {
  getAllTenantsQuery,
  getTenantSchema,
  createTenantSchema,
  updateTenantSchema,
  deleteTenantSchema,
  tenantIdSchema,
};

// The client-side (input) and handler-side (output) types of each schema.
export type GetAllTenantsQueryInput = z.input<typeof getAllTenantsQuery>;
export type GetAllTenantsQueryBody = z.output<typeof getAllTenantsQuery>;
export type GetTenantInput = z.input<typeof getTenantSchema>;
export type GetTenantBody = z.output<typeof getTenantSchema>;
export type CreateTenantInput = z.input<typeof createTenantSchema>;
export type CreateTenantBody = z.output<typeof createTenantSchema>;
export type UpdateTenantInput = z.input<typeof updateTenantSchema>;
export type UpdateTenantBody = z.output<typeof updateTenantSchema>;
export type DeleteTenantInput = z.input<typeof deleteTenantSchema>;
export type DeleteTenantBody = z.output<typeof deleteTenantSchema>;
export type TenantIdInput = z.input<typeof tenantIdSchema>;
export type TenantIdBody = z.output<typeof tenantIdSchema>;
