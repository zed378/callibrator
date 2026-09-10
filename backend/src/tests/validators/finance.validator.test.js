/**
 * Finance validator tests
 */
const {
  createAssetFinance,
  updateAssetFinance,
  validate,
  formatErrors,
} = require("../../validators/finance.validator");

describe("Finance Validators", () => {
  describe("createAssetFinance", () => {
    it("should validate correct asset finance data", () => {
      const { error, value } = validate({
        deviceId: "123e4567-e89b-12d3-a456-426614174000",
        purchasePrice: 10000,
        purchaseDate: "2026-01-01",
        usefulLifeYears: 5,
      }, createAssetFinance);

      expect(error).toBeUndefined();
      expect(value.purchasePrice).toBe(10000);
      expect(value.usefulLifeYears).toBe(5);
    });

    it("should validate with default salvage value", () => {
      const { error, value } = validate({
        deviceId: "123e4567-e89b-12d3-a456-426614174000",
        purchasePrice: 10000,
        purchaseDate: "2026-01-01",
        usefulLifeYears: 5,
      }, createAssetFinance);

      expect(error).toBeUndefined();
      expect(value.salvageValue).toBe(0);
    });

    it("should validate with default depreciation method", () => {
      const { error, value } = validate({
        deviceId: "123e4567-e89b-12d3-a456-426614174000",
        purchasePrice: 10000,
        purchaseDate: "2026-01-01",
        usefulLifeYears: 5,
      }, createAssetFinance);

      expect(error).toBeUndefined();
      expect(value.depreciationMethod).toBe("straight_line");
    });

    it("should validate with custom depreciation method", () => {
      const { error, value } = validate({
        deviceId: "123e4567-e89b-12d3-a456-426614174000",
        purchasePrice: 10000,
        purchaseDate: "2026-01-01",
        usefulLifeYears: 5,
        depreciationMethod: "declining_balance",
      }, createAssetFinance);

      expect(error).toBeUndefined();
      expect(value.depreciationMethod).toBe("declining_balance");
    });

    it("should validate with all fields", () => {
      const { error } = validate({
        deviceId: "123e4567-e89b-12d3-a456-426614174000",
        purchasePrice: 10000,
        purchaseDate: "2026-01-01",
        salvageValue: 1000,
        usefulLifeYears: 5,
        depreciationMethod: "straight_line",
        vendorId: "123e4567-e89b-12d3-a456-426614174001",
        invoiceNumber: "INV-001",
        notes: "Asset notes",
      }, createAssetFinance);

      expect(error).toBeUndefined();
    });

    it("should reject missing device ID", () => {
      const { error } = validate({
        purchasePrice: 10000,
        purchaseDate: "2026-01-01",
        usefulLifeYears: 5,
      }, createAssetFinance);

      expect(error).toBeDefined();
    });

    it("should reject missing purchase price", () => {
      const { error } = validate({
        deviceId: "123e4567-e89b-12d3-a456-426614174000",
        purchaseDate: "2026-01-01",
        usefulLifeYears: 5,
      }, createAssetFinance);

      expect(error).toBeDefined();
    });

    it("should reject negative purchase price", () => {
      const { error } = validate({
        deviceId: "123e4567-e89b-12d3-a456-426614174000",
        purchasePrice: -100,
        purchaseDate: "2026-01-01",
        usefulLifeYears: 5,
      }, createAssetFinance);

      expect(error).toBeDefined();
    });

    it("should reject missing purchase date", () => {
      const { error } = validate({
        deviceId: "123e4567-e89b-12d3-a456-426614174000",
        purchasePrice: 10000,
        usefulLifeYears: 5,
      }, createAssetFinance);

      expect(error).toBeDefined();
    });

    it("should reject invalid purchase date", () => {
      const { error } = validate({
        deviceId: "123e4567-e89b-12d3-a456-426614174000",
        purchasePrice: 10000,
        purchaseDate: "not-a-date",
        usefulLifeYears: 5,
      }, createAssetFinance);

      expect(error).toBeDefined();
    });

    it("should reject useful life outside range (too low)", () => {
      const { error } = validate({
        deviceId: "123e4567-e89b-12d3-a456-426614174000",
        purchasePrice: 10000,
        purchaseDate: "2026-01-01",
        usefulLifeYears: 0,
      }, createAssetFinance);

      expect(error).toBeDefined();
    });

    it("should reject useful life outside range (too high)", () => {
      const { error } = validate({
        deviceId: "123e4567-e89b-12d3-a456-426614174000",
        purchasePrice: 10000,
        purchaseDate: "2026-01-01",
        usefulLifeYears: 51,
      }, createAssetFinance);

      expect(error).toBeDefined();
    });

    it("should reject invalid depreciation method", () => {
      const { error } = validate({
        deviceId: "123e4567-e89b-12d3-a456-426614174000",
        purchasePrice: 10000,
        purchaseDate: "2026-01-01",
        usefulLifeYears: 5,
        depreciationMethod: "invalid",
      }, createAssetFinance);

      expect(error).toBeDefined();
    });

    it("should reject invalid vendor UUID", () => {
      const { error } = validate({
        deviceId: "123e4567-e89b-12d3-a456-426614174000",
        purchasePrice: 10000,
        purchaseDate: "2026-01-01",
        usefulLifeYears: 5,
        vendorId: "not-a-uuid",
      }, createAssetFinance);

      expect(error).toBeDefined();
    });
  });

  describe("updateAssetFinance", () => {
    it("should validate partial update", () => {
      const { error } = validate({ purchasePrice: 15000 }, updateAssetFinance);

      expect(error).toBeUndefined();
    });

    it("should validate empty object", () => {
      const { error } = validate({}, updateAssetFinance);

      expect(error).toBeUndefined();
    });

    it("should reject invalid depreciation method", () => {
      const { error } = validate({ depreciationMethod: "invalid" }, updateAssetFinance);

      expect(error).toBeDefined();
    });

    it("should reject invalid vendor UUID", () => {
      const { error } = validate({ vendorId: "not-a-uuid" }, updateAssetFinance);

      expect(error).toBeDefined();
    });
  });

  describe("formatErrors", () => {
    it("should format error details correctly", () => {
      const details = [
        { path: ["deviceId"], message: "deviceId is required" },
        { path: ["purchasePrice"], message: "purchasePrice must be a number" },
      ];

      const result = formatErrors(details);

      expect(result).toEqual([
        { field: "deviceId", message: "deviceId is required" },
        { field: "purchasePrice", message: "purchasePrice must be a number" },
      ]);
    });

    it("should handle nested field paths", () => {
      const details = [{ path: ["finance", "asset", "price"], message: "Price is required" }];

      const result = formatErrors(details);

      expect(result).toEqual([
        { field: "finance.asset.price", message: "Price is required" },
      ]);
    });

    it("should return empty array for empty input", () => {
      const result = formatErrors([]);

      expect(result).toEqual([]);
    });
  });
});