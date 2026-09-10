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
exports.createWorkflow = Joi.object({
  documentId: Joi.string().required(),
  signers: Joi.array()
    .items(
      Joi.object({
        userId: Joi.string().required(),
        email: Joi.string().email().required(),
        name: Joi.string().required(),
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
exports.signDocument = Joi.object({
  stepId: Joi.string().uuid().required(),
  polygon: Joi.object().optional().allow(null),
  biometricData: Joi.string().optional().allow(null),
  authenticationMethod: Joi.string()
    .valid("password", "mfa", "webauthn", "totp")
    .default("password"),
  ipAddress: Joi.string().optional(),
  userAgent: Joi.string().optional(),
}).options({ abortEarly: false, stripUnknown: true });

/**
 * Validate signature verification. Same reasoning as signDocument: the route
 * is POST /verify with no path param.
 */
exports.verifySignature = Joi.object({
  signatureId: Joi.string().uuid().required(),
}).options({ abortEarly: false, stripUnknown: true });

/**
 * Validate signature revocation
 */
exports.revokeSignature = Joi.object({
  reason: Joi.string().required().max(500),
}).options({ abortEarly: false, stripUnknown: true });

/**
 * Format validation errors
 */
exports.validate = (data, schema) => {
  const { error, value } = schema.validate(data);
  if (error) {
    throw new Error(formatErrors(error.details));
  }
  return value;
};
