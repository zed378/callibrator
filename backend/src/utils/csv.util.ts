/**
 * A-319 — the one way the API writes CSV.
 *
 * Every export (stock inventory, finance depreciation, the reports) goes
 * through this module, so the two rules below hold for all of them:
 *
 *  1. **RFC 4180.** Every field is enclosed in double quotes, a `"` inside it is
 *     doubled, and records end in CRLF. A value holding a comma, a quote or a
 *     line break therefore stays one field (a serial number `SN,42` used to
 *     shift its row's columns in the depreciation report).
 *  2. **Formula neutralisation** (OWASP, "CSV Injection"). A cell whose text
 *     starts with `=`, `+`, `-`, `@`, TAB or CR is evaluated as a formula by
 *     Excel, LibreOffice and Google Sheets — including DDE payloads such as
 *     `=cmd|' /c calc'!A1` — and quoting does NOT stop that. Such a cell is
 *     prefixed with `'`, which makes the spreadsheet read it as text. A plain
 *     number (`-5`, `-2.50`) is left alone: it is a value, not a formula, and
 *     prefixing it would turn a quantity into text.
 *
 * Values are written with `String()`: `null` and `undefined` are empty.
 */

/** A leading character that makes a spreadsheet evaluate the cell. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** A plain decimal number, which must survive intact. */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/** The text of one cell, neutralised if a spreadsheet would evaluate it. */
export const csvText = (value: unknown): string => {
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- a cell is whatever the row holds, String()-ed
  const text = value === null || value === undefined ? "" : String(value);
  return FORMULA_PREFIX.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
};

/** One field: neutralised, quoted, `"` doubled. */
export const csvField = (value: unknown): string => `"${csvText(value).replace(/"/g, '""')}"`;

/** One record: its fields, comma-separated (no terminator). */
export const csvRecord = (values: readonly unknown[]): string => values.map(csvField).join(",");

/** A whole document: the records joined by CRLF (no trailing terminator). */
export const csvDocument = (records: readonly (readonly unknown[])[]): string =>
  records.map(csvRecord).join("\r\n");
