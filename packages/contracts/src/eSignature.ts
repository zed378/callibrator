/**
 * E-Signature Validators (21 CFR Part 11).
 *
 * P9-11 (ADR-093): moved to Zod; the file's `validate` helper, which nothing
 * called, is gone (`validators/input` is the one helper).
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/eSignature.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the eSignature routes.
 */
import { z } from "zod";
import { dateLike, jsonObject, numeric, uuid } from "./fields";

/** Validate key pair creation. */
const createKeyPair = z.object({
  algorithm: z.enum(["RSA", "ECDSA", "Ed25519"]).default("RSA"),
  keySize: numeric(z.union([z.literal(2048), z.literal(3072), z.literal(4096)])).default(2048),
  label: z.string().min(1).max(255).optional(),
});

// A-129 / A-130 (ADR-051 Q-19, A-86; F-10) — a signer is a USER of the
// tenant, named by `userId`. Their name and email are read from the user row by
// the service; a body `name` / `email` is stripped (unknown keys are stripped
// in nested objects too), not trusted and not rejected, so an older client
// still validates. `userId` is optional HERE so that an email-only signer
// reaches the service and gets its explanation (400, "invite them as a user"),
// rather than a bare "userId is required".
/** Validate signature workflow creation. */
const createWorkflow = z.object({
  documentId: z.string().min(1),
  signers: z.array(z.object({ userId: uuid().optional() })).min(1),
  subject: z.string().min(1).max(255),
  message: z.string().default(""),
  expiresAt: dateLike().optional(),
});

// A-65 — signing re-authenticates: `authPayload` is the signer's password or
// current MFA code, checked the way certificate approval checks it. Only
// "password" and "mfa" can be verified at signing time. `ipAddress` /
// `userAgent` come from the connection, never the body — a body value is
// stripped, not rejected. `reason` is the meaning of the signature (21 CFR
// 11.50), bound into the signed payload; it fits
// signature_records.signature_reason (255).
//
// stepId travels in the body because the route is POST /sign with no path
// param.
/** Validate document signing. */
const signDocument = z.object({
  stepId: uuid(),
  polygon: jsonObject().nullable().optional(),
  biometricData: z.string().min(1).nullable().optional(),
  authenticationMethod: z.enum(["password", "mfa"]).default("password"),
  authPayload: z.string().min(1),
  // A-129 (ADR-051 Q-19) — mandatory. The service refuses a blank one too.
  reason: z.string().trim().min(1).max(255),
});

/** Validate signature verification (POST /verify, no path param). */
const verifySignature = z.object({
  signatureId: uuid(),
});

/**
 * A-130 — POST /workflows/:workflowId/cancel. The body is optional; a reason,
 * when given, is recorded in the CANCEL audit row.
 */
const cancelWorkflow = z.object({
  reason: z.string().trim().max(500).optional(),
});

export { createKeyPair, createWorkflow, signDocument, verifySignature, cancelWorkflow };

// The client-side (input) and handler-side (output) types of each schema.
export type CreateKeyPairInput = z.input<typeof createKeyPair>;
export type CreateKeyPairBody = z.output<typeof createKeyPair>;
export type CreateWorkflowInput = z.input<typeof createWorkflow>;
export type CreateWorkflowBody = z.output<typeof createWorkflow>;
export type SignDocumentInput = z.input<typeof signDocument>;
export type SignDocumentBody = z.output<typeof signDocument>;
export type VerifySignatureInput = z.input<typeof verifySignature>;
export type VerifySignatureBody = z.output<typeof verifySignature>;
export type CancelWorkflowInput = z.input<typeof cancelWorkflow>;
export type CancelWorkflowBody = z.output<typeof cancelWorkflow>;
