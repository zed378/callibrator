/**
 * Certificate Validators
 *
 * Joi validation schemas for certificate CRUD operations.
 */

const Joi = require("joi");
const { DEFAULT_LIMIT, MAX_LIMIT } = require("../constants");

// Certificate status enum
const CERTIFICATE_STATUS = [
  "draft",
  "pending_approval",
  "approved",
  "signed",
  "revoked",
];

// Certificate type enum
const CERTIFICATE_TYPES = ["calibration", "maintenance", "verification"];

/**
 * Schema for listing/querying certificates
 */
const getCertificatesQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  deviceId: Joi.string().uuid().allow("", null),
  status: Joi.array()
    .items(Joi.string().valid(...CERTIFICATE_STATUS))
    .allow("", null),
  type: Joi.array()
    .items(Joi.string().valid(...CERTIFICATE_TYPES))
    .allow("", null),
  certificateNumber: Joi.string().allow("", null),
  from: Joi.string().isoDate().allow("", null),
  to: Joi.string().isoDate().allow("", null),
  sortBy: Joi.string()
    .valid(
      "certificate_number",
      "issued_at",
      "created_at",
      "status",
      "device_name",
    )
    .default("created_at"),
  sortOrder: Joi.string().valid("ASC", "DESC").default("DESC"),
});

/**
 * Schema for creating a certificate
 */
const createCertificateSchema = Joi.object({
  deviceId: Joi.string().uuid().required(),
  calibrationRecordId: Joi.string().uuid().allow("", null),
  type: Joi.string()
    .valid(...CERTIFICATE_TYPES)
    .default("calibration"),
  summary: Joi.string().allow("", null),
  conditions: Joi.string().allow("", null),
  notes: Joi.string().allow("", null),
  standard: Joi.string().max(100).allow("", null),
  validUntil: Joi.date().allow("", null),
});

/**
 * Schema for updating a certificate
 */
const updateCertificateSchema = Joi.object({
  summary: Joi.string().allow("", null),
  conditions: Joi.string().allow("", null),
  notes: Joi.string().allow("", null),
  // A-64 — accepted ONLY so an attempted status change can be refused with a
  // 409 that explains the certificate's state (certificate.service
  // #updateCertificate). A PUT never changes status: transitions go through
  // /submit, /approve, /sign and /revoke, which re-authenticate and audit.
  // The current status repeated back is not a transition and is dropped.
  status: Joi.string()
    .valid(...CERTIFICATE_STATUS)
    .allow("", null),
  validUntil: Joi.date().allow("", null),
  standard: Joi.string().max(100).allow("", null),
  // No `approvedBy` (A-62): the approver is recorded only by POST
  // /:certificateId/approve, as the re-authenticated caller. Accepting it here
  // let a plain update name anyone as the approver, with no e-signature at all.
  // An `approvedBy` in the body is stripped (stripUnknown), not rejected.
});

/**
 * Schema for certificate ID parameter
 */
const certificateIdSchema = Joi.object({
  certificateId: Joi.string().uuid().required(),
});

/**
 * Schema for approving a certificate
 */
// A-62 — no `approvedBy`. The approver is the authenticated caller
// (req.user.id), always, and re-authentication checks the caller's own
// credentials. The body used to name the approver, so a caller who knew
// another approver's password recorded the approval in that person's name.
// A body `approvedBy` is stripped (stripUnknown), not rejected, so a client
// still sending its own id keeps working.
const approveCertificateSchema = Joi.object({
  authMethod: Joi.string().valid("password", "mfa").required(),
  authPayload: Joi.string().required(),
  meaning: Joi.string().min(1).max(255).required(),
});

/**
 * Schema for signing a certificate
 */
const signCertificateSchema = Joi.object({
  digitalSignature: Joi.string().required(),
  digitalSignatureKeyId: Joi.string().max(255).required(),
  authMethod: Joi.string().valid("password", "mfa").required(),
  authPayload: Joi.string().required(),
  meaning: Joi.string().min(1).max(255).required(),
});

/**
 * Schema for revoking a certificate
 */
const revokeCertificateSchema = Joi.object({
  reason: Joi.string().min(1).max(1000).required(),
  authMethod: Joi.string().valid("password", "mfa").required(),
  authPayload: Joi.string().required(),
  meaning: Joi.string().min(1).max(255).required(),
});

/**
 * Validate input data against a schema
 * @param {Object} data - Data to validate
 * @param {Object} schema - Joi schema
 * @returns {Object} - Validated and sanitized data
 */
// A-09 — Express 5 leaves `req.body` undefined when no body is sent. Joi
// treats `undefined` as valid against a non-required object schema and returns
// `{ value: undefined }` with no error, so the controller's `validated.x` then
// threw a TypeError — a 500 where a 400 was owed. `?? {}` makes the
// required-field rules fire instead.
const validate = (data, schema) => {
  const { error, value } = schema.validate(data ?? {}, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) {
    throw {
      status: 400,
      message: "Validation failed",
      errors: error.details.map((d) => ({
        field: d.path.join("."),
        message: d.message,
      })),
    };
  }
  return value;
};

module.exports = {
  getCertificatesQuery,
  createCertificateSchema,
  updateCertificateSchema,
  certificateIdSchema,
  approveCertificateSchema,
  signCertificateSchema,
  revokeCertificateSchema,
  validate,
  CERTIFICATE_STATUS,
  CERTIFICATE_TYPES,
};
