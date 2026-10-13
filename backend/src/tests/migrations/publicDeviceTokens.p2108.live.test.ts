/**
 * P21-08 against a REAL PostgreSQL 18 — migration 0137 (`public_device_tokens`). ADR-138 § 1 – 2,
 * Am. 1; spec MEMORY/specs/P19-07-public-device-page.md § 5, § 12 (PD-1, PD-9).
 *
 * On an EMPTY scratch database: db.sync() and EVERY migration (the boot's schema step). Each probe in
 * a rolled-back transaction; every refusal is checked as `callibrator_app` (SET LOCAL ROLE — CLAUDE.md
 * Evidence) AND as the owner where the owner is bound, and the indexes have their FAIL-BEFORE (the
 * same write with the index dropped inside the rolled-back transaction SUCCEEDS):
 *  - the token hash is unique GLOBALLY — across tenants (23505); its shape is 64 hex (23514);
 *  - one ACTIVE link per device (23505); a revoked one frees the slot;
 *  - the revoke columns together or not at all (23514); `revoked_by` NULL only for `device_deleted`;
 *  - append-mostly for every role: the hash and the identity columns never change, a revoked link
 *    never changes again, nothing is deleted or truncated (42501);
 *  - a link names a device of its own tenant (42501);
 *  - the grants: the application role may SELECT, INSERT and UPDATE only the revoke columns;
 *  - the triggers are ENABLE ALWAYS; schemaVerify passes; a reboot applies nothing.
 *
 *   docker run -d --name p2108-pg18 -e POSTGRES_PASSWORD=p2108pass -p 127.0.0.1:56258:5432 pgvector/pgvector:pg18
 *   DB_HOST=127.0.0.1 DB_PORT=56258 DB_NAME=p2108_scratch DB_USER=postgres DB_PASS=p2108pass \
 *     npm run test:live:jest -- src/tests/migrations/publicDeviceTokens.p2108.live
 *   docker rm -f p2108-pg18
 *
 * Synthetic values only.
 */
import { Sequelize } from "sequelize";
import { env } from "../../config/env";
import { APP_ROLE, errorOf, inRolledBack, rows, seedSql, type LiveDb, type LiveTx } from "../fixtures/ipmLive";

const T = "d2108000-0000-4000-8000-000000000001";
const T2 = "d2108000-0000-4000-8000-000000000011";
const ROLE = "d2108000-0000-4000-8000-000000000002";
const ROLE2 = "d2108000-0000-4000-8000-000000000012";
const U1 = "d2108000-0000-4000-8000-0000000000a1";
const U9 = "d2108000-0000-4000-8000-0000000000a9";
const F1 = "d2108000-0000-4000-8000-0000000000f1";
const F9 = "d2108000-0000-4000-8000-0000000000f9";
const D1 = "d2108000-0000-4000-8000-0000000000d1";
const D2 = "d2108000-0000-4000-8000-0000000000d2";
const D9 = "d2108000-0000-4000-8000-0000000000d9";
const L1 = "d2108000-0000-4000-8000-000000000101";
const L2 = "d2108000-0000-4000-8000-000000000102";
const H1 = "a1".repeat(32);
const H2 = "b2".repeat(32);

const TRIGGERS = ["public_device_tokens_append_only", "public_device_tokens_no_truncate", "public_device_tokens_same_tenant"];

interface Graph {
  db: LiveDb;
  migrator: { up(options?: object): Promise<{ name: string }[]> };
  schemaVerify: { verifySchema(db: unknown): Promise<{ problems: string[]; objects: number }> };
}

/* eslint-disable @typescript-eslint/no-require-imports -- the graph is loaded per "process" with jest.isolateModules; typed by the members used */
const startProcess = (): Graph => {
  let graph: Graph | undefined;
  jest.isolateModules(() => {
    const db = (require("../../config") as { db: LiveDb }).db;
    db.options.logging = false;
    require("../../models");
    graph = {
      db,
      migrator: (require("../../config/migrator") as { migrator: Graph["migrator"] }).migrator,
      schemaVerify: require("../../utils/schemaVerify.util") as Graph["schemaVerify"],
    };
  });
  if (!graph) {
    throw new Error("the module graph did not load");
  }
  return graph;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const linkSql = `INSERT INTO public_device_tokens (id, tenant_id, device_id, token_hash, created_by)
   VALUES (:id, :tenant, :device, :hash, :by)`;

jest.setTimeout(600000);

describe("P21-08 — migration 0137 on live PostgreSQL 18", () => {
  let g: Graph;
  let admin: Sequelize;
  let applied: string[] = [];

  const refusedForBoth = async (t: LiveTx, sql: string, replacements: object, pattern: RegExp): Promise<void> => {
    expect(await errorOf(g.db, t, sql, replacements)).toMatch(pattern);
    expect(await errorOf(g.db, t, sql, replacements, null)).toMatch(pattern);
  };
  const asApp = async (t: LiveTx, sql: string, replacements: object = {}): Promise<void> => {
    expect(await errorOf(g.db, t, sql, replacements)).toBeNull();
  };
  const link = (id: string, hash: string, device = D1, tenant = T, by = U1): Record<string, string> => ({ id, tenant, device, hash, by });

  beforeAll(async () => {
    const name = env("DB_NAME") ?? "";
    if (!name.includes("scratch")) {
      throw new Error(`Refusing to rebuild DB_NAME="${name}": use a scratch database (see the header)`);
    }
    admin = new Sequelize("postgres", env("DB_USER") ?? "", env("DB_PASS") ?? "", {
      host: env("DB_HOST") ?? "",
      port: Number(env("DB_PORT") ?? "5432"),
      dialect: "postgres",
      logging: false,
    });
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
    g = startProcess();
    await g.db.sync();
    applied = (await g.migrator.up()).map((m) => m.name);
    for (const statement of [
      ...seedSql({ tenant: T, role: ROLE, users: [U1], facilities: [[F1, "F-0001"]], devices: [[D1, F1, "SN-1"], [D2, F1, "SN-2"]], tag: "p2108" }),
      ...seedSql({ tenant: T2, role: ROLE2, users: [U9], facilities: [[F9, "F-0009"]], devices: [[D9, F9, "SN-9"]], tag: "p2108b" }),
    ]) {
      await g.db.query(statement);
    }
  });

  afterAll(async () => {
    await g.db.close();
    await admin.close();
  });

  it("0137 is applied after 0136; its three triggers are ENABLE ALWAYS ('A'); schemaVerify passes", async () => {
    expect(applied.indexOf("0137-public-device-tokens.js")).toBeGreaterThan(applied.indexOf("0136-upstream-transform-catalogue.js"));
    const triggers = await rows(
      g.db,
      "SELECT t.tgname AS name, t.tgenabled::text AS state FROM pg_trigger t WHERE t.tgrelid = 'public_device_tokens'::regclass AND NOT t.tgisinternal ORDER BY 1",
    );
    expect(triggers).toEqual(TRIGGERS.map((name) => ({ name, state: "A" })));
    expect((await g.schemaVerify.verifySchema(g.db)).problems).toEqual([]);
  });

  it("the hash is unique GLOBALLY — another tenant cannot hold it either (23505); FAIL-BEFORE without the index", async () => {
    await inRolledBack(g.db, async (t) => {
      await asApp(t, linkSql, link(L1, H1));
      await refusedForBoth(t, linkSql, link(L2, H1, D9, T2, U9), /^23505 .*public_device_tokens_token_hash_unique/);
      await g.db.query("DROP INDEX public_device_tokens_token_hash_unique", { transaction: t });
      await asApp(t, linkSql, link(L2, H1, D9, T2, U9));
    });
  });

  it("the hash is 64 lower-case hex (23514)", async () => {
    await inRolledBack(g.db, async (t) => {
      await refusedForBoth(t, linkSql, link(L1, "A1".repeat(32)), /^23514 .*public_device_tokens_hash_shape/);
    });
  });

  it("one ACTIVE link per device (23505); a revoked one frees the slot; FAIL-BEFORE without the index", async () => {
    await inRolledBack(g.db, async (t) => {
      await asApp(t, linkSql, link(L1, H1));
      await refusedForBoth(t, linkSql, link(L2, H2), /^23505 .*public_device_tokens_one_active_per_device/);
      await asApp(t, "UPDATE public_device_tokens SET revoked_at = now(), revoked_by = :by, revoked_reason = 'rotated' WHERE id = :id", { by: U1, id: L1 });
      await asApp(t, linkSql, link(L2, H2));
    });
    await inRolledBack(g.db, async (t) => {
      await asApp(t, linkSql, link(L1, H1));
      await g.db.query("DROP INDEX public_device_tokens_one_active_per_device", { transaction: t });
      await asApp(t, linkSql, link(L2, H2));
    });
  });

  it("the revoke columns together or not at all; `revoked_by` NULL only for `device_deleted` (23514)", async () => {
    await inRolledBack(g.db, async (t) => {
      await asApp(t, linkSql, link(L1, H1));
      const update = "UPDATE public_device_tokens SET %s WHERE id = :id";
      await refusedForBoth(t, update.replace("%s", "revoked_at = now()"), { id: L1 }, /^23514 .*public_device_tokens_revoke_together/);
      await refusedForBoth(t, update.replace("%s", "revoked_at = now(), revoked_reason = 'revoked'"), { id: L1 }, /^23514 .*public_device_tokens_revoke_together/);
      await refusedForBoth(t, update.replace("%s", `revoked_at = now(), revoked_by = '${U1}', revoked_reason = 'lost'`), { id: L1 }, /^23514 .*public_device_tokens_revoked_reason/);
      await asApp(t, update.replace("%s", "revoked_at = now(), revoked_reason = 'device_deleted'"), { id: L1 });
    });
  });

  it("append-mostly for every role: the hash and identity never change, a revoked link never changes again, no DELETE, no TRUNCATE (42501)", async () => {
    await inRolledBack(g.db, async (t) => {
      await asApp(t, linkSql, link(L1, H1));
      await refusedForBoth(t, "UPDATE public_device_tokens SET token_hash = :h WHERE id = :id", { h: H2, id: L1 }, /^42501 /);
      await refusedForBoth(t, "UPDATE public_device_tokens SET device_id = :d WHERE id = :id", { d: D2, id: L1 }, /^42501 /);
      await refusedForBoth(t, "DELETE FROM public_device_tokens WHERE id = :id", { id: L1 }, /^42501 /);
      await refusedForBoth(t, "TRUNCATE public_device_tokens", {}, /^42501 /);
      await asApp(t, "UPDATE public_device_tokens SET revoked_at = now(), revoked_by = :by, revoked_reason = 'revoked' WHERE id = :id", { by: U1, id: L1 });
      await refusedForBoth(t, "UPDATE public_device_tokens SET revoked_reason = 'rotated' WHERE id = :id", { id: L1 }, /^42501 .*is revoked and cannot change/);
    });
  });

  it("the owner is bound too: an identity change is refused by the trigger itself", async () => {
    await inRolledBack(g.db, async (t) => {
      await asApp(t, linkSql, link(L1, H1));
      expect(await errorOf(g.db, t, "UPDATE public_device_tokens SET created_by = :u WHERE id = :id", { u: U9, id: L1 }, null)).toMatch(
        /^42501 .*only the revoke columns/,
      );
      expect(await errorOf(g.db, t, "DELETE FROM public_device_tokens WHERE id = :id", { id: L1 }, null)).toMatch(/^42501 .*append-only/);
    });
  });

  it("a link names a device of its own tenant (42501)", async () => {
    await inRolledBack(g.db, async (t) => {
      await refusedForBoth(t, linkSql, link(L1, H1, D9, T), /^42501 .*is not of tenant/);
    });
  });

  it("the application role's grants: SELECT, INSERT, UPDATE of the revoke columns only — no DELETE", async () => {
    const [grants] = await rows(
      g.db,
      `SELECT has_table_privilege(:role, 'public_device_tokens', 'SELECT') AS sel,
              has_table_privilege(:role, 'public_device_tokens', 'INSERT') AS ins,
              has_table_privilege(:role, 'public_device_tokens', 'UPDATE') AS upd_table,
              has_column_privilege(:role, 'public_device_tokens', 'revoked_at', 'UPDATE') AS upd_revoked,
              has_column_privilege(:role, 'public_device_tokens', 'token_hash', 'UPDATE') AS upd_hash,
              has_table_privilege(:role, 'public_device_tokens', 'DELETE') AS del,
              has_table_privilege(:role, 'public_device_tokens', 'TRUNCATE') AS trunc`,
      { role: APP_ROLE },
    );
    expect(grants).toEqual({ sel: true, ins: true, upd_table: false, upd_revoked: true, upd_hash: false, del: false, trunc: false });
  });

  it("a reboot applies nothing", async () => {
    expect(await g.migrator.up()).toEqual([]);
  });
});
