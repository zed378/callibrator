/**
 * A-10 — durable webhook delivery and receiver-side replay protection, over a
 * REAL HTTP receiver in this process (tests/fixtures/webhookReceiver.js).
 *
 * The database here is an in-memory table (`mockStore`) that implements the
 * claim's contract — due = pending|failed and next_attempt_at <= now; a claim
 * leases the row — so the whole path runs: emit -> row -> claim -> signed POST
 * over a socket -> the receiver's verification recipe -> result on the row.
 * The same properties against real PostgreSQL (SKIP LOCKED, make_interval,
 * afterCommit) are webhook.durable.a10.live.test.js.
 *
 * "Restart" = a second copy of the service loaded with jest.isolateModules:
 * no timers, no memory from the first — only the rows.
 */

const mockStore = { deliveries: new Map(), webhooks: new Map(), seq: 0 };

const mockDeliveryRow = (values) => {
  const r = { attempts: 0, createdAt: new Date(), ...values };
  r.update = jest.fn(async (patch) => Object.assign(r, patch));
  return r;
};

jest.mock("../../models", () => ({
  Webhook: {
    findAll: jest.fn(async ({ where }) =>
      [...mockStore.webhooks.values()].filter(
        (w) => w.tenantId === where.tenantId && w.isActive && w.events.includes("*"),
      ),
    ),
    findOne: jest.fn(async ({ where }) => {
      const w = mockStore.webhooks.get(where.id);
      return w && w.tenantId === where.tenantId ? w : null;
    }),
  },
  WebhookDelivery: {
    create: jest.fn(async (values) => {
      mockStore.seq += 1;
      const id = `dddddddd-0000-4000-8000-${String(mockStore.seq).padStart(12, "0")}`;
      // nextAttemptAt arrives as fn("now"): the database would store now().
      const row = mockDeliveryRow({ ...values, id, nextAttemptAt: new Date() });
      mockStore.deliveries.set(id, row);
      return row;
    }),
    findOne: jest.fn(async ({ where }) => {
      const d = mockStore.deliveries.get(where.id);
      return d && d.tenantId === where.tenantId ? d : null;
    }),
  },
  AuditLog: { create: jest.fn() },
}));

jest.mock("../../config", () => ({
  db: {
    transaction: jest.fn((cb) => cb({})),
    // The claim, with the contract webhook.service#claim relies on.
    query: jest.fn(async (sql, { replacements }) => {
      const now = Date.now();
      const due = [...mockStore.deliveries.values()]
        .filter((d) => ["pending", "failed"].includes(d.status))
        .filter((d) => d.nextAttemptAt && d.nextAttemptAt.getTime() <= now)
        .filter((d) => !sql.includes("AND id = :id") || (d.id === replacements.id && d.tenantId === replacements.tenantId))
        .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
        .slice(0, replacements.limit);
      due.forEach((d) => {
        d.nextAttemptAt = new Date(now + replacements.leaseSeconds * 1000);
      });
      return [due.map((d) => ({ id: d.id, tenantId: d.tenantId }))];
    }),
  },
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../utils/ssrf.util", () => ({
  // The receiver is on 127.0.0.1, which the SSRF guard (rightly) refuses.
  assertSafeUrl: jest.fn(),
  assertResolvedHostIsPublic: jest.fn().mockResolvedValue(undefined),
  isBlockedIp: jest.fn(),
}));

const { startReceiver, verifyWebhook } = require("../fixtures/webhookReceiver");

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECRET_A = "a".repeat(64);
const SECRET_B = "b".repeat(64);

const loadService = () => {
  let svc;
  jest.isolateModules(() => {
    svc = require("../../services/webhook.service");
  });
  return svc;
};

/** Wait until `predicate` holds (real sockets are asynchronous). */
const until = async (predicate, ms = 3000) => {
  const end = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > end) {
      throw new Error("timed out waiting");
    }
    await new Promise((r) => setTimeout(r, 10));
  }
};

const makeDue = () =>
  mockStore.deliveries.forEach((d) => {
    if (d.nextAttemptAt) {
      d.nextAttemptAt = new Date(Date.now() - 1000);
    }
  });

describe("A-10 — durable delivery to a real HTTP receiver", () => {
  const receivers = [];
  const receiver = async (secret, status) => {
    const rx = await startReceiver({ secret, status });
    receivers.push(rx);
    return rx;
  };
  const register = (id, tenantId, secret, url) =>
    mockStore.webhooks.set(id, { id, tenantId, url, secret, events: ["*"], isActive: true });

  beforeEach(() => {
    mockStore.deliveries.clear();
    mockStore.webhooks.clear();
  });

  afterEach(async () => {
    while (receivers.length) {
      await receivers.pop().close();
    }
  });

  it("the receiver's recipe accepts the signed delivery: fresh timestamp, valid v1 signature, new id", async () => {
    const svc = loadService();
    const rx = await receiver(SECRET_A, 200);
    register("w-a", TENANT_A, SECRET_A, rx.url);

    await svc.emitEvent(TENANT_A, "certificate.signed", { certificateId: "c-1" });
    await until(() => rx.received.length === 1 && [...mockStore.deliveries.values()][0].status === "success");

    const [got] = rx.received;
    expect(got.verdict).toBe("ok");
    expect(got.event).toBe("certificate.signed");
    expect(JSON.parse(got.body)).toMatchObject({ id: got.deliveryId, event: "certificate.signed", data: { certificateId: "c-1" } });
  });

  it("replay protection: a captured request replayed later is stale; with a swapped timestamp its signature fails; resent at once it is a duplicate", async () => {
    const svc = loadService();
    const rx = await receiver(SECRET_A, 200);
    register("w-a", TENANT_A, SECRET_A, rx.url);
    await svc.emitEvent(TENANT_A, "capa.closed", { capaId: "x" });
    await until(() => rx.received.length === 1);

    expect(await rx.replay(0)).toBe("duplicate"); // same id, inside the window
    rx.advanceClock(10 * 60); // ten minutes later
    expect(await rx.replay(0)).toBe("stale");
    expect(await rx.replay(0, { freshTimestamp: true })).toBe("bad-signature");
  });

  it("a receiver holding the wrong secret rejects the delivery, and the failure is scheduled for retry", async () => {
    const svc = loadService();
    const rx = await receiver(SECRET_B, 200); // configured with another secret
    register("w-a", TENANT_A, SECRET_A, rx.url);
    await svc.emitEvent(TENANT_A, "device.overdue", {});
    await until(() => [...mockStore.deliveries.values()][0].status === "failed");

    const [row] = mockStore.deliveries.values();
    expect(rx.received[0].verdict).toBe("bad-signature");
    expect(row).toMatchObject({ attempts: 1, responseStatus: 401, lastError: "HTTP 401" });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 55 * 1000);
  });

  it("restart survival: a retry the first process scheduled is sent by a freshly loaded one, same delivery id", async () => {
    const first = loadService();
    const rx = await receiver(SECRET_A, 503);
    register("w-a", TENANT_A, SECRET_A, rx.url);
    await first.emitEvent(TENANT_A, "work_order.completed", { workOrderId: "wo-1" });
    await until(() => [...mockStore.deliveries.values()][0].status === "failed");

    // The first process is gone. Nothing of it survives but the rows.
    const second = loadService();
    expect(second).not.toBe(first);
    rx.respondWith(200);
    expect(await second.dispatchDue()).toEqual({ claimed: 0, errors: 0 }); // not due yet
    makeDue();
    expect(await second.dispatchDue()).toEqual({ claimed: 1, errors: 0 });

    const [row] = mockStore.deliveries.values();
    expect(row).toMatchObject({ status: "success", attempts: 2, nextAttemptAt: null });
    expect(rx.received).toHaveLength(2);
    expect(rx.received[1].deliveryId).toBe(rx.received[0].deliveryId);
    expect(rx.received[1].body).toBe(rx.received[0].body);
    expect(rx.received[1].verdict).toBe("duplicate"); // the receiver processes it once
  });

  it("dead letter: a receiver that never answers 2xx is given 12 attempts, then the row is exhausted", async () => {
    const svc = loadService();
    const rx = await receiver(SECRET_A, 500);
    register("w-a", TENANT_A, SECRET_A, rx.url);
    await svc.emitEvent(TENANT_A, "device.overdue", {});
    await until(() => [...mockStore.deliveries.values()][0].status === "failed");
    for (let i = 2; i <= 12; i++) {
      makeDue();
      await svc.dispatchDue();
    }
    const [row] = mockStore.deliveries.values();
    expect(row).toMatchObject({ status: "exhausted", attempts: 12, nextAttemptAt: null });
    makeDue();
    expect(await svc.dispatchDue()).toEqual({ claimed: 0, errors: 0 }); // nothing after the dead letter
    expect(rx.received).toHaveLength(12);
  });

  it("two tenants: each event reaches only its own tenant's receiver, and B cannot claim or test A's", async () => {
    const svc = loadService();
    const rxA = await receiver(SECRET_A, 500);
    const rxB = await receiver(SECRET_B, 200);
    register("w-a", TENANT_A, SECRET_A, rxA.url);
    register("w-b", TENANT_B, SECRET_B, rxB.url);

    await svc.emitEvent(TENANT_A, "stock_transfer.completed", { transferId: "t-a" });
    await until(() => rxA.received.length === 1);
    await svc.emitEvent(TENANT_B, "stock_transfer.completed", { transferId: "t-b" });
    await until(() => rxB.received.length === 1);

    expect(JSON.parse(rxA.received[0].body).data).toEqual({ transferId: "t-a" });
    expect(JSON.parse(rxB.received[0].body).data).toEqual({ transferId: "t-b" });
    const rows = [...mockStore.deliveries.values()];
    expect(rows.map((d) => [d.tenantId, d.webhookId])).toEqual([
      [TENANT_A, "w-a"],
      [TENANT_B, "w-b"],
    ]);

    // A's failed delivery, due again: tenant B's claim by id takes nothing.
    makeDue();
    const aRow = rows[0];
    expect(await svc._dispatchDelivery(aRow.id, TENANT_B)).toBeNull();
    await expect(svc.testWebhook(TENANT_B, "w-a")).rejects.toMatchObject({ status: 404 });
    expect(rxA.received).toHaveLength(1);
    expect(rxB.received).toHaveLength(1);
  });

  it("verifyWebhook refuses a request with a header missing", () => {
    expect(verifyWebhook(SECRET_A, {}, "{}", new Set())).toBe("missing-headers");
    expect(
      verifyWebhook(SECRET_A, { "x-webhook-timestamp": "abc", "x-webhook-signature": "v1=x", "x-webhook-delivery": "d" }, "{}", new Set()),
    ).toBe("stale");
  });
});
