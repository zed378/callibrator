/**
 * Certificate Validators — schemas for certificate CRUD operations.
 *
 * P9-11 (ADR-093): moved to Zod.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/certificate.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for C:/Program Files/Git/api/v1/certificates (list query, id params, create, update, approve, sign and revoke bodies).
 */
import { z } from "zod";
import { DEFAULT_LIMIT, MAX_LIMIT } from "./pagination";
import { dateLike, isoDateText, nullableText, numeric, uuid } from "./fields";

/** Certificate status enum. */
const CERTIFICATE_STATUS = ["draft", "pending_approval", "approved", "signed", "revoked"] as const;

/** Certificate type enum. */
const CERTIFICATE_TYPES = ["calibration", "maintenance", "verification"] as const;

/** Schema for listing/querying certificates. */
const getCertificatesQuery = z.object({
  page: numeric(z.number().int().min(1)).default(1),
  limit: numeric(z.number().int().min(1).max(MAX_LIMIT)).default(DEFAULT_LIMIT),
  deviceId: uuid().or(z.literal("")).nullable().optional(),
  status: z.array(z.enum(CERTIFICATE_STATUS)).or(z.literal("")).nullable().optional(),
  type: z.array(z.enum(CERTIFICATE_TYPES)).or(z.literal("")).nullable().optional(),
  certificateNumber: nullableText(),
  from: isoDateText().or(z.literal("")).nullable().optional(),
  to: isoDateText().or(z.literal("")).nullable().optional(),
  sortBy: z.enum(["certificate_number", "issued_at", "created_at", "status", "device_name"]).default("created_at"),
  sortOrder: z.enum(["ASC", "DESC"]).default("DESC"),
});

/** Schema for creating a certificate. */
const createCertificateSchema = z.object({
  deviceId: uuid(),
  calibrationRecordId: uuid().or(z.literal("")).nullable().optional(),
  type: z.enum(CERTIFICATE_TYPES).default("calibration"),
  summary: nullableText(),
  conditions: nullableText(),
  notes: nullableText(),
  standard: nullableText(100),
  validUntil: dateLike().or(z.literal("")).nullable().optional(),
});

/** Schema for updating a certificate. */
const updateCertificateSchema = z.object({
  summary: nullableText(),
  conditions: nullableText(),
  notes: nullableText(),
  // A-64 — accepted ONLY so an attempted status change can be refused with a
  // 409 that explains the certificate's state (certificate.service
  // #updateCertificate). A PUT never changes status: transitions go through
  // /submit, /approve, /sign and /revoke, which re-authenticate and audit.
  // The current status repeated back is not a transition and is dropped.
  status: z.enum(CERTIFICATE_STATUS).or(z.literal("")).nullable().optional(),
  validUntil: dateLike().or(z.literal("")).nullable().optional(),
  standard: nullableText(100),
  // No `approvedBy` (A-62): the approver is recorded only by POST
  // /:certificateId/approve, as the re-authenticated caller. An `approvedBy`
  // in the body is stripped, not rejected.
});

/** Schema for the certificate ID parameter. */
const certificateIdSchema = z.object({
  certificateId: uuid(),
});

const authMethod = z.enum(["password", "mfa"]);
const meaning = z.string().min(1).max(255);

// A-62 — no `approvedBy`. The approver is the authenticated caller
// (req.user.id), always, and re-authentication checks the caller's own
// credentials. A body `approvedBy` is stripped, not rejected, so a client
// still sending its own id keeps working.
/** Schema for approving a certificate. */
const approveCertificateSchema = z.object({
  authMethod,
  authPayload: z.string().min(1),
  meaning,
});

/** Schema for signing a certificate. */
const signCertificateSchema = z.object({
  digitalSignature: z.string().min(1),
  digitalSignatureKeyId: z.string().min(1).max(255),
  authMethod,
  authPayload: z.string().min(1),
  meaning,
});

/** Schema for revoking a certificate. */
const revokeCertificateSchema = z.object({
  reason: z.string().min(1).max(1000),
  authMethod,
  authPayload: z.string().min(1),
  meaning,
});

export {
  getCertificatesQuery,
  createCertificateSchema,
  updateCertificateSchema,
  certificateIdSchema,
  approveCertificateSchema,
  signCertificateSchema,
  revokeCertificateSchema,
  CERTIFICATE_STATUS,
  CERTIFICATE_TYPES,
};

// The client-side (input) and handler-side (output) types of each schema.
export type GetCertificatesQueryInput = z.input<typeof getCertificatesQuery>;
export type GetCertificatesQueryBody = z.output<typeof getCertificatesQuery>;
export type CreateCertificateInput = z.input<typeof createCertificateSchema>;
export type CreateCertificateBody = z.output<typeof createCertificateSchema>;
export type UpdateCertificateInput = z.input<typeof updateCertificateSchema>;
export type UpdateCertificateBody = z.output<typeof updateCertificateSchema>;
export type CertificateIdInput = z.input<typeof certificateIdSchema>;
export type CertificateIdBody = z.output<typeof certificateIdSchema>;
export type ApproveCertificateInput = z.input<typeof approveCertificateSchema>;
export type ApproveCertificateBody = z.output<typeof approveCertificateSchema>;
export type SignCertificateInput = z.input<typeof signCertificateSchema>;
export type SignCertificateBody = z.output<typeof signCertificateSchema>;
export type RevokeCertificateInput = z.input<typeof revokeCertificateSchema>;
export type RevokeCertificateBody = z.output<typeof revokeCertificateSchema>;
