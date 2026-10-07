/**
 * P24-06 — the SQL-dump import's JSONB columns (D-27, utils/jsonShape.util.ts):
 * counts and lower-case codes only, keyed by plain identifiers — nothing else
 * can ride along into `upstream_sql_imports`.
 */
import { jsonShape } from "../../utils/jsonShape.util";

const table = { staged: true, reason: null, columns: 2, excludedColumns: 1, rowsLoaded: 3, rowsRejected: 2, rowsNotExtracted: 0, rejections: { invalid_date: 1, invalid_utf8: 1 }, notes: { zero_date: 2 } };
const summary = { statements: { create_table: 1, insert: 2 }, comments: 3, conditionalComments: 1, delimiterRegions: 0, truncated: false, completionMarker: true };

describe("P24-06 jsonShape — UpstreamSqlImport.tables / .parseSummary", () => {
  const tables = jsonShape("UpstreamSqlImport.tables");
  const parseSummary = jsonShape("UpstreamSqlImport.parseSummary");

  it("accepts counts and codes under identifier keys (and the parser's #invalid)", () => {
    expect(() => {
      tables({ mst_faskes: table, "#invalid": { ...table, staged: false, reason: "identifier_not_allowed" } });
    }).not.toThrow();
    expect(() => {
      parseSummary(summary);
    }).not.toThrow();
  });

  it.each([
    ["a value smuggled in a new key", { mst_faskes: { ...table, sample: "Synthetic Name" } }],
    ["a table key that is not an identifier", { "users; DROP": table }],
    ["a reason that is not a code", { t: { ...table, rejections: { "Synthetic Name": 1 } } }],
    ["a negative count", { t: { ...table, rowsLoaded: -1 } }],
    ["more than 1,001 tables", Object.fromEntries(Array.from({ length: 1002 }, (_, i) => [`t${String(i)}`, table]))],
  ])("refuses %s", (_label, value) => {
    expect(() => {
      tables(value);
    }).toThrow(/wrong shape/);
  });

  it("refuses an unexpected key in the parse summary", () => {
    expect(() => {
      parseSummary({ ...summary, firstStatement: "INSERT INTO users VALUES ('x')" });
    }).toThrow(/wrong shape/);
  });
});
