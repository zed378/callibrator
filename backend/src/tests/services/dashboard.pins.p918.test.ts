/**
 * P9-18 (dashboard): two behaviours no suite pinned, found by planted
 * defects during the conversion.
 *
 * - runBounded stops starting tasks once one has failed. That is its
 *   documented contract ("tasks not yet started are then not started"): a
 *   failing dashboard should not keep putting queries on the pool.
 * - "overdue" and "due soon" count ACTIVE devices only. A retired or
 *   out-of-service device is not due for calibration.
 */
import Sequelize from "sequelize";

const mockCount = jest.fn();
const mockFindAll = jest.fn();

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
    User: model("User"),
    Tenant: model("Tenant"),
    CalibrationDevice: model("CalibrationDevice"),
    CalibrationRecord: model("CalibrationRecord"),
    Certificate: model("Certificate"),
    Stock: model("Stock"),
    Warehouse: model("Warehouse"),
    StockTransfer: model("StockTransfer"),
    StockOpname: model("StockOpname"),
    MaintenanceWorkOrder: model("MaintenanceWorkOrder"),
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factory above
const dashboard = require("../../services/dashboard.service") as {
  getDashboardMetrics: (tenantId?: string | null) => Promise<{ data: Record<string, unknown> }>;
  runBounded: <T>(tasks: (() => Promise<T>)[], limit: number) => Promise<T[]>;
};

const { Op } = Sequelize;

beforeEach(() => {
  mockCount.mockReset().mockResolvedValue(0);
  mockFindAll.mockReset().mockImplementation((name: string, options: { group?: unknown }) => {
    if (name === "Tenant") {
      return Promise.resolve([{ id: "t1", name: "A", code: "a", status: "active" }]);
    }
    if (options.group) {
      return Promise.resolve([
        { tenantId: "t1", count: "5" },
        { tenantId: null, count: "1" },
      ]);
    }
    return Promise.resolve([]);
  });
});

describe("dashboard — pinned behaviours", () => {
  it("runBounded starts no new task after one has failed", async () => {
    const started: number[] = [];
    const task = (i: number) => async (): Promise<number> => {
      started.push(i);
      await new Promise((resolve) => setImmediate(resolve));
      if (i === 0) {
        throw new Error("first failed");
      }
      return i;
    };
    // Two workers: 0 and 1 start together; 0 fails; the worker that ran 1
    // must not then start 2.
    await expect(dashboard.runBounded([0, 1, 2, 3, 4].map(task), 2)).rejects.toThrow("first failed");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started).toEqual([0, 1]);
  });

  it("due-soon and overdue count active devices only", async () => {
    await dashboard.getDashboardMetrics("t1");
    const deviceWheres = (mockCount.mock.calls as [string, { where: Record<string | symbol, unknown> }][])
      .filter(([name, options]) => name === "CalibrationDevice" && "nextCalibrationDate" in options.where)
      .map(([, options]) => options.where);
    expect(deviceWheres).toHaveLength(2);
    for (const where of deviceWheres) {
      expect(where["status"]).toBe("active");
      expect(where["tenantId"]).toBe("t1");
    }
    const ranges = deviceWheres.map((w) => Object.getOwnPropertySymbols(w["nextCalibrationDate"] as object));
    expect(ranges).toEqual([[Op.between], [Op.lt]]);
  });
});
