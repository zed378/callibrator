/**
 * Finance validator tests
 *
 * P9-11 (ADR-093): the schemas are Zod, exercised through the shared
 * `checkInput` helper (the file's own `validate` / `formatErrors` are gone).
 */
const { checkInput } = require("../../validators/input");
const { createAssetFinance, updateAssetFinance } = require("../../validators/finance.validator");

const DEVICE = "123e4567-e89b-12d3-a456-426614174000";
const VENDOR = "123e4567-e89b-12d3-a456-426614174001";
const METHOD_OPTION = 'Invalid option: expected one of "straight_line"|"declining_balance"';

/** A valid create body, with `overrides` applied (an `undefined` override removes the key). */
const body = (overrides = {}) => {
  const data = { deviceId: DEVICE, purchasePrice: 10000, purchaseDate: "2026-01-01", usefulLifeYears: 5, ...overrides };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete data[key];
    }
  }
  return data;
};

describe("Finance Validators", () => {
  describe("createAssetFinance", () => {
    it("should validate correct asset finance data", () => {
      const result = checkInput(body(), createAssetFinance);

      expect(result.ok).toBe(true);
      expect(result.value.purchasePrice).toBe(10000);
      expect(result.value.usefulLifeYears).toBe(5);
      expect(result.value.purchaseDate).toEqual(new Date("2026-01-01"));
    });

    it("should validate with default salvage value", () => {
      const result = checkInput(body(), createAssetFinance);

      expect(result.ok).toBe(true);
      expect(result.value.salvageValue).toBe(0);
    });

    it("should validate with default depreciation method", () => {
      const result = checkInput(body(), createAssetFinance);

      expect(result.ok).toBe(true);
      expect(result.value.depreciationMethod).toBe("straight_line");
    });

    it("should validate with custom depreciation method", () => {
      const result = checkInput(body({ depreciationMethod: "declining_balance" }), createAssetFinance);

      expect(result.ok).toBe(true);
      expect(result.value.depreciationMethod).toBe("declining_balance");
    });

    it("should validate with all fields", () => {
      const result = checkInput(
        body({
          salvageValue: 1000,
          depreciationMethod: "straight_line",
          vendorId: VENDOR,
          invoiceNumber: "INV-001",
          notes: "Asset notes",
        }),
        createAssetFinance,
      );

      expect(result.ok).toBe(true);
    });

    it("converts numeric strings and trims the invoice number", () => {
      const result = checkInput(
        body({ purchasePrice: "10000", usefulLifeYears: "5", invoiceNumber: "  INV-001  " }),
        createAssetFinance,
      );

      expect(result.value).toMatchObject({ purchasePrice: 10000, usefulLifeYears: 5, invoiceNumber: "INV-001" });
    });

    it("should reject missing device ID", () => {
      const result = checkInput(body({ deviceId: undefined }), createAssetFinance);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([
        { field: "deviceId", message: "Invalid input: expected string, received undefined" },
      ]);
    });

    it("should reject missing purchase price", () => {
      const result = checkInput(body({ purchasePrice: undefined }), createAssetFinance);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([
        { field: "purchasePrice", message: "Invalid input: expected number, received undefined" },
      ]);
    });

    it("should reject negative purchase price", () => {
      const result = checkInput(body({ purchasePrice: -100 }), createAssetFinance);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([{ field: "purchasePrice", message: "Too small: expected number to be >=0" }]);
    });

    it("should reject missing purchase date", () => {
      const result = checkInput(body({ purchaseDate: undefined }), createAssetFinance);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([{ field: "purchaseDate", message: "Invalid input" }]);
    });

    it("should reject invalid purchase date", () => {
      const result = checkInput(body({ purchaseDate: "not-a-date" }), createAssetFinance);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([{ field: "purchaseDate", message: "Invalid input" }]);
    });

    it("should reject useful life outside range (too low)", () => {
      const result = checkInput(body({ usefulLifeYears: 0 }), createAssetFinance);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([{ field: "usefulLifeYears", message: "Too small: expected number to be >=1" }]);
    });

    it("should reject useful life outside range (too high)", () => {
      const result = checkInput(body({ usefulLifeYears: 51 }), createAssetFinance);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([{ field: "usefulLifeYears", message: "Too big: expected number to be <=50" }]);
    });

    it("should reject invalid depreciation method", () => {
      const result = checkInput(body({ depreciationMethod: "invalid" }), createAssetFinance);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([{ field: "depreciationMethod", message: METHOD_OPTION }]);
    });

    it("should reject invalid vendor UUID", () => {
      const result = checkInput(body({ vendorId: "not-a-uuid" }), createAssetFinance);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([{ field: "vendorId", message: "Invalid GUID" }]);
    });
  });

  describe("updateAssetFinance", () => {
    it("should validate partial update", () => {
      expect(checkInput({ purchasePrice: 15000 }, updateAssetFinance)).toEqual({
        ok: true,
        value: { purchasePrice: 15000 },
      });
    });

    it("should validate empty object", () => {
      expect(checkInput({}, updateAssetFinance)).toEqual({ ok: true, value: {} });
    });

    it("accepts an ISO date-time purchase date as a Date", () => {
      expect(checkInput({ purchaseDate: "2026-01-01T10:00:00Z" }, updateAssetFinance).value.purchaseDate).toEqual(
        new Date("2026-01-01T10:00:00Z"),
      );
    });

    it("should reject invalid depreciation method", () => {
      const result = checkInput({ depreciationMethod: "invalid" }, updateAssetFinance);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([{ field: "depreciationMethod", message: METHOD_OPTION }]);
    });

    it("should reject invalid vendor UUID", () => {
      const result = checkInput({ vendorId: "not-a-uuid" }, updateAssetFinance);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([{ field: "vendorId", message: "Invalid GUID" }]);
    });
  });
});
