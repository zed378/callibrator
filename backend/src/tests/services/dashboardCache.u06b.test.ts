/**
 * U-06b (ADR-120) — the dashboard's aggregates are cached for 30 s per scope,
 * never across tenants, in Redis with an in-process fallback.
 *
 * Before: every GET /dashboard/metrics ran the service's 21 aggregates
 * (43.5 ms of backend CPU per call, about 40% of the U-06 mix). The REAL
 * controller and the REAL cache module run here; the service is a spy that
 * answers each tenant's own figures, and Redis is an in-memory double with
 * expiry (or "down"), so what is asserted is what reaches the response.
 *
 * Fail-before: the cases marked [FB] failed against the pre-change controller
 * (it called the service on every request); the isolation cases are
 * preservation tests — they pass with no cache too, and pin that the cache
 * keeps them true.
 */
import type { Request, Response } from "express";
import type * as DashboardCacheModule from "../../services/dashboardCache.service";

interface StoredValue {
  value: string;
  expiresAt: number;
}

const mockRedis = {
  up: true,
  throwOnGet: false,
  store: new Map<string, StoredValue>(),
  setCalls: [] as { key: string; ttl: number }[],
};

jest.mock("../../services/redis.service", () => ({
  get: jest.fn((key: string) => {
    if (mockRedis.throwOnGet) {
      return Promise.reject(new Error("ECONNRESET"));
    }
    if (!mockRedis.up) {
      return Promise.resolve(null);
    }
    const hit = mockRedis.store.get(key);
    if (!hit || hit.expiresAt <= Date.now()) {
      return Promise.resolve(null);
    }
    return Promise.resolve(JSON.parse(hit.value) as unknown);
  }),
  set: jest.fn((key: string, value: unknown, ttl: number) => {
    if (!mockRedis.up) {
      return Promise.resolve(false);
    }
    mockRedis.setCalls.push({ key, ttl });
    mockRedis.store.set(key, { value: JSON.stringify(value), expiresAt: Date.now() + ttl * 1000 });
    return Promise.resolve(true);
  }),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../services/dashboard.service", () => ({ getDashboardMetrics: jest.fn() }));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as the jest.mock factories require */
const dashboardService = require("../../services/dashboard.service") as { getDashboardMetrics: jest.Mock };
const controller = require("../../controllers/dashboard.controller") as {
  getDashboardMetrics: (req: Request, res: Response, next: jest.Mock) => Promise<void>;
};
const cache = require("../../services/dashboardCache.service") as typeof DashboardCacheModule;
/* eslint-enable @typescript-eslint/no-require-imports */

const TENANT_A = "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4a";
const TENANT_B = "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4b";
const PLATFORM = "00000000-0000-4000-8000-000000000000";

/** Each tenant's own figures; the global view's are different again. */
const figuresFor = (tenantId: string | null): number =>
  tenantId === TENANT_A ? 111 : tenantId === TENANT_B ? 222 : tenantId === null ? 999 : 0;

let computedAt = 0;

const tenantUser = (tenantId: string, role = "HEALTHCARE ADMIN"): Record<string, unknown> => ({
  id: `user-${tenantId}`,
  tenantId,
  role: { id: "role-1", name: role },
});
const superAdmin = (): Record<string, unknown> => ({ id: "root", tenantId: PLATFORM, role: { id: "r0", name: "SUPERADMIN" } });

interface Sent {
  status: number;
  body: { success: boolean; data: { devices: { total: number }; generatedAt: string; scope: string } };
}

const call = async (user: Record<string, unknown>, query: Record<string, string> = {}): Promise<Sent> => {
  const sent: Partial<Sent> = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return res;
    },
    json(body: Sent["body"]) {
      sent.body = body;
      return res;
    },
  };
  const next = jest.fn();
  await controller.getDashboardMetrics({ user, query, params: {}, body: {} } as unknown as Request, res as unknown as Response, next);
  expect(next).not.toHaveBeenCalled();
  return sent as Sent;
};

beforeEach(() => {
  jest.useRealTimers();
  cache.clearDashboardCache();
  mockRedis.up = true;
  mockRedis.throwOnGet = false;
  mockRedis.store.clear();
  mockRedis.setCalls = [];
  computedAt = 0;
  dashboardService.getDashboardMetrics.mockReset();
  dashboardService.getDashboardMetrics.mockImplementation((tenantId: string | null) => {
    computedAt += 1;
    return Promise.resolve({
      success: true,
      status: 200,
      message: "Dashboard metrics fetched successfully",
      data: {
        scope: tenantId ? "tenant" : "global",
        generatedAt: new Date(Date.UTC(2030, 0, 1, 0, 0, computedAt)).toISOString(),
        devices: { total: figuresFor(tenantId) },
      },
    });
  });
});

describe("U-06b — the key never crosses a tenant", () => {
  it("gives two tenants, the platform's view of a tenant and the global view four different keys", () => {
    const a = cache.dashboardCacheKey({ superAdmin: false, tenantId: TENANT_A }, TENANT_A);
    const b = cache.dashboardCacheKey({ superAdmin: false, tenantId: TENANT_B }, TENANT_B);
    const platformA = cache.dashboardCacheKey({ superAdmin: true, tenantId: PLATFORM }, TENANT_A);
    const global = cache.dashboardCacheKey({ superAdmin: true, tenantId: PLATFORM }, null);
    expect(new Set([a, b, platformA, global]).size).toBe(4);
    expect(a).toContain(TENANT_A);
    expect(b).toContain(TENANT_B);
  });

  it("caches nothing for a target that is not a UUID, or a tenant principal aimed at another tenant", () => {
    expect(cache.dashboardCacheKey({ superAdmin: true, tenantId: PLATFORM }, "x' OR 1=1")).toBeNull();
    expect(cache.dashboardCacheKey({ superAdmin: false, tenantId: TENANT_A }, TENANT_B)).toBeNull();
    expect(cache.dashboardCacheKey({ superAdmin: false, tenantId: undefined }, TENANT_A)).toBeNull();
    expect(cache.dashboardCacheKey({ superAdmin: false, tenantId: "not-a-uuid" }, "not-a-uuid")).toBeNull();
  });
});

describe("U-06b — two tenants never see each other's cached figures", () => {
  it("serves each tenant its own figures, alternating, while both are cached", async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await call(tenantUser(TENANT_A))).body.data.devices.total).toBe(111);
      expect((await call(tenantUser(TENANT_B))).body.data.devices.total).toBe(222);
    }
  });

  it("does the same when Redis is down and the in-process fallback holds both", async () => {
    mockRedis.up = false;
    for (let i = 0; i < 3; i += 1) {
      expect((await call(tenantUser(TENANT_B))).body.data.devices.total).toBe(222);
      expect((await call(tenantUser(TENANT_A))).body.data.devices.total).toBe(111);
    }
  });

  it("never hands a tenant user the platform's cached global view, nor a ?tenantId= it does not own", async () => {
    expect((await call(superAdmin())).body.data.devices.total).toBe(999);
    // A tenant user's ?tenantId= is ignored (the controller pins its own tenant).
    const own = await call(tenantUser(TENANT_A), { tenantId: TENANT_B });
    expect(own.body.data.devices.total).toBe(111);
    expect(own.body.data.scope).toBe("tenant");
    expect((await call(tenantUser(TENANT_B))).body.data.devices.total).toBe(222);
  });

  it("[FB] keeps the platform's view of tenant A apart from tenant A's own entry", async () => {
    await call(superAdmin(), { tenantId: TENANT_A });
    await call(tenantUser(TENANT_A));
    const keys = mockRedis.setCalls.map((c) => c.key);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("U-06b — the 30-second TTL", () => {
  it("[FB] answers a second request inside the TTL from Redis without recomputing, with the first generatedAt", async () => {
    const first = await call(tenantUser(TENANT_A));
    const second = await call(tenantUser(TENANT_A, "TECHNICIAN"));
    expect(dashboardService.getDashboardMetrics).toHaveBeenCalledTimes(1);
    expect(second.body.data).toEqual(first.body.data);
    expect(second.body.data.generatedAt).toBe(first.body.data.generatedAt);
    expect(mockRedis.setCalls).toHaveLength(1);
    expect(mockRedis.setCalls[0]?.key).toContain(TENANT_A);
    expect(mockRedis.setCalls[0]?.ttl).toBe(30);
  });

  it("[FB] recomputes once the 30 s have passed (Redis)", async () => {
    jest.useFakeTimers({ now: Date.UTC(2030, 0, 1) });
    await call(tenantUser(TENANT_A));
    jest.setSystemTime(Date.UTC(2030, 0, 1) + 29_999);
    await call(tenantUser(TENANT_A));
    expect(dashboardService.getDashboardMetrics).toHaveBeenCalledTimes(1);
    jest.setSystemTime(Date.UTC(2030, 0, 1) + 30_000);
    const third = await call(tenantUser(TENANT_A));
    expect(dashboardService.getDashboardMetrics).toHaveBeenCalledTimes(2);
    expect(third.body.data.generatedAt).toBe(new Date(Date.UTC(2030, 0, 1, 0, 0, 2)).toISOString());
  });

  it("[FB] recomputes once the 30 s have passed (in-process fallback)", async () => {
    mockRedis.up = false;
    jest.useFakeTimers({ now: Date.UTC(2030, 0, 1) });
    await call(tenantUser(TENANT_A));
    jest.setSystemTime(Date.UTC(2030, 0, 1) + 29_999);
    await call(tenantUser(TENANT_A));
    expect(dashboardService.getDashboardMetrics).toHaveBeenCalledTimes(1);
    jest.setSystemTime(Date.UTC(2030, 0, 1) + 30_000);
    await call(tenantUser(TENANT_A));
    expect(dashboardService.getDashboardMetrics).toHaveBeenCalledTimes(2);
  });
});

describe("U-06b — a cache failure never fails the request", () => {
  it("[FB] answers from the in-process fallback while Redis is not ready", async () => {
    mockRedis.up = false;
    const first = await call(tenantUser(TENANT_A));
    const second = await call(tenantUser(TENANT_A));
    expect(first.status).toBe(200);
    expect(second.body.data).toEqual(first.body.data);
    expect(dashboardService.getDashboardMetrics).toHaveBeenCalledTimes(1);
  });

  it("answers 200 when a Redis read throws", async () => {
    mockRedis.throwOnGet = true;
    const sent = await call(tenantUser(TENANT_B));
    expect(sent.status).toBe(200);
    expect(sent.body.data.devices.total).toBe(222);
  });

  it("answers 200 when a Redis write throws, and keeps the value in process", async () => {
    const redis = jest.requireMock<{ set: jest.Mock }>("../../services/redis.service");
    redis.set.mockImplementationOnce(() => Promise.reject(new Error("READONLY")));
    mockRedis.up = true;
    expect((await call(tenantUser(TENANT_A))).status).toBe(200);
    await call(tenantUser(TENANT_A));
    expect(dashboardService.getDashboardMetrics).toHaveBeenCalledTimes(1);
  });

  it("still fails the request when the computation itself fails, and caches nothing", async () => {
    dashboardService.getDashboardMetrics.mockRejectedValueOnce(new Error("db down"));
    const next = jest.fn();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await controller.getDashboardMetrics(
      { user: tenantUser(TENANT_A), query: {}, params: {}, body: {} } as unknown as Request,
      res as unknown as Response,
      next,
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "db down" }));
    expect((await call(tenantUser(TENANT_A))).body.data.devices.total).toBe(111);
    expect(dashboardService.getDashboardMetrics).toHaveBeenCalledTimes(2);
  });
});

describe("U-06b — single flight and bounds", () => {
  it("[FB] computes once for concurrent misses on one key", async () => {
    const results = await Promise.all([call(tenantUser(TENANT_A)), call(tenantUser(TENANT_A)), call(tenantUser(TENANT_A))]);
    expect(dashboardService.getDashboardMetrics).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.body.data.devices.total)).toEqual([111, 111, 111]);
  });

  it("does not cache a super admin's non-UUID ?tenantId= (the call goes through every time)", async () => {
    await call(superAdmin(), { tenantId: "nope" });
    await call(superAdmin(), { tenantId: "nope" });
    expect(dashboardService.getDashboardMetrics).toHaveBeenCalledTimes(2);
    expect(mockRedis.setCalls).toHaveLength(0);
  });

  it("evicts the oldest scope beyond the in-process bound", async () => {
    mockRedis.up = false;
    const hex = (n: number): string => n.toString(16).padStart(12, "0");
    const ids = Array.from({ length: cache.DASHBOARD_LRU_MAX + 1 }, (_, i) => `0b7e6d5c-4a3b-4c2d-8e1f-${hex(i)}`);
    for (const id of ids) {
      await cache.cachedDashboard(cache.dashboardCacheKey({ superAdmin: true, tenantId: PLATFORM }, id), () => Promise.resolve(id));
    }
    const compute = jest.fn(() => Promise.resolve("recomputed"));
    // The first id was evicted; the last is still held.
    expect(await cache.cachedDashboard(cache.dashboardCacheKey({ superAdmin: true, tenantId: PLATFORM }, ids[0] as string), compute)).toBe("recomputed");
    expect(await cache.cachedDashboard(cache.dashboardCacheKey({ superAdmin: true, tenantId: PLATFORM }, ids[ids.length - 1] as string), compute)).toBe(ids[ids.length - 1]);
    expect(compute).toHaveBeenCalledTimes(1);
  });
});
