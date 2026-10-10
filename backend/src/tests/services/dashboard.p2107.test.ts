/**
 * P21-07 (F-70, F-73, N-9; ADR-126 Am. 6) — the dashboard's new figures, in the service:
 *
 *  - `devices.byCondition`: one grouped count over the devices, every key present, a device with no
 *    condition (or a value outside the vocabulary) counted as `unset`, pg's bigint strings read as
 *    numbers; upstream "fit" is stored as `good` (D-03), so it needs no key of its own;
 *  - `ipm.sessionsLast30Days`: submitted visits performed in the last 30 days, in the tenant;
 *  - `ipm.due`: `countDue(tenant)` in a tenant view, null in the global view (the interval and zone
 *    are a tenant's).
 *
 * The models are doubles (their `where` observable); the facility scoping of every figure is proved
 * on PostgreSQL 18 by `dashboard.twoFacility.p2107.live`, the route by `routes/dashboard.twoFacility`.
 */
import Sequelize from "sequelize";

const mockCount = jest.fn();
const mockFindAll = jest.fn();
const mockCountDue = jest.fn();

jest.mock("../../models", () => {
  const model = (name: string): Record<string, unknown> => ({
    count: (options: Record<string, unknown>) => mockCount(name, options) as Promise<number>,
    sum: () => Promise.resolve(0),
    findAll: (options: Record<string, unknown>) => mockFindAll(name, options) as Promise<unknown[]>,
    findByPk: () => Promise.resolve(null),
  });
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the real Op and Sequelize inside a jest.mock factory
  const { Op, Sequelize: S } = require("sequelize") as typeof Sequelize;
  return {
    Op,
    Sequelize: S,
    ...Object.fromEntries(
      [
        "User",
        "Tenant",
        "CalibrationDevice",
        "CalibrationRecord",
        "Certificate",
        "Stock",
        "Warehouse",
        "StockTransfer",
        "StockOpname",
        "MaintenanceWorkOrder",
        "InspectionSession",
      ].map((name) => [name, model(name)]),
    ),
  };
});
jest.mock("../../services/ipmDue.service", () => ({
  countDue: (tenantId: string) => mockCountDue(tenantId) as Promise<unknown>,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const dashboard = require("../../services/dashboard.service") as {
  getDashboardMetrics: (tenantId?: string | null) => Promise<{ data: Record<string, Record<string, unknown>> }>;
};

const { Op } = Sequelize;
const T = "aaaaaaaa-0000-4000-8000-000000000001";

beforeEach(() => {
  mockCount.mockReset().mockResolvedValue(0);
  mockCountDue.mockReset().mockResolvedValue({ scheduled: 9, due: 4, neverInspected: 2 });
  mockFindAll.mockReset().mockImplementation((name: string, options: { group?: unknown[] }) => {
    if (name === "CalibrationDevice" && options.group?.[0] === "condition") {
      return Promise.resolve([
        { condition: "good", count: "5" },
        { condition: "broken", count: "2" },
        { condition: null, count: "3" },
        { condition: "lost", count: "1" },
      ]);
    }
    return Promise.resolve([]);
  });
});

describe("P21-07 — the dashboard's condition and IPM figures", () => {
  it("devices.byCondition: every key, null and unknown values as `unset`, bigint strings as numbers; scoped to the tenant", async () => {
    const { data } = await dashboard.getDashboardMetrics(T);
    expect(data["devices"]?.["byCondition"]).toEqual({ good: 5, not_good: 0, broken: 2, unset: 4 });
    const call = (mockFindAll.mock.calls as [string, { where: Record<string, unknown>; group?: unknown[] }][]).find(
      ([name, options]) => name === "CalibrationDevice" && options.group?.[0] === "condition",
    );
    expect(call?.[1].where).toEqual({ tenantId: T });
  });

  it("ipm: submitted visits of the last 30 days in the tenant, and the due counts of countDue(tenant)", async () => {
    mockCount.mockImplementation((name: string) => Promise.resolve(name === "InspectionSession" ? 6 : 0));
    const before = Date.now();
    const { data } = await dashboard.getDashboardMetrics(T);
    expect(data["ipm"]).toEqual({ sessionsLast30Days: 6, due: { scheduled: 9, due: 4, neverInspected: 2 } });
    expect(mockCountDue).toHaveBeenCalledWith(T);
    const [, options] = (mockCount.mock.calls as [string, { where: Record<string | symbol, unknown> }][]).find(([name]) => name === "InspectionSession") ?? [];
    expect(options?.where["tenantId"]).toBe(T);
    expect(options?.where["status"]).toBe("submitted");
    const since = (options?.where["performedAt"] as Record<symbol, Date>)[Op.gte] as Date;
    expect(before - since.getTime()).toBeGreaterThanOrEqual(30 * 24 * 3600 * 1000 - 1000);
    expect(before - since.getTime()).toBeLessThanOrEqual(30 * 24 * 3600 * 1000 + 1000);
  });

  it("the global view (super admin, no tenant): no due counts, every figure unscoped", async () => {
    const { data } = await dashboard.getDashboardMetrics(null);
    expect(data["ipm"]).toEqual({ sessionsLast30Days: 0, due: null });
    expect(mockCountDue).not.toHaveBeenCalled();
    expect(data["devices"]?.["byCondition"]).toEqual({ good: 5, not_good: 0, broken: 2, unset: 4 });
  });
});
