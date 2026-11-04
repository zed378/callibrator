/**
 * P21-15 against a REAL PostgreSQL 18 — migration 0149 (`user_esignatures`, `esignature_applications`).
 * ADR-140; spec MEMORY/specs/P21-15-operator-esignature.md v2 § 2.
 *
 * On an EMPTY scratch database: db.sync() and EVERY migration (the boot's schema step). Each probe in a
 * rolled-back transaction; every refusal is checked as `callibrator_app` (SET LOCAL ROLE — CLAUDE.md
 * Evidence) AND as the owner where the owner is bound, and the unique indexes have their FAIL-BEFORE
 * (the same write with the index dropped inside the rolled-back transaction SUCCEEDS):
 *  - one ACTIVE e-signature per user (23505), one version number per user (23505); the status, the
 *    lifecycle and the fingerprint CHECKs (23514); a user of the row's own tenant (42501);
 *  - append-mostly: an active row may become superseded or revoked; nothing else changes, a
 *    non-active row never changes, nothing is deleted or truncated (42501, every role);
 *  - an application only by the ACTIVE e-signature of its own signer, on an effective full record of
 *    its tenant, `performed` by the performer and `reviewed` by anyone else (42501);
 *  - a document has no id and the file scheme, a record has an id and its scheme (23514);
 *  - the token is unique GLOBALLY (23505); one application per (document, signer, meaning) (23505);
 *  - append-only applications (42501, every role); the grants of the application role;
 *  - the triggers are ENABLE ALWAYS; schemaVerify passes; a reboot applies nothing.
 *
 *   npm run test:live -- --only=p2115      (the runner makes and drops the scratch database)
 *
 * Synthetic values only.
 */
import { Sequelize } from "sequelize";
import { env } from "../../config/env";
import { APP_ROLE, errorOf, inRolledBack, rows, seedSql, type LiveDb, type LiveTx } from "../fixtures/ipmLive";

const T = "d2115000-0000-4000-8000-000000000001";
const T2 = "d2115000-0000-4000-8000-000000000011";
const ROLE = "d2115000-0000-4000-8000-000000000002";
const ROLE2 = "d2115000-0000-4000-8000-000000000012";
const U1 = "d2115000-0000-4000-8000-0000000000a1";
const U2 = "d2115000-0000-4000-8000-0000000000a2";
const U9 = "d2115000-0000-4000-8000-0000000000a9";
const F1 = "d2115000-0000-4000-8000-0000000000f1";
const F9 = "d2115000-0000-4000-8000-0000000000f9";
const D1 = "d2115000-0000-4000-8000-0000000000d1";
const D9 = "d2115000-0000-4000-8000-0000000000d9";
const R1 = "d2115000-0000-4000-8000-0000000000c1";
const R9 = "d2115000-0000-4000-8000-0000000000c9";
const E1 = "d2115000-0000-4000-8000-0000000000e1";
const E2 = "d2115000-0000-4000-8000-0000000000e2";
const E9 = "d2115000-0000-4000-8000-0000000000e9";
const A1 = "d2115000-0000-4000-8000-000000000101";
const A2 = "d2115000-0000-4000-8000-000000000102";
const FP = "ab".repeat(32);
const HASH = "cd".repeat(32);

const TRIGGERS = {
  user_esignatures: ["user_esignatures_append_mostly", "user_esignatures_no_truncate", "user_esignatures_same_tenant"],
  esignature_applications: ["esignature_applications_append_only", "esignature_applications_no_truncate", "esignature_applications_signable"],
};

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

const esigSql = `INSERT INTO user_esignatures (id, tenant_id, user_id, version, specimen_svg, public_key_pem, private_key_enc, key_fingerprint, status)
   VALUES (:id, :tenant, :user, :version, '<svg></svg>', 'synthetic-public', 'synthetic-envelope', :fp, :status)`;
const esig = (id: string, user: string, tenant = T, version = 1, status = "active", fp = FP): Record<string, unknown> => ({ id, tenant, user, version, status, fp });

const appSql = `INSERT INTO esignature_applications (id, tenant_id, esignature_id, signer_user_id, signer_snapshot, document_type, document_id,
     document_title, meaning, content_hash, content_scheme, auth_method, signature_value, signed_at, verification_token)
   VALUES (:id, :tenant, :esig, :signer, '{"name":"Teknisi","role":null,"organisation":null}', :type, :doc, 'Synthetic', :meaning, :hash, :scheme,
     'password', 'c2lnbmF0dXJl', now(), :token)`;
const app = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: A1,
  tenant: T,
  esig: E1,
  signer: U1,
  type: "calibration_record",
  doc: R1,
  meaning: "performed",
  hash: HASH,
  scheme: "calrec-data-v1",
  token: "A".repeat(32),
  ...over,
});

const recordSql = (id: string, tenant: string, device: string, performer: string): string =>
  `INSERT INTO calibration_records (id, tenant_id, device_id, performed_by, calibration_date, created_at, updated_at)
   VALUES ('${id}', '${tenant}', '${device}', '${performer}', '2030-01-15', now(), now())`;

jest.setTimeout(600000);

describe("P21-15 — migration 0149 on live PostgreSQL 18", () => {
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
      ...seedSql({ tenant: T, role: ROLE, users: [U1, U2], facilities: [[F1, "F-2115"]], devices: [[D1, F1, "SN-2115"]], tag: "p2115a" }),
      ...seedSql({ tenant: T2, role: ROLE2, users: [U9], facilities: [[F9, "F-2119"]], devices: [[D9, F9, "SN-2119"]], tag: "p2115b" }),
      recordSql(R1, T, D1, U1),
      recordSql(R9, T2, D9, U9),
    ]) {
      await g.db.query(statement);
    }
    await g.db.query(esigSql, { replacements: esig(E1, U1) });
    await g.db.query(esigSql, { replacements: esig(E2, U2) });
    await g.db.query(esigSql, { replacements: esig(E9, U9, T2) });
  });

  afterAll(async () => {
    await g.db.close();
    await admin.close();
  });

  it("0149 is applied after 0148; its six triggers are ENABLE ALWAYS ('A'); schemaVerify passes", async () => {
    expect(applied.indexOf("0149-user-esignatures.js")).toBeGreaterThan(applied.indexOf("0148-device-text-search-trgm.js"));
    for (const [table, names] of Object.entries(TRIGGERS)) {
      const triggers = await rows(g.db, `SELECT t.tgname AS name, t.tgenabled::text AS state FROM pg_trigger t WHERE t.tgrelid = '${table}'::regclass AND NOT t.tgisinternal ORDER BY 1`);
      expect(triggers).toEqual([...names].sort().map((name) => ({ name, state: "A" })));
    }
    expect((await g.schemaVerify.verifySchema(g.db)).problems).toEqual([]);
  });

  it("one ACTIVE e-signature per user, one version number per user (23505); FAIL-BEFORE without the index", async () => {
    const E3 = "d2115000-0000-4000-8000-0000000000e3";
    await inRolledBack(g.db, async (t) => {
      await refusedForBoth(t, esigSql, esig(E3, U1, T, 2), /^23505 .*user_esignatures_one_active_per_user/);
      await refusedForBoth(t, esigSql, esig(E3, U1, T, 1, "superseded"), /^23514 .*user_esignatures_lifecycle/);
      await g.db.query("DROP INDEX user_esignatures_one_active_per_user", { transaction: t });
      await asApp(t, esigSql, esig(E3, U1, T, 2));
    });
    await inRolledBack(g.db, async (t) => {
      await asApp(t, "UPDATE user_esignatures SET status = 'superseded', superseded_at = now() WHERE id = :id", { id: E1 });
      await refusedForBoth(t, esigSql, esig(E3, U1, T, 1), /^23505 .*user_esignatures_user_version_unique/);
      await asApp(t, esigSql, esig(E3, U1, T, 2));
    });
  });

  it("the status, lifecycle and fingerprint CHECKs (23514); a user of the row's own tenant (42501)", async () => {
    const E3 = "d2115000-0000-4000-8000-0000000000e3";
    await inRolledBack(g.db, async (t) => {
      await refusedForBoth(t, esigSql, esig(E3, U9, T2, 2, "lost"), /^23514 .*user_esignatures_(status|lifecycle)/);
      await refusedForBoth(t, esigSql, esig(E3, U9, T2, 2, "active", "AB".repeat(32)), /^23514 .*user_esignatures_fingerprint_shape/);
      await refusedForBoth(t, esigSql, esig(E3, U9, T, 2), /^42501 .*is not of tenant/);
      await refusedForBoth(t, "UPDATE user_esignatures SET status = 'revoked', revoked_at = now() WHERE id = :id", { id: E1 }, /^23514 .*user_esignatures_lifecycle/);
    });
  });

  it("append-mostly for every role: active → superseded or revoked once; nothing else changes; never deleted or truncated (42501)", async () => {
    await inRolledBack(g.db, async (t) => {
      await refusedForBoth(t, "UPDATE user_esignatures SET specimen_svg = '<svg/>' WHERE id = :id", { id: E1 }, /^42501 /);
      await refusedForBoth(t, "UPDATE user_esignatures SET private_key_enc = 'x' WHERE id = :id", { id: E1 }, /^42501 /);
      await refusedForBoth(t, "DELETE FROM user_esignatures WHERE id = :id", { id: E1 }, /^42501 /);
      await refusedForBoth(t, "TRUNCATE user_esignatures CASCADE", {}, /^42501 /);
      await asApp(t, "UPDATE user_esignatures SET status = 'revoked', revoked_at = now(), revoked_reason = 'Departed' WHERE id = :id", { id: E1 });
      await refusedForBoth(t, "UPDATE user_esignatures SET revoked_reason = 'Other' WHERE id = :id", { id: E1 }, /^42501 .*never changes again/);
    });
    // The owner is bound by the trigger itself, not only the grant.
    await inRolledBack(g.db, async (t) => {
      expect(await errorOf(g.db, t, "UPDATE user_esignatures SET public_key_pem = 'x' WHERE id = :id", { id: E1 }, null)).toMatch(/^42501 .*only the lifecycle/);
    });
  });

  it("an application only by its signer's ACTIVE e-signature, on an effective full record of its tenant, with the meaning the signer may give (42501)", async () => {
    await inRolledBack(g.db, async (t) => {
      await asApp(t, appSql, app());
      await asApp(t, appSql, app({ id: A2, esig: E2, signer: U2, meaning: "reviewed", token: "B".repeat(32) }));
    });
    await inRolledBack(g.db, async (t) => {
      await refusedForBoth(t, appSql, app({ meaning: "reviewed" }), /^42501 .*is not the meaning signer/);
      await refusedForBoth(t, appSql, app({ esig: E2, signer: U2 }), /^42501 .*is not the meaning signer/);
      await refusedForBoth(t, appSql, app({ esig: E2 }), /^42501 .*is not the active e-signature/);
      await refusedForBoth(t, appSql, app({ doc: R9 }), /^42501 .*is not of tenant/);
      await refusedForBoth(t, appSql, app({ meaning: "approved" }), /^42501 .*is not the meaning signer/);
      await g.db.query("UPDATE user_esignatures SET status = 'superseded', superseded_at = now() WHERE id = :id", { transaction: t, replacements: { id: E1 } });
      await refusedForBoth(t, appSql, app(), /^42501 .*is not the active e-signature/);
    });
    await inRolledBack(g.db, async (t) => {
      await g.db.query("UPDATE calibration_records SET is_deleted = true, deleted_at = now(), void_reason = 'Synthetic' WHERE id = :id", { transaction: t, replacements: { id: R1 } });
      await refusedForBoth(t, appSql, app(), /^42501 .*only an effective full record/);
    });
  });

  it("a document has no id and the file scheme; a record has an id and its own scheme (23514); a certificate must be the tenant's (42501)", async () => {
    await inRolledBack(g.db, async (t) => {
      await asApp(t, appSql, app({ type: "document", doc: null, scheme: "file-sha256", meaning: "authored" }));
      await refusedForBoth(t, appSql, app({ id: A2, type: "document", doc: R1, scheme: "file-sha256", meaning: "authored", token: "B".repeat(32) }), /^23514 .*esignature_applications_document_id/);
      await refusedForBoth(t, appSql, app({ id: A2, scheme: "file-sha256", token: "B".repeat(32) }), /^23514 .*esignature_applications_type_scheme/);
      await refusedForBoth(t, appSql, app({ id: A2, type: "certificate", doc: R1, scheme: "cert-data-v1", meaning: "approved", token: "B".repeat(32) }), /^42501 .*certificate .* is not of tenant/);
    });
  });

  it("the token is unique GLOBALLY (23505); one application per (document, signer, meaning) (23505); FAIL-BEFORE without each index", async () => {
    await inRolledBack(g.db, async (t) => {
      await asApp(t, appSql, app());
      await refusedForBoth(t, appSql, app({ id: A2, tenant: T2, esig: E9, signer: U9, doc: R9 }), /^23505 .*esignature_applications_token_unique/);
      await g.db.query("DROP INDEX esignature_applications_token_unique", { transaction: t });
      await asApp(t, appSql, app({ id: A2, tenant: T2, esig: E9, signer: U9, doc: R9 }));
    });
    await inRolledBack(g.db, async (t) => {
      await asApp(t, appSql, app());
      await refusedForBoth(t, appSql, app({ id: A2, token: "B".repeat(32) }), /^23505 .*esignature_applications_once_per_meaning/);
      await g.db.query("DROP INDEX esignature_applications_once_per_meaning", { transaction: t });
      await asApp(t, appSql, app({ id: A2, token: "B".repeat(32) }));
    });
  });

  it("applications are append-only for every role (42501)", async () => {
    await inRolledBack(g.db, async (t) => {
      await asApp(t, appSql, app());
      await refusedForBoth(t, "UPDATE esignature_applications SET document_title = 'x' WHERE id = :id", { id: A1 }, /^42501 /);
      await refusedForBoth(t, "DELETE FROM esignature_applications WHERE id = :id", { id: A1 }, /^42501 /);
      await refusedForBoth(t, "TRUNCATE esignature_applications", {}, /^42501 /);
      expect(await errorOf(g.db, t, "UPDATE esignature_applications SET meaning = 'reviewed' WHERE id = :id", { id: A1 }, null)).toMatch(/^42501 .*append-only/);
    });
  });

  it("the application role's grants: the lifecycle columns only on user_esignatures; SELECT and INSERT only on applications", async () => {
    const [grants] = await rows(
      g.db,
      `SELECT has_table_privilege(:role, 'user_esignatures', 'INSERT') AS esig_ins,
              has_table_privilege(:role, 'user_esignatures', 'UPDATE') AS esig_upd_table,
              has_column_privilege(:role, 'user_esignatures', 'status', 'UPDATE') AS esig_upd_status,
              has_column_privilege(:role, 'user_esignatures', 'private_key_enc', 'UPDATE') AS esig_upd_key,
              has_table_privilege(:role, 'user_esignatures', 'DELETE') AS esig_del,
              has_table_privilege(:role, 'esignature_applications', 'SELECT') AS app_sel,
              has_table_privilege(:role, 'esignature_applications', 'INSERT') AS app_ins,
              has_table_privilege(:role, 'esignature_applications', 'UPDATE') AS app_upd,
              has_table_privilege(:role, 'esignature_applications', 'DELETE') AS app_del,
              has_table_privilege(:role, 'esignature_applications', 'TRUNCATE') AS app_trunc`,
      { role: APP_ROLE },
    );
    expect(grants).toEqual({ esig_ins: true, esig_upd_table: false, esig_upd_status: true, esig_upd_key: false, esig_del: false, app_sel: true, app_ins: true, app_upd: false, app_del: false, app_trunc: false });
  });

  it("a reboot applies nothing", async () => {
    expect(await g.migrator.up()).toEqual([]);
  });
});
