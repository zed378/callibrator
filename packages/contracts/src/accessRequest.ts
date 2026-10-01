/**
 * P10-05 (ADR-098 §6) — the request shapes of the access-request intake and
 * the super admin's queue (spec MEMORY/specs/P10-05-request-access.md § API).
 *
 * The public schema STRIPS unknown keys (Zod's default): a body carrying
 * `tenantId`, `status`, `decidedBy` or `provisionedTenantId` is answered as if
 * they were absent (BR-P10-5), so a probe learns nothing — `.strict()` would
 * answer 400 and tell it which keys the server knows. The server never reads
 * any of them from a body.
 *
 * A 400 describes the SHAPE of what was typed, never an existing record.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/accessRequest.validator.ts,
 * which re-exports these same objects by name. The contract for
 * /api/v1/access-requests (the public intake and the super admin's queue).
 */
import { z } from "zod";
import {
  ACCESS_REQUEST_STATUSES,
  DEVICE_COUNT_BANDS,
  FACILITY_TYPES,
  REQUEST_LOCALES,
} from "./accessRequestValues";
import { email as emailAddress, uuid } from "./fields";

/** A trimmed string of `min`–`max` characters. */
const text = (min: number, max: number): z.ZodString => z.string().trim().min(min).max(max);

/** An optional trimmed string; blank reads as absent (null). */
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v));

/** E.164 after normalisation. */
const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * An Indonesian mobile number as people type it, normalised: spaces, dashes,
 * dots and brackets removed; a leading `0` becomes `+62`, a leading `62`
 * becomes `+62`. Then E.164.
 */
export const normaliseWhatsapp = (raw: string): string => {
  const compact = raw.replace(/[\s\-.()]/g, "");
  if (compact.startsWith("0")) {
    return `+62${compact.slice(1)}`;
  }
  if (compact.startsWith("62")) {
    return `+${compact}`;
  }
  return compact;
};

const whatsapp = z
  .string()
  .trim()
  .max(32)
  .transform(normaliseWhatsapp)
  .pipe(z.string().regex(E164, { error: "Enter a WhatsApp number, e.g. 0812… or +62812…" }));

const workEmail = z.string().trim().toLowerCase().max(254).pipe(emailAddress());

/** `POST /access-requests` — the public intake. */
export const submitAccessRequestSchema = z.object({
  organisationName: text(2, 160),
  facilityType: z.enum(FACILITY_TYPES),
  city: text(2, 80),
  deviceCountBand: z.enum(DEVICE_COUNT_BANDS),
  contactName: text(2, 120),
  contactRole: optional(80),
  workEmail,
  whatsapp,
  needs: optional(2000),
  consent: z.literal(true, { error: "Consent is required" }),
  consentVersion: text(1, 32),
  locale: z.enum(REQUEST_LOCALES),
  // The honeypot: a real person never sees it. Any string is accepted here —
  // a filled honeypot must get the SAME answer as a real request, never a 400.
  website: z.string().max(2000).optional().default(""),
});

export type SubmitAccessRequestInput = z.output<typeof submitAccessRequestSchema>;

/** The statuses the queue lists (`expired` included, so an operator can see what lapsed). */
export const listAccessRequestsSchema = z.object({
  status: z.enum(ACCESS_REQUEST_STATUSES).default("pending"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListAccessRequestsInput = z.output<typeof listAccessRequestsSchema>;

/** `:id` of the admin routes. */
export const accessRequestIdSchema = z.object({ id: uuid() });

/** A tenant code as `tenant.validator` accepts it: letters, digits, `-` and `_`. */
const tenantCode = z
  .string()
  .trim()
  .min(2)
  .max(50)
  .regex(/^[A-Za-z0-9_-]+$/, { error: "Use letters, digits, - and _ only" });

/**
 * `POST /admin/access-requests/:id/approve` (`from: ["params", "body"]`, so
 * `id` is validated). The invited administrator's address is ALWAYS the
 * request's `workEmail` and is not accepted here: an approval cannot invite a
 * different person than the one who asked.
 */
export const approveAccessRequestSchema = z.object({
  id: uuid(),
  tenantCode,
  // tenant.validator#createTenantSchema caps a tenant name at 100.
  tenantName: text(2, 100).optional(),
  // No `maxUsers`: the Tenant model has no such column (A-303) — createTenant
  // would accept it and store nothing.
  adminFirstName: text(1, 100).optional(),
  adminLastName: text(1, 100).optional(),
});

export type ApproveAccessRequestInput = z.output<typeof approveAccessRequestSchema>;

/** `POST /admin/access-requests/:id/reject`: a reason is required. */
export const rejectAccessRequestSchema = z.object({
  id: uuid(),
  reason: text(1, 1000),
  spam: z.boolean().optional().default(false),
});

export type RejectAccessRequestInput = z.output<typeof rejectAccessRequestSchema>;

/** `POST /admin/access-requests/erasure`: a requester's erasure request (DSAR), by address. */
export const eraseAccessRequestsSchema = z.object({ email: workEmail });
