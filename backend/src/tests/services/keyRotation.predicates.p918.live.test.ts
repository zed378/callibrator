/**
 * P9-18 — the key rotation's two write predicates, on a REAL PostgreSQL 18.
 *
 * `rewrapTarget` reads a page of rows, then writes each re-wrapped value with
 *
 *   UPDATE <table> SET <column> = $1
 *    WHERE id::text = $2 AND tenant_id IS NOT DISTINCT FROM CAST($3 AS uuid)
 *      AND <column> = $4
 *
 * The last two predicates are what make the rotation safe to run on a live
 * database, and until this suite nothing pinned them: the planted-defect run
 * of the P9-18 conversion removed each one and every unit and live suite
 * stayed green (the unit double evaluates its own predicate; the S-08 live
 * rehearsal never changes a row while the rotation runs).
 *
 *  - The OPTIMISTIC predicate (`<column> = $4`): a value the application
 *    rewrote between the rotation's read and its write must be SKIPPED, never
 *    overwritten with the re-wrap of the stale value it read.
 *  - The TENANT predicate: a row whose tenant changed in between must be
 *    skipped too. Its value was decrypted and re-encrypted under the OLD
 *    tenant as AAD; written under the new tenant, it would never decrypt again.
 *
 * Each case interleaves the application's write with the rotation's by
 * wrapping the runner: just before the rotation's UPDATE reaches PostgreSQL,
 * the "application" changes the row, as a concurrent request would.
 *
 * The schema is the models' own (db.sync), not the full migration chain: the
 * two tables involved are model tables, and the rotation runs as the owner.
 *
 * OPT-IN, a disposable database per run (fixtures/disposableDatabase):
 *
 *   DATA_PG_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=... DB_USER=postgres DB_PASS=... \
 *     npm test -- src/tests/services/keyRotation.predicates.p918.live --coverage=false
 */
import { env } from "../../config/env";
import type { DisposableDatabase, createDisposableDatabase as CreateDisposableDatabase } from "../fixtures/disposableDatabase";

const live = env("DATA_PG_LIVE_TEST") === "1" ? describe : describe.skip;

const A = "a9180000-0000-4000-8000-0000000000a1";
const B = "a9180000-0000-4000-8000-0000000000b2";

type Row = Record<string, unknown>;
interface LiveDb {
  options: { logging: unknown };
  query(sql: string, options?: object): Promise<unknown>;
  close(): Promise<void>;
}
interface Target {
  table: string;
  column: string;
}
interface Rotation {
  TARGETS: readonly Target[];
  rewrapTarget(o: { sequelize: { query: LiveDb["query"] }; target: Target }): Promise<{ rewrapped: number; skipped: number; failed: unknown[] }>;
}
interface Kms {
  encryptData(tenantId: string, plain: string): string;
  decryptData(tenantId: string, payload: string): string;
}

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the disposable database exists: config reads DB_NAME when it loads */
live("P9-18 — key rotation write predicates on live PostgreSQL", () => {
  let scratch: DisposableDatabase;
  let db: LiveDb;
  let rotation: Rotation;
  let kms: Kms;
  const q = async (sql: string, bind: unknown[] = []): Promise<Row[]> =>
    (await db.query(sql, { bind, type: "SELECT" })) as Row[];
  /** A v1 envelope (no key id): what the rotation must re-wrap. */
  const asV1 = (envelope: string): string => ["v1", ...envelope.split(":").slice(2)].join(":");
  const settingsTarget = (): Target => rotation.TARGETS[0] as Target;

  /** The runner the rotation gets: before its UPDATE, `meanwhile` runs, as a concurrent request would. */
  const interleaved = (meanwhile: () => Promise<void>): { query: LiveDb["query"] } => ({
    query: async (sql: string, options?: object) => {
      if (sql.trimStart().startsWith("UPDATE")) {
        await meanwhile();
      }
      return db.query(sql, options);
    },
  });

  const seed = async (id: string, tenantId: string, plain: string): Promise<string> => {
    const value = asV1(kms.encryptData(tenantId, plain));
    await q("DELETE FROM tenant_settings WHERE key LIKE 'p918_%'");
    await q(
      `INSERT INTO tenant_settings (id, tenant_id, key, value, created_at, updated_at)
       VALUES ($1, $2, $3, $4, now(), now())`,
      [id, tenantId, `p918_${id.slice(-4)}`, value],
    );
    return value;
  };

  beforeAll(async () => {
    const { createDisposableDatabase } = require("../fixtures/disposableDatabase") as { createDisposableDatabase: typeof CreateDisposableDatabase };
    scratch = await createDisposableDatabase("p918kr");
    ({ db } = require("../../config") as { db: LiveDb });
    db.options.logging = false;
    // The tables the models define are all this needs (tenants, tenant_settings). The rotation is an
    // operator task (npm run keys:rotate) that runs as the database owner, so the suite does too.
    require("../../models");
    await (db as LiveDb & { sync(o: object): Promise<unknown> }).sync({ force: true });
    rotation = require("../../services/keyRotation.service") as Rotation;
    kms = require("../../services/kms.service") as Kms;
    for (const [id, sub] of [[A, "p918-a"], [B, "p918-b"]] as const) {
      await q(
        "INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES ($1, $2, $2, $3, now(), now())",
        [id, sub, `${sub}@example.test`],
      );
    }
  }, 900_000);

  afterAll(async () => {
    await db.close();
    await scratch.drop();
  }, 900_000);

  it("without interference, the row is re-wrapped under the current key and still opens for its tenant", async () => {
    const id = "a9180000-0000-4000-8000-00000000c001";
    await seed(id, A, "sk_live_a");
    const report = await rotation.rewrapTarget({ sequelize: db, target: settingsTarget() });
    expect(report).toMatchObject({ rewrapped: 1, skipped: 0, failed: [] });
    const [row] = await q("SELECT value FROM tenant_settings WHERE id = $1", [id]);
    expect(String(row?.["value"])).toMatch(/^v2:/);
    expect(kms.decryptData(A, String(row?.["value"]))).toBe("sk_live_a");
  }, 120_000);

  it("a value the application rewrote meanwhile is skipped, not overwritten (the optimistic predicate)", async () => {
    const id = "a9180000-0000-4000-8000-00000000c002";
    await seed(id, A, "old secret");
    const appValue = kms.encryptData(A, "new secret set by the application");
    const report = await rotation.rewrapTarget({
      sequelize: interleaved(async () => {
        await q("UPDATE tenant_settings SET value = $1 WHERE id = $2", [appValue, id]);
      }),
      target: settingsTarget(),
    });
    expect(report).toMatchObject({ rewrapped: 0, skipped: 1, failed: [] });
    const [row] = await q("SELECT value FROM tenant_settings WHERE id = $1", [id]);
    expect(row?.["value"]).toBe(appValue);
    expect(kms.decryptData(A, String(row?.["value"]))).toBe("new secret set by the application");
  }, 120_000);

  it("a row moved to another tenant meanwhile is skipped, not re-wrapped under the old tenant (the tenant predicate)", async () => {
    const id = "a9180000-0000-4000-8000-00000000c003";
    const original = await seed(id, A, "tenant A's secret");
    const report = await rotation.rewrapTarget({
      sequelize: interleaved(async () => {
        await q("UPDATE tenant_settings SET tenant_id = $1 WHERE id = $2", [B, id]);
      }),
      target: settingsTarget(),
    });
    expect(report).toMatchObject({ rewrapped: 0, skipped: 1, failed: [] });
    const [row] = await q("SELECT tenant_id, value FROM tenant_settings WHERE id = $1", [id]);
    expect(row?.["tenant_id"]).toBe(B);
    expect(row?.["value"]).toBe(original);
  }, 120_000);
});
/* eslint-enable @typescript-eslint/no-require-imports */
