/**
 * P21-03 against a REAL PostgreSQL 18 — the IPM session SERVICES and the idempotency store on the
 * real schema (0126's keys and partial uniques, 0127's append-only and draft-only triggers, the
 * grants), run AS `callibrator_app` (liveBoot#enterAppRole: every pooled connection `SET ROLE`,
 * after the boot's own self-check). memoryDb has no trigger, no unique index and no grant; this
 * suite is where the service meets them:
 *
 *  - a root draft is created in the device's facility (the facility default trigger agrees), a
 *    second one for the same device and technician is the service's IPM_DRAFT_EXISTS (the
 *    one-root-draft index would refuse it anyway);
 *  - results are REPLACED on a draft: the draft-only trigger admits the DELETE and the INSERT, as
 *    the application role (it holds DELETE on inspection_results, G-S3);
 *  - a `clientRef` used in a facility the caller can no longer read meets the REAL partial unique
 *    index, and the service maps PostgreSQL's 23505 to 409 IPM_CLIENT_REF_REUSED (the fields of the
 *    error name `client_ref`);
 *  - two first attempts under one Idempotency-Key at once: the real unique index lets exactly one
 *    proceed; a completion inside a write transaction is replayed; a release deletes (DELETE grant);
 *  - a correction of a submitted session copies its results into the new draft through the
 *    draft-only trigger; a second one is IPM_CORRECTION_OPEN;
 *  - the device move refuses a device with open drafts (the service's 409 — the database alone
 *    would move it, deviceMove.p2007.live);
 *  - the purge deletes expired keys of every tenant as the application role.
 *
 *   docker run -d --name p2103-pg18 -e POSTGRES_PASSWORD=p2103pass \
 *     -p 127.0.0.1:55213:5432 pgvector/pgvector:pg18
 *   P2103_PG_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=55213 DB_NAME=p2103_scratch \
 *     DB_USER=postgres DB_PASS=p2103pass npm test -- src/tests/services/ipmSessions.p2103.live --coverage=false
 *   docker rm -f p2103-pg18
 * (or `npm run test:live -- --only=p2103`)
 *
 * Synthetic values only.
 */
import { env } from "../../config/env";
import { BASE_VERSION, HASH, rows, seedSql, type LiveDb, type Row } from "../fixtures/ipmLive";
import type * as SessionService from "../../services/ipmSession.service";
import type * as IdempotencyService from "../../services/idempotency.service";
import type * as MoveService from "../../services/deviceMove.service";
import type * as TenantContext from "../../middlewares/tenantContext.middleware";
import type * as LiveBoot from "../fixtures/liveBoot";
import type { ClientFacilityId, TenantId } from "../../types/ids";

const live = env("P2103_PG_LIVE_TEST") === "1" ? describe : describe.skip;

const T = "c2103000-0000-4000-8000-000000000001";
const ROLE = "c2103000-0000-4000-8000-000000000002";
const U1 = "c2103000-0000-4000-8000-0000000000a1";
const U2 = "c2103000-0000-4000-8000-0000000000a2";
const F1 = "c2103000-0000-4000-8000-0000000000f1";
const F2 = "c2103000-0000-4000-8000-0000000000f2";
const D1 = "c2103000-0000-4000-8000-0000000000d1";
const D2 = "c2103000-0000-4000-8000-0000000000d2";
const REF = "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b";
const KEY = "3f3f3f3f-3f3f-4f3f-8f3f-3f3f3f3f3f3f";

interface Graph {
  db: LiveDb;
  migrator: { up(options?: object): Promise<{ name: string }[]> };
  sessions: typeof SessionService;
  keys: typeof IdempotencyService;
  move: typeof MoveService;
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
      keys: require("../../services/idempotency.service") as typeof IdempotencyService,
      move: require("../../services/deviceMove.service") as typeof MoveService,
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

live("P21-03 — the IPM session services on PostgreSQL 18, as callibrator_app", () => {
  let g: Graph;
  let draft = "";

  const as = <R>(userId: string, work: () => Promise<R>, facility: string | null = null): Promise<R> =>
    g.tenantStorage.run(
      { tenantId: T as TenantId, isSuperAdmin: false, isSystemTask: false, userId, clientFacilityId: facility as ClientFacilityId | null, facilityBound: facility !== null },
      work,
    );
  const actor = (userId: string): SessionService.IpmActor => ({ userId, apiKeyId: null, ipAddress: "127.0.0.1", userAgent: "live", tenantAdmin: false });
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

  beforeAll(async () => {
    g = startProcess();
    await g.db.sync();
    await g.migrator.up();
    for (const sql of seedSql({
      tenant: T,
      role: ROLE,
      users: [U1, U2],
      facilities: [
        [F1, "F-2103-1"],
        [F2, "F-2103-2"],
      ],
      devices: [
        [D1, F1, "SN-2103-1"],
        [D2, F2, "SN-2103-2"],
      ],
      tag: "p2103",
    })) {
      await g.db.query(sql);
    }
    await g.db.query("UPDATE calibration_devices SET status = 'active' WHERE tenant_id = :t", { replacements: { t: T } });
    await g.boot.enterAppRole(g.db as unknown as Parameters<typeof LiveBoot.enterAppRole>[0]);
  }, 300_000);

  afterAll(async () => {
    await g.db.close();
  });

  it("runs as the application role", async () => {
    expect(await one("SELECT current_user AS u")).toEqual({ u: "callibrator_app" });
  });

  it("a root draft lands in the device's facility, pinned to the base checklist; a second one is IPM_DRAFT_EXISTS", async () => {
    const created = await as(U1, () => g.sessions.createSession(T as TenantId, { deviceId: D1, clientRef: REF }, actor(U1)));
    draft = String(created.session["id"]);
    expect([created.status, created.session["clientFacilityId"], created.session["templateVersionId"]]).toEqual([201, F1, BASE_VERSION]);
    expect(await one("SELECT client_facility_id, status::text AS status, received_at IS NOT NULL AS received FROM inspection_sessions WHERE id = :id", { id: draft })).toEqual({
      client_facility_id: F1,
      status: "draft",
      received: true,
    });
    expect(await codeOf(() => as(U1, () => g.sessions.createSession(T as TenantId, { deviceId: D1 }, actor(U1))))).toBe("409 IPM_DRAFT_EXISTS");
    expect(await one("SELECT count(*)::int AS n FROM audit_logs WHERE resource_id = :id AND changes->>'operation' = 'CREATE_IPM_DRAFT'", { id: draft })).toEqual({ n: 1 });
  });

  it("results are replaced on a draft through the draft-only trigger (DELETE + INSERT as the application role)", async () => {
    const adHoc = (label: string): { inputKind: "check"; adHoc: { section: "tools_used"; label: string }; outcome: "done" } => ({
      inputKind: "check",
      adHoc: { section: "tools_used", label },
      outcome: "done",
    });
    await as(U1, () => g.sessions.replaceResults(T as TenantId, { sessionId: draft, revision: 0, results: [adHoc("Alat ukur A"), adHoc("Alat ukur B")] }, actor(U1)));
    const second = await as(U1, () => g.sessions.replaceResults(T as TenantId, { sessionId: draft, revision: 1, results: [adHoc("Alat ukur C")] }, actor(U1)));
    expect(second.session["revision"]).toBe(2);
    expect(await rows(g.db, "SELECT label_snapshot, client_facility_id FROM inspection_results WHERE session_id = :id", { id: draft })).toEqual([
      { label_snapshot: "Alat ukur C", client_facility_id: F1 },
    ]);
  });

  it("a clientRef used where the caller can no longer read meets the real unique index → 409 IPM_CLIENT_REF_REUSED", async () => {
    // The caller now bound to F2: its F1 capture is invisible, the index (tenant, creator, ref) is not.
    expect(await codeOf(() => as(U1, () => g.sessions.createSession(T as TenantId, { deviceId: D2, clientRef: REF }, actor(U1)), F2))).toBe(
      "409 IPM_CLIENT_REF_REUSED",
    );
    expect(await one("SELECT count(*)::int AS n FROM inspection_sessions WHERE device_id = :d", { d: D2 })).toEqual({ n: 0 });
  });

  it("two first attempts under one key: exactly one proceeds; a completion in a write transaction is replayed; a release deletes", async () => {
    const request: IdempotencyService.IdempotencyRequest = {
      tenantId: T as TenantId,
      userId: U2,
      apiKeyId: null,
      key: KEY,
      route: "POST /api/v1/ipm/sessions/",
      requestHash: "a".repeat(64),
      scopeFingerprint: "b".repeat(64),
    };
    const both = await as(U2, () => Promise.all([g.keys.beginIdempotentRequest(request), g.keys.beginIdempotentRequest(request)]));
    expect(both.map((b) => b.kind).sort()).toEqual(["conflict", "proceed"]);
    const winner = both.find((b) => b.kind === "proceed") as Extract<IdempotencyService.IdempotencyBegin, { kind: "proceed" }>;
    await as(U2, () =>
      g.keys.idempotencyStorage.run(winner.handle, () => g.db.transaction().then(async (t) => {
        await g.keys.completeIdempotentRequest(t as never, 201, "InspectionSession", draft);
        await t.commit();
      })),
    );
    expect(await as(U2, () => g.keys.beginIdempotentRequest(request))).toEqual({ kind: "replay", status: 201, resourceType: "InspectionSession", resourceId: draft });
    const other = await as(U2, () => g.keys.beginIdempotentRequest({ ...request, key: "4f4f4f4f-4f4f-4f4f-8f4f-4f4f4f4f4f4f" }));
    expect(other.kind).toBe("proceed");
    await as(U2, () => g.keys.releaseIdempotentRequest((other as Extract<IdempotencyService.IdempotencyBegin, { kind: "proceed" }>).handle, 409));
    expect(await one("SELECT count(*)::int AS n FROM idempotency_keys WHERE key = '4f4f4f4f-4f4f-4f4f-8f4f-4f4f4f4f4f4f'")).toEqual({ n: 0 });
  });

  it("a correction of a submitted session copies its results through the trigger; a second one is IPM_CORRECTION_OPEN", async () => {
    await g.db.query(
      `UPDATE inspection_sessions SET status = 'submitted', submitted_at = now(), submitted_by = created_by, visit_number = 1,
         performer_snapshot = '{"name": "Teknisi Sintetis", "role": "TECHNICIAN", "organisation": null}', device_snapshot = '{}',
         facility_snapshot = '{}', report_number = 'IPM-F-2103-001', verification_token = 'tok-p2103', report_content_hash = '${HASH}',
         report_hash_scheme = 'ipm-report-v1', issuer_snapshot = '{"version": 1}', inspection_outcome = 'pass',
         maintenance_outcome = 'pass', recommendation = 'fit_for_use', updated_at = now() WHERE id = :id`,
      { replacements: { id: draft } },
    );
    const correction = await as(U2, () => g.sessions.createCorrection(T as TenantId, { sessionId: draft, reason: "Koreksi sintetis" }, actor(U2)));
    expect([correction.status, correction.session["supersedesId"]]).toEqual([201, draft]);
    expect(await rows(g.db, "SELECT label_snapshot FROM inspection_results WHERE session_id = :id", { id: correction.session["id"] })).toEqual([
      { label_snapshot: "Alat ukur C" },
    ]);
    expect(await codeOf(() => as(U1, () => g.sessions.createCorrection(T as TenantId, { sessionId: draft, reason: "Kedua" }, actor(U1))))).toBe(
      "409 IPM_CORRECTION_OPEN",
    );
    expect(await codeOf(() => as(U1, () => g.sessions.updateHeader(T as TenantId, { sessionId: draft, revision: 2, notes: "x" }, actor(U1))))).toBe(
      "409 IPM_NOT_DRAFT",
    );
  });

  it("the device move refuses a device with an open IPM draft (the service; the database alone would move it)", async () => {
    await expect(
      as(U1, () => g.move.moveDevice(T as TenantId, { calibrationDeviceId: D1, targetClientFacilityId: F2, reason: "Pindah sintetis" }, { userId: U1 })),
    ).rejects.toMatchObject({ status: 409, message: "Submit or discard the 1 open IPM draft(s) of this device first." });
  });

  it("the purge deletes expired keys of every tenant, as the application role", async () => {
    await g.db.query(
      `INSERT INTO idempotency_keys (id, tenant_id, user_id, key, route, request_hash, scope_fingerprint, status, response_status,
         created_at, completed_at, expires_at)
       VALUES ('c2103000-0000-4000-8000-0000000000e1', :t, :u, '5f5f5f5f-5f5f-4f5f-8f5f-5f5f5f5f5f5f', 'r', :h, :h, 'completed', 201,
               now() - interval '40 days', now() - interval '40 days', now() - interval '10 days')`,
      { replacements: { t: T, u: U1, h: "c".repeat(64) } },
    );
    const purged = await g.keys.purgeExpiredIdempotencyKeys();
    expect(purged).toEqual({ deleted: 1, stoppedEarly: false });
    expect(await one("SELECT count(*)::int AS n FROM idempotency_keys WHERE id = 'c2103000-0000-4000-8000-0000000000e1'")).toEqual({ n: 0 });
  });
});
