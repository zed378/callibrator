/**
 * P9-11 (ADR-093) — the field schemas the request validators share.
 *
 * P9-22 (ADR-097): the definitions moved to `@callibrator/contracts/fields`
 * (packages/contracts/src/fields.ts), so the frontend's request types and these
 * validators read one copy. This module re-exports them, unchanged, so every
 * validator's `./fields` import stays as it was. The names are listed, not
 * `export *`: the CommonJS interop of `export *` has branches the 100% gate
 * counts; packages/contracts/test/package.test.ts asserts the two lists match.
 */
export {
  booleanish,
  caseless,
  dateLike,
  email,
  isoDate,
  isoDateText,
  jsonObject,
  nullableText,
  numeric,
  optionalText,
  uuid,
} from "@callibrator/contracts/fields";
