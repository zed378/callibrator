/**
 * IoT device provisioning validation schemas (A-29, A-46).
 *
 * P9-09/P9-11 (ADR-087 Amendment 6): converted from iot.validator.js with no
 * behaviour change — still Joi, byte for byte the same schemas and messages
 * (helper 3's contract suite, iot.validator.contract.test.ts, pins the 400s).
 * Converted AHEAD of P9-11 because utils/jsonShape.util imports
 * `readingToleranceSchema`, and jsonShape must be TypeScript before the first
 * model with a JSON column converts (P9-10). Its Joi → Zod move stays P9-11's.
 */
import Joi from "joi";
import type { CustomHelpers, Schema, ValidationResult } from "joi";

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
  .custom((value: { min?: number; max?: number }, helpers: CustomHelpers) =>
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
const readingToleranceSchema = Joi.object()
  .pattern(Joi.string().pattern(METRIC_NAME), bounds)
  .max(MAX_METRICS)
  // A bad metric name or a misspelt bound ("mx") is refused, not silently
  // stripped: a tolerance that quietly lost a bound would never fire.
  .prefs({ stripUnknown: false })
  .allow(null);

const deviceIdSchema = Joi.object({
  deviceId: Joi.string().uuid().required(),
});

const updateIotConfigSchema = Joi.object({
  iotEnabled: Joi.boolean(),
  readingTolerance: readingToleranceSchema,
})
  .min(1)
  .messages({ "object.min": "Provide iotEnabled and/or readingTolerance" });

/**
 * Validate with the module's options. `?? {}` — Express 5 leaves `req.body`
 * undefined when no body is sent (A-09).
 * @param data - the input
 * @param schema - the schema
 * @returns Joi's result
 */
const validate = (data: unknown, schema: Schema): ValidationResult =>
  schema.validate(data ?? {}, { abortEarly: false, stripUnknown: true });

// The same names, in the order the .js assigned them to `exports`.
export { readingToleranceSchema, deviceIdSchema, updateIotConfigSchema, validate };
