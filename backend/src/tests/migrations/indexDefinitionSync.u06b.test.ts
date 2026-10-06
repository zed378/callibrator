/**
 * U-06b (ADR-120) — an index a migration creates must survive Sequelize's
 * showIndex, because `db.sync()` runs showIndex on every model's table at
 * EVERY boot.
 *
 * Sequelize 6 (dialects/postgres/query.js, the SHOWINDEXES branch) takes the
 * text of pg_get_indexdef() between the first `(` and the last `)`, splits it
 * on commas, and reads piece N for the N-th entry of `indkey`. An index whose
 * rendered definition has fewer comma pieces than indkey entries throws
 * "Cannot read properties of undefined (reading 'match')" there — and the
 * server does not start. Migration 0109 as first written (U-06) was such an
 * index: `(tenant_id, calibration_date DESC) INCLUDE (is_compliant,
 * superseded_by_id)` has four indkey entries and three pieces. The boot after
 * the one that applied it crash-looped on PostgreSQL 18 (callib-u06b,
 * 2026-10-05).
 *
 * The cases run the REAL Sequelize postgres Query over a connection double
 * that answers the catalog row exactly as PostgreSQL 18 rendered it
 * (`SELECT indkey, pg_get_indexdef(indexrelid)` on the live stack). The first
 * case is the pre-fix 0109, pinned as the failure this guards against.
 */
import * as fs from "fs";
import * as path from "path";
import { Sequelize, QueryTypes } from "sequelize";

/** The SHOWINDEXES row Sequelize's own catalog query returns. */
interface CatalogRow {
  name: string;
  primary: boolean;
  unique: boolean;
  indkey: string;
  column_indexes: number[];
  column_names: string;
  definition: string;
}

interface QueryRunner {
  run(sql: string): Promise<unknown>;
}
type QueryClass = new (connection: unknown, sequelize: Sequelize, options: Record<string, unknown>) => QueryRunner;

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Sequelize's postgres Query class, which its typings do not declare
const PostgresQuery = require("sequelize/lib/dialects/postgres/query") as QueryClass;

const sequelize = new Sequelize({ dialect: "postgres", logging: false });

/** Run Sequelize's showIndex parsing over one catalog row. */
const showIndex = (row: CatalogRow): Promise<unknown> => {
  const connection = {
    query: (_sql: string, callback: (error: Error | null, result: { rows: CatalogRow[]; rowCount: number }) => void): void => {
      callback(null, { rows: [{ ...row, column_indexes: [...row.column_indexes] }], rowCount: 1 });
    },
  };
  return new PostgresQuery(connection, sequelize, { type: QueryTypes.SHOWINDEXES }).run("SELECT /* showIndexesQuery */ 1");
};

/** calibration_records' attnums on the P8-07 stack: tenant_id 2, calibration_date 6, is_compliant 11, superseded_by_id 18. */
const RECORD_COLUMNS = { column_indexes: [2, 6, 11, 18], column_names: "{tenant_id,calibration_date,is_compliant,superseded_by_id}" };

describe("U-06b — every index a migration creates parses in Sequelize's showIndex (the boot's db.sync)", () => {
  it("the pre-fix 0109 (INCLUDE) is the failure: four indkey entries, three pieces", async () => {
    await expect(
      showIndex({
        name: "calibration_records_tenant_live_date",
        primary: false,
        unique: false,
        indkey: "2 6 11 18",
        ...RECORD_COLUMNS,
        definition:
          "CREATE INDEX calibration_records_tenant_live_date ON public.calibration_records USING btree " +
          "(tenant_id, calibration_date DESC) INCLUDE (is_compliant, superseded_by_id) " +
          "WHERE ((is_deleted = false) AND (deleted_at IS NULL))",
      }),
    ).rejects.toThrow(/reading 'match'/);
  });

  it("0109 as built (key columns) parses, its four fields in order", async () => {
    const rows = (await showIndex({
      name: "calibration_records_tenant_live_date",
      primary: false,
      unique: false,
      indkey: "2 6 11 18",
      ...RECORD_COLUMNS,
      definition:
        "CREATE INDEX calibration_records_tenant_live_date ON public.calibration_records USING btree " +
        "(tenant_id, calibration_date DESC, is_compliant, superseded_by_id) " +
        "WHERE ((is_deleted = false) AND (deleted_at IS NULL))",
    })) as { fields: { attribute: string; order?: string }[] }[];
    expect(rows[0]?.fields.map((f) => f.attribute)).toEqual(["tenant_id", "calibration_date", "is_compliant", "superseded_by_id"]);
    expect(rows[0]?.fields[1]?.order).toBe("DESC");
  });

  it("0110's per-tenant GIN indexes parse: (tenant_id, search_vector), both fields", async () => {
    for (const [table, attnum] of [
      ["calibration_devices", 25],
      ["stocks", 15],
      ["certificates", 31],
    ] as const) {
      const rows = (await showIndex({
        name: `${table}_tenant_id_search_vector`,
        primary: false,
        unique: false,
        indkey: `2 ${String(attnum)}`,
        column_indexes: [2, attnum],
        column_names: "{tenant_id,search_vector}",
        definition: `CREATE INDEX ${table}_tenant_id_search_vector ON public.${table} USING gin (tenant_id, search_vector)`,
      })) as { fields: { attribute: string }[] }[];
      expect(rows[0]?.fields.map((f) => f.attribute)).toEqual(["tenant_id", "search_vector"]);
    }
  });

  it("no migration creates an index with INCLUDE (...) — its columns are in indkey but not in the parsed pieces", () => {
    const dir = path.join(__dirname, "../../migrations");
    const offenders = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /\)\s*INCLUDE\s*\(/i.test(fs.readFileSync(path.join(dir, f), "utf8").replace(/^\s*(\/\/|\*).*$/gm, "")));
    expect(offenders).toEqual([]);
  });
});
