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
// P9-09 (ADR-087 Amendment 6): converted from jsonShape.util.js with no
// behaviour change, together with validators/iot.validator (it reuses that
// module's tolerance schema, captured at load as the destructuring was).
import Joi from "joi";
import type { Schema } from "joi";
import type { JsonObject, JsonValue } from "../types/json";
import { readingToleranceSchema as iotReadingToleranceSchema } from "../validators/iot.validator";

const readingToleranceSchema = iotReadingToleranceSchema;

/** A Sequelize attribute validator produced by `jsonShape`, tagged with its key. */
export type ShapeValidator = ((value: unknown) => void) & { shapeKey: string };

/*
 * The TypeScript type of each JSON shape a CONVERTED model declares (P9-10,
 * spec item 5, ADR-064 item 10 / D-27). Joi infers no type, so until P9-11
 * moves the shapes to Zod (each type then becomes `z.infer<typeof shape>`),
 * each type is written by hand HERE, beside its Joi shape below, and pinned
 * by src/tests/models/modelTypes.p910.test.ts against one value the Joi shape
 * accepts and one it refuses. Added with the model that first uses it.
 */

/** `UsageAlert.notificationChannels`: `Joi.array().items(Joi.string().valid("email", "webhook"))`. */
export type NotificationChannels = ("email" | "webhook")[];

/** `CalibrationDevice.uncertaintyBudget`, `IotReading.metrics`: `object` (any JSON object). */
export type UncertaintyBudget = JsonObject;
export type IotMetrics = JsonObject;

/** `CalibrationRecord.results`: `object.allow("")` — a JSON object, or an empty string. */
export type CalibrationResults = JsonObject | "";

/**
 * `CalibrationDevice.readingTolerance`: iot.validator#readingToleranceSchema —
 * per metric, an object with at least one of `min` / `max` (Joi `.or("min", "max")`),
 * both numbers, at most 50 metrics (not expressible in the type).
 */
export type MetricBounds =
  | { readonly min: number; readonly max?: number }
  | { readonly min?: number; readonly max: number };
export type ReadingTolerance = Readonly<Record<string, MetricBounds>>;

/** `SignatureRecord.polygon`: `Joi.alternatives(object, Joi.array())` — a JSON object or a JSON array. */
export type SignaturePolygon = JsonObject | JsonValue[];

/** `SignatureRecord.biometricData`: `Joi.alternatives(Joi.string(), object)` — a string or a JSON object. */
export type SignatureBiometricData = string | JsonObject;

/** Any JSON object — not an array, not a scalar. */
const object = Joi.object().unknown(true);

/** `<menu slug>` or `<menu slug>:<read|write>` — apiKey.service#assertScopes, lower-cased. */
const scope = Joi.string().pattern(
  /^[a-z0-9][a-z0-9_-]*(:(read|write))?$/,
  "scope",
);

/** A webhook event name or "*" — the pattern of validators/webhook.validator.js. */
const eventName = Joi.string()
  .max(100)
  .pattern(/^(\*|[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*)$/, "event name");

const JSON_SHAPES: Readonly<Record<string, Schema | undefined>> = Object.freeze(
  {
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
    "UsageAlert.notificationChannels": Joi.array().items(
      Joi.string().valid("email", "webhook"),
    ),
    "Webhook.events": Joi.array().items(eventName),
    "WebhookDelivery.payload": object,
  },
);

/**
 * The Sequelize attribute validator for one declared column.
 *
 * @param key - "<Model>.<attribute>", a key of JSON_SHAPES
 * @returns throws on a value of the wrong shape
 * @throws Error at model definition, for an undeclared key
 */
const jsonShape = (key: string): ShapeValidator => {
  const schema = JSON_SHAPES[key];
  if (!schema) {
    throw new Error(
      `No declared JSON shape for ${key}: add it to utils/jsonShape.util.js`,
    );
  }
  const validator = (value: unknown): void => {
    // P6-02: Sequelize runs a custom attribute validator even on an explicit
    // null, so without this a nullable column could not be written as null —
    // a calibration-record correction copying a record with no `results`
    // failed with a 500 (found by the live E2E suite). Whether null is allowed
    // is the column's `allowNull`, which Sequelize checks on its own.
    if (value === null) {
      return;
    }
    const { error } = schema.validate(value, { convert: false });
    if (error) {
      throw new Error(`${key} has the wrong shape: ${error.message}`);
    }
  };
  // Object.assign sets the one property, on the same function, as `validator.shapeKey = key` did.
  return Object.assign(validator, { shapeKey: key });
};

export { jsonShape, JSON_SHAPES };
