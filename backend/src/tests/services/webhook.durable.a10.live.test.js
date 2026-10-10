/**
 * Durable webhook delivery against a REAL PostgreSQL (A-10, A-11).
 *
 * The mocked suites prove which statements the service issues. They cannot
 * prove `FOR UPDATE SKIP LOCKED`, the lease arithmetic in `make_interval`,
 * `RETURNING` through Sequelize's raw query, or `transaction.afterCommit` —
 * a mocked db.query returns whatever the test says. These run the real claim
 * on a real server, POST to a real in-process receiver that verifies every
 * signature with the documented recipe, and assert:
 *
 *   1. a retry scheduled before a restart is sent by the next process,
 *   2. two replicas dispatching at once send every delivery exactly once,
 *   3. a leased row is invisible until its lease expires,
 *   4. deliveries never cross tenants, and a claim by id is tenant-bound,
 *   5. a rolled-back transaction emits nothing; a committed one emits once.
 *
 * A "replica" / "restarted process" is a separately loaded copy of the module
 * graph: its own Sequelize instance and connection pool.
 *
 * NEEDS a PostgreSQL server where DB_USER may CREATE DATABASE:
 *
 *   DB_HOST=... DB_PORT=... DB_USER=... DB_PASS=... \
 *     [LIVE_DB_TEMPLATE=<a booted database>] \
 *     npm run test:live:jest -- src/tests/services/webhook.durable.a10.live
 *
 * A-283 (2026-09-30): the suite creates its OWN database (ADR-095 O-2),
 * builds it the way the backend boots (db.sync() + every migration), and every
 * process — the first, the "restarted" one and the second replica — runs as
 * `callibrator_app` (enterApplicationRole), never as the owner. The claim is
 * `UPDATE … FOR UPDATE SKIP LOCKED`: as the owner it passed whether the
 * application role held UPDATE on webhook_deliveries or not. Creating a
 * webhook writes an append-only audit row (0091) naming its creator (A-124),
 * so the database is dropped, never cleaned.
 */

jest.mock("../../utils/ssrf.util", () => ({
  // The receiver is on 127.0.0.1, which the SSRF guard (rightly) refuses.
  assertSafeUrl: jest.fn(),
  assertResolvedHostIsPublic: jest.fn().mockResolvedValue(undefined),
  isBlockedIp: jest.fn(),
  // A-307's sender: its pinned lookup refuses loopback too. Plain fetch with
  // the same contract — a 3xx returned, not followed; every status resolves.
  pinnedFetch: async (url, { method, headers, body, signal }) => {
    const res = await fetch(url, { method, headers, body, signal, redirect: "manual" });
    await res.body?.cancel();
    return { ok: res.ok, status: res.status };
  },
}));

const { startReceiver } = require("../fixtures/webhookReceiver");
const { createDisposableDatabase, LIVE_BOOT_TIMEOUT_MS } = require("../fixtures/disposableDatabase");
const { bootSchema, enterAppRole, APP_ROLE } = require("../fixtures/liveBoot");

const TENANT_A = "a1a1a1a1-0000-4000-8000-00000000000a";
const TENANT_B = "b2b2b2b2-0000-4000-8000-00000000000b";
/** The webhook creator in each tenant: an audit row names its actor (A-124). */
const CREATOR = {
  [TENANT_A]: "a1a1a1a1-0000-4000-8000-0000000000e1",
  [TENANT_B]: "b2b2b2b2-0000-4000-8000-0000000000e2",
};

/**
 * A separately loaded module graph: a new process, as far as the DB can tell.
 * `boot` only for the first one: db.sync() + the migrations are owner
 * DDL; every process then runs as the application role, as index.js does.
 */
const startProcess = async ({ boot = false } = {}) => {
  let graph;
  jest.isolateModules(() => {
    const { db } = require("../../config");
    db.options.logging = false;
    graph = {
      db,
      migrator: require("../../config/migrator").migrator,
      models: require("../../models"),
      webhookService: require("../../services/webhook.service"),
    };
  });
  if (boot) {
    await bootSchema(graph.db, graph.migrator);
  }
  await enterAppRole(graph.db);
  return graph;
};

/** createWebhook with the tenant's creator as the audited actor. */
const createHook = (p, tenantId, events = ["*"]) =>
  p.webhookService.createWebhook(tenantId, {
    url: "https://placeholder.invalid/",
    events,
    createdBy: CREATOR[tenantId],
  });

const settle = () => new Promise((r) => setTimeout(r, 300));

describe("webhook delivery — live PostgreSQL (A-10, A-11)", () => {
  jest.setTimeout(60000);
  let p1;
  const receivers = [];

  const receiver = async (secret, status) => {
    const rx = await startReceiver({ secret, status });
    receivers.push(rx);
    return rx;
  };

  const due = (db, ids) =>
    db.query("UPDATE webhook_deliveries SET next_attempt_at = now() - interval '1 second' WHERE id IN (:ids)", {
      replacements: { ids },
    });

  const rowsOf = async (db, tenantId) => {
    const [rows] = await db.query(
      "SELECT id, tenant_id, webhook_id, status, attempts, next_attempt_at FROM webhook_deliveries WHERE tenant_id = :tenantId ORDER BY created_at",
      { replacements: { tenantId } },
    );
    return rows;
  };

  let scratch;

  beforeAll(async () => {
    scratch = await createDisposableDatabase("a10");
    p1 = await startProcess({ boot: true });
    await p1.db.query(
      `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES
         (:a, 'Live A', 'live-a10-a', 'a10a@live.test', now(), now()),
         (:b, 'Live B', 'live-a10-b', 'a10b@live.test', now(), now())`,
      { replacements: { a: TENANT_A, b: TENANT_B } },
    );
    for (const [tenantId, userId] of Object.entries(CREATOR)) {
      await p1.db.query(
        `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, created_at, updated_at)
         VALUES (:userId, :tenantId, :name, :email, 'x', 'A10', 'Creator', now(), now())`,
        { replacements: { userId, tenantId, name: `a10-${userId.slice(-2)}`, email: `a10-${userId.slice(-2)}@live.test` } },
      );
    }
  }, LIVE_BOOT_TIMEOUT_MS);

  afterEach(async () => {
    await p1.db.query("DELETE FROM webhook_deliveries WHERE tenant_id IN (:t)", { replacements: { t: [TENANT_A, TENANT_B] } });
    await p1.db.query("DELETE FROM webhooks WHERE tenant_id IN (:t)", { replacements: { t: [TENANT_A, TENANT_B] } });
    while (receivers.length) {
      await receivers.pop().close();
    }
  });

  afterAll(async () => {
    if (p1) {
      await p1.db.close();
    }
    if (scratch) {
      await scratch.drop();
    }
  });

  it("runs as callibrator_app, which may claim (UPDATE) deliveries but not delete an audit row", async () => {
    const [[row]] = await p1.db.query(
      `SELECT current_user AS u, has_table_privilege('webhook_deliveries', 'UPDATE') AS claim,
              has_table_privilege('audit_logs', 'DELETE') AS erase`,
    );
    expect(row).toEqual({ u: APP_ROLE, claim: true, erase: false });
  });

  it("a retry scheduled before a restart is delivered by the next process, same delivery id, signature verified", async () => {
    const hook = await createHook(p1, TENANT_A);
    const rx = await receiver(hook.secret, 500);
    await p1.db.query("UPDATE webhooks SET url = :url WHERE id = :id", { replacements: { url: rx.url, id: hook.id } });

    await p1.webhookService.emitEvent(TENANT_A, "device.overdue", { deviceId: "dev-1" });
    await settle();

    let [row] = await rowsOf(p1.db, TENANT_A);
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(1);
    // The retry is in the database, scheduled a minute out — not in a timer.
    expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 50 * 1000);
    expect(rx.received).toHaveLength(1);
    expect(rx.received[0].verdict).toBe("ok");

    // "Restart": the first process is gone; a new one boots. Its dispatcher
    // finds the row once it is due.
    await p1.db.close();
    const p2 = await startProcess();
    p1 = p2; // the cleanup hooks use the live process
    rx.respondWith(200);
    const early = await p2.webhookService.dispatchDue();
    expect(early.claimed).toBe(0); // not due yet: nothing is sent early
    await due(p2.db, [row.id]);
    const pass = await p2.webhookService.dispatchDue();
    expect(pass).toEqual({ claimed: 1, errors: 0 });

    [row] = await rowsOf(p2.db, TENANT_A);
    expect(row.status).toBe("success");
    expect(row.attempts).toBe(2);
    expect(row.next_attempt_at).toBeNull();
    expect(rx.received).toHaveLength(2);
    expect(rx.received[1].deliveryId).toBe(rx.received[0].deliveryId);
    expect(rx.received[1].body).toBe(rx.received[0].body); // byte-identical body
    expect(rx.received[1].verdict).toBe("duplicate"); // the receiver dedupes on the id
  });

  it("two replicas dispatching concurrently send each of 30 due deliveries exactly once (SKIP LOCKED)", async () => {
    const hook = await createHook(p1, TENANT_A);
    const rx = await receiver(hook.secret, 200);
    await p1.db.query("UPDATE webhooks SET url = :url WHERE id = :id", { replacements: { url: rx.url, id: hook.id } });
    // Rows written straight to the table, due now — as a restart finds them.
    await p1.db.query(
      `INSERT INTO webhook_deliveries (id, tenant_id, webhook_id, event, payload, status, attempts, next_attempt_at, created_at, updated_at)
       SELECT gen_random_uuid(), :tenant, :hook, 'device.overdue', '{}'::jsonb, 'pending', 0, now() - interval '1 second', now(), now()
         FROM generate_series(1, 30)`,
      { replacements: { tenant: TENANT_A, hook: hook.id } },
    );
    const p2 = await startProcess();
    try {
      const [a, b] = await Promise.all([
        p1.webhookService.dispatchDue({ limit: 30 }),
        p2.webhookService.dispatchDue({ limit: 30 }),
      ]);
      expect(a.claimed + b.claimed).toBe(30);
      const ids = rx.received.map((r) => r.deliveryId);
      expect(ids).toHaveLength(30);
      expect(new Set(ids).size).toBe(30);
      expect(rx.received.every((r) => r.verdict === "ok")).toBe(true);
    } finally {
      await p2.db.close();
    }
  });

  it("a claimed (leased) row is invisible to every claimer until the lease expires", async () => {
    const hook = await createHook(p1, TENANT_A);
    await p1.db.query(
      `INSERT INTO webhook_deliveries (id, tenant_id, webhook_id, event, payload, status, attempts, next_attempt_at, created_at, updated_at)
       VALUES (gen_random_uuid(), :tenant, :hook, 'device.overdue', '{}'::jsonb, 'pending', 0, now() - interval '1 second', now(), now())`,
      { replacements: { tenant: TENANT_A, hook: hook.id } },
    );
    // Claim it the way a sender that then crashes would: claim, never report.
    const claimed = await p1.webhookService._claim({ limit: 10 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0].tenantId).toBe(TENANT_A);
    const [row] = await rowsOf(p1.db, TENANT_A);
    const leaseMs = new Date(row.next_attempt_at).getTime() - Date.now();
    expect(leaseMs).toBeGreaterThan(4 * 60 * 1000); // default lease: 5 minutes
    expect(await p1.webhookService._claim({ limit: 10 })).toHaveLength(0);
    // Lease expired (the sender died): due again, and claimable again.
    await due(p1.db, [row.id]);
    expect(await p1.webhookService._claim({ limit: 10 })).toHaveLength(1);
  });

  it("two tenants: an event reaches only its own tenant's webhook, and a claim by id is bound to the tenant", async () => {
    const hookA = await createHook(p1, TENANT_A);
    const hookB = await createHook(p1, TENANT_B);
    const rxA = await receiver(hookA.secret, 500);
    const rxB = await receiver(hookB.secret, 200);
    await p1.db.query("UPDATE webhooks SET url = :url WHERE id = :id", { replacements: { url: rxA.url, id: hookA.id } });
    await p1.db.query("UPDATE webhooks SET url = :url WHERE id = :id", { replacements: { url: rxB.url, id: hookB.id } });

    await p1.webhookService.emitEvent(TENANT_A, "capa.created", { capaId: "c-1" });
    await settle();

    const rowsA = await rowsOf(p1.db, TENANT_A);
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0].webhook_id).toBe(hookA.id);
    expect(await rowsOf(p1.db, TENANT_B)).toHaveLength(0);
    expect(rxA.received).toHaveLength(1);
    expect(rxB.received).toHaveLength(0);

    // Tenant B cannot claim, re-send, list or test tenant A's delivery/webhook.
    await due(p1.db, [rowsA[0].id]);
    expect(await p1.webhookService._claim({ id: rowsA[0].id, tenantId: TENANT_B })).toHaveLength(0);
    expect(await p1.webhookService._dispatchDelivery(rowsA[0].id, TENANT_B)).toBeNull();
    await expect(p1.webhookService.listDeliveries(TENANT_B, hookA.id)).rejects.toMatchObject({ status: 404 });
    await expect(p1.webhookService.testWebhook(TENANT_B, hookA.id)).rejects.toMatchObject({ status: 404 });
    expect(rxA.received).toHaveLength(1);
    expect(rxB.received).toHaveLength(0);

    // The cross-tenant dispatcher sends A's retry to A's receiver only.
    await p1.webhookService.dispatchDue();
    expect(rxA.received).toHaveLength(2);
    expect(rxB.received).toHaveLength(0);
  });

  it("emitAfterCommit: a rolled-back transaction emits nothing; a committed one emits exactly once", async () => {
    const hook = await createHook(p1, TENANT_A, ["capa.created"]);
    const rx = await receiver(hook.secret, 200);
    await p1.db.query("UPDATE webhooks SET url = :url WHERE id = :id", { replacements: { url: rx.url, id: hook.id } });

    await expect(
      p1.db.transaction(async (transaction) => {
        p1.webhookService.emitAfterCommit(transaction, TENANT_A, "capa.created", { capaId: "rolled-back" });
        throw new Error("the mutation failed");
      }),
    ).rejects.toThrow("the mutation failed");
    await settle();
    expect(await rowsOf(p1.db, TENANT_A)).toHaveLength(0);
    expect(rx.received).toHaveLength(0);

    await p1.db.transaction(async (transaction) => {
      p1.webhookService.emitAfterCommit(transaction, TENANT_A, "capa.created", { capaId: "committed" });
      // Nothing is emitted before COMMIT.
      const [inside] = await p1.db.query("SELECT count(*)::int AS n FROM webhook_deliveries WHERE tenant_id = :t", {
        replacements: { t: TENANT_A },
      });
      expect(inside[0].n).toBe(0);
    });
    await settle();
    const rows = await rowsOf(p1.db, TENANT_A);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("success");
    expect(rx.received).toHaveLength(1);
    expect(JSON.parse(rx.received[0].body).data).toEqual({ capaId: "committed" });
    expect(rx.received[0].verdict).toBe("ok");
  });
});
