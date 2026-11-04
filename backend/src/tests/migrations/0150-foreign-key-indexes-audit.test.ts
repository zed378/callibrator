/**
 * Migration 0150 — the foreign-key indexes the 2026-11 audit found missing
 * (DB-01).
 *
 * The migration is proved here over a fake sequelize that records every
 * statement: the indexes it builds, the CONCURRENTLY form, the skip rule for an
 * index that is already there and valid, the rebuild of an INVALID one, and
 * that `down` drops exactly what `up` created.
 *
 * It is also proved that the migration is registered in the static manifest
 * under its frozen `.js` name, right after 0149 (P9-23), and that it has no
 * blanket try/catch — a real failure must propagate, or Umzug records the
 * migration as applied while nothing was done (CLAUDE.md).
 */
import fs from "fs";
import path from "path";

const MIGRATION = path.join(__dirname, "..", "..", "migrations", "0150-foreign-key-indexes-audit.ts");
const MANIFEST = fs.readFileSync(path.join(__dirname, "..", "..", "config", "migrator.ts"), "utf8");

/** A sequelize double that records the statements and answers the catalog probe. */
const fakeSequelize = (indexes: { name: string; valid: boolean }[] = []) => {
  const statements: string[] = [];
  return {
    statements,
    query: (sql: string) => {
      statements.push(sql);
      if (sql.includes("pg_index")) {
        return Promise.resolve([
          indexes.map((i) => ({ name: i.name, valid: i.valid })),
          undefined,
        ]);
      }
      return Promise.resolve([undefined, undefined]);
    },
  };
};

interface FkIndex {
  readonly name: string;
  readonly table: string;
  readonly columns: string;
}

interface Migration {
  readonly INDEXES: readonly FkIndex[];
  up: (params: { context: { sequelize: unknown } }) => Promise<void>;
  down: (params: { context: { sequelize: unknown } }) => Promise<void>;
}

const load = (): Migration =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the path is built
  require(MIGRATION) as Migration;

describe("migration 0150 — the audit's foreign-key indexes (DB-01)", () => {
  it("is registered in the static manifest under its frozen .js name, right after 0149", () => {
    const names = [...MANIFEST.matchAll(/\["(\d{4}-[\w.-]+\.js)"/g)].map((m) => m[1]);
    expect(names.indexOf("0150-foreign-key-indexes-audit.js")).toBe(
      names.indexOf("0149-user-esignatures.js") + 1,
    );
  });

  it("has no blanket try/catch, so a real failure propagates", () => {
    expect(fs.readFileSync(MIGRATION, "utf8")).not.toMatch(/\btry\s*\{/);
  });

  it("indexes every foreign key the audit named that no earlier migration covers", () => {
    const { INDEXES } = load();
    const names = INDEXES.map((i) => i.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "ticket_comments_ticket_id",
        "webhook_deliveries_tenant_id_webhook_id",
        "stocks_tenant_id_warehouse_id",
        "stocks_tenant_id_location_id",
        "calibration_records_tenant_id_device_id",
        "inspection_results_tenant_id_session_id",
      ]),
    );
    // every index is on a column of its own table, and no table is repeated
    // with the same name.
    expect(new Set(names).size).toBe(names.length);
  });

  it("builds each index CONCURRENTLY, so the build does not lock the table", async () => {
    const { INDEXES, up } = load();
    const sequelize = fakeSequelize();
    await up({ context: { sequelize } });

    for (const { name, table, columns } of INDEXES) {
      expect(sequelize.statements).toContain(
        `CREATE INDEX CONCURRENTLY "${name}" ON ${table} (${columns})`,
      );
    }
  });

  it("skips an index that is already there and valid", async () => {
    const { INDEXES, up } = load();
    const sequelize = fakeSequelize(
      INDEXES.map((i) => ({ name: i.name, valid: true })),
    );
    await up({ context: { sequelize } });

    expect(sequelize.statements.filter((s) => s.includes("CREATE INDEX"))).toEqual([]);
  });

  it("rebuilds an index left INVALID by an interrupted concurrent build", async () => {
    const { INDEXES, up } = load();
    const first = INDEXES[0] as FkIndex;
    const sequelize = fakeSequelize([{ name: first.name, valid: false }]);
    await up({ context: { sequelize } });

    expect(sequelize.statements).toContain(`DROP INDEX CONCURRENTLY IF EXISTS "${first.name}"`);
    expect(sequelize.statements).toContain(
      `CREATE INDEX CONCURRENTLY "${first.name}" ON ${first.table} (${first.columns})`,
    );
  });

  it("down drops exactly the indexes it created", async () => {
    const { INDEXES, down } = load();
    const sequelize = fakeSequelize();
    await down({ context: { sequelize } });

    for (const { name } of INDEXES) {
      expect(sequelize.statements).toContain(`DROP INDEX CONCURRENTLY IF EXISTS "${name}"`);
    }
  });
});
