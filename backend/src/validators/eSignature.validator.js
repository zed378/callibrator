/**
 * E-Signature Validators (21 CFR Part 11)
 *
 * Joi validation schemas for digital signature endpoints.
 */

const Joi = require("joi");
const { formatErrors } = require("../utils/appError.util");

/**
 * Validate key pair creation
 */
exports.createKeyPair = Joi.object({
  algorithm: Joi.string()
    .valid("RSA", "ECDSA", "Ed25519")
    .default("RSA"),
  keySize: Joi.number().integer().valid(2048, 3072, 4096).default(2048),
  label: Joi.string().optional().max(255),
}).options({ abortEarly: false, stripUnknown: true });

/**
 * Validate signature workflow creation
 */
// A-129 / A-130 (ADR-051 Q-19, A-86; F-10) — a signer is a USER of the
// tenant, named by `userId`. Their name and email are read from the user row by
// the service; a body `name` / `email` is stripped (stripUnknown applies to the
// nested objects), not trusted and not rejected, so an older client still
// validates. `userId` is optional HERE so that an email-only signer reaches the
// service and gets its explanation (400, "invite them as a user"), rather than
// a bare "userId is required".
exports.createWorkflow = Joi.object({
  documentId: Joi.string().required(),
  signers: Joi.array()
    .items(
      Joi.object({
        userId: Joi.string().uuid(),
      }),
    )
    .min(1)
    .required(),
  subject: Joi.string().required().max(255),
  message: Joi.string().allow("").default(""),
  expiresAt: Joi.date().optional(),
}).options({ abortEarly: false, stripUnknown: true });

/**
 * Validate document signing.
 *
 * stepId travels in the body because the route is POST /sign with no path
 * param — the controller previously read req.params.stepId, which was always
 * undefined.
 */
// A-65 — signing re-authenticates: `authPayload` is the signer's password or
// current MFA code, checked the way certificate approval checks it. Only
// "password" and "mfa" can be verified at signing time, so "webauthn" and
// "totp" are no longer accepted (a method nothing verifies is no method).
// `ipAddress` / `userAgent` are gone: they come from the connection, never
// the body — a body value is stripped (stripUnknown), not rejected, so an
// older client keeps working but cannot choose what is recorded.
// `reason` is the meaning of the signature (21 CFR 11.50), bound into the
// signed payload; it fits signature_records.signature_reason (255).
exports.signDocument = Joi.object({
  stepId: Joi.string().uuid().required(),
  polygon: Joi.object().optional().allow(null),
  biometricData: Joi.string().optional().allow(null),
  authenticationMethod: Joi.string().valid("password", "mfa").default("password"),
  authPayload: Joi.string().required(),
  // A-129 (ADR-051 Q-19) — mandatory. The service refuses a blank one too.
  reason: Joi.string().trim().min(1).max(255).required(),
}).options({ abortEarly: false, stripUnknown: true });

/**
 * Validate signature verification. Same reasoning as signDocument: the route
 * is POST /verify with no path param.
 */
exports.verifySignature = Joi.object({
  signatureId: Joi.string().uuid().required(),
}).options({ abortEarly: false, stripUnknown: true });

/**
 * A-130 — POST /workflows/:workflowId/cancel. The body is optional; a reason,
 * when given, is recorded in the CANCEL audit row.
 */
exports.cancelWorkflow = Joi.object({
  reason: Joi.string().trim().max(500).allow(""),
}).options({ abortEarly: false, stripUnknown: true });

/**
 * Format validation errors
 */
// A-09 — Express 5 leaves `req.body` undefined when no body is sent. Joi
// treats `undefined` as valid against a non-required object schema and returns
// `{ value: undefined }` with no error, so the controller's `validated.x` then
// threw a TypeError — a 500 where a 400 was owed. `?? {}` makes the
// required-field rules fire instead.
exports.validate = (data, schema) => {
  const { error, value } = schema.validate(data ?? {});
  if (error) {
    throw new Error(formatErrors(error.details));
  }
  return value;
};
