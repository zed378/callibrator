jest.mock("../../models", () => ({
  AssetFinance: {
    findAndCountAll: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
  },
  CalibrationDevice: { findOne: jest.fn() },
  Vendor: {},
}));

const financeService = require("../../services/finance.service");
const { AssetFinance, CalibrationDevice } = require("../../models");

const asRow = (data) => ({ ...data, toJSON: () => ({ ...data }) });

const baseRecord = {
  id: "fin-1",
  tenantId: "t1",
  deviceId: "dev-1",
  purchasePrice: "10000.00",
  purchaseDate: "2020-01-01",
  salvageValue: "1000.00",
  usefulLifeYears: 5,
  depreciationMethod: "straight_line",
};

describe("finance.service", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("computeDepreciation", () => {
    it("straight line: half-life point depreciates half the base", () => {
      const asOf = new Date("2022-07-02"); // ~2.5 years after 2020-01-01
      const dep = financeService.computeDepreciation(baseRecord, asOf);
      // base = 9000, annual = 1800, accumulated ≈ 4500
      expect(dep.annualDepreciation).toBe(1800);
      expect(dep.accumulatedDepreciation).toBeGreaterThan(4400);
      expect(dep.accumulatedDepreciation).toBeLessThan(4600);
      expect(dep.bookValue).toBeCloseTo(10000 - dep.accumulatedDepreciation, 2);
      expect(dep.fullyDepreciated).toBe(false);
    });

    it("treats a missing purchase price and useful life as 0 and 1 year", () => {
      const dep = financeService.computeDepreciation(
        { purchaseDate: "2020-01-01", depreciationMethod: "straight_line" },
        new Date("2021-01-01"),
      );
      expect(dep.annualDepreciation).toBe(0);
      expect(dep.accumulatedDepreciation).toBe(0);
      expect(dep.bookValue).toBe(0);
      // life defaulted to 1 year, so a 1-year-old asset is fully depreciated
      expect(dep.ageYears).toBe(1);
      expect(dep.fullyDepreciated).toBe(true);
    });

    it("straight line: never depreciates below salvage value", () => {
      const asOf = new Date("2040-01-01"); // way past useful life
      const dep = financeService.computeDepreciation(baseRecord, asOf);
      expect(dep.accumulatedDepreciation).toBe(9000);
      expect(dep.bookValue).toBe(1000);
      expect(dep.fullyDepreciated).toBe(true);
    });

    it("straight line: zero age means zero accumulated depreciation", () => {
      const dep = financeService.computeDepreciation(
        baseRecord,
        new Date("2020-01-01"),
      );
      expect(dep.accumulatedDepreciation).toBe(0);
      expect(dep.bookValue).toBe(10000);
    });

    it("declining balance: floors at salvage value", () => {
      const record = {
        ...baseRecord,
        depreciationMethod: "declining_balance",
      };
      const dep = financeService.computeDepreciation(
        record,
        new Date("2050-01-01"),
      );
      expect(dep.bookValue).toBe(1000);
      expect(dep.fullyDepreciated).toBe(true);
    });

    it("declining balance: uses double-declining rate on book value", () => {
      const record = {
        ...baseRecord,
        depreciationMethod: "declining_balance",
      };
      const dep = financeService.computeDepreciation(
        record,
        new Date("2021-01-01"), // 1 year, rate = 0.4
      );
      // book ≈ 10000 * 0.6 = 6000
      expect(dep.bookValue).toBeGreaterThan(5900);
      expect(dep.bookValue).toBeLessThan(6100);
    });

    it("clamps salvage above price to price (no negative base)", () => {
      const record = { ...baseRecord, salvageValue: "20000.00" };
      const dep = financeService.computeDepreciation(
        record,
        new Date("2030-01-01"),
      );
      expect(dep.accumulatedDepreciation).toBe(0);
      expect(dep.bookValue).toBe(10000);
    });
  });

  describe("fetchAssetFinances", () => {
    it("returns paginated rows with computed depreciation", async () => {
      AssetFinance.findAndCountAll.mockResolvedValue({
        count: 1,
        rows: [asRow(baseRecord)],
      });
      const result = await financeService.fetchAssetFinances({
        tenantId: "t1",
        page: 1,
        limit: 10,
      });
      expect(result.status).toBe(200);
      expect(result.data.rows[0].depreciation).toBeDefined();
      expect(result.data.meta.total).toBe(1);
      expect(AssetFinance.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: "t1" } }),
      );
    });

    it("falls back to the default limit when limit is not a usable number", async () => {
      AssetFinance.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
      await financeService.fetchAssetFinances({
        tenantId: "t1",
        page: 1,
        limit: "not-a-number",
      });
      expect(AssetFinance.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 25, offset: 0 }),
      );
    });

    it("applies deviceId and method filters", async () => {
      AssetFinance.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
      await financeService.fetchAssetFinances({
        tenantId: "t1",
        deviceId: "dev-1",
        method: "straight_line",
      });
      expect(AssetFinance.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: "t1",
            deviceId: "dev-1",
            depreciationMethod: "straight_line",
          },
        }),
      );
    });
  });

  describe("getAssetFinanceById", () => {
    it("throws 404 when not found", async () => {
      AssetFinance.findOne.mockResolvedValue(null);
      await expect(
        financeService.getAssetFinanceById("t1", "missing"),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("returns the record with depreciation", async () => {
      AssetFinance.findOne.mockResolvedValue(asRow(baseRecord));
      const result = await financeService.getAssetFinanceById("t1", "fin-1");
      expect(result.data.depreciation.bookValue).toBeDefined();
    });
  });

  describe("createAssetFinance", () => {
    it("throws 404 when the device does not exist in the tenant", async () => {
      CalibrationDevice.findOne.mockResolvedValue(null);
      await expect(
        financeService.createAssetFinance("t1", { deviceId: "dev-x" }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("throws 409 when an active record already exists for the device", async () => {
      CalibrationDevice.findOne.mockResolvedValue({ id: "dev-1" });
      AssetFinance.findOne.mockResolvedValue({
        id: "fin-1",
        deletedAt: null,
      });
      await expect(
        financeService.createAssetFinance("t1", { deviceId: "dev-1" }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("creates a record and returns 201 with depreciation", async () => {
      CalibrationDevice.findOne.mockResolvedValue({ id: "dev-1" });
      AssetFinance.findOne.mockResolvedValue(null);
      AssetFinance.create.mockResolvedValue(asRow(baseRecord));
      const result = await financeService.createAssetFinance("t1", {
        deviceId: "dev-1",
        purchasePrice: 10000,
        purchaseDate: "2020-01-01",
        usefulLifeYears: 5,
      });
      expect(result.status).toBe(201);
      expect(result.data.depreciation).toBeDefined();
      expect(AssetFinance.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "t1", deviceId: "dev-1" }),
      );
    });

    it("revives a soft-deleted record instead of violating the unique index", async () => {
      CalibrationDevice.findOne.mockResolvedValue({ id: "dev-1" });
      const softDeleted = {
        ...asRow(baseRecord),
        deletedAt: new Date(),
        restore: jest.fn(),
        update: jest.fn(),
      };
      AssetFinance.findOne.mockResolvedValue(softDeleted);
      const result = await financeService.createAssetFinance("t1", {
        deviceId: "dev-1",
        purchasePrice: 5000,
        purchaseDate: "2024-01-01",
        usefulLifeYears: 4,
      });
      expect(softDeleted.restore).toHaveBeenCalled();
      expect(softDeleted.update).toHaveBeenCalled();
      expect(result.status).toBe(201);
    });
  });

  describe("updateAssetFinance", () => {
    it("throws 404 when not found", async () => {
      AssetFinance.findOne.mockResolvedValue(null);
      await expect(
        financeService.updateAssetFinance("t1", "missing", {}),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("updates and returns the record", async () => {
      const record = { ...asRow(baseRecord), update: jest.fn() };
      AssetFinance.findOne.mockResolvedValue(record);
      const result = await financeService.updateAssetFinance("t1", "fin-1", {
        usefulLifeYears: 6,
      });
      expect(record.update).toHaveBeenCalledWith({ usefulLifeYears: 6 });
      expect(result.status).toBe(200);
    });
  });

  describe("deleteAssetFinance", () => {
    it("throws 404 when not found", async () => {
      AssetFinance.findOne.mockResolvedValue(null);
      await expect(
        financeService.deleteAssetFinance("t1", "missing"),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("soft-deletes the record", async () => {
      const record = { destroy: jest.fn() };
      AssetFinance.findOne.mockResolvedValue(record);
      const result = await financeService.deleteAssetFinance("t1", "fin-1");
      expect(record.destroy).toHaveBeenCalled();
      expect(result.status).toBe(200);
    });
  });

  describe("getDepreciationReport", () => {
    it("throws 400 on an invalid asOf date", async () => {
      await expect(
        financeService.getDepreciationReport("t1", { asOf: "not-a-date" }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("aggregates totals and builds a CSV scaffold", async () => {
      AssetFinance.findAll.mockResolvedValue([
        {
          ...baseRecord,
          device: { name: "Ventilator A", serialNumber: "SN-1" },
        },
        {
          ...baseRecord,
          id: "fin-2",
          deviceId: "dev-2",
          purchasePrice: "5000.00",
          salvageValue: "0.00",
          device: { name: "Monitor B", serialNumber: "SN-2" },
        },
      ]);
      const result = await financeService.getDepreciationReport("t1", {
        asOf: "2021-01-01",
      });
      expect(result.data.count).toBe(2);
      expect(result.data.totals.totalPurchase).toBe(15000);
      expect(result.data.totals.totalBookValue).toBeLessThan(15000);
      expect(result.data.rows[0].deviceName).toBe("Ventilator A");
      expect(result.data.csv.split("\n")).toHaveLength(3);
    });

    it("defaults to an empty options object and reports as of now", async () => {
      AssetFinance.findAll.mockResolvedValue([]);
      const result = await financeService.getDepreciationReport("t1");
      expect(result.status).toBe(200);
      expect(result.data.count).toBe(0);
      expect(result.data.totals.totalPurchase).toBe(0);
      expect(AssetFinance.findAll).toHaveBeenCalledTimes(1);
    });

    it("handles missing device relation gracefully", async () => {
      AssetFinance.findAll.mockResolvedValue([{ ...baseRecord, device: null }]);
      const result = await financeService.getDepreciationReport("t1", {});
      expect(result.data.rows[0].deviceName).toBe("Unknown device");
    });
  });
});
