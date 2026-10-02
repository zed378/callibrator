/**
 * IoT device provisioning validation schemas (A-29, A-46).
 *
 * P9-11 (ADR-093): moved to Zod. `readingToleranceSchema` is also the declared
 * JSON shape of `calibration_devices.reading_tolerance`
 * (utils/jsonShape.util), so what it accepts and refuses is unchanged.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/iot.validator.ts,
 * which re-exports these same objects by name. The contract for
 * /api/v1/iot (reading tolerances, the device id and the IoT configuration).
 */
import { z } from "zod";
import { booleanish, uuid } from "./fields";

/** A metric name as it appears as a key in an ingested payload. */
const METRIC_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

/** How many metrics one device's tolerance may bound. */
const MAX_METRICS = 50;

/** A bound: a finite number within the safe-integer range (an unsafe one was always refused). */
const bound = z.number().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);

/**
 * One metric's bounds: at least one of min / max, finite numbers, and
 * min <= max when both are given. `iot.service#ingestReading` flags a reading
 * below `min` or above `max` as an anomaly. A misspelt bound ("mx") is refused,
 * not stripped: a tolerance that quietly lost a bound would never fire.
 */
const metricBounds = z
  .union([z.strictObject({ min: bound, max: bound.optional() }), z.strictObject({ min: bound.optional(), max: bound })], {
    error: "Provide min and/or max, numbers only",
  })
  .refine((b) => b.min === undefined || b.max === undefined || b.min <= b.max, {
    error: "min must not be greater than max",
  });

/** One metric's bounds, as stored. */
export type MetricBoundsInput = z.infer<typeof metricBounds>;

/**
 * `readingTolerance`: `{ "<metric>": { min?, max? }, … }`, or null to clear it.
 * A-46: until this schema existed nothing could set it, so the anomaly
 * comparison in iot.service never ran.
 */
const readingToleranceSchema = z
  .preprocess(
    // The shape always read any non-array object's own keys (a Date, or a
    // class instance, included); z.record reads plain objects only.
    (value) =>
      typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype
        ? { ...value }
        : value,
    z.record(z.string().regex(METRIC_NAME, { error: "Metric names are 1-64 of A-Z a-z 0-9 _ . -" }), metricBounds)
      .refine((tolerance) => Object.keys(tolerance).length <= MAX_METRICS, {
        error: `A tolerance bounds at most ${String(MAX_METRICS)} metrics`,
      }),
  )
  .nullable();

/** The type of a device's reading tolerance (null clears it). */
export type ReadingToleranceInput = z.infer<typeof readingToleranceSchema>;

const deviceIdSchema = z.object({
  deviceId: uuid(),
});

const updateIotConfigSchema = z
  .object({
    iotEnabled: booleanish().optional(),
    readingTolerance: readingToleranceSchema.optional(),
  })
  .refine((body) => Object.keys(body).length >= 1, { error: "Provide iotEnabled and/or readingTolerance" });

export { readingToleranceSchema, deviceIdSchema, updateIotConfigSchema };
