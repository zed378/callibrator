/**
 * IoT device provisioning validation schemas (A-29, A-46).
 */
const Joi = require("joi");

/** A metric name as it appears as a key in an ingested payload. */
const METRIC_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

/** How many metrics one device's tolerance may bound. */
const MAX_METRICS = 50;

/**
 * One metric's bounds: at least one of min / max, finite numbers, and
 * min <= max when both are given. `iot.service#ingestReading` flags a reading
 * below `min` or above `max` as an anomaly.
 */
const bounds = Joi.object({
  min: Joi.number(),
  max: Joi.number(),
})
  .or("min", "max")
  .custom((value, helpers) =>
    value.min !== undefined && value.max !== undefined && value.min > value.max
      ? helpers.error("any.invalid")
      : value,
  )
  .messages({ "any.invalid": "{{#label}} min must not be greater than max" });

/**
 * `readingTolerance`: `{ "<metric>": { min?, max? }, … }`, or null to clear it.
 * A-46: until this schema existed nothing could set it, so the anomaly
 * comparison in iot.service never ran.
 */
exports.readingToleranceSchema = Joi.object()
  .pattern(Joi.string().pattern(METRIC_NAME), bounds)
  .max(MAX_METRICS)
  // A bad metric name or a misspelt bound ("mx") is refused, not silently
  // stripped: a tolerance that quietly lost a bound would never fire.
  .prefs({ stripUnknown: false })
  .allow(null);

exports.deviceIdSchema = Joi.object({
  deviceId: Joi.string().uuid().required(),
});

exports.updateIotConfigSchema = Joi.object({
  iotEnabled: Joi.boolean(),
  readingTolerance: exports.readingToleranceSchema,
})
  .min(1)
  .messages({ "object.min": "Provide iotEnabled and/or readingTolerance" });

/**
 * Validate with the module's options. `?? {}` — Express 5 leaves `req.body`
 * undefined when no body is sent (A-09).
 * @param {*} data - the input
 * @param {import("joi").Schema} schema - the schema
 * @returns {import("joi").ValidationResult} Joi's result
 */
exports.validate = (data, schema) =>
  schema.validate(data ?? {}, { abortEarly: false, stripUnknown: true });
