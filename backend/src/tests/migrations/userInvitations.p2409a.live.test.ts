/**
 * P24-09a against a REAL PostgreSQL 18 — migration 0144 (`user_invitations`). ADR-139 § 3 – § 4.
 *
 * On an EMPTY scratch database: db.sync() and EVERY migration (the boot's schema step). Each probe in
 * a rolled-back transaction; every refusal is checked as `callibrator_app` (SET LOCAL ROLE — CLAUDE.md
 * Evidence) AND as the owner where the owner is bound, and the indexes have their FAIL-BEFORE (the
 * same write with the index dropped inside the rolled-back transaction SUCCEEDS):
 *  - the token hash is unique GLOBALLY — across tenants (23505); its shape is 64 hex (23514);
 *  - one LIVE invitation per user (23505); an accepted or revoked one frees the slot;
 *  - the revoke columns together, by a person, or not at all; never accepted AND revoked; it expires
 *    after it was issued (23514);
 *  - append-mostly for every role: identity, hash and expiry never change, a spent invitation never
 *    changes again, nothing is deleted or truncated (42501);
 *  - an invitation names a user of its own tenant (42501);
 *  - the grants: the application role may SELECT, INSERT and UPDATE only the acceptance and revoke
 *    columns;
 *  - the triggers are ENABLE ALWAYS; schemaVerify passes; a reboot applies nothing.
 *
 *   npm run test:live -- --only=p2409a      (the runner makes and drops the scratch database)
 *
 * Synthetic values only.
 */
import { Sequelize } from "sequelize";
import { env } from "../../config/env";
import { APP_ROLE, errorOf, inRolledBack, rows, seedSql, type LiveDb, type LiveTx } from "../fixtures/ipmLive";

const T = "d2409000-0000-4000-8000-000000000001";
const T2 = "d2409000-0000-4000-8000-000000000011";
const ROLE = "d2409000-0000-4000-8000-000000000002";
const ROLE2 = "d2409000-0000-4000-8000-000000000012";
const ADMIN = "d2409000-0000-4000-8000-0000000000a1";
const U1 = "d2409000-0000-4000-8000-0000000000a2";
const U9 = "d2409000-0000-4000-8000-0000000000a9";
const I1 = "d2409000-0000-4000-8000-000000000101";
const I2 = "d2409000-0000-4000-8000-000000000102";
const H1 = "a1".repeat(32);
const H2 = "b2".repeat(32);

const TRIGGERS = ["user_invitations_append_only", "user_invitations_no_truncate", "user_invitations_same_tenant"];

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

const inviteSql = `INSERT INTO user_invitations (id, tenant_id, user_id, token_hash, issued_by, expires_at)
   VALUES (:id, :tenant, :user, :hash, :by, now() + interval '7 days')`;

jest.setTimeout(600000);

describe("P24-09a — migration 0144 on live PostgreSQL 18", () => {
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
  const invite = (id: string, hash: string, user = U1, tenant = T, by = ADMIN): Record<string, string> => ({ id, tenant, user, hash, by });

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
      ...seedSql({ tenant: T, role: ROLE, users: [ADMIN, U1], facilities: [], devices: [], tag: "p2409a" }),
      ...seedSql({ tenant: T2, role: ROLE2, users: [U9], facilities: [], devices: [], tag: "p2409b" }),
    ]) {
      await g.db.query(statement);
    }
  });

  afterAll(async () => {
    await g.db.close();
    await admin.close();
  });

  it("0144 is applied after 0143; its three triggers are ENABLE ALWAYS ('A'); schemaVerify passes", async () => {
    expect(applied.indexOf("0144-user-invitations.js")).toBeGreaterThan(applied.indexOf("0143-users-awaiting-invitation.js"));
    const triggers = await rows(
      g.db,
      "SELECT t.tgname AS name, t.tgenabled::text AS state FROM pg_trigger t WHERE t.tgrelid = 'user_invitations'::regclass AND NOT t.tgisinternal ORDER BY 1",
    );
    expect(triggers).toEqual(TRIGGERS.map((name) => ({ name, state: "A" })));
    expect((await g.schemaVerify.verifySchema(g.db)).problems).toEqual([]);
  });

  it("the hash is unique GLOBALLY — another tenant cannot hold it either (23505); FAIL-BEFORE without the index", async () => {
    await inRolledBack(g.db, async (t) => {
      await asApp(t, inviteSql, invite(I1, H1));
      await refusedForBoth(t, inviteSql, invite(I2, H1, U9, T2, U9), /^23505 .*user_invitations_token_hash_unique/);
      await g.db.query("DROP INDEX user_invitations_token_hash_unique", { transaction: t });
      await asApp(t, inviteSql, invite(I2, H1, U9, T2, U9));
    });
  });

  it("the hash is 64 lower-case hex; it expires after it was issued (23514)", async () => {
    await inRolledBack(g.db, async (t) => {
      await refusedForBoth(t, inviteSql, invite(I1, "A1".repeat(32)), /^23514 .*user_invitations_hash_shape/);
      await refusedForBoth(
        t,
        "INSERT INTO user_invitations (id, tenant_id, user_id, token_hash, issued_by, expires_at) VALUES (:id, :tenant, :user, :hash, :by, now() - interval '1 second')",
        invite(I1, H1),
        /^23514 .*user_invitations_expires_after_issue/,
      );
    });
  });

  it("one LIVE invitation per user (23505); an accepted or revoked one frees the slot; FAIL-BEFORE without the index", async () => {
    await inRolledBack(g.db, async (t) => {
      await asApp(t, inviteSql, invite(I1, H1));
      await refusedForBoth(t, inviteSql, invite(I2, H2), /^23505 .*user_invitations_one_live_per_user/);
      await asApp(t, "UPDATE user_invitations SET revoked_at = now(), revoked_by = :by, revoked_reason = 'reissued' WHERE id = :id", { by: ADMIN, id: I1 });
      await asApp(t, inviteSql, invite(I2, H2));
    });
    await inRolledBack(g.db, async (t) => {
      await asApp(t, inviteSql, invite(I1, H1));
      await asApp(t, "UPDATE user_invitations SET accepted_at = now() WHERE id = :id", { id: I1 });
      await asApp(t, inviteSql, invite(I2, H2));
    });
    await inRolledBack(g.db, async (t) => {
      await asApp(t, inviteSql, invite(I1, H1));
      await g.db.query("DROP INDEX user_invitations_one_live_per_user", { transaction: t });
      await asApp(t, inviteSql, invite(I2, H2));
    });
  });

  it("the revoke columns together, by a person, or not at all; never accepted AND revoked (23514)", async () => {
    await inRolledBack(g.db, async (t) => {
      await asApp(t, inviteSql, invite(I1, H1));
      const update = "UPDATE user_invitations SET %s WHERE id = :id";
      await refusedForBoth(t, update.replace("%s", "revoked_at = now()"), { id: I1 }, /^23514 .*user_invitations_revoke_together/);
      await refusedForBoth(t, update.replace("%s", "revoked_at = now(), revoked_reason = 'revoked'"), { id: I1 }, /^23514 .*user_invitations_revoke_together/);
      await refusedForBoth(t, update.replace("%s", `revoked_at = now(), revoked_by = '${ADMIN}', revoked_reason = 'lost'`), { id: I1 }, /^23514 .*user_invitations_revoked_reason/);
      await refusedForBoth(
        t,
        update.replace("%s", `accepted_at = now(), revoked_at = now(), revoked_by = '${ADMIN}', revoked_reason = 'revoked'`),
        { id: I1 },
        /^23514 .*user_invitations_accepted_or_revoked/,
      );
    });
  });

  it("append-mostly for every role: identity, hash and expiry never change, a spent invitation never changes again, no DELETE, no TRUNCATE (42501)", async () => {
    await inRolledBack(g.db, async (t) => {
      await asApp(t, inviteSql, invite(I1, H1));
      await refusedForBoth(t, "UPDATE user_invitations SET token_hash = :h WHERE id = :id", { h: H2, id: I1 }, /^42501 /);
      await refusedForBoth(t, "UPDATE user_invitations SET expires_at = now() + interval '30 days' WHERE id = :id", { id: I1 }, /^42501 /);
      await refusedForBoth(t, "DELETE FROM user_invitations WHERE id = :id", { id: I1 }, /^42501 /);
      await refusedForBoth(t, "TRUNCATE user_invitations", {}, /^42501 /);
      await asApp(t, "UPDATE user_invitations SET accepted_at = now() WHERE id = :id", { id: I1 });
      await refusedForBoth(t, "UPDATE user_invitations SET accepted_at = now() WHERE id = :id", { id: I1 }, /^42501 .*is spent and cannot change/);
    });
  });

  it("the owner is bound too: an identity change is refused by the trigger itself", async () => {
    await inRolledBack(g.db, async (t) => {
      await asApp(t, inviteSql, invite(I1, H1));
      expect(await errorOf(g.db, t, "UPDATE user_invitations SET issued_by = :u WHERE id = :id", { u: U1, id: I1 }, null)).toMatch(
        /^42501 .*only the acceptance or the revoke columns/,
      );
      expect(await errorOf(g.db, t, "DELETE FROM user_invitations WHERE id = :id", { id: I1 }, null)).toMatch(/^42501 .*append-only/);
    });
  });

  it("an invitation names a user of its own tenant (42501)", async () => {
    await inRolledBack(g.db, async (t) => {
      await refusedForBoth(t, inviteSql, invite(I1, H1, U9, T), /^42501 .*is not of tenant/);
    });
  });

  it("the application role's grants: SELECT, INSERT, UPDATE of the acceptance and revoke columns only — no DELETE", async () => {
    const [grants] = await rows(
      g.db,
      `SELECT has_table_privilege(:role, 'user_invitations', 'SELECT') AS sel,
              has_table_privilege(:role, 'user_invitations', 'INSERT') AS ins,
              has_table_privilege(:role, 'user_invitations', 'UPDATE') AS upd_table,
              has_column_privilege(:role, 'user_invitations', 'accepted_at', 'UPDATE') AS upd_accepted,
              has_column_privilege(:role, 'user_invitations', 'revoked_at', 'UPDATE') AS upd_revoked,
              has_column_privilege(:role, 'user_invitations', 'token_hash', 'UPDATE') AS upd_hash,
              has_column_privilege(:role, 'user_invitations', 'expires_at', 'UPDATE') AS upd_expires,
              has_table_privilege(:role, 'user_invitations', 'DELETE') AS del,
              has_table_privilege(:role, 'user_invitations', 'TRUNCATE') AS trunc`,
      { role: APP_ROLE },
    );
    expect(grants).toEqual({ sel: true, ins: true, upd_table: false, upd_accepted: true, upd_revoked: true, upd_hash: false, upd_expires: false, del: false, trunc: false });
  });

  it("a reboot applies nothing", async () => {
    expect(await g.migrator.up()).toEqual([]);
  });
});
