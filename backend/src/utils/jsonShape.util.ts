/**
 * D-27 (ADR-070) — the declared shape of every JSON/JSONB column, validated on
 * write by the model.
 *
 * Fourteen columns held JSON whose shape lived in a comment, if anywhere.
 * Each is declared here once, as a Zod schema, and each model attribute calls
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
 *
 * P9-11 (ADR-093): the shapes moved to Zod. A shape converts nothing (the
 * previous library ran here with conversion off, and Zod converts nothing unless
 * told), and each accepts and refuses exactly what it did before; only the error
 * text after "has the wrong shape:" changed. Each D-27 type is now the shape's
 * `z.infer`, so the model's type and the check cannot drift.
 */
import { z } from "zod";
import type { JsonObject, JsonValue } from "../types/json";
import { readingToleranceSchema as iotReadingToleranceSchema } from "../validators/iot.validator";

/** A Sequelize attribute validator produced by `jsonShape`, tagged with its key. */
export type ShapeValidator = ((value: unknown) => void) & { shapeKey: string };

/**
 * Any object that is not an array — as before P9-11, a non-plain object
 * too (which `z.record` would refuse). Its type is a JSON
 * object: the column stores JSON.
 */
const object = z.custom<JsonObject>((value) => typeof value === "object" && value !== null && !Array.isArray(value), {
  error: "Expected an object",
});

/** `<menu slug>` or `<menu slug>:<read|write>` — apiKey.service#assertScopes, lower-cased. */
const scope = z.string().regex(/^[a-z0-9][a-z0-9_-]*(:(read|write))?$/, { error: "Invalid scope" });

/** A webhook event name or "*" — the pattern of validators/webhook.validator. */
const eventName = z
  .string()
  .max(100)
  .regex(/^(\*|[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*)$/, { error: "Invalid event name" });

const apiKeyScopes = z.array(scope);
const calibrationResults = z.union([object, z.literal("")]);
const readingTolerance = iotReadingToleranceSchema.unwrap();
const signaturePolygon = z.union([object, z.array(z.custom<JsonValue>(() => true))]);
// The sign schema accepts a string (eSignature.validator: biometricData); an
// empty one was always refused.
const signatureBiometricData = z.union([z.string().min(1), object]);
const notificationChannels = z.array(z.enum(["email", "webhook"]));
/*
 * ADR-108 Amendment 1: a passkey's transports hint, as the authenticator
 * reported it at registration (WebAuthn's AuthenticatorTransportFuture). Null
 * when it reported none.
 */
const passkeyTransports = z
  .array(z.enum(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"]))
  .max(7)
  .nullable();
const webhookEvents = z.array(eventName);

/*
 * ADR-107 (Q-50): what a signed certificate prints, fixed at signing — written
 * only by certificateDocument.service#captureSignedSnapshot. Strict: an extra
 * or missing key is refused, because every key is bound by the v3 hash.
 */
const snapshotText = z.string().nullable();
const certificateSignedSnapshot = z
  .object({
    version: z.literal(1),
    issuer: z
      .object({
        name: snapshotText,
        email: snapshotText,
        phone: snapshotText,
        address: snapshotText,
        city: snapshotText,
        state: snapshotText,
        zipCode: snapshotText,
        country: snapshotText,
        website: snapshotText,
      })
      .strict(),
    device: z
      .object({ name: snapshotText, serialNumber: snapshotText, manufacturer: snapshotText, model: snapshotText })
      .strict()
      .nullable(),
    calibratedBy: snapshotText,
    approvedBy: snapshotText,
    signedBy: snapshotText,
  })
  .strict();

/*
 * The TypeScript type of each JSON shape a converted model declares (P9-10,
 * spec item 5, ADR-064 item 10 / D-27): the shape's `z.infer`.
 */

/** `UsageAlert.notificationChannels`: `"email"` / `"webhook"` items. */
export type NotificationChannels = z.infer<typeof notificationChannels>;

/** `CalibrationDevice.uncertaintyBudget`, `IotReading.metrics`: any JSON object. */
export type UncertaintyBudget = z.infer<typeof object>;
export type IotMetrics = z.infer<typeof object>;

/** `DsarRequest.details`: any JSON object. */
export type DsarDetails = z.infer<typeof object>;

/** `WebhookDelivery.payload`, `TenantBackup.metadata`: any JSON object. */
export type WebhookPayload = z.infer<typeof object>;
export type TenantBackupMetadata = z.infer<typeof object>;

/** `Webhook.events`: event names (`a.b_c`) or `"*"`, max 100 chars each (the pattern is not in the type). */
export type WebhookEvents = z.infer<typeof webhookEvents>;

/** `ApiKey.scopes`: `<menu slug>` or `<menu slug>:<read|write>`, lower-case (the pattern is not in the type). */
export type ApiKeyScopes = z.infer<typeof apiKeyScopes>;

/** `AuditLog.changes`, `Tenant.settings`: any JSON object. */
export type AuditLogChanges = z.infer<typeof object>;
export type TenantSettingsJson = z.infer<typeof object>;

/** `CalibrationRecord.results`: a JSON object, or an empty string. */
export type CalibrationResults = z.infer<typeof calibrationResults>;

/**
 * `CalibrationDevice.readingTolerance`: iot.validator#readingToleranceSchema —
 * per metric, at least one of `min` / `max`, both numbers, at most 50 metrics
 * (the count is not in the type).
 */
export type ReadingTolerance = Readonly<z.infer<typeof readingTolerance>>;
export type MetricBounds = Readonly<ReadingTolerance[string]>;

/** `SignatureRecord.polygon`: a JSON object or a JSON array. */
export type SignaturePolygon = z.infer<typeof signaturePolygon>;

/** `SignatureRecord.biometricData`: a string or a JSON object. */
export type SignatureBiometricData = z.infer<typeof signatureBiometricData>;

/** `Certificate.signedSnapshot` (ADR-107): the issuer, instrument and people as printed at signing. */
export type CertificateSignedSnapshot = z.infer<typeof certificateSignedSnapshot>;

/** `WebauthnCredential.transports` (ADR-108 Amendment 1). */
export type PasskeyTransports = z.infer<typeof passkeyTransports>;

const JSON_SHAPES: Readonly<Record<string, z.ZodType | undefined>> = Object.freeze({
  "ApiKey.scopes": apiKeyScopes,
  "AuditLog.changes": object,
  "CalibrationDevice.uncertaintyBudget": object,
  "CalibrationDevice.readingTolerance": readingTolerance,
  "CalibrationRecord.results": calibrationResults,
  "Certificate.signedSnapshot": certificateSignedSnapshot,
  "DsarRequest.details": object,
  "IotReading.metrics": object,
  "SignatureRecord.polygon": signaturePolygon,
  "SignatureRecord.biometricData": signatureBiometricData,
  "Tenant.settings": object,
  "TenantBackup.metadata": object,
  "UsageAlert.notificationChannels": notificationChannels,
  "Webhook.events": webhookEvents,
  "WebhookDelivery.payload": object,
  "WebauthnCredential.transports": passkeyTransports,
});

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
    throw new Error(`No declared JSON shape for ${key}: add it to utils/jsonShape.util.ts`);
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
    // No shape was ever required, so an undefined value passed every
    // one (a write that leaves the column unset). Zod refuses undefined, so it
    // is let through here, exactly as before.
    if (value === undefined) {
      return;
    }
    const result = schema.safeParse(value);
    if (!result.success) {
      const problems = result.error.issues.map((issue) =>
        issue.path.length ? `${issue.path.map(String).join(".")}: ${issue.message}` : issue.message,
      );
      throw new Error(`${key} has the wrong shape: ${problems.join(". ")}`);
    }
  };
  // Object.assign sets the one property, on the same function, as `validator.shapeKey = key` did.
  return Object.assign(validator, { shapeKey: key });
};

export { jsonShape, JSON_SHAPES };
