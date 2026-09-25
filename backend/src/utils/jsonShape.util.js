/**
 * D-27 (ADR-070) — the declared shape of every JSON/JSONB column, validated on
 * write by the model.
 *
 * Fourteen columns held JSON whose shape lived in a comment, if anywhere.
 * Each is declared here once, as a Joi schema, and each model attribute calls
 * `jsonShape("<Model>.<attribute>")` as its `validate.shape`, so a write of the
 * wrong shape fails at the model — a Sequelize ValidationError — instead of
 * landing in the table. A test (tests/utils/jsonShape.d27.test.js) discovers
 * every JSON attribute from the model files and fails when one has no entry
 * here, or an entry names no JSON attribute.
 *
 * The shapes are what the application WRITES, read from its writers and their
 * boundary validators; where a boundary validator exists it is reused, so the
 * two cannot drift. A shape is deliberately no stricter than today's writers:
 * `calibration_records.results` still accepts the "" its create schema allows.
 *
 * Validated on create and on update of the column (Sequelize validates the
 * changed fields); `bulkCreate` validates only with `validate: true`, and raw
 * SQL not at all. A row written before this is not re-validated until the
 * column is next written.
 */
const Joi = require("joi");
const { readingToleranceSchema } = require("../validators/iot.validator");

/** Any JSON object — not an array, not a scalar. */
const object = Joi.object().unknown(true);

/** `<menu slug>` or `<menu slug>:<read|write>` — apiKey.service#assertScopes, lower-cased. */
const scope = Joi.string().pattern(/^[a-z0-9][a-z0-9_-]*(:(read|write))?$/, "scope");

/** A webhook event name or "*" — the pattern of validators/webhook.validator.js. */
const eventName = Joi.string().max(100).pattern(/^(\*|[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*)$/, "event name");

const JSON_SHAPES = Object.freeze({
  "ApiKey.scopes": Joi.array().items(scope),
  "AuditLog.changes": object,
  "CalibrationDevice.uncertaintyBudget": object,
  "CalibrationDevice.readingTolerance": readingToleranceSchema,
  "CalibrationRecord.results": object.allow(""),
  "DsarRequest.details": object,
  "IotReading.metrics": object,
  "SignatureRecord.polygon": Joi.alternatives(object, Joi.array()),
  // The sign schema accepts a string (eSignature.validator: biometricData).
  "SignatureRecord.biometricData": Joi.alternatives(Joi.string(), object),
  "Tenant.settings": object,
  "TenantBackup.metadata": object,
  "UsageAlert.notificationChannels": Joi.array().items(Joi.string().valid("email", "webhook")),
  "Webhook.events": Joi.array().items(eventName),
  "WebhookDelivery.payload": object,
});

/**
 * The Sequelize attribute validator for one declared column.
 *
 * @param {string} key - "<Model>.<attribute>", a key of JSON_SHAPES
 * @returns {(value: *) => void} throws on a value of the wrong shape
 * @throws {Error} at model definition, for an undeclared key
 */
const jsonShape = (key) => {
  const schema = JSON_SHAPES[key];
  if (!schema) {
    throw new Error(`No declared JSON shape for ${key}: add it to utils/jsonShape.util.js`);
  }
  const validator = (value) => {
    const { error } = schema.validate(value, { convert: false });
    if (error) {
      throw new Error(`${key} has the wrong shape: ${error.message}`);
    }
  };
  validator.shapeKey = key;
  return validator;
};

module.exports = { jsonShape, JSON_SHAPES };
