/**
 * P9-11 (ADR-093) — the field schemas the request validators share.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/fields.ts, which now
 * re-exports this module, so the backend validators and the frontend's
 * request types read one definition. The only change in the move is to types:
 * `numeric`, `booleanish` and `dateLike` declare the input they convert
 * (`number | string`, `boolean | string`, `Date | string | number`) instead
 * of `unknown`, so `z.input` of a request schema is a useful client type. The
 * runtime is the same: Zod passes whatever arrives to the conversion, which
 * still takes `unknown`.
 *
 * The previous validation library converted every value by default: `"5"`
 * passed a number field as 5, `"true"` a boolean field as true, and a date
 * field turned a string or a millisecond count into a Date. Zod converts nothing unless told, so each
 * conversion the validators keep is named here and used field by field:
 * query strings and form posts reach the API as strings, and a client that
 * sends `"25"` for a number keeps working.
 *
 * The conversions are deliberately narrower than `z.coerce`: `z.coerce.number()`
 * turns `""`, `null`, `true` and `[]` into numbers, and `z.coerce.boolean()`
 * turns `"false"` into `true`. Only a string that spells a number (or a
 * boolean) is converted; anything else reaches the inner schema unchanged and
 * is refused by it.
 */
import { z } from "zod";

/** A decimal number spelt as a string, optionally signed, with an exponent and surrounding spaces. */
const NUMERIC = /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*$/i;

/**
 * @param value - anything
 * @returns the number a numeric string spells, otherwise the value unchanged
 */
const toNumber = (value: unknown): unknown => (typeof value === "string" && NUMERIC.test(value) ? Number(value) : value);

/**
 * @param value - anything
 * @returns true / false for the strings "true" / "false" (any case, trimmed), otherwise the value unchanged
 */
const toBoolean = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "true" ? true : normalized === "false" ? false : value;
};

/**
 * @param value - anything
 * @returns a Date for a non-blank string or finite number `new Date()` accepts (a string of digits is milliseconds), otherwise the value unchanged
 */
const toDate = (value: unknown): unknown => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value);
  }
  if (typeof value !== "string" || value.trim() === "") {
    return value;
  }
  const date = new Date(/^[+-]?\d+(\.\d+)?$/.test(value) ? Number(value) : value);
  return Number.isNaN(date.getTime()) ? value : date;
};

/**
 * A number field that also accepts a numeric string. Beyond the
 * safe-integer range a number is refused ("Must be a safe number"), as it was
 * before P9-11: it cannot round-trip.
 *
 * @param schema - the number schema (`z.number().int().min(1)` …)
 * @returns the schema, converting a numeric string first
 */
export const numeric = <S extends z.ZodType>(schema: S): z.ZodPreprocess<S, number | string> =>
  z.preprocess<unknown, S, number | string>(toNumber, schema).refine((value) => typeof value !== "number" || Math.abs(value) <= Number.MAX_SAFE_INTEGER, {
    error: "Must be a safe number",
  });

/**
 * A boolean field that also accepts "true" / "false".
 *
 * @returns the schema
 */
export const booleanish = (): z.ZodPreprocess<z.ZodBoolean, boolean | string> =>
  z.preprocess<unknown, z.ZodBoolean, boolean | string>(toBoolean, z.boolean());

/**
 * A date field: a Date, or a string or millisecond number `new Date()` accepts; the output is a Date.
 *
 * @returns the schema
 */
export const dateLike = (): z.ZodPreprocess<z.ZodDate, Date | string | number> =>
  z.preprocess<unknown, z.ZodDate, Date | string | number>(toDate, z.date());

/** An ISO 8601 date (`2026-09-29`) or date-time, with or without an offset. */
const isoText = z.union([z.iso.date(), z.iso.datetime({ offset: true, local: true })]);

/**
 * A date field that accepts only ISO 8601 text (or a Date); the output is a Date.
 *
 * @returns the schema
 */
export const isoDate = (): z.ZodUnion<readonly [z.ZodDate, z.ZodPipe<typeof isoText, z.ZodTransform<Date, string>>]> =>
  z.union([z.date(), isoText.transform((text) => new Date(text))]);

/**
 * A string field that must be ISO 8601; the output is its `toISOString()` form.
 *
 * @returns the schema
 */
export const isoDateText = (): z.ZodPipe<typeof isoText, z.ZodTransform<string, string>> =>
  isoText.transform((text) => new Date(text).toISOString());

/**
 * An RFC 5322 "dot-atom" address: the local part may use every character the
 * RFC allows unquoted (`!#$%&'*+/=?^_\`{|}~-`, as before P9-11; Zod's default
 * email pattern refuses `%`, `!` and `#`), and the domain needs two or more
 * labels ending in an alphabetic top-level domain. RFC 5321's limits hold too:
 * at most 64 characters before the `@` and 254 in all (as before P9-11; the
 * live E2E suite's oversized-email case found this).
 */
const EMAIL = /^(?=.{1,254}$)(?=[^@]{1,64}@)[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

/**
 * An email address (see EMAIL).
 *
 * @returns the schema
 */
export const email = (): z.ZodEmail => z.email({ pattern: EMAIL });

/**
 * An id: any 8-4-4-4-12 hexadecimal string (PostgreSQL's `uuid` accepts no less).
 *
 * @returns the schema
 */
export const uuid = (): z.ZodGUID => z.guid();

/**
 * Any JSON object — not an array, not a scalar.
 *
 * @returns the schema
 */
export const jsonObject = (): z.ZodRecord<z.ZodString, z.ZodUnknown> => z.record(z.string(), z.unknown());

/**
 * Optional free text that may be empty or null, trimmed first.
 *
 * @param max - the greatest length, if any
 * @returns the schema
 */
export const optionalText = (max?: number): z.ZodOptional<z.ZodNullable<z.ZodString>> =>
  (max === undefined ? z.string().trim() : z.string().trim().max(max)).nullable().optional();

/**
 * Optional free text that may be empty or null, NOT trimmed.
 *
 * @param max - the greatest length, if any
 * @returns the schema
 */
export const nullableText = (max?: number): z.ZodOptional<z.ZodNullable<z.ZodString>> =>
  (max === undefined ? z.string() : z.string().max(max)).nullable().optional();

/**
 * An enum matched case-insensitively, output in one case.
 *
 * @param values - the allowed values, in the output case
 * @param to - the case the input is folded to before matching
 * @returns the schema
 */
export const caseless = <const V extends readonly [string, ...string[]]>(
  values: V,
  to: "upper" | "lower",
): z.ZodPipe<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>, z.ZodEnum<{ [K in V[number]]: K }>> => {
  const fold = (text: string): string => (to === "upper" ? text.toUpperCase() : text.toLowerCase());
  return z.string().transform(fold).pipe(z.enum(values));
};
