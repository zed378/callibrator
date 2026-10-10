/**
 * P21-07 against a REAL PostgreSQL 18 — the live twin of `routes/dashboard.twoFacility` (A-10, OQ-8;
 * G-14, G-20) and of `ipmDue.p2107` / `search.qr.p2107`, run AS `callibrator_app`:
 *
 *  - the REAL `getDashboardMetrics` (every aggregate: hooked counts, grouped counts,
 *    `to_char(date_trunc(…))` trends, `countDue`'s raw read) under three contexts — unbound, bound to
 *    F1, bound to F2 — answers each facility its own figures: the condition cards, the IPM figures,
 *    the devices and users; and for EVERY count in the payload, F1's + F2's never exceed the unbound
 *    view's (a figure that ignored the facility would count the whole tenant twice);
 *  - `GET /ipm/due?month=` moves the reference month in SQL exactly as `computeIpmDue` does;
 *  - the quick search finds a device by its QR code typed in lower case (F-72), ranked first.
 *
 *   docker run -d --name p2107-pg18 -e POSTGRES_PASSWORD=p2107pass \
 *     -p 127.0.0.1:55217:5432 pgvector/pgvector:pg18
 *   P2107_PG_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=55217 DB_NAME=p2107_scratch \
 *     DB_USER=postgres DB_PASS=p2107pass npm test -- src/tests/services/dashboard.twoFacility.p2107.live --coverage=false
 *   docker rm -f p2107-pg18
 * (or `npm run test:live -- --only=p2107`)
 *
 * Synthetic values only.
 */
import { env } from "../../config/env";
import { draftSql, resultSql, rows, seedSql, submitSql, type LiveDb, type Row } from "../fixtures/ipmLive";
import type * as DueService from "../../services/ipmDue.service";
import type * as TenantContext from "../../middlewares/tenantContext.middleware";
import type * as LiveBoot from "../fixtures/liveBoot";
import type { ClientFacilityId, TenantId } from "../../types/ids";

const live = env("P2107_PG_LIVE_TEST") === "1" ? describe : describe.skip;

const T = "c2107000-0000-4000-8000-000000000001";
const ROLE = "c2107000-0000-4000-8000-000000000002";
const U1 = "c2107000-0000-4000-8000-0000000000a1";
const U2 = "c2107000-0000-4000-8000-0000000000a2";
const U3 = "c2107000-0000-4000-8000-0000000000a3";
const F1 = "c2107000-0000-4000-8000-0000000000f1";
const F2 = "c2107000-0000-4000-8000-0000000000f2";
const D1 = "c2107000-0000-4000-8000-0000000000d1";
const D2 = "c2107000-0000-4000-8000-0000000000d2";
const D3 = "c2107000-0000-4000-8000-0000000000d3";
const D4 = "c2107000-0000-4000-8000-0000000000d4";
const S1 = "c2107000-0000-4000-8000-0000000000e1";
const S2 = "c2107000-0000-4000-8000-0000000000e2";

type Metrics = Record<string, unknown>;
interface DashboardService {
  getDashboardMetrics(tenantId: string | null): Promise<{ data: Metrics }>;
}
interface SearchService {
  search(tenantId: string, q: { q: string; types?: string[] }): Promise<{ results: Record<string, unknown>[] }>;
}
interface Graph {
  db: LiveDb;
  migrator: { up(options?: object): Promise<{ name: string }[]> };
  dashboard: DashboardService;
  due: typeof DueService;
  search: SearchService;
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
      dashboard: require("../../services/dashboard.service") as DashboardService,
      due: require("../../services/ipmDue.service") as typeof DueService,
      search: require("../../services/search.service") as SearchService,
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

/** Every numeric leaf of a payload, by path (rates excluded: they are not counts). */
const counts = (value: unknown, path = ""): Map<string, number> => {
  const out = new Map<string, number>();
  if (typeof value === "number") {
    out.set(path, value);
  } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, inner] of Object.entries(value)) {
      if (key !== "complianceRate") {
        for (const [p, n] of counts(inner, `${path}.${key}`)) {
          out.set(p, n);
        }
      }
    }
  }
  return out;
};

/** `YYYY-MM` of the current month in Asia/Jakarta (the tenant's default zone) plus `offset`. */
const jakartaMonth = (offset: number): string => {
  const local = new Date(Date.now() + 7 * 3600 * 1000);
  const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + offset, 1));
  return `${String(d.getUTCFullYear())}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

live("P21-07 — the dashboard per facility, due by month and the QR search on PostgreSQL 18, as callibrator_app", () => {
  let g: Graph;

  const ctx = <R>(work: () => Promise<R>, facility: string | null = null): Promise<R> =>
    g.tenantStorage.run(
      { tenantId: T as TenantId, isSuperAdmin: false, isSystemTask: false, userId: U1, clientFacilityId: facility as ClientFacilityId | null, facilityBound: facility !== null },
      work,
    );
  const metrics = async (facility: string | null): Promise<Metrics> => (await ctx(() => g.dashboard.getDashboardMetrics(T), facility)).data;
  const one = async (sql: string, replacements: object = {}): Promise<Row> => (await rows(g.db, sql, replacements))[0] as Row;

  beforeAll(async () => {
    g = startProcess();
    await g.db.sync();
    await g.migrator.up();
    const statements: [string, object][] = [
      ...seedSql({
        tenant: T,
        role: ROLE,
        users: [U1, U2],
        facilities: [
          [F1, "F-2107-1"],
          [F2, "F-2107-2"],
        ],
        devices: [
          [D1, F1, "SN-2107-1"],
          [D2, F2, "SN-2107-2"],
          [D3, F1, "SN-2107-3"],
          [D4, F1, "SN-2107-4"],
        ],
        tag: "p2107",
      }).map((sql): [string, object] => [sql, {}]),
      ["UPDATE calibration_devices SET status = 'active' WHERE tenant_id = :t", { t: T }],
      ["UPDATE calibration_devices SET condition = 'good', condition_source = 'manual', qr_code = 'TST2107001' WHERE id = :d", { d: D1 }],
      ["UPDATE calibration_devices SET condition = 'broken', condition_source = 'manual' WHERE id IN (:a, :b)", { a: D2, b: D3 }],
      ["UPDATE calibration_devices SET ipm_interval_months = 0 WHERE id = :d", { d: D4 }],
      [
        `INSERT INTO tenant_settings (id, tenant_id, key, value, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, 'ipm_interval_months', '1', now(), now())`,
        { t: T },
      ],
      // U3 is bound to F1 from its creation (a bound role, as the database's users_bound_role_check requires).
      [
        `INSERT INTO roles (id, name, created_at, updated_at) SELECT gen_random_uuid(), 'HEALTHCARE TECHNICIAN', now(), now()
          WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'HEALTHCARE TECHNICIAN')`,
        {},
      ],
      [
        `INSERT INTO users (id, tenant_id, role_id, client_facility_id, username, email, password, first_name, last_name, created_at, updated_at)
         SELECT :u, :t, id, :f, 'p2107bound', 'p2107bound@example.test', 'x', 'T', 'Bound', now(), now() FROM roles WHERE name = 'HEALTHCARE TECHNICIAN' LIMIT 1`,
        { u: U3, t: T, f: F1 },
      ],
      // One effective IPM this month on D1 (F1) and on D2 (F2).
      [draftSql(), { id: S1, tenant: T, device: D1, user: U1 }],
      [resultSql, { resultId: "c2107000-0000-4000-8000-0000000000c1", tenant: T, session: S1, sort: 1 }],
      [submitSql, { id: S1, visit: 1, reportNumber: "IPM-F-2107-1-20261009-001", token: "tok-2107-1" }],
      [draftSql(), { id: S2, tenant: T, device: D2, user: U1 }],
      [resultSql, { resultId: "c2107000-0000-4000-8000-0000000000c2", tenant: T, session: S2, sort: 1 }],
      [submitSql, { id: S2, visit: 1, reportNumber: "IPM-F-2107-2-20261009-001", token: "tok-2107-2" }],
    ];
    for (const [sql, replacements] of statements) {
      await g.db.query(sql, { replacements }).catch((e: unknown) => {
        throw new Error(`seed failed: ${(e as Error).message} — ${sql.slice(0, 90)}`);
      });
    }
    await g.boot.enterAppRole(g.db as unknown as Parameters<typeof LiveBoot.enterAppRole>[0]);
  }, 300_000);

  afterAll(async () => {
    await g.db.close();
  });

  it("runs as the application role", async () => {
    expect(await one("SELECT current_user AS u")).toEqual({ u: "callibrator_app" });
  });

  it("unbound: the tenant's figures — conditions, IPM and users of both facilities", async () => {
    const m = await metrics(null);
    expect(m["devices"]).toMatchObject({ total: 4, byCondition: { good: 1, not_good: 0, broken: 2, unset: 1 } });
    expect(m["ipm"]).toEqual({ sessionsLast30Days: 2, due: { scheduled: 3, due: 1, neverInspected: 1 } });
    expect(m["users"]).toMatchObject({ total: 3 });
  });

  it("bound to F1: F1's figures only", async () => {
    const m = await metrics(F1);
    expect(m["devices"]).toMatchObject({ total: 3, byCondition: { good: 1, not_good: 0, broken: 1, unset: 1 } });
    expect(m["ipm"]).toEqual({ sessionsLast30Days: 1, due: { scheduled: 2, due: 1, neverInspected: 1 } });
    expect(m["users"]).toMatchObject({ total: 1 });
    expect(m["inventory"]).toMatchObject({ stockItems: 0, pendingTransfers: 0, openOpnames: 0 });
  });

  it("bound to F2: F2's figures only", async () => {
    const m = await metrics(F2);
    expect(m["devices"]).toMatchObject({ total: 1, byCondition: { good: 0, not_good: 0, broken: 1, unset: 0 } });
    expect(m["ipm"]).toEqual({ sessionsLast30Days: 1, due: { scheduled: 1, due: 0, neverInspected: 0 } });
    expect(m["users"]).toMatchObject({ total: 0 });
  });

  it("for every count of the payload, F1's + F2's never exceed the tenant's", async () => {
    const [all, f1, f2] = await Promise.all([metrics(null), metrics(F1), metrics(F2)]).then((ms) => ms.map((m) => counts(m)));
    for (const [path, total] of all ?? new Map<string, number>()) {
      expect({ path, ok: (f1?.get(path) ?? 0) + (f2?.get(path) ?? 0) <= total }).toEqual({ path, ok: true });
    }
  });

  it("due by month: next month adds the devices inspected this month (interval 1); a bound caller sees its facility's", async () => {
    const now = await ctx(() => g.due.listDue(T, { page: 1, limit: 50, state: "due" }));
    expect(now.rows.map((r) => r["id"])).toEqual([D3]);
    const next = await ctx(() => g.due.listDue(T, { page: 1, limit: 50, state: "due", month: jakartaMonth(1) }));
    expect(next.rows.map((r) => r["id"]).sort()).toEqual([D1, D2, D3].sort());
    expect(next.rows.every((r) => (r["ipmDue"] as { state: string }).state !== "ok")).toBe(true);
    const bound = await ctx(() => g.due.listDue(T, { page: 1, limit: 50, state: "due", month: jakartaMonth(1) }), F1);
    expect(bound.rows.map((r) => r["id"]).sort()).toEqual([D1, D3].sort());
  });

  it("F-72: the quick search finds a device by its QR code typed in lower case, ranked first", async () => {
    const res = await ctx(() => g.search.search(T, { q: "tst2107001", types: ["device"] }));
    expect(res.results[0]).toMatchObject({ id: D1, qrCode: "TST2107001", rank: 1 });
  });
});
