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
  Op,
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

    // D-24: the database groups by month (UTC); the service fills the gaps.
    const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const monthsAgo = (n) => {
      const d = new Date();
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1));
    };

    it("returns 6 zeroed buckets, oldest first, when there are no rows", async () => {
      zeroAll();
      CalibrationRecord.findAll.mockResolvedValue([]);

      const result = await getDashboardMetrics("tenant-1");
      const trend = result.data.trends.calibrations;

      expect(trend).toHaveLength(6);
      expect(trend.every((b) => b.count === 0)).toBe(true);
      expect(trend[5].month).toBe(monthKey(new Date()));
      expect(trend[0].month).toBe(monthKey(monthsAgo(5)));
    });

    it("places each grouped row in its month, reading COUNT (a bigint string) as a number", async () => {
      zeroAll();
      CalibrationRecord.findAll.mockResolvedValue([
        { month: monthKey(monthsAgo(0)), count: "2" },
        { month: monthKey(monthsAgo(1)), count: "1" },
      ]);

      const result = await getDashboardMetrics("tenant-1");
      const byMonth = Object.fromEntries(result.data.trends.calibrations.map((b) => [b.month, b.count]));

      expect(byMonth[monthKey(monthsAgo(0))]).toBe(2);
      expect(byMonth[monthKey(monthsAgo(1))]).toBe(1);
    });

    it("ignores a grouped row outside the window", async () => {
      zeroAll();
      CalibrationRecord.findAll.mockResolvedValue([{ month: "2000-01", count: "9" }]);

      const result = await getDashboardMetrics("tenant-1");
      const trend = result.data.trends.calibrations;

      expect(trend.every((b) => b.count === 0)).toBe(true);
      expect(trend.map((b) => b.month)).not.toContain("2000-01");
    });

    it("buckets months in the connection's timezone (+07:00): 03:00 WIB on 1 September is September", async () => {
      zeroAll();
      jest.useFakeTimers({ now: new Date("2026-08-31T20:00:00Z"), doNotFake: ["nextTick", "setImmediate"] });
      CalibrationRecord.sequelize = { options: { timezone: "+07:00" } };
      CalibrationRecord.findAll.mockResolvedValue([{ month: "2026-09", count: "4" }]);
      try {
        const result = await getDashboardMetrics("tenant-1");
        const trend = result.data.trends.calibrations;
        expect(trend.map((b) => b.month)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
        expect(trend[5].count).toBe(4);
        // The window opens at 00:00 WIB on 1 April = 17:00 UTC on 31 March.
        const where = CalibrationRecord.findAll.mock.calls.map(([o]) => o.where).find((w) => w.calibrationDate);
        expect(where.calibrationDate[Op.gte]).toEqual(new Date("2026-03-31T17:00:00Z"));
      } finally {
        delete CalibrationRecord.sequelize;
        jest.useRealTimers();
      }
    });

    it("handles a negative offset (-05:00): 21:00 on 31 August there is still August", async () => {
      zeroAll();
      jest.useFakeTimers({ now: new Date("2026-09-01T02:00:00Z"), doNotFake: ["nextTick", "setImmediate"] });
      CalibrationRecord.sequelize = { options: { timezone: "-05:00" } };
      CalibrationRecord.findAll.mockResolvedValue([]);
      try {
        const result = await getDashboardMetrics("tenant-1");
        expect(result.data.trends.calibrations[5].month).toBe("2026-08");
      } finally {
        delete CalibrationRecord.sequelize;
        jest.useRealTimers();
      }
    });

    it("treats a timezone it cannot read (a zone name) as UTC", async () => {
      zeroAll();
      jest.useFakeTimers({ now: new Date("2026-08-31T20:00:00Z"), doNotFake: ["nextTick", "setImmediate"] });
      CalibrationRecord.sequelize = { options: { timezone: "Asia/Jakarta" } };
      CalibrationRecord.findAll.mockResolvedValue([]);
      try {
        const result = await getDashboardMetrics("tenant-1");
        expect(result.data.trends.calibrations[5].month).toBe("2026-08");
      } finally {
        delete CalibrationRecord.sequelize;
        jest.useRealTimers();
      }
    });

    it("asks the database for one row per month: GROUP BY to_char(date_trunc('month', <column>)), from the window start", async () => {
      zeroAll();
      CalibrationRecord.findAll.mockResolvedValue([]);
      CalibrationRecord.rawAttributes = { calibrationDate: { field: "calibration_date" } };
      Sequelize.col.mockImplementation((name) => ({ col: name }));
      Sequelize.fn.mockImplementation((name, ...args) => ({ fn: name, args }));

      try {
        await getDashboardMetrics("tenant-1");
      } finally {
        delete CalibrationRecord.rawAttributes;
      }

      const trendCall = (Model) =>
        Model.findAll.mock.calls.map(([o]) => o).find((o) => Array.isArray(o.attributes) && o.attributes.some((a) => a[1] === "month"));
      const options = trendCall(CalibrationRecord);
      const month = {
        fn: "to_char",
        args: [{ fn: "date_trunc", args: ["month", { col: "calibration_date" }] }, "YYYY-MM"],
      };
      expect(options.attributes).toEqual([
        [month, "month"],
        [{ fn: "COUNT", args: [{ col: "id" }] }, "count"],
      ]);
      expect(options.group).toEqual([month]);
      expect(options.raw).toBe(true);
      expect(options.where).toMatchObject({ tenantId: "tenant-1" });
      expect(options.where.calibrationDate[Op.gte]).toEqual(monthsAgo(5));
      // Certificates have no rawAttributes here: the attribute name is the column.
      expect(trendCall(Certificate).group).toEqual([
        { fn: "to_char", args: [{ fn: "date_trunc", args: ["month", { col: "createdAt" }] }, "YYYY-MM"] },
      ]);
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
