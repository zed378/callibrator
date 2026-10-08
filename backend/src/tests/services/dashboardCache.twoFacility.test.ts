/**
 * P21-09d — G-20 (spec P19-04 § 9.2; AM-18): the dashboard cache key carries the facility scope
 * from the CONTEXT. Two facilities of one tenant, and an unbound principal of the same tenant,
 * never share a key — nor a cached value.
 */
import { tenantStorage, type TenantContextStore } from "../../middlewares/tenantContext.middleware";
import type { ClientFacilityId, TenantId } from "../../types/ids";
import type * as DashboardCacheModule from "../../services/dashboardCache.service";

jest.mock("../../services/redis.service", () => ({
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve(false)),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- after the mock above
const cache = require("../../services/dashboardCache.service") as typeof DashboardCacheModule;

const T = "aaaaaaaa-0000-4000-8000-000000000001";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";

const as = <R>(store: Partial<TenantContextStore>, fn: () => R): R =>
  tenantStorage.run({ tenantId: T as TenantId, isSuperAdmin: false, isSystemTask: false, ...store }, fn);
const bound = (f: string): Partial<TenantContextStore> => ({ facilityBound: true, clientFacilityId: f as ClientFacilityId });
const keyFor = (store: Partial<TenantContextStore>): string | null =>
  as(store, () => cache.dashboardCacheKey({ superAdmin: false, tenantId: T }, T));

describe("G-20 dashboard:metrics:v2 — the facility scope in the key", () => {
  it("unbound `:all:`, bound `:f:<facility>:` — three different keys for one tenant", () => {
    const all = keyFor({ facilityBound: false });
    const f1 = keyFor(bound(F1));
    const f2 = keyFor(bound(F2));
    expect(all).toBe(`dashboard:metrics:v2:tenant:${T}:all:${T}`);
    expect(f1).toBe(`dashboard:metrics:v2:tenant:${T}:f:${F1}:${T}`);
    expect(f2).toBe(`dashboard:metrics:v2:tenant:${T}:f:${F2}:${T}`);
    expect(new Set([all, f1, f2]).size).toBe(3);
  });

  it("a bound principal with no facility gets the deny sentinel's segment, never `all`", () => {
    expect(keyFor({ facilityBound: true, clientFacilityId: null })).toBe(`dashboard:metrics:v2:tenant:${T}:f:00000000-0000-0000-0000-00000000f000:${T}`);
  });

  it("no context (a job) and the platform view keep their unbound / platform keys", () => {
    expect(cache.dashboardCacheKey({ superAdmin: false, tenantId: T }, T)).toBe(`dashboard:metrics:v2:tenant:${T}:all:${T}`);
    expect(as({ isSuperAdmin: true, ...bound(F1) }, () => cache.facilityScopeSegment())).toBe("all");
    expect(as(bound(F1), () => cache.dashboardCacheKey({ superAdmin: true, tenantId: T }, T))).toBe(`dashboard:metrics:v2:platform:${T}`);
  });

  it("F1's cached figures are never served to F2 or to the unbound view", async () => {
    const compute = (label: string) => jest.fn(() => Promise.resolve(label));
    const f1 = compute("F1");
    const f2 = compute("F2");
    const all = compute("ALL");
    expect(await as(bound(F1), () => cache.cachedDashboard(keyFor(bound(F1)), f1))).toBe("F1");
    expect(await as(bound(F2), () => cache.cachedDashboard(keyFor(bound(F2)), f2))).toBe("F2");
    expect(await cache.cachedDashboard(keyFor({}), all)).toBe("ALL");
    // A second F1 read is the cached F1 value (the in-process fallback), computed once.
    expect(await cache.cachedDashboard(keyFor(bound(F1)), compute("WRONG"))).toBe("F1");
    expect([f1.mock.calls.length, f2.mock.calls.length, all.mock.calls.length]).toEqual([1, 1, 1]);
  });
});
