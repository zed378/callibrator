/**
 * P21-04 against a REAL PostgreSQL 18 — the submit, the correction's submit, the void, the
 * signatures, the public verification and "due" on the real schema (0126's issued-fields CHECK and
 * partial uniques, 0127's append-only, draft-only and signature triggers, 0128's calibration-request
 * key and trigger, the grants), run AS `callibrator_app` (liveBoot#enterAppRole). memoryDb has no
 * CHECK, no trigger, no advisory lock and no raw SQL; this suite is where the services meet them:
 *
 *  - a root submit writes every issued field in ONE UPDATE the CHECK and the append-only trigger
 *    admit; its stored hash equals the hash recomputed at read (`integrity.state: "match"`);
 *  - two technicians submitting two roots of ONE device at once get visit numbers n and n+1 and
 *    report numbers -00k and -00k+1 (the device lock, then the advisory lock — no 23505, no deadlock);
 *  - a correction's submit carries the original's visit number (the trigger checks it) and sets the
 *    original's `superseded_by_id` (a lifecycle column the trigger admits once);
 *  - the side effects land: a Repair work order, the device to `maintenance`, the calibration
 *    request naming the session (0128's same-device trigger agrees);
 *  - the signatures bind the stored hash (the signature trigger compares them); the countersignature
 *    by the self facility's own IPSRS is accepted, by the submitter refused;
 *  - the void cancels the visit's Preventative order and clears the chain's calibration request;
 *  - the public verification resolves by token with NO context at all; a wrong token is the 404;
 *  - "due" (the raw read: LATERAL effective session, the month arithmetic in the tenant's zone, the
 *    facility clause BOUND for a facility-bound caller).
 *
 *   docker run -d --name p2104-pg18 -e POSTGRES_PASSWORD=p2104pass \
 *     -p 127.0.0.1:55214:5432 pgvector/pgvector:pg18
 *   P2104_PG_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=55214 DB_NAME=p2104_scratch \
 *     DB_USER=postgres DB_PASS=p2104pass npm test -- src/tests/services/ipmSubmit.p2104.live --coverage=false
 *   docker rm -f p2104-pg18
 * (or `npm run test:live -- --only=p2104`)
 *
 * Synthetic values only.
 */
import { env } from "../../config/env";
import { BASE_VERSION, rows, seedSql, type LiveDb, type Row } from "../fixtures/ipmLive";
import type * as SessionService from "../../services/ipmSession.service";
import type * as SubmitService from "../../services/ipmSubmit.service";
import type * as SignatureService from "../../services/ipmSignature.service";
import type * as ReportService from "../../services/ipmReport.service";
import type * as DueService from "../../services/ipmDue.service";
import type CertificateServiceModule from "../../services/certificate.service";
import type * as TenantContext from "../../middlewares/tenantContext.middleware";
import type * as LiveBoot from "../fixtures/liveBoot";
import type { IpmResultsReplace, IpmSessionHeaderUpdate } from "@callibrator/contracts/inspectionSessions";
import type { ClientFacilityId, TenantId } from "../../types/ids";

const live = env("P2104_PG_LIVE_TEST") === "1" ? describe : describe.skip;

const T = "c2104000-0000-4000-8000-000000000001";
const ROLE = "c2104000-0000-4000-8000-000000000002";
const U1 = "c2104000-0000-4000-8000-0000000000a1";
const U2 = "c2104000-0000-4000-8000-0000000000a2";
const U3 = "c2104000-0000-4000-8000-0000000000a3";
const ADMIN = "c2104000-0000-4000-8000-0000000000a4";
const F1 = "c2104000-0000-4000-8000-0000000000f1";
const F2 = "c2104000-0000-4000-8000-0000000000f2";
const FS = "c2104000-0000-4000-8000-0000000000f5";
const D1 = "c2104000-0000-4000-8000-0000000000d1";
const D2 = "c2104000-0000-4000-8000-0000000000d2";
const D3 = "c2104000-0000-4000-8000-0000000000d3";
const D4 = "c2104000-0000-4000-8000-0000000000d4";
const DS = "c2104000-0000-4000-8000-0000000000d5";
const DAY_MS = 24 * 3600 * 1000;

interface Graph {
  db: LiveDb;
  migrator: { up(options?: object): Promise<{ name: string }[]> };
  sessions: typeof SessionService;
  submit: typeof SubmitService;
  signatures: typeof SignatureService;
  report: typeof ReportService;
  due: typeof DueService;
  certificates: typeof CertificateServiceModule;
  tenantStorage: typeof TenantContext.tenantStorage;
  boot: typeof LiveBoot;
}

/* eslint-disable @typescript-eslint/no-require-imports -- one module graph, loaded in isolation; typed by the members used */
const startProcess = (): Graph => {
  let graph: Graph | undefined;
  jest.isolateModules(() => {
    const db = (require("../../config") as { db: LiveDb }).db;
    db.options.logging = false;
    require("../../models");
    graph = {
      db,
      migrator: (require("../../config/migrator") as { migrator: Graph["migrator"] }).migrator,
      sessions: require("../../services/ipmSession.service") as typeof SessionService,
      submit: require("../../services/ipmSubmit.service") as typeof SubmitService,
      signatures: require("../../services/ipmSignature.service") as typeof SignatureService,
      report: require("../../services/ipmReport.service") as typeof ReportService,
      due: require("../../services/ipmDue.service") as typeof DueService,
      certificates: require("../../services/certificate.service") as typeof CertificateServiceModule,
      tenantStorage: (require("../../middlewares/tenantContext.middleware") as typeof TenantContext).tenantStorage,
      boot: require("../fixtures/liveBoot") as typeof LiveBoot,
    };
  });
  if (!graph) {
    throw new Error("the module graph did not load");
  }
  return graph;
};
/* eslint-enable @typescript-eslint/no-require-imports */

/** A valid answer for a base checklist item, by its kind (the live suite answers whatever 0112 seeded). */
const answer = (item: Row): Record<string, unknown> => {
  const allowed = (item["allowed_outcomes"] as string[] | null) ?? [];
  const base = { inputKind: item["input_kind"], templateItemId: item["id"] };
  switch (item["input_kind"]) {
    case "check":
      return { ...base, outcome: "done" };
    case "tri_state":
      return { ...base, outcome: allowed.includes("pass") || allowed.length === 0 ? "pass" : allowed[0] };
    case "condition_clean":
      return { ...base, outcome: "good", cleanliness: "clean" };
    case "measured":
      return { ...base, value: item["valid_min"] ?? "1" };
    case "measured_with_limit":
      return { ...base, notApplicable: true };
    case "setting_measured_reference":
      return { ...base, value1: item["setting_value"] ?? "1", outcome: "pass" };
    default:
      return { ...base, text: "ok" };
  }
};

live("P21-04 — submit, correction, void, signatures, verification and due on PostgreSQL 18, as callibrator_app", () => {
  let g: Graph;
  let results: Record<string, unknown>[] = [];
  let root = "";
  let selfFacility = "";

  const ctx = <R>(userId: string, work: () => Promise<R>, facility: string | null = null): Promise<R> =>
    g.tenantStorage.run(
      { tenantId: T as TenantId, isSuperAdmin: false, isSystemTask: false, userId, clientFacilityId: facility as ClientFacilityId | null, facilityBound: facility !== null },
      work,
    );
  const actor = (userId: string, tenantAdmin = false): SessionService.IpmActor => ({ userId, apiKeyId: null, ipAddress: "127.0.0.1", userAgent: "live", tenantAdmin });
  const one = async (sql: string, replacements: object = {}): Promise<Row> => (await rows(g.db, sql, replacements))[0] as Row;
  const codeOf = async (work: () => Promise<unknown>): Promise<string> => {
    try {
      await work();
      return "none";
    } catch (err) {
      const e = err as { status?: number; publicCode?: string };
      return `${String(e.status)} ${e.publicCode ?? ""}`.trim();
    }
  };
  /** The answers built from the seeded base checklist, as the results contract types them. */
  const resultsInput = (): IpmResultsReplace["results"] => results as unknown as IpmResultsReplace["results"];
  const headerOf = (sessionId: string, header: Record<string, unknown>): IpmSessionHeaderUpdate => {
    const values: IpmSessionHeaderUpdate = { sessionId, revision: 0, inspectionOutcome: "pass", maintenanceOutcome: "pass", recommendation: "fit_for_use" };
    return Object.assign(values, header);
  };
  /** A complete draft of `user` on `device`, at revision 2. */
  const draft = async (user: string, device: string, header: Record<string, unknown> = {}, performedAt?: Date): Promise<string> => {
    const created = await ctx(user, () => g.sessions.createSession(T as TenantId, { deviceId: device, ...(performedAt ? { performedAt } : {}) }, actor(user)));
    const id = String(created.session["id"]);
    await ctx(user, () =>
      g.sessions.updateHeader(
        T as TenantId,
        headerOf(id, header),
        actor(user),
      ),
    );
    await ctx(user, () => g.sessions.replaceResults(T as TenantId, { sessionId: id, revision: 1, results: resultsInput() }, actor(user)));
    return id;
  };
  const submitAs = (user: string, id: string): Promise<SessionService.IpmWriteResult> =>
    ctx(user, () => g.submit.submitSession(T as TenantId, { sessionId: id, revision: 2 }, actor(user)));

  beforeAll(async () => {
    g = startProcess();
    await g.db.sync();
    await g.migrator.up();
    for (const sql of seedSql({
      tenant: T,
      role: ROLE,
      users: [U1, U2, U3, ADMIN],
      facilities: [
        [F1, "F-2104-1"],
        [F2, "F-2104-2"],
      ],
      devices: [
        [D1, F1, "SN-2104-1"],
        [D2, F2, "SN-2104-2"],
        [D3, F1, "SN-2104-3"],
        [D4, F1, "SN-2104-4"],
      ],
      tag: "p2104",
    })) {
      await g.db.query(sql);
    }
    // The tenant's self facility (is_self is immutable and one per tenant — 0117): this suite's self-served hospital.
    await g.db.query(
      `INSERT INTO client_facilities (id, tenant_id, name, code, kind, is_self, created_at, updated_at)
       SELECT :fs, :t, 'Fasilitas sendiri', 'SELF', 'hospital', true, now(), now()
        WHERE NOT EXISTS (SELECT 1 FROM client_facilities WHERE tenant_id = :t AND is_self)`,
      { replacements: { fs: FS, t: T } },
    );
    selfFacility = String((await one("SELECT id FROM client_facilities WHERE tenant_id = :t AND is_self", { t: T }))["id"]);
    await g.db.query(
      `INSERT INTO calibration_devices (id, tenant_id, client_facility_id, name, serial_number, created_at, updated_at)
       VALUES (:d, :t, :f, 'Alat sintetis SN-2104-5', 'SN-2104-5', now(), now())`,
      { replacements: { d: DS, t: T, f: selfFacility } },
    );
    await g.db.query("UPDATE calibration_devices SET status = 'active' WHERE tenant_id = :t", { replacements: { t: T } });
    // U3 is the self-served hospital's IPSRS: the signature service reads the role from the user row.
    await g.db.query(
      `INSERT INTO roles (id, name, created_at, updated_at) SELECT gen_random_uuid(), 'FACILITY MAINTENANCE', now(), now()
        WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'FACILITY MAINTENANCE')`,
    );
    await g.db.query("UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'FACILITY MAINTENANCE' LIMIT 1) WHERE id = :u", { replacements: { u: U3 } });
    await g.db.query("UPDATE calibration_devices SET ipm_interval_months = 0 WHERE id = :d", { replacements: { d: D4 } });
    await g.db.query(
      `INSERT INTO tenant_settings (id, tenant_id, key, value, created_at, updated_at)
       VALUES (gen_random_uuid(), :t, 'ipm_interval_months', '1', now(), now()), (gen_random_uuid(), :t, 'ipm_countersign_enabled', 'true', now(), now())`,
      { replacements: { t: T } },
    );
    results = (
      await rows(
        g.db,
        "SELECT id, input_kind::text AS input_kind, allowed_outcomes, valid_min, setting_value FROM inspection_template_items WHERE version_id = :v",
        { v: BASE_VERSION },
      )
    ).map(answer);
    await g.boot.enterAppRole(g.db as unknown as Parameters<typeof LiveBoot.enterAppRole>[0]);
  }, 300_000);

  afterAll(async () => {
    await g.db.close();
  });

  it("runs as the application role", async () => {
    expect(await one("SELECT current_user AS u")).toEqual({ u: "callibrator_app" });
  });

  it("a root submit writes every issued field in one UPDATE; the stored hash is the one recomputed at read", async () => {
    root = await draft(U1, D1);
    const res = await submitAs(U1, root);
    expect(res.session).toMatchObject({ status: "submitted", visitNumber: 1, reportNumber: expect.stringMatching(/^IPM-F-2104-1-\d{8}-001$/) as unknown });
    const stored = await one(
      `SELECT report_hash_scheme, length(verification_token) AS token_length, issuer_snapshot->>'timeZone' AS zone, work_order_id IS NOT NULL AS ordered
         FROM inspection_sessions WHERE id = :id`,
      { id: root },
    );
    expect(stored).toEqual({ report_hash_scheme: "ipm-report-v1", token_length: 32, zone: "Asia/Jakarta", ordered: true });
    const doc = await ctx(U1, () => g.report.getReportDocument(T, { sessionId: root }, { userId: U1 }));
    expect((doc["integrity"] as Record<string, unknown>)["state"]).toBe("match");
    expect(await one("SELECT type::text AS type, status::text AS status, client_facility_id FROM maintenance_work_orders WHERE id = (SELECT work_order_id FROM inspection_sessions WHERE id = :id)", { id: root })).toEqual({
      type: "Preventative",
      status: "Completed",
      client_facility_id: F1,
    });
  });

  it("two roots of one device submitted at once: visits n and n+1, numbers in sequence — no 23505, no deadlock", async () => {
    const a = await draft(U1, D1);
    const b = await draft(U2, D1);
    const both = await Promise.all([submitAs(U1, a), submitAs(U2, b)]);
    expect(both.map((r) => r.session["visitNumber"]).sort()).toEqual([2, 3]);
    expect(both.map((r) => String(r.session["reportNumber"]).slice(-3)).sort()).toEqual(["002", "003"]);
  });

  it("a correction's submit keeps the visit, supersedes the original (the trigger admits both), re-uses the order", async () => {
    const correction = await ctx(U2, () => g.sessions.createCorrection(T as TenantId, { sessionId: root, reason: "Koreksi sintetis" }, actor(U2)));
    const id = String(correction.session["id"]);
    await ctx(U2, () => g.sessions.replaceResults(T as TenantId, { sessionId: id, revision: 0, results: resultsInput() }, actor(U2)));
    const res = await ctx(U2, () => g.submit.submitSession(T as TenantId, { sessionId: id, revision: 1 }, actor(U2)));
    expect(res.session).toMatchObject({ visitNumber: 1, supersedesId: root });
    expect(await one("SELECT superseded_by_id, status::text AS status FROM inspection_sessions WHERE id = :id", { id: root })).toEqual({ superseded_by_id: id, status: "submitted" });
    expect(await one("SELECT (SELECT work_order_id FROM inspection_sessions WHERE id = :a) = (SELECT work_order_id FROM inspection_sessions WHERE id = :b) AS same", { a: root, b: id })).toEqual({ same: true });
    root = id;
  });

  it("the side effects land on the real tables (Repair order, device status, calibration request)", async () => {
    const repair = await draft(U1, D2, { recommendation: "needs_repair" });
    const repaired = await submitAs(U1, repair);
    expect(await one("SELECT type::text AS type, status::text AS status, priority::text AS priority FROM maintenance_work_orders WHERE id = :id", { id: repaired.session["followUpWorkOrderId"] })).toEqual({
      type: "Repair",
      status: "Open",
      priority: "High",
    });
    const unfit = await draft(U1, D2, { recommendation: "not_fit_for_use" }, new Date(Date.now() - 120 * DAY_MS));
    await submitAs(U1, unfit);
    expect(await one("SELECT status::text AS status FROM calibration_devices WHERE id = :d", { d: D2 })).toEqual({ status: "maintenance" });
    const calibration = await draft(U2, D1, { recommendation: "needs_calibration" });
    await submitAs(U2, calibration);
    expect(await one("SELECT calibration_requested_by_session_id AS s FROM calibration_devices WHERE id = :d", { d: D1 })).toEqual({ s: calibration });
  });

  it("the signatures bind the stored hash; the self facility's own IPSRS countersigns; the submitter cannot", async () => {
    // The credential check is certificate.service's (its own suites); here: what the signature writes.
    jest.spyOn(g.certificates, "verifySignerCredentials").mockResolvedValue(undefined);
    const id = await draft(U1, DS);
    await submitAs(U1, id);
    const signer = (userId: string): SignatureService.IpmSigner => ({ userId, ipAddress: "127.0.0.1", userAgent: "live" });
    const body = (kind: "performer" | "countersign") => ({ sessionId: id, kind, authMethod: "password" as const, authPayload: "x", meaningAcknowledged: true as const });
    await ctx(U1, () => g.signatures.signReport(T as TenantId, body("performer"), signer(U1)));
    expect(await codeOf(() => ctx(U1, () => g.signatures.signReport(T as TenantId, body("countersign"), signer(U1))))).toBe("403 IPM_COUNTERSIGN_SOD");
    await ctx(U3, () => g.signatures.signReport(T as TenantId, body("countersign"), signer(U3)));
    expect(
      await rows(g.db, "SELECT kind::text AS kind, document_hash = (SELECT report_content_hash FROM inspection_sessions WHERE id = :id) AS bound FROM inspection_session_signatures WHERE session_id = :id ORDER BY signed_at", { id }),
    ).toEqual([
      { kind: "performer", bound: true },
      { kind: "countersign", bound: true },
    ]);
  });

  it("the void cancels the visit's order and clears the chain's calibration request; the trigger admits submitted → voided", async () => {
    const calibrationHead = String((await one("SELECT calibration_requested_by_session_id AS s FROM calibration_devices WHERE id = :d", { d: D1 }))["s"]);
    const res = await ctx(ADMIN, () => g.submit.voidSession(T as TenantId, { sessionId: calibrationHead, reason: "Kunjungan ganda sintetis" }, actor(ADMIN, true)));
    expect(res.session["status"]).toBe("voided");
    expect(await one("SELECT status::text AS status FROM maintenance_work_orders WHERE id = (SELECT work_order_id FROM inspection_sessions WHERE id = :id)", { id: calibrationHead })).toEqual({ status: "Cancelled" });
    expect(await one("SELECT calibration_requested_by_session_id AS s FROM calibration_devices WHERE id = :d", { d: D1 })).toEqual({ s: null });
  });

  it("the public verification resolves by token with no context at all; a wrong token is the 404", async () => {
    const stored = await one("SELECT report_number, verification_token FROM inspection_sessions WHERE id = :id", { id: root });
    const verdict = await g.report.verifyReport(String(stored["report_number"]), String(stored["verification_token"]));
    expect(verdict).toMatchObject({ found: true, status: "issued", integrity: { state: "match" } });
    expect(await codeOf(() => g.report.verifyReport(String(stored["report_number"]), "A".repeat(32)))).toBe("404");
  });

  it("due: the effective session per device in the tenant's zone; never inspected counts; interval 0 is not listed; a bound caller sees its facility only", async () => {
    const all = await ctx(U1, () => g.due.listDue(T, { page: 1, limit: 50, state: "all_scheduled" }));
    const byId = new Map(all.rows.map((r) => [r["id"], (r["ipmDue"] as { state: string }).state]));
    expect(byId.get(D4)).toBeUndefined();
    expect([byId.get(D1), byId.get(D2), byId.get(D3)]).toEqual(["ok", "ok", "never_inspected"]);
    const due = await ctx(U1, () => g.due.listDue(T, { page: 1, limit: 50, state: "due" }));
    expect(due.rows.map((r) => r["id"]).sort()).toEqual([D3].sort());
    const bound = await ctx(U1, () => g.due.listDue(T, { page: 1, limit: 50, state: "all_scheduled" }), F1);
    expect([...new Set(bound.rows.map((r) => r["clientFacilityId"]))]).toEqual([F1]);
    expect(bound.meta.total).toBe(bound.rows.length);
  });
});
