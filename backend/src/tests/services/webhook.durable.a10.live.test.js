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
 * OPT-IN — needs a database whose schema includes webhook_deliveries with
 * migration 0043 applied (db.sync() of the current models is enough):
 *
 *   WEBHOOK_PG_LIVE_TEST=1 DB_HOST=... DB_PORT=... DB_NAME=... DB_USER=... DB_PASS=... \
 *     npm test -- src/tests/services/webhook.durable.a10.live --coverage=false
 *
 * It creates two tenants with fixed ids and removes everything it wrote.
 */

jest.mock("../../utils/ssrf.util", () => ({
  // The receiver is on 127.0.0.1, which the SSRF guard (rightly) refuses.
  assertSafeUrl: jest.fn(),
  assertResolvedHostIsPublic: jest.fn().mockResolvedValue(undefined),
  isBlockedIp: jest.fn(),
}));

const { startReceiver } = require("../fixtures/webhookReceiver");

const live = process.env.WEBHOOK_PG_LIVE_TEST === "1" ? describe : describe.skip;

const TENANT_A = "a1a1a1a1-0000-4000-8000-00000000000a";
const TENANT_B = "b2b2b2b2-0000-4000-8000-00000000000b";

// jest.config maps `uuid` to a mock returning ONE constant (A-116) — which
// Sequelize's UUIDV4 defaults use too. Rows in a real table need real ids.
const realUuids = new Set();
const useRealUuids = (uuid) => {
  uuid.v4.mockImplementation(() => require("crypto").randomUUID());
  realUuids.add(uuid);
};

/** A separately loaded module graph: a new process, as far as the DB can tell. */
const startProcess = () => {
  let graph;
  jest.isolateModules(() => {
    useRealUuids(require("uuid"));
    const { db } = require("../../config");
    db.options.logging = false;
    graph = {
      db,
      models: require("../../models"),
      webhookService: require("../../services/webhook.service"),
    };
  });
  return graph;
};

const settle = () => new Promise((r) => setTimeout(r, 300));

live("webhook delivery — live PostgreSQL (A-10, A-11)", () => {
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

  beforeAll(async () => {
    p1 = startProcess();
    await p1.db.query(
      `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES
         (:a, 'Live A', 'live-a10-a', 'a10a@live.test', now(), now()),
         (:b, 'Live B', 'live-a10-b', 'a10b@live.test', now(), now())
       ON CONFLICT (id) DO NOTHING`,
      { replacements: { a: TENANT_A, b: TENANT_B } },
    );
  });

  beforeEach(() => {
    realUuids.forEach(useRealUuids); // restoreMocks resets the implementation
  });

  afterEach(async () => {
    await p1.db.query("DELETE FROM webhook_deliveries WHERE tenant_id IN (:t)", { replacements: { t: [TENANT_A, TENANT_B] } });
    await p1.db.query("DELETE FROM webhooks WHERE tenant_id IN (:t)", { replacements: { t: [TENANT_A, TENANT_B] } });
    while (receivers.length) {
      await receivers.pop().close();
    }
  });

  afterAll(async () => {
    await p1.db.query("DELETE FROM tenants WHERE id IN (:t)", { replacements: { t: [TENANT_A, TENANT_B] } });
    await p1.db.close();
  });

  it("a retry scheduled before a restart is delivered by the next process, same delivery id, signature verified", async () => {
    const hook = await p1.webhookService.createWebhook(TENANT_A, { url: "https://placeholder.invalid/", events: ["*"] });
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
    const p2 = startProcess();
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
    const hook = await p1.webhookService.createWebhook(TENANT_A, { url: "https://placeholder.invalid/", events: ["*"] });
    const rx = await receiver(hook.secret, 200);
    await p1.db.query("UPDATE webhooks SET url = :url WHERE id = :id", { replacements: { url: rx.url, id: hook.id } });
    // Rows written straight to the table, due now — as a restart finds them.
    await p1.db.query(
      `INSERT INTO webhook_deliveries (id, tenant_id, webhook_id, event, payload, status, attempts, next_attempt_at, created_at, updated_at)
       SELECT gen_random_uuid(), :tenant, :hook, 'device.overdue', '{}'::jsonb, 'pending', 0, now() - interval '1 second', now(), now()
         FROM generate_series(1, 30)`,
      { replacements: { tenant: TENANT_A, hook: hook.id } },
    );
    const p2 = startProcess();
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
    const hook = await p1.webhookService.createWebhook(TENANT_A, { url: "https://placeholder.invalid/", events: ["*"] });
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
    const hookA = await p1.webhookService.createWebhook(TENANT_A, { url: "https://placeholder.invalid/", events: ["*"] });
    const hookB = await p1.webhookService.createWebhook(TENANT_B, { url: "https://placeholder.invalid/", events: ["*"] });
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
    const hook = await p1.webhookService.createWebhook(TENANT_A, { url: "https://placeholder.invalid/", events: ["capa.created"] });
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
