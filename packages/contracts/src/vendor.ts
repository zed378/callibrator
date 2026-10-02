/**
 * Vendor request bodies — the contract for POST /api/v1/vendors,
 * PATCH /api/v1/vendors/:vendorId and PATCH /api/v1/vendors/:vendorId/qualify.
 *
 * P9-11 (ADR-093): moved to Zod. P9-22 (ADR-097): moved here from
 * backend/src/validators/vendor.validator.ts, which re-exports these same
 * objects; the frontend derives its request types from them.
 */
import { z } from "zod";
import { email as emailAddress, isoDate, numeric, optionalText } from "./fields";

const VENDOR_TYPES = ["CalibrationLab", "PartsSupplier", "Other"] as const;
const VENDOR_STATUSES = ["Active", "Inactive"] as const;

const email = z.string().trim().pipe(emailAddress().or(z.literal(""))).nullable().optional();

/**
 * Q-52 (ADR-109 §6, amended 2026-09-30): `notes` is stored (migration 0106) and
 * bounded at 2,000 characters. Adding the bound is a request-contract change
 * oasdiff reports, and it breaks no working client: before 0106 the field was
 * accepted and silently dropped, so no client could have relied on a longer
 * value being kept.
 */
const VENDOR_NOTES_MAX = 2000;

const createVendor = z.object({
  name: z.string().trim().min(2).max(100),
  type: z.enum(VENDOR_TYPES).default("Other"),
  contactPerson: optionalText(100),
  email,
  phone: optionalText(50),
  address: optionalText(),
  notes: optionalText(VENDOR_NOTES_MAX),
  status: z.enum(VENDOR_STATUSES).default("Active"),
});

const updateVendor = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  type: z.enum(VENDOR_TYPES).optional(),
  contactPerson: optionalText(100),
  email,
  phone: optionalText(50),
  address: optionalText(),
  notes: optionalText(VENDOR_NOTES_MAX),
  status: z.enum(VENDOR_STATUSES).optional(),
  rating: numeric(z.number().min(1).max(5)).nullable().optional(),
});

// P6-02 — PATCH /vendors/:vendorId/qualify had no validator. The column is a
// PostgreSQL enum of UPPER-CASE values, and the frontend sends "approved" /
// "rejected" (VendorsTable.tsx), so every approve or reject reached the
// database as an invalid enum value and answered 500. The value is matched
// case-insensitively and stored in the enum's case; anything else is a 400.
const qualifyVendor = z.object({
  approvalStatus: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.enum(["APPROVED", "PENDING", "REJECTED", "CONDITIONAL"]))
    .optional(),
  scorecard: numeric(z.number().int().min(0).max(100)).nullable().optional(),
  lastAuditDate: isoDate().nullable().optional(),
  nextAuditDate: isoDate().nullable().optional(),
});

// ── Response ──────────────────────────────────────────────────────────────

const VENDOR_APPROVAL_STATUSES = ["APPROVED", "PENDING", "REJECTED", "CONDITIONAL"] as const;

const timestamp = z.iso.datetime();

/**
 * A vendor as the API answers it (`Vendor.toJSON()`): the response schema of
 * every vendor route (P9-20/21, ADR-097 Am. 5; moved here from
 * backend/src/routes/api/vendor.openapi.ts, unchanged).
 */
const vendorResponse = z
  .object({
    id: z.guid(),
    tenantId: z.guid(),
    name: z.string(),
    type: z.enum(VENDOR_TYPES),
    contactPerson: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    address: z.string().nullable(),
    /** Q-52: stored since migration 0106 (was accepted and dropped). */
    notes: z.string().nullable(),
    rating: z.number().nullable(),
    approvalStatus: z.enum(VENDOR_APPROVAL_STATUSES),
    scorecard: z.number().int().nullable(),
    lastAuditDate: timestamp.nullable(),
    nextAuditDate: timestamp.nullable(),
    status: z.enum(VENDOR_STATUSES),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: timestamp.nullable(),
  })
  .meta({
    id: "Vendor",
    description: "An approved-supplier record (ISO 13485 supplier file).",
    example: {
      id: "5f0c2a8e-7c1d-4b6a-9e2f-3d4c5b6a7e81",
      tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
      name: "Example Calibration Lab",
      type: "CalibrationLab",
      contactPerson: "Quality Desk",
      email: "quality@lab.example",
      phone: "+00 000 0000",
      address: "1 Example Street",
      notes: "Accredited scope covers temperature and pressure.",
      rating: 4.5,
      approvalStatus: "APPROVED",
      scorecard: 92,
      lastAuditDate: "2026-03-01T00:00:00.000Z",
      nextAuditDate: "2027-03-01T00:00:00.000Z",
      status: "Active",
      createdAt: "2026-01-15T08:30:00.000Z",
      updatedAt: "2026-03-01T09:00:00.000Z",
      deletedAt: null,
    },
  });

export { VENDOR_NOTES_MAX, VENDOR_TYPES, VENDOR_STATUSES, createVendor, updateVendor, qualifyVendor };
export { VENDOR_APPROVAL_STATUSES, vendorResponse };
/** A vendor as the API answers it. */
export type VendorResponse = z.output<typeof vendorResponse>;

/** A vendor's type, as the API stores it. */
export type VendorType = (typeof VENDOR_TYPES)[number];
/** A vendor's status, as the API stores it. */
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

/** What a client may send to create a vendor (the schema's input). */
export type CreateVendorInput = z.input<typeof createVendor>;
/** What a client may send to update a vendor. */
export type UpdateVendorInput = z.input<typeof updateVendor>;
/** What a client may send to qualify a vendor. */
export type QualifyVendorInput = z.input<typeof qualifyVendor>;

/** What the handler receives after validation (the schema's output). */
export type CreateVendorBody = z.output<typeof createVendor>;
/** The validated update body. */
export type UpdateVendorBody = z.output<typeof updateVendor>;
/** The validated qualify body. */
export type QualifyVendorBody = z.output<typeof qualifyVendor>;
