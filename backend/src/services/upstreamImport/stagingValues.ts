/**
 * The SQL-dump import (ADR-129, P24-06): a MariaDB column's type → its
 * staging column's PostgreSQL type, and a dumped value → the value bound for
 * that column.
 *
 * Every value is checked HERE, before it is bound, so the staging INSERT
 * never fails on a value: a value that cannot be what its column says rejects
 * its row with a reason (counted), and the batch it would have broken loads.
 * Values are bound as text (or a Buffer for bytea) and PostgreSQL parses them
 * into the column's type — which, having been checked here, it accepts.
 *
 * MariaDB's zero dates (`0000-00-00`, a zero month or day) have no PostgreSQL
 * equivalent: they are loaded as NULL and counted (`zero_date`), never
 * guessed. Pure date and datetime values are copied as written — the
 * timezone question (D-6) belongs to the transform, not to staging.
 */
import type { Charset, ColumnDef, RawValue } from "./dumpParser";

/** The PostgreSQL types a staging column can have. */
export type StagingType = "smallint" | "integer" | "bigint" | "numeric" | "double precision" | "date" | "timestamp" | "text" | "bytea";

/** Why a value was refused (its row is rejected). */
export type ValueRejection =
  | "value_type_mismatch"
  | "value_out_of_range"
  | "invalid_date"
  | "invalid_utf8"
  | "nul_in_text";

/** What a conversion gives: the value to bind, a note to count, or the reason the row is rejected. */
export type Converted =
  | { readonly ok: true; readonly value: string | Buffer | null; readonly note?: "zero_date" }
  | { readonly ok: false; readonly reason: ValueRejection };

const INTEGER_RANGES: Readonly<Record<"smallint" | "integer" | "bigint", readonly [bigint, bigint]>> = {
  smallint: [-32768n, 32767n],
  integer: [-2147483648n, 2147483647n],
  bigint: [-9223372036854775808n, 9223372036854775807n],
};

/** Signed MariaDB integer types → the smallest PostgreSQL type that holds them; unsigned one size up. */
const INTEGER_TYPES: Readonly<Partial<Record<string, readonly [StagingType, StagingType]>>> = {
  tinyint: ["smallint", "smallint"],
  smallint: ["smallint", "integer"],
  mediumint: ["integer", "integer"],
  int: ["integer", "bigint"],
  integer: ["integer", "bigint"],
  bigint: ["bigint", "numeric"],
  year: ["smallint", "smallint"],
};

const OTHER_TYPES: Readonly<Partial<Record<string, StagingType>>> = {
  decimal: "numeric",
  dec: "numeric",
  numeric: "numeric",
  fixed: "numeric",
  float: "double precision",
  double: "double precision",
  real: "double precision",
  date: "date",
  datetime: "timestamp",
  timestamp: "timestamp",
  binary: "bytea",
  varbinary: "bytea",
  tinyblob: "bytea",
  blob: "bytea",
  mediumblob: "bytea",
  longblob: "bytea",
};

/**
 * The staging type of a declared column. Character types, enum, set, json,
 * time, bit, boolean words and every type this list does not know are text:
 * nothing is lost, and the transform casts.
 */
export const stagingTypeOf = (column: ColumnDef): StagingType => {
  const integer = INTEGER_TYPES[column.type];
  if (integer !== undefined) {
    return integer[column.unsigned ? 1 : 0];
  }
  return OTHER_TYPES[column.type] ?? "text";
};

const INTEGER = /^-?\d+$/;
const DECIMAL = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?$/;

const reject = (reason: ValueRejection): Converted => ({ ok: false, reason });
const accept = (value: string | Buffer | null): Converted => ({ ok: true, value });
const ZERO_DATE: Converted = { ok: true, value: null, note: "zero_date" };

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** A string literal's text, or a rejection (invalid UTF-8; a NUL byte, which PostgreSQL text cannot hold). */
const textOf = (bytes: Buffer, charset: Charset): Converted => {
  if (bytes.includes(0)) {
    return reject("nul_in_text");
  }
  if (charset === "latin1") {
    return accept(bytes.toString("latin1"));
  }
  try {
    return accept(utf8.decode(bytes));
  } catch {
    return reject("invalid_utf8");
  }
};

/** A value's text as the dump spelled it, for the numeric and date checks (bytes are text there). */
const spelled = (raw: Exclude<RawValue, { kind: "null" }>): Converted => {
  switch (raw.kind) {
    case "number":
    case "bit":
      return accept(raw.text);
    case "string":
      return textOf(raw.bytes, raw.charset);
    case "hex":
      return textOf(raw.bytes, "default");
  }
};

const checkInteger = (text: string, type: "smallint" | "integer" | "bigint"): Converted => {
  if (!INTEGER.test(text)) {
    return reject("value_type_mismatch");
  }
  const [min, max] = INTEGER_RANGES[type];
  const n = BigInt(text);
  return n < min || n > max ? reject("value_out_of_range") : accept(text);
};

const checkNumber = (text: string, type: "numeric" | "double precision"): Converted => {
  if (!DECIMAL.test(text)) {
    return reject("value_type_mismatch");
  }
  return type === "double precision" && !Number.isFinite(Number(text)) ? reject("value_out_of_range") : accept(text);
};

/** A real calendar date, or a zero date (→ NULL), or a rejection. */
const checkDate = (text: string, pattern: RegExp): Converted => {
  const m = pattern.exec(text);
  if (m === null) {
    return reject("invalid_date");
  }
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year === 0 || month === 0 || day === 0) {
    return ZERO_DATE;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid = date.getUTCMonth() === month - 1 && date.getUTCDate() === day && Number(m[4] ?? 0) < 24 && Number(m[5] ?? 0) < 60 && Number(m[6] ?? 0) < 60;
  return valid ? accept(text) : reject("invalid_date");
};

/**
 * Convert one dumped value for its staging column. NULL is always NULL.
 *
 * @param raw - the value as the parser read it
 * @param type - the staging column's type (`stagingTypeOf`)
 */
export const convertValue = (raw: RawValue, type: StagingType): Converted => {
  if (raw.kind === "null") {
    return accept(null);
  }
  if (type === "bytea") {
    return accept(raw.kind === "string" || raw.kind === "hex" ? raw.bytes : Buffer.from(raw.text, "latin1"));
  }
  // b'101' is a number to a numeric column, and its bits to a text one (a BIT column is staged as text).
  const text = raw.kind === "bit" && type !== "text" ? accept(BigInt(`0b0${raw.text}`).toString()) : spelled(raw);
  if (!text.ok || type === "text") {
    return text;
  }
  const value = text.value as string;
  switch (type) {
    case "smallint":
    case "integer":
    case "bigint":
      return checkInteger(value, type);
    case "numeric":
    case "double precision":
      return checkNumber(value, type);
    case "date":
      return checkDate(value, DATE);
    case "timestamp":
      return checkDate(value, TIMESTAMP);
  }
};
