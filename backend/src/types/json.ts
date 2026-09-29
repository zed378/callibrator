/**
 * JSON as it round-trips through a JSON / JSONB column (P9-10, spec item 5).
 *
 * Shared by the D-27 shape types in utils/jsonShape.util.ts, which several
 * converted models use. Types only: emits nothing.
 */

/** Any JSON value. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | JsonObject;

/** A JSON object: string keys, JSON values. */
export interface JsonObject {
  [key: string]: JsonValue;
}
