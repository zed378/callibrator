/**
 * W-17 — the first attempt `emitEvent` makes for each delivery is capped.
 *
 * The dispatcher was bounded per pass (WEBHOOK_DISPATCH_BATCH), but emitEvent
 * started one detached claim-and-POST chain per matching webhook per event,
 * with no limit: a calibration scan over 500 due devices and one subscribed
 * webhook put 500 chains in flight at once. Now at most
 * WEBHOOK_EMIT_CONCURRENCY first attempts run per process; a row past the cap
 * gets no immediate attempt, and it is already due, so the dispatcher's next
 * pass sends it. Nothing is lost and nothing is queued in memory.
 */
// Shared objects, so a module loaded under jest.isolateModules sees the same
// mocks as the test.
const mockModels = {
  Webhook: { findAll: jest.fn(), findOne: jest.fn() },
  WebhookDelivery: { create: jest.fn(), findOne: jest.fn() },
  AuditLog: { create: jest.fn() },
};
const mockConfig = { db: { transaction: jest.fn(), query: jest.fn() } };
const mockLog = { logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } };
jest.mock("../../models", () => mockModels);
jest.mock("../../config", () => mockConfig);
jest.mock("../../middlewares/activityLog.middleware", () => mockLog);

const flush = () => new Promise((r) => setImmediate(r));

/** Load the service with WEBHOOK_EMIT_CONCURRENCY set to `value`. */
const load = (value) => {
  const saved = process.env.WEBHOOK_EMIT_CONCURRENCY;
  if (value === undefined) {
    delete process.env.WEBHOOK_EMIT_CONCURRENCY;
  } else {
    process.env.WEBHOOK_EMIT_CONCURRENCY = value;
  }
  let service;
  jest.isolateModules(() => {
    service = require("../../services/webhook.service");
  });
  if (saved === undefined) {
    delete process.env.WEBHOOK_EMIT_CONCURRENCY;
  } else {
    process.env.WEBHOOK_EMIT_CONCURRENCY = saved;
  }
  return service;
};

describe("W-17 — emitEvent caps its first attempts", () => {
  const { Webhook, WebhookDelivery } = mockModels;
  const { db } = mockConfig;
  let releases;

  beforeEach(() => {
    jest.clearAllMocks();
    releases = [];
    // Each claim hangs until released, so its slot stays taken; released, it
    // claims nothing (another replica got it), which settles the chain.
    db.query.mockImplementation(
      () => new Promise((resolve) => releases.push(() => resolve([[]]))),
    );
    let n = 0;
    WebhookDelivery.create.mockImplementation(async () => ({ id: `d${++n}` }));
    Webhook.findAll.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({ id: `w${i}`, tenantId: "t1", isActive: true })),
    );
  });

  it("writes a row for every webhook but starts at most WEBHOOK_EMIT_CONCURRENCY attempts; the rest are deferred", async () => {
    const service = load("2");

    const result = await service.emitEvent("t1", "device.overdue", {});

    expect(WebhookDelivery.create).toHaveBeenCalledTimes(5);
    expect(result).toEqual({ matched: 5, deferred: 3 });
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(service._emitInFlight()).toBe(2);
  });

  it("the cap is per process, across events: a second event while two are in flight starts none", async () => {
    const service = load("2");
    Webhook.findAll.mockResolvedValue([{ id: "w0", tenantId: "t1", isActive: true }]);

    await service.emitEvent("t1", "a", {});
    await service.emitEvent("t1", "b", {});
    const third = await service.emitEvent("t1", "c", {});

    expect(third).toEqual({ matched: 1, deferred: 1 });
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it("a slot is released when its attempt settles, so the next event's first attempt runs", async () => {
    const service = load("1");
    Webhook.findAll.mockResolvedValue([{ id: "w0", tenantId: "t1", isActive: true }]);

    await service.emitEvent("t1", "a", {});
    expect(service._emitInFlight()).toBe(1);
    releases.shift()();
    await flush();
    await flush();
    expect(service._emitInFlight()).toBe(0);

    const next = await service.emitEvent("t1", "b", {});
    expect(next).toEqual({ matched: 1 });
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it("a failed attempt releases its slot too", async () => {
    const service = load("1");
    Webhook.findAll.mockResolvedValue([{ id: "w0", tenantId: "t1", isActive: true }]);
    db.query.mockRejectedValueOnce(new Error("claim failed"));

    await service.emitEvent("t1", "a", {});
    await flush();
    await flush();

    expect(service._emitInFlight()).toBe(0);
  });

  it("WEBHOOK_EMIT_CONCURRENCY defaults to 10, and an invalid value falls back to it", () => {
    expect(load(undefined)._config.EMIT_CONCURRENCY).toBe(10);
    expect(load("0")._config.EMIT_CONCURRENCY).toBe(10);
    expect(load("-3")._config.EMIT_CONCURRENCY).toBe(10);
    expect(load("2.5")._config.EMIT_CONCURRENCY).toBe(10);
    expect(load("abc")._config.EMIT_CONCURRENCY).toBe(10);
    expect(load("25")._config.EMIT_CONCURRENCY).toBe(25);
  });
});
