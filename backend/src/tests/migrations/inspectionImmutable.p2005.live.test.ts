/**
 * P20-05 against a REAL PostgreSQL 18 — migration 0127's triggers, AS `callibrator_app` AND AS THE
 * OWNER (ADR-126 § 5, Am. 1 § 3, Am. 2 § 5; spec MEMORY/specs/P19-02-ipm-session-aggregate.md
 * § 5.1 – § 5.3, § 17; MEMORY/specs/P19-06-ipm-report-document.md § 4.2).
 *
 * On an EMPTY scratch database: db.sync() and every migration. Then, each probe in a rolled-back
 * transaction unless the case commits:
 *  - FAIL-BEFORE (0127 down, 0126's grants still in place): the application role rewrites a
 *    submitted session's notes, recommendation and report number, writes and deletes its results,
 *    signs it with a hash it never issued, and corrects it on ANOTHER device; the owner deletes it —
 *    nothing refuses. 0127 up: every one of those is refused (each case below);
 *  - inspection_sessions_append_only, for both roles: a submitted session's content and report
 *    fields refused, its identity refused; a draft edits freely but is never voided; void once,
 *    final; voided never back to submitted; a supersession set once; discarded final; a correction
 *    carries its original's visit number; DELETE and TRUNCATE refused;
 *  - inspection_results_draft_only, for both roles: insert, update and delete refused on a submitted
 *    session; a draft's results replaced wholesale; a result never changes session; a row with no
 *    template item and no ad-hoc flag only on imported history; TRUNCATE refused;
 *  - inspection_sessions_correction_same_device: a correction naming another device's session (23514);
 *  - inspection_session_signatures_append_only: only a submitted, effective, captured session's
 *    stored hash is signed; a countersignature after the performer's, never by the submitter or
 *    the performer; never updated or deleted, TRUNCATE refused;
 *  - the facility column of every IPM row: refused without a move, for the owner too;
 *  - THE MOVE, as callibrator_app, COMMITTED: the device's submitted, voided, discarded and draft
 *    sessions, their results and the signatures follow it along one cascade path each and pass
 *    every trigger; nothing else of them changed;
 *  - schemaVerify sees every trigger.
 *
 *   docker run -d --name p2005-pg18 -e POSTGRES_PASSWORD=p2005pass -p 127.0.0.1:55205:5432 pgvector/pgvector:pg18
 *   DB_HOST=127.0.0.1 DB_PORT=55205 DB_NAME=p2005_scratch DB_USER=postgres DB_PASS=p2005pass \
 *     npm run test:live:jest -- src/tests/migrations/inspectionImmutable.p2005.live
 *   docker rm -f p2005-pg18
 */
import { Sequelize } from "sequelize";
import { env } from "../../config/env";
import {
  APP_ROLE,
  HASH,
  OTHER_HASH,
  draftSql,
  errorOf,
  inRolledBack,
  resultSql,
  rows,
  runAs,
  seedSql,
  signatureSql,
  submitSql,
  type LiveDb,
  type LiveTx,
} from "../fixtures/ipmLive";

const T = "e2005000-0000-4000-8000-000000000001";
const ROLE = "e2005000-0000-4000-8000-000000000002";
const U1 = "e2005000-0000-4000-8000-0000000000a1";
const U2 = "e2005000-0000-4000-8000-0000000000a2";
const U3 = "e2005000-0000-4000-8000-0000000000a3";
const F1 = "e2005000-0000-4000-8000-0000000000f1";
const F2 = "e2005000-0000-4000-8000-0000000000f2";
const D1 = "e2005000-0000-4000-8000-0000000000d1";
const D2 = "e2005000-0000-4000-8000-0000000000d2";
const S1 = "e2005000-0000-4000-8000-000000000101";
const S2 = "e2005000-0000-4000-8000-000000000102";
const S3 = "e2005000-0000-4000-8000-000000000103";
const S4 = "e2005000-0000-4000-8000-000000000104";
const R1 = "e2005000-0000-4000-8000-000000000201";
const R2 = "e2005000-0000-4000-8000-000000000202";
const G1 = "e2005000-0000-4000-8000-000000000301";
const G2 = "e2005000-0000-4000-8000-000000000302";
const MOVE = "e2005000-0000-4000-8000-0000000000e1";
const OWNER = null;
const ROLES = [
  ["callibrator_app", APP_ROLE],
  ["the owner", OWNER],
] as const;

interface Migration {
  up(o: { context: unknown }): Promise<void>;
  down(o: { context: unknown }): Promise<void>;
}
interface Graph {
  db: LiveDb;
  migrator: { up(options?: object): Promise<{ name: string }[]> };
  schemaVerify: {
    verifySchema(db: unknown): Promise<{ problems: string[] }>;
    EXPECTED_OBJECTS: readonly { kind: string; table: string; name: string }[];
  };
  m0127: Migration & { TRIGGERS: readonly (readonly [string, string, string])[] };
}

/* eslint-disable @typescript-eslint/no-require-imports -- the real boot step (models, sync, migrator) on the scratch database */
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
      m0127: require("../../migrations/0127-ipm-immutability") as Graph["m0127"],
    };
  });
  if (!graph) {
    throw new Error("the module graph did not load");
  }
  return graph;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const ok = async (db: LiveDb, t: LiveTx, sql: string, replacements: object = {}, role: string | null = APP_ROLE): Promise<void> => {
  expect(await runAs(db, t, sql, replacements, role)).toBeNull();
};

const base = { tenant: T, user: U1, device: D1 };
/** A result id unique per session and position: "<prefix><session suffix>9<n>". */
const resultId = (session: string, n: number): string => `${session.slice(0, 24)}${session.slice(-3)}9${String(n).padStart(8, "0")}`;

/** A submitted root of `device` by U1 with two results — as the application role. */
const submitted = async (db: LiveDb, t: LiveTx, id: string, visit: number, device = D1): Promise<void> => {
  await ok(db, t, draftSql(), { ...base, device, id });
  await ok(db, t, resultSql, { resultId: resultId(id, 1), tenant: T, session: id, sort: 1 });
  await ok(db, t, resultSql, { resultId: resultId(id, 2), tenant: T, session: id, sort: 2 });
  await ok(db, t, submitSql, { id, visit, reportNumber: `IPM-F-0001-20261009-${id.slice(-3)}`, token: `tok-${id}` });
};

const sign = (session: string, kind: "performer" | "countersign", signer: string, id: string, hash = HASH) => ({
  signatureId: id,
  tenant: T,
  session,
  kind,
  signer,
  hash,
});

jest.setTimeout(900000);

describe("P20-05 — migration 0127's triggers on live PostgreSQL 18, as callibrator_app and as the owner", () => {
  let g: Graph;
  let admin: Sequelize;

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
    await g.migrator.up();
    for (const statement of seedSql({
      tenant: T,
      role: ROLE,
      users: [U1, U2, U3],
      facilities: [[F1, "F-0001"], [F2, "F-0002"]],
      devices: [[D1, F1, "SN-1"], [D2, F1, "SN-2"]],
      tag: "p2005",
    })) {
      await g.db.query(statement);
    }
  });

  afterAll(async () => {
    await g.db.close();
    await admin.close();
  });

  it("FAIL-BEFORE (0127 down): the application role rewrites, re-signs and re-attributes a submitted IPM, and the owner deletes it", async () => {
    const qi = g.db.getQueryInterface();
    await g.m0127.down({ context: qi });
    try {
      await inRolledBack(g.db, async (t) => {
        await submitted(g.db, t, S1, 1);
        expect(await errorOf(g.db, t, "UPDATE inspection_sessions SET notes = 'ditulis ulang', recommendation = 'needs_repair', report_number = 'X-1' WHERE id = :id", { id: S1 })).toBeNull();
        expect(await errorOf(g.db, t, "UPDATE inspection_sessions SET status = 'draft' WHERE id = :id", { id: S1 })).toBeNull();
        expect(await errorOf(g.db, t, "UPDATE inspection_sessions SET status = 'submitted' WHERE id = :id", { id: S1 })).toBeNull();
        expect(await errorOf(g.db, t, resultSql, { resultId: R1, tenant: T, session: S1, sort: 9 })).toBeNull();
        expect(await errorOf(g.db, t, "DELETE FROM inspection_results WHERE session_id = :id", { id: S1 })).toBeNull();
        expect(await errorOf(g.db, t, signatureSql, sign(S1, "performer", U1, G1, OTHER_HASH))).toBeNull();
        expect(await errorOf(g.db, t, draftSql({ supersedes: true }), { ...base, device: D2, id: S2, supersedes: S1 })).toBeNull();
        expect(await errorOf(g.db, t, "DELETE FROM inspection_sessions WHERE id = :id", { id: S2 }, OWNER)).toBeNull();
      });
    } finally {
      await g.m0127.up({ context: qi });
    }
    expect(
      (await rows(g.db, "SELECT tgname, tgenabled::text AS e FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (:names)", {
        names: g.m0127.TRIGGERS.map(([, name]) => name),
      })).filter((r) => r["e"] === "A"),
    ).toHaveLength(7);
  });

  it.each(ROLES)("sessions, as %s: a submitted session's content, report fields and identity never change", async (_who, role) => {
    await inRolledBack(g.db, async (t) => {
      await submitted(g.db, t, S1, 1);
      for (const set of [
        "notes = 'ditulis ulang'",
        "recommendation = 'needs_repair'",
        "performed_at = now() - interval '1 day'",
        "revision = 5",
        "report_number = 'IPM-X'",
        "verification_token = 'another-token'",
        `report_content_hash = '${OTHER_HASH}'`,
        "issuer_snapshot = '{\"version\": 1, \"name\": \"lain\"}'",
        "performer_snapshot = '{\"name\": \"lain\"}'",
      ]) {
        expect([set, await errorOf(g.db, t, `UPDATE inspection_sessions SET ${set} WHERE id = :id`, { id: S1 }, role)]).toEqual([
          set,
          expect.stringMatching(/^42501 inspection_sessions is append-only: the content of submitted IPM session .* cannot be changed/),
        ]);
      }
      expect(await errorOf(g.db, t, "UPDATE inspection_sessions SET created_by = :u WHERE id = :id", { id: S1, u: U2 }, role)).toMatch(
        /^42501 inspection_sessions: created_by of IPM session .* never changes/,
      );
      expect(await errorOf(g.db, t, "UPDATE inspection_sessions SET device_id = :d WHERE id = :id", { id: S1, d: D2 }, role)).toMatch(
        /^42501 inspection_sessions: device_id of IPM session .* never changes/,
      );
      expect(await errorOf(g.db, t, "DELETE FROM inspection_sessions WHERE id = :id", { id: S1 }, role)).toMatch(
        role === APP_ROLE ? /^42501 permission denied for table inspection_sessions/ : /^42501 inspection_sessions is append-only: IPM session .* cannot be deleted/,
      );
      expect(await errorOf(g.db, t, "TRUNCATE inspection_sessions CASCADE", {}, role)).toMatch(
        role === APP_ROLE ? /^42501 permission denied for table/ : /^42501 .*TRUNCATE is refused/,
      );
    });
  });

  it.each(ROLES)("sessions, as %s: a draft edits freely but is never voided; void once, final; never back to submitted; discarded final", async (_who, role) => {
    await inRolledBack(g.db, async (t) => {
      await ok(g.db, t, draftSql(), { ...base, id: S3 }, role);
      await ok(g.db, t, "UPDATE inspection_sessions SET notes = 'catatan', revision = revision + 1 WHERE id = :id", { id: S3 }, role);
      expect(
        await errorOf(g.db, t, "UPDATE inspection_sessions SET status = 'voided', void_reason = 'salah', voided_by = :u, voided_at = now() WHERE id = :id", { id: S3, u: U1 }, role),
      ).toMatch(/^42501 inspection_sessions: draft .* may be submitted or discarded, never voided/);
      await ok(g.db, t, "UPDATE inspection_sessions SET status = 'discarded', discarded_by = :u, discarded_at = now() WHERE id = :id", { id: S3, u: U1 }, role);
      expect(await errorOf(g.db, t, "UPDATE inspection_sessions SET notes = 'lagi' WHERE id = :id", { id: S3 }, role)).toMatch(/^42501 .* is discarded — final/);

      await submitted(g.db, t, S1, 1);
      await ok(g.db, t, "UPDATE inspection_sessions SET status = 'voided', void_reason = 'Duplikat', voided_by = :u, voided_at = now(), updated_at = now() WHERE id = :id", { id: S1, u: U2 }, role);
      expect(await errorOf(g.db, t, "UPDATE inspection_sessions SET status = 'submitted', void_reason = NULL, voided_by = NULL, voided_at = NULL WHERE id = :id", { id: S1 }, role))
        .toMatch(/^42501 .* is voided — final/);
      expect(await errorOf(g.db, t, "UPDATE inspection_sessions SET void_reason = 'Alasan lain' WHERE id = :id", { id: S1 }, role)).toMatch(/^42501 .* is voided — final/);
    });
  });

  it.each(ROLES)("sessions, as %s: a supersession is set once; a correction carries its original's visit number", async (_who, role) => {
    await inRolledBack(g.db, async (t) => {
      await submitted(g.db, t, S1, 3);
      await ok(g.db, t, draftSql({ supersedes: true }), { ...base, id: S2, supersedes: S1 }, role);
      expect(await errorOf(g.db, t, submitSql, { id: S2, visit: 4, reportNumber: "IPM-C-2", token: "tok-c2" }, role)).toMatch(
        /^42501 inspection_sessions: correction .* must carry the visit number of the session it corrects \(3\), not 4/,
      );
      await ok(g.db, t, submitSql, { id: S2, visit: 3, reportNumber: "IPM-C-2", token: "tok-c2" }, role);
      await ok(g.db, t, "UPDATE inspection_sessions SET superseded_by_id = :c, superseded_at = now() WHERE id = :id", { id: S1, c: S2 }, role);
      expect(await errorOf(g.db, t, "UPDATE inspection_sessions SET superseded_by_id = :c WHERE id = :id", { id: S1, c: S3 }, role)).toMatch(
        /^42501 inspection_sessions: a supersession or void of IPM session .* is set once and final/,
      );
    });
  });

  it("a correction naming another device's session is refused (23514), for the owner too", async () => {
    await inRolledBack(g.db, async (t) => {
      await submitted(g.db, t, S1, 1);
      for (const role of [APP_ROLE, OWNER]) {
        expect(await errorOf(g.db, t, draftSql({ supersedes: true }), { ...base, device: D2, id: S2, supersedes: S1 }, role)).toMatch(
          /^23514 inspection_sessions: correction .* must correct a session of its own tenant and device/,
        );
      }
    });
  });

  it.each(ROLES)("results, as %s: refused on a submitted session; a draft's results replaced wholesale; never another session", async (_who, role) => {
    await inRolledBack(g.db, async (t) => {
      await submitted(g.db, t, S1, 1);
      expect(await errorOf(g.db, t, resultSql, { resultId: R1, tenant: T, session: S1, sort: 9 }, role)).toMatch(
        /^42501 inspection_results: the results of IPM session .* are written only while it is a draft \(it is submitted\)/,
      );
      expect(await errorOf(g.db, t, "UPDATE inspection_results SET outcome = 'not_done' WHERE session_id = :id", { id: S1 }, role)).toMatch(/^42501 .*only while it is a draft/);
      expect(await errorOf(g.db, t, "DELETE FROM inspection_results WHERE session_id = :id", { id: S1 }, role)).toMatch(/^42501 .*only while it is a draft/);
      expect(await errorOf(g.db, t, "TRUNCATE inspection_results", {}, role)).toMatch(role === APP_ROLE ? /^42501 permission denied/ : /^42501 inspection_results: TRUNCATE is refused/);

      await ok(g.db, t, draftSql(), { ...base, user: U2, id: S3 }, role);
      await ok(g.db, t, resultSql, { resultId: R1, tenant: T, session: S3, sort: 1 }, role);
      await ok(g.db, t, "DELETE FROM inspection_results WHERE session_id = :id", { id: S3 }, role);
      await ok(g.db, t, resultSql, { resultId: R2, tenant: T, session: S3, sort: 1 }, role);
      expect(await errorOf(g.db, t, "UPDATE inspection_results SET session_id = :other WHERE id = :id", { id: R2, other: S1 }, role)).toMatch(
        /^42501 inspection_results: result .* never changes session/,
      );
    });
  });

  it("results: a row with neither a template item nor the ad-hoc flag only on imported history", async () => {
    const plain = `INSERT INTO inspection_results (id, tenant_id, session_id, section, input_kind, is_ad_hoc, label_snapshot, sort_order, created_at, updated_at)
      VALUES (:id, :t, :s, 'function', 'tri_state', false, 'Fungsi', 1, now(), now())`;
    await inRolledBack(g.db, async (t) => {
      await ok(g.db, t, draftSql(), { ...base, id: S3 });
      expect(await errorOf(g.db, t, plain, { id: R1, t: T, s: S3 })).toMatch(/^42501 inspection_results: a result without a template item is an ad-hoc row or imported history/);
      await ok(g.db, t, `INSERT INTO inspection_sessions (id, tenant_id, device_id, legacy_key, created_at, updated_at)
        VALUES (:id, :t, :d, 'QR-1|2024-01-02', now(), now())`, { id: S4, t: T, d: D2 }, OWNER);
      expect(await errorOf(g.db, t, plain, { id: R2, t: T, s: S4 }, OWNER)).toBeNull();
    });
  });

  it("signatures: only a submitted, effective, captured session's stored hash; countersign after the performer, never by submitter or performer; never changed", async () => {
    await inRolledBack(g.db, async (t) => {
      await ok(g.db, t, draftSql(), { ...base, user: U2, id: S3 });
      expect(await errorOf(g.db, t, signatureSql, sign(S3, "performer", U2, G1))).toMatch(/^42501 .*only a submitted, effective, captured IPM report is signed/);
      await submitted(g.db, t, S1, 1);
      expect(await errorOf(g.db, t, signatureSql, sign(S1, "performer", U1, G1, OTHER_HASH))).toMatch(/^42501 .*the signed hash is not the stored content hash/);
      expect(await errorOf(g.db, t, signatureSql, sign(S1, "countersign", U3, G2))).toMatch(/^42501 .*countersigned only after its performer signed/);
      await ok(g.db, t, signatureSql, sign(S1, "performer", U1, G1));
      expect(await errorOf(g.db, t, signatureSql, sign(S1, "countersign", U1, G2))).toMatch(/^42501 .*never its submitter or performer/);
      await ok(g.db, t, signatureSql, sign(S1, "countersign", U3, G2));
      for (const role of [APP_ROLE, OWNER]) {
        expect(await errorOf(g.db, t, "UPDATE inspection_session_signatures SET signed_at = now() WHERE id = :id", { id: G1 }, role)).toMatch(
          role === APP_ROLE ? /^42501 permission denied/ : /^42501 inspection_session_signatures is append-only: signature .* cannot be changed/,
        );
        expect(await errorOf(g.db, t, "DELETE FROM inspection_session_signatures WHERE id = :id", { id: G1 }, role)).toMatch(
          role === APP_ROLE ? /^42501 permission denied/ : /^42501 inspection_session_signatures is append-only: signature .* cannot be deleted/,
        );
      }
      expect(await errorOf(g.db, t, "TRUNCATE inspection_session_signatures", {}, OWNER)).toMatch(/^42501 .*TRUNCATE is refused/);
      // A superseded session is no longer signed.
      await ok(g.db, t, draftSql({ supersedes: true }), { ...base, id: S2, supersedes: S1 });
      await ok(g.db, t, submitSql, { id: S2, visit: 1, reportNumber: "IPM-C-2", token: "tok-c2" });
      await ok(g.db, t, "UPDATE inspection_sessions SET superseded_by_id = :c, superseded_at = now() WHERE id = :id", { id: S1, c: S2 });
      expect(await errorOf(g.db, t, signatureSql, sign(S1, "countersign", U2, "e2005000-0000-4000-8000-000000000303"))).toMatch(
        /^42501 .*only a submitted, effective, captured IPM report is signed/,
      );
    });
  });

  it("the facility column of a session, result and signature is refused without a device move — for the owner too", async () => {
    await inRolledBack(g.db, async (t) => {
      await submitted(g.db, t, S1, 1);
      await ok(g.db, t, signatureSql, sign(S1, "performer", U1, G1));
      await ok(g.db, t, draftSql(), { ...base, user: U2, id: S3 });
      await ok(g.db, t, resultSql, { resultId: R1, tenant: T, session: S3, sort: 1 });
      for (const role of [APP_ROLE, OWNER]) {
        expect(await errorOf(g.db, t, "UPDATE inspection_sessions SET client_facility_id = :f WHERE id = :id", { id: S1, f: F2 }, role)).toMatch(
          /^42501 .*changed only by an audited device move/,
        );
        expect(await errorOf(g.db, t, "UPDATE inspection_sessions SET client_facility_id = :f WHERE id = :id", { id: S3, f: F2 }, role)).toMatch(
          /^42501 .*changed only by an audited device move/,
        );
        expect(await errorOf(g.db, t, "UPDATE inspection_results SET client_facility_id = :f WHERE id = :id", { id: R1, f: F2 }, role)).toMatch(
          /^42501 .*changed only by an audited device move/,
        );
      }
      expect(await errorOf(g.db, t, "UPDATE inspection_session_signatures SET client_facility_id = :f WHERE id = :id", { id: G1, f: F2 }, OWNER)).toMatch(
        /^42501 inspection_session_signatures is append-only: signature .* cannot be changed/,
      );
    });
  });

  it("THE MOVE, as callibrator_app, committed: submitted, voided, discarded and draft sessions, their results and signatures follow the device — and nothing else of them changes", async () => {
    // The device's IPM history, committed as the application role.
    const seedHistory = async (seed: LiveTx): Promise<void> => {
      await submitted(g.db, seed, S1, 1);
      await ok(g.db, seed, signatureSql, sign(S1, "performer", U1, G1));
      await ok(g.db, seed, signatureSql, sign(S1, "countersign", U3, G2));
      await submitted(g.db, seed, S2, 2);
      await ok(g.db, seed, "UPDATE inspection_sessions SET status = 'voided', void_reason = 'Duplikat', voided_by = :u, voided_at = now() WHERE id = :id", { id: S2, u: U2 });
      await ok(g.db, seed, draftSql(), { ...base, user: U2, id: S3 });
      await ok(g.db, seed, resultSql, { resultId: R1, tenant: T, session: S3, sort: 1 });
      await ok(g.db, seed, "UPDATE inspection_sessions SET status = 'discarded', discarded_by = :u, discarded_at = now() WHERE id = :id", { id: S3, u: U2 });
      await ok(g.db, seed, draftSql(), { ...base, user: U3, id: S4 });
      await ok(g.db, seed, resultSql, { resultId: R2, tenant: T, session: S4, sort: 1 });
    };
    const seed = await g.db.transaction();
    try {
      await seedHistory(seed);
      await seed.commit();
    } catch (err) {
      await seed.rollback();
      throw err;
    }

    const content = `SELECT 's' AS k, id, to_jsonb(x) - 'client_facility_id' AS c FROM inspection_sessions x
      UNION ALL SELECT 'r', id, to_jsonb(x) - 'client_facility_id' FROM inspection_results x
      UNION ALL SELECT 'g', id, to_jsonb(x) - 'client_facility_id' FROM inspection_session_signatures x ORDER BY 1, 2`;
    const facilities = `SELECT DISTINCT f.code FROM (SELECT client_facility_id FROM inspection_sessions UNION ALL SELECT client_facility_id FROM inspection_results
      UNION ALL SELECT client_facility_id FROM inspection_session_signatures) x JOIN client_facilities f ON f.id = x.client_facility_id ORDER BY 1`;
    const before = await rows(g.db, content);
    expect(before).toHaveLength(4 + 6 + 2);
    expect(await rows(g.db, facilities)).toEqual([{ code: "F-0001" }]);

    const t = await g.db.transaction();
    try {
      await ok(g.db, t, `INSERT INTO client_facility_moves (id, tenant_id, device_id, from_client_facility_id, to_client_facility_id, reason, moved_by, created_at)
        VALUES (:m, :t, :d, :from, :to, 'Dipindah ke klien lain', :u, now())`, { m: MOVE, t: T, d: D1, from: F1, to: F2, u: U2 });
      await ok(g.db, t, "SELECT set_config('callibrator.facility_move', :m, true)", { m: MOVE });
      await ok(g.db, t, "UPDATE calibration_devices SET client_facility_id = :to WHERE id = :d", { to: F2, d: D1 });
      await ok(g.db, t, "UPDATE client_facility_moves SET status = 'completed', completed_at = now(), counts = '{\"inspection_sessions\": 4}' WHERE id = :m", { m: MOVE });
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
    expect(await rows(g.db, facilities)).toEqual([{ code: "F-0002" }]);
    expect(await rows(g.db, content)).toEqual(before);
    // After the move, the same change without the setting is refused — for the owner too.
    await inRolledBack(g.db, async (t2) => {
      expect(await errorOf(g.db, t2, "UPDATE inspection_sessions SET client_facility_id = :f WHERE id = :id", { id: S1, f: F1 }, OWNER)).toMatch(
        /^42501 .*changed only by an audited device move/,
      );
    });
  });

  it("schemaVerify sees every trigger of 0127 (and passes)", async () => {
    const result = await g.schemaVerify.verifySchema(g.db);
    expect(result.problems).toEqual([]);
    const listed = g.schemaVerify.EXPECTED_OBJECTS.filter((o) => o.kind === "trigger").map((o) => o.name);
    for (const [, name] of g.m0127.TRIGGERS) {
      expect(listed).toContain(name);
    }
  });
});
