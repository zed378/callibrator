/**
 * P20-04 against a REAL PostgreSQL 18 — migration 0126 (the IPM tables, their keys, the facility
 * functions' `result` branch, the grants), with 0127 applied as the boot applies it (ADR-126 Am. 1–2;
 * spec MEMORY/specs/P19-02-ipm-session-aggregate.md § 4, § 5.3, § 5.4, § 9.1, § 17;
 * MEMORY/specs/P19-06-ipm-report-document.md § 4).
 *
 * On an EMPTY scratch database: db.sync() and EVERY migration (the boot's schema step). Then, as
 * `callibrator_app` (SET LOCAL ROLE — never as the owner, CLAUDE.md Evidence) unless a case says
 * otherwise, each probe in a rolled-back transaction:
 *  - the grants: sessions without DELETE, signatures without UPDATE and DELETE, no TRUNCATE anywhere;
 *  - the composite keys: a session naming another facility's device, a result or a signature naming
 *    another facility's session — 23503; both keys ON UPDATE CASCADE ON DELETE RESTRICT;
 *  - the facility default: a session takes its device's facility, a result and a signature their
 *    session's (the `result` branch); FAIL-BEFORE: with 0117's functions back (no `result` branch —
 *    what re-running 0117 alone after 0126 would do) every result insert fails with 42703, since
 *    0117's fall-through reads a `device_id` a result does not have — the branch makes the difference;
 *  - no session is added to an ended facility (23514);
 *  - the CHECKs (issued fields, correction reason, ad-hoc section, one principal, signature meaning);
 *  - the partial unique indexes: one open root draft per creator and device (another creator may),
 *    one visit number per device root, one live correction per session (a discarded one frees it),
 *    `client_ref` per creator (another creator may reuse it), `report_number` per tenant;
 *  - schemaVerify passes; a REBOOT applies nothing and still passes;
 *  - 0126 down REFUSES while a row exists; on an empty aggregate down × 2, then up × 2 through the
 *    migrations' own createTable path: the same objects, and schemaVerify passes.
 *
 *   docker run -d --name p2004-pg18 -e POSTGRES_PASSWORD=p2004pass -p 127.0.0.1:55204:5432 pgvector/pgvector:pg18
 *   DB_HOST=127.0.0.1 DB_PORT=55204 DB_NAME=p2004_scratch DB_USER=postgres DB_PASS=p2004pass \
 *     npm run test:live:jest -- src/tests/migrations/inspectionSessions.p2004.live
 *   docker rm -f p2004-pg18
 */
import { Sequelize } from "sequelize";
import { env } from "../../config/env";
import {
  APP_ROLE,
  HASH,
  draftSql,
  errorOf,
  inRolledBack,
  resultSql,
  rows,
  seedSql,
  signatureSql,
  submitSql,
  type LiveDb,
  type LiveTx,
  type Row,
} from "../fixtures/ipmLive";

const T = "d2004000-0000-4000-8000-000000000001";
const ROLE = "d2004000-0000-4000-8000-000000000002";
const U1 = "d2004000-0000-4000-8000-0000000000a1";
const U2 = "d2004000-0000-4000-8000-0000000000a2";
const F1 = "d2004000-0000-4000-8000-0000000000f1";
const F2 = "d2004000-0000-4000-8000-0000000000f2";
const F3 = "d2004000-0000-4000-8000-0000000000f3";
const D1 = "d2004000-0000-4000-8000-0000000000d1";
const D2 = "d2004000-0000-4000-8000-0000000000d2";
const D3 = "d2004000-0000-4000-8000-0000000000d3";
const S1 = "d2004000-0000-4000-8000-000000000101";
const S2 = "d2004000-0000-4000-8000-000000000102";
const S3 = "d2004000-0000-4000-8000-000000000103";
const S4 = "d2004000-0000-4000-8000-000000000104";
const R1 = "d2004000-0000-4000-8000-000000000201";
const SIG = "d2004000-0000-4000-8000-000000000301";
const REF = "d2004000-0000-4000-8000-000000000401";
const IPM_TABLES = ["inspection_sessions", "inspection_results", "inspection_session_signatures"];

interface Migration {
  up(o: { context: unknown }): Promise<void>;
  down(o: { context: unknown }): Promise<void>;
}
interface Graph {
  db: LiveDb;
  migrator: { up(options?: object): Promise<{ name: string }[]> };
  schemaVerify: { verifySchema(db: unknown): Promise<{ problems: string[]; objects: number }> };
  m0117: { FUNCTIONS: readonly (readonly [string, string, string])[] };
  m0126: Migration & { FUNCTIONS: readonly (readonly [string, string])[] };
  m0127: Migration;
  m0128: Migration;
  m0129: Migration;
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
      m0117: require("../../migrations/0117-client-facilities") as Graph["m0117"],
      m0126: require("../../migrations/0126-ipm-sessions") as Graph["m0126"],
      m0127: require("../../migrations/0127-ipm-immutability") as Migration,
      m0128: require("../../migrations/0128-device-extensions") as Migration,
      m0129: require("../../migrations/0129-attachment-purpose") as Migration,
    };
  });
  if (!graph) {
    throw new Error("the module graph did not load");
  }
  return graph;
};
/* eslint-enable @typescript-eslint/no-require-imports */

/** Run `sql` as the application role, keeping its effect (it must succeed). */
const asApp = async (db: LiveDb, t: LiveTx, sql: string, replacements: object = {}): Promise<void> => {
  expect(await errorOf(db, t, sql, replacements)).toBeNull();
};

const base = { tenant: T, user: U1, device: D1 };
/** A submitted root of D1 by U1: draft, one result, submit. */
const submittedRoot = async (db: LiveDb, t: LiveTx, id: string, visit: number, reportNumber: string): Promise<void> => {
  await asApp(db, t, draftSql(), { ...base, id });
  await asApp(db, t, resultSql, { resultId: `${id.slice(0, 33)}999`, tenant: T, session: id, sort: 1 });
  await asApp(db, t, submitSql, { id, visit, reportNumber, token: `tok-${reportNumber}` });
};

const ipmTriggers = async (db: LiveDb): Promise<string[]> =>
  (
    await rows(
      db,
      `SELECT c.relname || ':' || t.tgname || ':' || t.tgenabled::text AS t FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal AND c.relname IN ('inspection_sessions', 'inspection_results', 'inspection_session_signatures')
          AND t.tgname <> 'inspection_sessions_attachments_follow_facility' ORDER BY 1`, // 0129's (P20-08), not 0126/0127's
    )
  ).map((r) => String(r["t"]));

jest.setTimeout(900000);

describe("P20-04 — migration 0126 on live PostgreSQL 18 (with 0127, as the boot applies it)", () => {
  let g: Graph;
  let admin: Sequelize;
  let applied: string[] = [];

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
    for (const statement of seedSql({
      tenant: T,
      role: ROLE,
      users: [U1, U2],
      facilities: [[F1, "F-0001"], [F2, "F-0002"], [F3, "F-0003"]],
      devices: [[D1, F1, "SN-1"], [D2, F2, "SN-2"], [D3, F3, "SN-3"]],
      tag: "p2004",
    })) {
      await g.db.query(statement);
    }
  });

  afterAll(async () => {
    await g.db.close();
    await admin.close();
  });

  it("0126 and 0127 are applied (then 0128, 0129), and their sixteen triggers are ENABLE ALWAYS ('A')", async () => {
    // Later migrations (0128 ... ) follow them in the manifest: assert the adjacent pair, not its
    // position from the tail, which every new migration would break.
    const at = applied.indexOf("0126-ipm-sessions.js");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(applied.slice(at, at + 2)).toEqual(["0126-ipm-sessions.js", "0127-ipm-immutability.js"]);
    const triggers = await ipmTriggers(g.db);
    expect(triggers).toHaveLength(16);
    expect(triggers.filter((x) => !x.endsWith(":A"))).toEqual([]);
    expect(await rows(g.db, `SELECT table_name, is_nullable FROM information_schema.columns
      WHERE column_name = 'client_facility_id' AND table_name IN ('inspection_sessions', 'inspection_results', 'inspection_session_signatures')
      ORDER BY 1`)).toEqual(IPM_TABLES.slice().sort().map((table_name) => ({ table_name, is_nullable: "NO" })));
  });

  it("grants as checked for callibrator_app (spec § 5.4): no DELETE on sessions, no UPDATE/DELETE on signatures, no TRUNCATE anywhere", async () => {
    expect(
      await rows(
        g.db,
        `SELECT t, has_table_privilege(:role, t, 'SELECT') AS s, has_table_privilege(:role, t, 'INSERT') AS i,
                has_table_privilege(:role, t, 'UPDATE') AS u, has_table_privilege(:role, t, 'DELETE') AS d,
                has_table_privilege(:role, t, 'TRUNCATE') AS tr
           FROM unnest(ARRAY['inspection_sessions', 'inspection_results', 'inspection_session_signatures', 'idempotency_keys'])
                WITH ORDINALITY AS u(t, n) ORDER BY n`,
        { role: APP_ROLE },
      ),
    ).toEqual([
      { t: "inspection_sessions", s: true, i: true, u: true, d: false, tr: false },
      { t: "inspection_results", s: true, i: true, u: true, d: true, tr: false },
      { t: "inspection_session_signatures", s: true, i: true, u: false, d: false, tr: false },
      { t: "idempotency_keys", s: true, i: true, u: true, d: true, tr: false },
    ]);
  });

  it("the composite keys cascade on update and restrict on delete; the user keys are RESTRICT, the draft's room SET NULL", async () => {
    expect(
      await rows(
        g.db,
        `SELECT conname, confupdtype::text AS up, confdeltype::text AS del FROM pg_constraint
          WHERE conname IN ('inspection_sessions_device_facility_fkey', 'inspection_results_session_facility_fkey',
                            'inspection_session_signatures_session_facility_fkey') ORDER BY 1`,
      ),
    ).toEqual([
      { conname: "inspection_results_session_facility_fkey", up: "c", del: "r" },
      { conname: "inspection_session_signatures_session_facility_fkey", up: "c", del: "r" },
      { conname: "inspection_sessions_device_facility_fkey", up: "c", del: "r" },
    ]);
    const single = await rows(
      g.db,
      `SELECT a.attname AS col, c.confdeltype::text AS del FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.conrelid = 'inspection_sessions'::regclass AND array_length(c.conkey, 1) = 1
          AND a.attname <> 'tenant_id' ORDER BY 1`,
    );
    expect(single.filter((r) => r["col"] === "location_id")).toEqual([{ col: "location_id", del: "n" }]);
    expect(single.filter((r) => r["col"] !== "location_id" && r["del"] !== "r")).toEqual([]);
    expect(single.length).toBe(12);
  });

  it("the facility default: a session takes its device's, a result and a signature their session's (the result branch)", async () => {
    await inRolledBack(g.db, async (t) => {
      await submittedRoot(g.db, t, S1, 1, "IPM-F-0001-20261009-001");
      await asApp(g.db, t, signatureSql, { signatureId: SIG, tenant: T, session: S1, kind: "performer", signer: U1, hash: HASH });
      expect(await rows(g.db, `SELECT 's' AS k, client_facility_id AS f FROM inspection_sessions WHERE id = :s
        UNION ALL SELECT 'r', client_facility_id FROM inspection_results WHERE session_id = :s
        UNION ALL SELECT 'g', client_facility_id FROM inspection_session_signatures WHERE session_id = :s`, { s: S1 }, t))
        .toEqual([{ k: "s", f: F1 }, { k: "r", f: F1 }, { k: "g", f: F1 }]);
    });
  });

  it("FAIL-BEFORE: with 0117's functions back (no result branch — the 0057-after-0119 trap's shape), every result insert fails (42703)", async () => {
    await inRolledBack(g.db, async (t) => {
      await asApp(g.db, t, draftSql(), { ...base, id: S1 });
      for (const [name, , statement] of g.m0117.FUNCTIONS) {
        if (name === "facility_insert_default" || name === "facility_column_guard") {
          await g.db.query(statement, { transaction: t });
        }
      }
      // 0117's `child` fall-through reads the row's device_id, which a result does not have.
      expect(await errorOf(g.db, t, resultSql, { resultId: R1, tenant: T, session: S1, sort: 1 })).toMatch(
        /^42703 record "new" has no field "device_id"/,
      );
      for (const [, statement] of g.m0126.FUNCTIONS) {
        await g.db.query(statement, { transaction: t });
      }
      expect(await errorOf(g.db, t, resultSql, { resultId: R1, tenant: T, session: S1, sort: 1 })).toBeNull();
    });
  });

  it("the composite keys refuse a session naming another facility's device and a result naming another facility's session (23503)", async () => {
    await inRolledBack(g.db, async (t) => {
      expect(await errorOf(g.db, t, draftSql({ facility: true }), { ...base, id: S1, facility: F2 })).toMatch(
        /^23503 .*inspection_sessions_device_facility_fkey/,
      );
      await asApp(g.db, t, draftSql(), { ...base, id: S1 });
      expect(
        await errorOf(
          g.db,
          t,
          `INSERT INTO inspection_results (id, tenant_id, client_facility_id, session_id, section, input_kind, is_ad_hoc, label_snapshot, sort_order, created_at, updated_at)
           VALUES (:id, :t, :f, :s, 'tools_used', 'check', true, 'x', 1, now(), now())`,
          { id: R1, t: T, f: F2, s: S1 },
        ),
      ).toMatch(/^23503 .*inspection_results_session_facility_fkey/);
    });
  });

  it("no session is added to an ended facility (23514)", async () => {
    await inRolledBack(g.db, async (t) => {
      await g.db.query(`UPDATE client_facilities SET status = 'ended', status_reason = 'Kontrak selesai' WHERE id = '${F3}'`, { transaction: t });
      expect(await errorOf(g.db, t, draftSql(), { tenant: T, user: U1, device: D3, id: S1 })).toMatch(/^23514 Fasilitas F-0003 has ended/);
    });
  });

  it("the CHECKs: issued fields, correction reason, ad-hoc section, one principal, signature meaning", async () => {
    await inRolledBack(g.db, async (t) => {
      await asApp(g.db, t, draftSql(), { ...base, id: S1 });
      expect(await errorOf(g.db, t, `UPDATE inspection_sessions SET status = 'submitted', submitted_at = now(), submitted_by = created_by,
        inspection_outcome = 'pass', maintenance_outcome = 'pass', recommendation = 'fit_for_use' WHERE id = :id`, { id: S1 }))
        .toMatch(/^23514 .*inspection_sessions_issued_fields/);
      expect(await errorOf(g.db, t, "UPDATE inspection_sessions SET correction_reason = 'Tanpa asal' WHERE id = :id", { id: S1 }))
        .toMatch(/^23514 .*inspection_sessions_correction_reason/);
      expect(await errorOf(g.db, t, "UPDATE inspection_sessions SET submitted_by = :u2 WHERE id = :id", { id: S1, u2: U2 }))
        .toMatch(/^23514 .*inspection_sessions_submitter/);
      expect(
        await errorOf(
          g.db,
          t,
          `INSERT INTO inspection_results (id, tenant_id, session_id, section, input_kind, is_ad_hoc, label_snapshot, sort_order, created_at, updated_at)
           VALUES (:id, :t, :s, 'function', 'tri_state', true, 'x', 1, now(), now())`,
          { id: R1, t: T, s: S1 },
        ),
      ).toMatch(/^23514 .*inspection_results_ad_hoc_section/);
      const key = `INSERT INTO idempotency_keys (id, tenant_id, user_id, api_key_id, key, route, request_hash, scope_fingerprint, created_at, expires_at)
        VALUES (gen_random_uuid(), :t, :u, NULL, gen_random_uuid(), 'POST /ipm/sessions', repeat('a', 64), repeat('b', 64), now(), now() + interval '30 days')`;
      expect(await errorOf(g.db, t, key.replace(":u", "NULL"), { t: T })).toMatch(/^23514 .*idempotency_keys_one_principal/);
      expect(await errorOf(g.db, t, key, { t: T, u: U1 })).toBeNull();
      expect(await errorOf(g.db, t, key.replace("repeat('a', 64)", "'not-a-hash'"), { t: T, u: U1 })).toMatch(/^23514 .*idempotency_keys_hash_shape/);
      await asApp(g.db, t, resultSql, { resultId: R1, tenant: T, session: S1, sort: 1 });
      await asApp(g.db, t, submitSql, { id: S1, visit: 1, reportNumber: "IPM-F-0001-20261009-001", token: "tok-1" });
      expect(await errorOf(g.db, t, signatureSql.replace("CASE WHEN :kind = 'performer' THEN 'authorship' ELSE 'review' END", "'review'"),
        { signatureId: SIG, tenant: T, session: S1, kind: "performer", signer: U1, hash: HASH }))
        .toMatch(/^23514 .*inspection_session_signatures_meaning/);
    });
  });

  it("one open root draft per creator and device — another creator may open one", async () => {
    await inRolledBack(g.db, async (t) => {
      await asApp(g.db, t, draftSql(), { ...base, id: S1 });
      expect(await errorOf(g.db, t, draftSql(), { ...base, id: S2 })).toMatch(/^23505 .*inspection_sessions_one_root_draft/);
      expect(await errorOf(g.db, t, draftSql(), { ...base, user: U2, id: S2 })).toBeNull();
    });
  });

  it("one visit number per device root; one live correction per session (a discarded one frees the slot)", async () => {
    await inRolledBack(g.db, async (t) => {
      await submittedRoot(g.db, t, S1, 1, "IPM-F-0001-20261009-001");
      await asApp(g.db, t, draftSql(), { ...base, id: S2 });
      expect(await errorOf(g.db, t, submitSql, { id: S2, visit: 1, reportNumber: "IPM-F-0001-20261009-002", token: "tok-2" }))
        .toMatch(/^23505 .*inspection_sessions_visit_unique/);
      await asApp(g.db, t, draftSql({ supersedes: true }), { ...base, id: S3, supersedes: S1 });
      expect(await errorOf(g.db, t, draftSql({ supersedes: true }), { ...base, user: U2, id: S4, supersedes: S1 }))
        .toMatch(/^23505 .*inspection_sessions_linear_chain/);
      await asApp(g.db, t, "UPDATE inspection_sessions SET status = 'discarded', discarded_by = :u, discarded_at = now() WHERE id = :id", { u: U1, id: S3 });
      expect(await errorOf(g.db, t, draftSql({ supersedes: true }), { ...base, user: U2, id: S4, supersedes: S1 })).toBeNull();
    });
  });

  it("client_ref is unique per creator (another creator may reuse it); report_number per tenant", async () => {
    await inRolledBack(g.db, async (t) => {
      await asApp(g.db, t, draftSql({ clientRef: true }), { ...base, id: S1, clientRef: REF });
      expect(await errorOf(g.db, t, draftSql({ clientRef: true }), { tenant: T, user: U1, device: D2, id: S2, clientRef: REF }))
        .toMatch(/^23505 .*inspection_sessions_client_ref_unique/);
      expect(await errorOf(g.db, t, draftSql({ clientRef: true }), { tenant: T, user: U2, device: D2, id: S2, clientRef: REF })).toBeNull();
      await asApp(g.db, t, resultSql, { resultId: R1, tenant: T, session: S1, sort: 1 });
      await asApp(g.db, t, submitSql, { id: S1, visit: 1, reportNumber: "IPM-F-0001-20261009-001", token: "tok-1" });
      expect(await errorOf(g.db, t, submitSql, { id: S2, visit: 1, reportNumber: "IPM-F-0001-20261009-001", token: "tok-2" }))
        .toMatch(/^23505 .*inspection_sessions_report_number_unique/);
    });
  });

  it("schemaVerify passes: every table, column and control object", async () => {
    const result = await g.schemaVerify.verifySchema(g.db);
    expect(result.problems).toEqual([]);
  });

  it("a REBOOT on the migrated database: sync() (showIndex on every new index), the migrator (nothing), the schema check", async () => {
    const next = startProcess();
    try {
      await next.db.sync();
      expect(await next.migrator.up()).toEqual([]);
      expect((await next.schemaVerify.verifySchema(next.db)).problems).toEqual([]);
    } finally {
      await next.db.close();
    }
  });

  it("0126 down REFUSES while a row exists, and changes nothing", async () => {
    await g.db.query(draftSql(), { replacements: { ...base, id: S1 } });
    const qi = g.db.getQueryInterface();
    await g.m0127.down({ context: qi });
    await expect(g.m0126.down({ context: qi })).rejects.toThrow(/1 row\(s\) in inspection_sessions.*restore the pre-upgrade backup/);
    await g.m0127.up({ context: qi });
    expect(await ipmTriggers(g.db)).toHaveLength(16);
    // Remove the row the only way the aggregate allows a person to: as DDL, the append-only trigger lifted.
    await g.db.query("ALTER TABLE inspection_sessions DISABLE TRIGGER inspection_sessions_append_only");
    await g.db.query(`DELETE FROM inspection_sessions WHERE id = '${S1}'`);
    await g.db.query("ALTER TABLE inspection_sessions ENABLE ALWAYS TRIGGER inspection_sessions_append_only");
  });

  it("down, down, then up, up through the migrations' own createTable path: the same objects; the functions are 0117's in between", async () => {
    const qi = g.db.getQueryInterface();
    const objects = async (): Promise<Row[]> =>
      rows(g.db, `SELECT 'i:' || indexname AS o FROM pg_indexes WHERE tablename IN ('inspection_sessions', 'inspection_results', 'inspection_session_signatures', 'idempotency_keys')
        UNION ALL SELECT 'c:' || conname FROM pg_constraint WHERE conrelid::regclass::text IN ('inspection_sessions', 'inspection_results', 'inspection_session_signatures', 'idempotency_keys')
        UNION ALL SELECT 't:' || tgname || tgenabled::text FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text LIKE 'inspection_%' ORDER BY 1`);
    const before = await objects();
    // 0129 and 0128 (P20-08 / P20-02) name the session table (a device key, the functions): reverted first.
    await g.m0129.down({ context: qi });
    await g.m0128.down({ context: qi });
    await g.m0127.down({ context: qi });
    await g.m0126.down({ context: qi });
    expect(await rows(g.db, "SELECT to_regclass('inspection_sessions') AS s, to_regclass('idempotency_keys') AS k")).toEqual([{ s: null, k: null }]);
    expect(await rows(g.db, "SELECT count(*)::int AS n FROM pg_type WHERE typname LIKE 'enum_inspection_session%' OR typname LIKE 'enum_inspection_results_%' OR typname = 'enum_idempotency_keys_status'"))
      .toEqual([{ n: 0 }]);
    const [fn] = await rows(g.db, "SELECT prosrc FROM pg_proc WHERE proname = 'facility_insert_default'");
    expect(String(fn?.["prosrc"])).not.toContain("'result'");
    await g.m0126.up({ context: qi });
    await g.m0127.up({ context: qi });
    await g.m0128.up({ context: qi });
    await g.m0129.up({ context: qi });
    expect(await objects()).toEqual(before);
    expect((await g.schemaVerify.verifySchema(g.db)).problems).toEqual([]);
  });
});
