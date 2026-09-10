const Joi = require("joi");

/**
 * A tenant's storage override. `local` is intentionally NOT accepted here — it
 * is the platform default only; letting a tenant point the local driver at a
 * server path would be an arbitrary filesystem read/write primitive.
 */
exports.updateStorageSettingsSchema = Joi.object({
  provider: Joi.string().valid("s3", "nfs").required(),

  // --- s3 ---
  bucket: Joi.string().trim().max(255).when("provider", {
    is: "s3",
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  region: Joi.string().trim().max(64).when("provider", {
    is: "s3",
    then: Joi.optional(),
    otherwise: Joi.forbidden(),
  }),
  endpoint: Joi.string().trim().uri().max(255).when("provider", {
    is: "s3",
    then: Joi.optional().allow(null, ""),
    otherwise: Joi.forbidden(),
  }),
  forcePathStyle: Joi.boolean().when("provider", {
    is: "s3",
    then: Joi.optional(),
    otherwise: Joi.forbidden(),
  }),
  prefix: Joi.string().trim().max(255).when("provider", {
    is: "s3",
    then: Joi.optional().allow(null, ""),
    otherwise: Joi.forbidden(),
  }),
  accessKeyId: Joi.string().trim().max(255).when("provider", {
    is: "s3",
    then: Joi.optional().allow(null, ""),
    otherwise: Joi.forbidden(),
  }),
  secretAccessKey: Joi.string().trim().max(255).when("provider", {
    is: "s3",
    then: Joi.optional().allow(null, ""),
    otherwise: Joi.forbidden(),
  }),

  // --- nfs ---
  root: Joi.string().trim().max(1024).when("provider", {
    is: "nfs",
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  fsync: Joi.boolean().when("provider", {
    is: "nfs",
    then: Joi.optional(),
    otherwise: Joi.forbidden(),
  }),
});
