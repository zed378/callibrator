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
  status: Joi.string()
    .valid(...CERTIFICATE_STATUS)
    .allow("", null),
  validUntil: Joi.date().allow("", null),
  standard: Joi.string().max(100).allow("", null),
  approvedBy: Joi.string().uuid().allow("", null),
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
const approveCertificateSchema = Joi.object({
  approvedBy: Joi.string().uuid().required(),
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
const validate = (data, schema) => {
  const { error, value } = schema.validate(data, {
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
