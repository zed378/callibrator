// eslint-disable-next-line no-undef
jest.mock("../../models", () => ({
  Op: {
    between: Symbol("between"),
    lt: Symbol("lt"),
    gte: Symbol("gte"),
    lte: Symbol("lte"),
    in: Symbol("in"),
  },
  Sequelize: {
    fn: jest.fn(),
    col: jest.fn(),
  },
  User: {
    count: jest.fn(),
    findAll: jest.fn(),
  },
  Tenant: {
    count: jest.fn(),
    findByPk: jest.fn(),
    findAll: jest.fn(),
  },
  CalibrationDevice: {
    count: jest.fn(),
    findAll: jest.fn(),
  },
  CalibrationRecord: {
    count: jest.fn(),
    findAll: jest.fn(),
  },
  Certificate: {
    count: jest.fn(),
    findAll: jest.fn(),
  },
  Stock: {
    count: jest.fn(),
    sum: jest.fn(),
  },
  Warehouse: {
    count: jest.fn(),
  },
  StockTransfer: {
    count: jest.fn(),
  },
  StockOpname: {
    count: jest.fn(),
  },
  MaintenanceWorkOrder: {
    count: jest.fn(),
  },
}));

const {
  User,
  Tenant,
  CalibrationDevice,
  CalibrationRecord,
  Certificate,
  Stock,
  Warehouse,
  StockTransfer,
  StockOpname,
  MaintenanceWorkOrder,
  Sequelize,
} = require("../../models");
const { getDashboardMetrics } = require("../../services/dashboard.service");

describe("dashboard.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset Sequelize mocks
    Sequelize.fn.mockReset();
    Sequelize.col.mockReset();
  });

  describe("getDashboardMetrics", () => {
    it("should return tenant-scoped metrics when tenantId provided", async () => {
      User.count.mockImplementation(({ where }) => {
        if (where && where.isEmailVerified !== undefined) {
          return Promise.resolve(5);
        }
        return Promise.resolve(10);
      });
      CalibrationDevice.count.mockImplementation(({ where }) => {
        if (where && where.status === "active") {
          return Promise.resolve(3);
        }
        return Promise.resolve(8);
      });
      CalibrationDevice.findAll.mockResolvedValue([]);
      CalibrationRecord.count.mockImplementation(({ where }) => {
        if (where && where.isCompliant !== undefined) {
          return Promise.resolve(7);
        }
        return Promise.resolve(15);
      });
      CalibrationRecord.findAll.mockResolvedValue([]);
      Certificate.count.mockResolvedValue(5);
      Certificate.findAll.mockResolvedValue([]);
      Stock.count.mockResolvedValue(20);
      Stock.sum.mockResolvedValue(500);
      Stock.count.mockImplementation(({ where }) => {
        if (where && where.quantity) {
          return Promise.resolve(3);
        }
        return Promise.resolve(20);
      });
      Warehouse.count.mockResolvedValue(2);
      StockTransfer.count.mockResolvedValue(2);
      StockOpname.count.mockResolvedValue(1);
      MaintenanceWorkOrder.count.mockResolvedValue(3);
      Tenant.findByPk.mockResolvedValue({
        id: "tenant-1",
        name: "Test Tenant",
        code: "TT",
        status: "active",
      });

      const result = await getDashboardMetrics("tenant-1");

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.data.scope).toBe("tenant");
      expect(result.data.users.total).toBe(10);
      expect(result.data.users.verified).toBe(5);
      expect(result.data.devices.total).toBe(8);
      expect(result.data.calibrations.total).toBe(15);
      expect(result.data.calibrations.compliant).toBe(7);
      expect(result.data.tenant).toEqual({
        id: "tenant-1",
        name: "Test Tenant",
        code: "TT",
        status: "active",
      });
    });

    it("should return global metrics when tenantId is null", async () => {
      User.count.mockImplementation(({ where }) => {
        if (where && where.isEmailVerified !== undefined) {
          return Promise.resolve(50);
        }
        return Promise.resolve(100);
      });
      CalibrationDevice.count.mockImplementation(({ where }) => {
        if (where && where.status === "active") {
          return Promise.resolve(30);
        }
        return Promise.resolve(80);
      });
      CalibrationDevice.findAll.mockResolvedValue([]);
      CalibrationRecord.count.mockImplementation(({ where }) => {
        if (where && where.isCompliant !== undefined) {
          return Promise.resolve(70);
        }
        return Promise.resolve(150);
      });
      CalibrationRecord.findAll.mockResolvedValue([]);
      Certificate.count.mockResolvedValue(50);
      Certificate.findAll.mockResolvedValue([]);
      Stock.count.mockResolvedValue(200);
      Stock.sum.mockResolvedValue(5000);
      Stock.count.mockImplementation(({ where }) => {
        if (where && where.quantity) {
          return Promise.resolve(30);
        }
        return Promise.resolve(200);
      });
      Warehouse.count.mockResolvedValue(10);
      StockTransfer.count.mockResolvedValue(20);
      StockOpname.count.mockResolvedValue(5);
      MaintenanceWorkOrder.count.mockResolvedValue(15);

      Tenant.count.mockResolvedValue(5);
      Tenant.count.mockImplementation((opts) => {
        const { where } = opts || {};
        if (where && where.status === "active") {
          return Promise.resolve(4);
        }
        return Promise.resolve(5);
      });
      Tenant.findAll.mockResolvedValue([
        { id: "tenant-1", name: "Tenant 1", code: "T1", status: "active" },
        { id: "tenant-2", name: "Tenant 2", code: "T2", status: "active" },
      ]);
      User.findAll.mockResolvedValue([
        { tenantId: "tenant-1", count: "50" },
        { tenantId: "tenant-2", count: "30" },
      ]);
      CalibrationDevice.findAll.mockResolvedValue([
        { tenantId: "tenant-1", count: "40" },
        { tenantId: "tenant-2", count: "20" },
      ]);

      const result = await getDashboardMetrics();

      expect(result.success).toBe(true);
      expect(result.data.scope).toBe("global");
      expect(result.data.tenants.total).toBe(5);
      expect(result.data.tenants.active).toBe(4);
      expect(result.data.tenantBreakdown).toHaveLength(2);
      expect(result.data.tenantBreakdown[0].users).toBe(50);
      expect(result.data.tenantBreakdown[0].devices).toBe(40);
    });

    it("should calculate compliance rate correctly", async () => {
      User.count.mockResolvedValue(10);
      CalibrationDevice.count.mockResolvedValue(5);
      CalibrationRecord.count.mockImplementation(({ where }) => {
        if (where && where.isCompliant !== undefined) {
          return Promise.resolve(7);
        }
        return Promise.resolve(10);
      });
      CalibrationRecord.findAll.mockResolvedValue([]);
      Certificate.count.mockResolvedValue(0);
      Stock.count.mockResolvedValue(0);
      Stock.sum.mockResolvedValue(0);
      Stock.count.mockResolvedValue(0);
      Warehouse.count.mockResolvedValue(0);
      StockTransfer.count.mockResolvedValue(0);
      StockOpname.count.mockResolvedValue(0);
      MaintenanceWorkOrder.count.mockResolvedValue(0);
      Tenant.findByPk.mockResolvedValue(null);

      const result = await getDashboardMetrics("tenant-1");

      expect(result.data.calibrations.complianceRate).toBe(70);
    });

    it("should return null compliance rate when no calibrations", async () => {
      User.count.mockResolvedValue(10);
      CalibrationDevice.count.mockResolvedValue(5);
      CalibrationRecord.count.mockResolvedValue(0);
      CalibrationRecord.findAll.mockResolvedValue([]);
      Certificate.count.mockResolvedValue(0);
      Stock.count.mockResolvedValue(0);
      Stock.sum.mockResolvedValue(0);
      Stock.count.mockResolvedValue(0);
      Warehouse.count.mockResolvedValue(0);
      StockTransfer.count.mockResolvedValue(0);
      StockOpname.count.mockResolvedValue(0);
      MaintenanceWorkOrder.count.mockResolvedValue(0);
      Tenant.findByPk.mockResolvedValue(null);

      const result = await getDashboardMetrics("tenant-1");

      expect(result.data.calibrations.complianceRate).toBeNull();
    });

    it("should handle tenant not found in tenant scope", async () => {
      User.count.mockResolvedValue(0);
      CalibrationDevice.count.mockResolvedValue(0);
      CalibrationRecord.count.mockResolvedValue(0);
      CalibrationRecord.findAll.mockResolvedValue([]);
      Certificate.count.mockResolvedValue(0);
      Stock.count.mockResolvedValue(0);
      Stock.sum.mockResolvedValue(0);
      Stock.count.mockResolvedValue(0);
      Warehouse.count.mockResolvedValue(0);
      StockTransfer.count.mockResolvedValue(0);
      StockOpname.count.mockResolvedValue(0);
      MaintenanceWorkOrder.count.mockResolvedValue(0);
      Tenant.findByPk.mockResolvedValue(null);

      const result = await getDashboardMetrics("nonexistent");

      expect(result.data.tenant).toBeNull();
    });

    it("should include trends in response", async () => {
      User.count.mockResolvedValue(10);
      CalibrationDevice.count.mockResolvedValue(5);
      CalibrationRecord.count.mockResolvedValue(0);
      CalibrationRecord.findAll.mockResolvedValue([
        { month: "2026-01", count: 5 },
        { month: "2026-02", count: 10 },
      ]);
      Certificate.count.mockResolvedValue(0);
      Certificate.findAll.mockResolvedValue([
        { month: "2026-01", count: 2 },
        { month: "2026-02", count: 4 },
      ]);
      Stock.count.mockResolvedValue(0);
      Stock.sum.mockResolvedValue(0);
      Stock.count.mockResolvedValue(0);
      Warehouse.count.mockResolvedValue(0);
      StockTransfer.count.mockResolvedValue(0);
      StockOpname.count.mockResolvedValue(0);
      MaintenanceWorkOrder.count.mockResolvedValue(0);
      Tenant.findByPk.mockResolvedValue(null);

      const result = await getDashboardMetrics("tenant-1");

      expect(result.data.trends.calibrations).toHaveLength(6);
      expect(result.data.trends.certificates).toHaveLength(6);
    });

    it("should include inventory metrics", async () => {
      User.count.mockResolvedValue(10);
      CalibrationDevice.count.mockResolvedValue(5);
      CalibrationRecord.count.mockResolvedValue(0);
      CalibrationRecord.findAll.mockResolvedValue([]);
      Certificate.count.mockResolvedValue(0);
      Stock.count.mockResolvedValue(20);
      Stock.sum.mockResolvedValue(500);
      Stock.count.mockImplementation(({ where }) => {
        if (where && where.quantity) {
          return Promise.resolve(3);
        }
        return Promise.resolve(20);
      });
      Warehouse.count.mockResolvedValue(2);
      StockTransfer.count.mockResolvedValue(2);
      StockOpname.count.mockResolvedValue(1);
      MaintenanceWorkOrder.count.mockResolvedValue(3);
      Tenant.findByPk.mockResolvedValue(null);

      const result = await getDashboardMetrics("tenant-1");

      expect(result.data.inventory.stockItems).toBe(20);
      expect(result.data.inventory.totalQuantity).toBe(500);
      expect(result.data.inventory.lowStockItems).toBe(3);
      expect(result.data.inventory.warehouses).toBe(2);
      expect(result.data.inventory.pendingTransfers).toBe(2);
      expect(result.data.inventory.openOpnames).toBe(1);
    });

    it("should handle zero totalQuantity", async () => {
      User.count.mockResolvedValue(10);
      CalibrationDevice.count.mockResolvedValue(5);
      CalibrationRecord.count.mockResolvedValue(0);
      CalibrationRecord.findAll.mockResolvedValue([]);
      Certificate.count.mockResolvedValue(0);
      Stock.count.mockResolvedValue(0);
      Stock.sum.mockResolvedValue(null);
      Stock.count.mockResolvedValue(0);
      Warehouse.count.mockResolvedValue(0);
      StockTransfer.count.mockResolvedValue(0);
      StockOpname.count.mockResolvedValue(0);
      MaintenanceWorkOrder.count.mockResolvedValue(0);
      Tenant.findByPk.mockResolvedValue(null);

      const result = await getDashboardMetrics("tenant-1");

      expect(result.data.inventory.totalQuantity).toBe(0);
    });
  });

  // ================================================================
  // Coverage: monthlyTrend bucketing + remaining defaults
  // ================================================================
  describe("monthlyTrend bucketing", () => {
    // Zero everything so only the trend inputs matter.
    const zeroAll = () => {
      User.count.mockResolvedValue(0);
      CalibrationDevice.count.mockResolvedValue(0);
      CalibrationDevice.findAll.mockResolvedValue([]);
      CalibrationRecord.count.mockResolvedValue(0);
      Certificate.count.mockResolvedValue(0);
      Certificate.findAll.mockResolvedValue([]);
      Stock.count.mockResolvedValue(0);
      Stock.sum.mockResolvedValue(0);
      Warehouse.count.mockResolvedValue(0);
      StockTransfer.count.mockResolvedValue(0);
      StockOpname.count.mockResolvedValue(0);
      MaintenanceWorkOrder.count.mockResolvedValue(0);
      Tenant.findByPk.mockResolvedValue(null);
    };

    const monthKey = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    it("returns 6 zeroed buckets, oldest first, when there are no rows", async () => {
      zeroAll();
      CalibrationRecord.findAll.mockResolvedValue([]);

      const result = await getDashboardMetrics("tenant-1");
      const trend = result.data.trends.calibrations;

      expect(trend).toHaveLength(6);
      expect(trend.every((b) => b.count === 0)).toBe(true);
      expect(trend[5].month).toBe(monthKey(new Date()));
    });

    it("counts rows into their calendar-month bucket", async () => {
      zeroAll();
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 10);

      CalibrationRecord.findAll.mockResolvedValue([
        { calibrationDate: thisMonth },
        { calibrationDate: thisMonth },
        { calibrationDate: lastMonth },
      ]);

      const result = await getDashboardMetrics("tenant-1");
      const trend = result.data.trends.calibrations;
      const byMonth = Object.fromEntries(trend.map((b) => [b.month, b.count]));

      expect(byMonth[monthKey(thisMonth)]).toBe(2);
      expect(byMonth[monthKey(lastMonth)]).toBe(1);
    });

    it("skips rows whose date field is null", async () => {
      zeroAll();
      CalibrationRecord.findAll.mockResolvedValue([
        { calibrationDate: null },
        { calibrationDate: undefined },
      ]);

      const result = await getDashboardMetrics("tenant-1");

      expect(
        result.data.trends.calibrations.every((b) => b.count === 0),
      ).toBe(true);
    });

    it("ignores rows that fall outside the 6-month window", async () => {
      zeroAll();
      const old = new Date(2000, 0, 15);
      CalibrationRecord.findAll.mockResolvedValue([{ calibrationDate: old }]);

      const result = await getDashboardMetrics("tenant-1");
      const trend = result.data.trends.calibrations;

      expect(trend).toHaveLength(6);
      expect(trend.every((b) => b.count === 0)).toBe(true);
      expect(trend.map((b) => b.month)).not.toContain("2000-01");
    });

    it("parses date strings as well as Date objects", async () => {
      zeroAll();
      const now = new Date();
      const iso = new Date(now.getFullYear(), now.getMonth(), 5).toISOString();
      Certificate.findAll.mockResolvedValue([{ createdAt: iso }]);

      const result = await getDashboardMetrics("tenant-1");
      const byMonth = Object.fromEntries(
        result.data.trends.certificates.map((b) => [b.month, b.count]),
      );

      expect(byMonth[monthKey(now)]).toBe(1);
    });
  });

  describe("complianceRate", () => {
    const zeroAllExceptCalibrations = () => {
      User.count.mockResolvedValue(0);
      CalibrationDevice.count.mockResolvedValue(0);
      CalibrationDevice.findAll.mockResolvedValue([]);
      CalibrationRecord.findAll.mockResolvedValue([]);
      Certificate.count.mockResolvedValue(0);
      Certificate.findAll.mockResolvedValue([]);
      Stock.count.mockResolvedValue(0);
      Stock.sum.mockResolvedValue(0);
      Warehouse.count.mockResolvedValue(0);
      StockTransfer.count.mockResolvedValue(0);
      StockOpname.count.mockResolvedValue(0);
      MaintenanceWorkOrder.count.mockResolvedValue(0);
      Tenant.findByPk.mockResolvedValue(null);
    };

    it("is null when there are no calibrations (no divide-by-zero)", async () => {
      zeroAllExceptCalibrations();
      CalibrationRecord.count.mockResolvedValue(0);

      const result = await getDashboardMetrics("tenant-1");

      expect(result.data.calibrations.complianceRate).toBeNull();
    });

    it("is rounded to one decimal place", async () => {
      zeroAllExceptCalibrations();
      // total=3 (first count call), compliant=1 (second) → 33.333% → 33.3
      CalibrationRecord.count
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);

      const result = await getDashboardMetrics("tenant-1");

      expect(result.data.calibrations.complianceRate).toBe(33.3);
    });
  });

  describe("global tenant breakdown edge cases", () => {
    const zeroGlobal = () => {
      User.count.mockResolvedValue(0);
      CalibrationDevice.count.mockResolvedValue(0);
      CalibrationRecord.count.mockResolvedValue(0);
      CalibrationRecord.findAll.mockResolvedValue([]);
      Certificate.count.mockResolvedValue(0);
      Certificate.findAll.mockResolvedValue([]);
      Stock.count.mockResolvedValue(0);
      Stock.sum.mockResolvedValue(0);
      Warehouse.count.mockResolvedValue(0);
      StockTransfer.count.mockResolvedValue(0);
      StockOpname.count.mockResolvedValue(0);
      MaintenanceWorkOrder.count.mockResolvedValue(0);
      Tenant.count.mockResolvedValue(0);
    };

    it("zeroes tenants that have no rows in the group-by result", async () => {
      zeroGlobal();
      CalibrationDevice.findAll.mockResolvedValue([]);
      Tenant.findAll.mockResolvedValue([
        { id: "tenant-1", name: "Has users", code: "T1", status: "active" },
        { id: "tenant-2", name: "Empty", code: "T2", status: "active" },
      ]);
      User.findAll.mockResolvedValue([{ tenantId: "tenant-1", count: "7" }]);

      const result = await getDashboardMetrics();

      expect(result.data.tenantBreakdown).toEqual([
        { id: "tenant-1", name: "Has users", code: "T1", status: "active", users: 7, devices: 0 },
        { id: "tenant-2", name: "Empty", code: "T2", status: "active", users: 0, devices: 0 },
      ]);
    });

    it("ignores group-by rows with a null tenantId", async () => {
      zeroGlobal();
      CalibrationDevice.findAll.mockResolvedValue([]);
      Tenant.findAll.mockResolvedValue([
        { id: "tenant-1", name: "Tenant 1", code: "T1", status: "active" },
      ]);
      // A NULL tenant_id aggregate row must not become a breakdown entry.
      User.findAll.mockResolvedValue([
        { tenantId: null, count: "3" },
        { tenantId: "tenant-1", count: "4" },
      ]);

      const result = await getDashboardMetrics();

      expect(result.data.tenantBreakdown).toHaveLength(1);
      expect(result.data.tenantBreakdown[0].users).toBe(4);
    });

    it("returns an empty breakdown when there are no tenants", async () => {
      zeroGlobal();
      CalibrationDevice.findAll.mockResolvedValue([]);
      Tenant.findAll.mockResolvedValue([]);
      User.findAll.mockResolvedValue([]);

      const result = await getDashboardMetrics();

      expect(result.data.scope).toBe("global");
      expect(result.data.tenantBreakdown).toEqual([]);
      expect(result.data).not.toHaveProperty("tenant");
    });
  });
});
