/**
 * Migration 0150 on live PostgreSQL 18 — the foreign-key indexes of the 2026-11 audit (DB-01):
 *  - the boot's migrations build every index 0150 lists, VALID, on the columns it names;
 *  - `up` again is a no-op (idempotent), `down` drops them all, `up` rebuilds them all;
 *  - an INVALID index of the same name (an interrupted concurrent build) is dropped and rebuilt,
 *    never accepted.
 *
 *   docker run -d --name t0150-pg18 -e POSTGRES_PASSWORD=t0150pass -p 127.0.0.1:55432:5432 pgvector/pgvector:pg18
 *   DB_HOST=127.0.0.1 DB_PORT=55432 DB_USER=postgres DB_PASS=t0150pass npm run test:live -- --only=t0150
 *   docker rm -f t0150-pg18
 */
import { env } from "../../config/env";

type Row = Record<string, unknown>;
interface LiveDb {
  options: { logging: unknown };
  query(sql: string, options?: object): Promise<[Row[], unknown]>;
  getQueryInterface(): unknown;
}
interface FkIndex {
  readonly name: string;
  readonly table: string;
  readonly columns: string;
}
interface Migration {
  INDEXES: readonly FkIndex[];
  up(arg: { context: unknown }): Promise<void>;
  down(arg: { context: unknown }): Promise<void>;
}

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

/* eslint-disable @typescript-eslint/no-require-imports -- the graph is loaded after the environment is set; typed by the members used */
const load = () => ({
  db: (require("../../config") as { db: LiveDb }).db,
  models: require("../../models") as unknown,
  migrator: (require("../../config/migrator") as { migrator: { pending(): Promise<unknown[]> } }).migrator,
  migrationLock: require("../../utils/migrationLock.util") as { runSchemaSetup(options: object): Promise<unknown> },
  migration: require("../../migrations/0150-foreign-key-indexes-audit") as Migration,
});
/* eslint-enable @typescript-eslint/no-require-imports */

describe("0150 — the audit's foreign-key indexes on live PostgreSQL 18", () => {
  jest.setTimeout(300_000);
  let g: ReturnType<typeof load>;

  const rows = async (sql: string, bind: unknown[] = []): Promise<Row[]> => (await g.db.query(sql, { bind }))[0];
  /** name → { valid, columns as PostgreSQL reports them } for every listed index that exists. */
  const present = async (): Promise<Map<string, { valid: boolean; def: string }>> => {
    const names = g.migration.INDEXES.map((x) => x.name);
    const found = await rows(
      `SELECT i.relname AS name, ix.indisvalid AS valid, pg_get_indexdef(ix.indexrelid) AS def
         FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid
        WHERE i.relname = ANY($1::text[])`,
      [names],
    );
    return new Map(found.map((r) => [String(r["name"]), { valid: r["valid"] === true, def: String(r["def"]) }]));
  };
  const context = (): { context: unknown } => ({ context: g.db.getQueryInterface() });

  beforeAll(async () => {
    const name = env("DB_NAME") ?? "";
    if (!name.includes("scratch")) {
      throw new Error(`Refusing to build a schema in DB_NAME="${name}": use a scratch database (see the header)`);
    }
    g = load();
    g.db.options.logging = false;
    await g.migrationLock.runSchemaSetup({ sequelize: g.db, migrator: g.migrator, logger });
    expect(await g.migrator.pending()).toEqual([]);
  });

  it("the boot builds every listed index, VALID, on its table and columns", async () => {
    const map = await present();
    expect(g.migration.INDEXES).toHaveLength(8);
    for (const { name, table, columns } of g.migration.INDEXES) {
      const ix = map.get(name);
      expect({ name, valid: ix?.valid }).toEqual({ name, valid: true });
      expect(ix?.def).toContain(`ON public.${table} USING btree (${columns})`);
    }
  });

  it("up again is a no-op; down drops every index; up rebuilds every one", async () => {
    await g.migration.up(context());
    expect([...(await present()).values()].filter((x) => x.valid)).toHaveLength(8);

    await g.migration.down(context());
    expect((await present()).size).toBe(0);

    await g.migration.up(context());
    const map = await present();
    expect([...map.values()].filter((x) => x.valid)).toHaveLength(8);
  });

  it("an INVALID index of the same name is dropped and rebuilt, never accepted", async () => {
    const first = g.migration.INDEXES[0];
    if (first === undefined) {
      throw new Error("0150 lists no index");
    }
    const { name } = first;
    await rows("UPDATE pg_index SET indisvalid = false WHERE indexrelid = $1::regclass", [name]);
    expect((await present()).get(name)?.valid).toBe(false);

    await g.migration.up(context());
    expect((await present()).get(name)?.valid).toBe(true);
  });
});
