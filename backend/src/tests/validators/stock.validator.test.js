/**
 * Stock validator tests
 *
 * P9-11 (ADR-093): the module's own validate/formatErrors helpers are gone;
 * the schemas are exercised through the shared checkInput (validators/input),
 * which answers { ok: true, value } or { ok: false, errors: [{ field, message }] }.
 */
const {
  getStocksQuery,
  stockIdSchema,
  createStockSchema,
  updateStockSchema,
  createTransferSchema,
  updateTransferStatusSchema,
  createAdjustmentSchema,
  createOpnameSchema,
  updateOpnameStatusSchema,
} = require("../../validators/stock.validator");
const { checkInput } = require("../../validators/input");

const UUID = "8c352a92-d6cf-4b71-b0db-6e69622d1b11";
const REQUIRED = "Invalid input: expected string, received undefined";

describe("Stock Validators", () => {
  describe("getStocksQuery", () => {
    it("should apply defaults", () => {
      expect(checkInput({}, getStocksQuery).value).toEqual({ page: 1, limit: 20 });
    });

    it("should accept valid query params", () => {
      const result = checkInput({ page: "2", warehouseId: UUID, locationId: UUID }, getStocksQuery);
      expect(result.ok).toBe(true);
      expect(result.value.page).toBe(2);
      expect(result.value.warehouseId).toBe(UUID);
    });

    it("should accept empty / null filters", () => {
      expect(checkInput({ find: "", warehouseId: "", locationId: null }, getStocksQuery).value).toEqual({
        page: 1,
        limit: 20,
        find: "",
        warehouseId: "",
        locationId: null,
      });
    });

    it.each([
      [{ page: "0" }, "page", "Too small: expected number to be >=1"],
      [{ page: "abc" }, "page", "Invalid input: expected number, received string"],
      [{ limit: "101" }, "limit", "Too big: expected number to be <=100"],
      [{ warehouseId: "bad" }, "warehouseId", "Invalid GUID"],
    ])("should reject %j", (query, field, message) => {
      expect(checkInput(query, getStocksQuery).errors).toEqual([{ field, message }]);
    });
  });

  describe("stockIdSchema", () => {
    it("should validate a uuid stockId", () => {
      expect(checkInput({ stockId: UUID }, stockIdSchema).ok).toBe(true);
    });

    it("should reject a non-uuid stockId", () => {
      expect(checkInput({ stockId: "x" }, stockIdSchema).errors).toEqual([{ field: "stockId", message: "Invalid GUID" }]);
    });
  });

  describe("createStockSchema", () => {
    it("should validate a valid stock item", () => {
      const result = checkInput({ warehouseId: UUID, itemName: "Syringe", quantity: 10 }, createStockSchema);
      expect(result.ok).toBe(true);
      expect(result.value.quantity).toBe(10);
      expect(result.value.minQuantity).toBe(0);
    });

    it("should trim, default and convert", () => {
      const result = checkInput(
        {
          warehouseId: UUID,
          itemName: "  Syringe  ",
          locationId: "",
          sku: "",
          serialNumber: null,
          description: "  d ",
          minQuantity: "1",
        },
        createStockSchema,
      );
      expect(result.value).toEqual({
        warehouseId: UUID,
        locationId: "",
        itemName: "Syringe",
        sku: "",
        serialNumber: null,
        quantity: 0,
        minQuantity: 1,
        description: "d",
      });
    });

    it("should require itemName and warehouseId", () => {
      expect(checkInput({ quantity: 10 }, createStockSchema).errors).toEqual([
        { field: "warehouseId", message: REQUIRED },
        { field: "itemName", message: REQUIRED },
      ]);
    });

    it("should reject a negative quantity", () => {
      expect(checkInput({ warehouseId: UUID, itemName: "Syringe", quantity: -1 }, createStockSchema).errors).toEqual([
        { field: "quantity", message: "Too small: expected number to be >=0" },
      ]);
    });

    it("should reject a sku over 100 characters", () => {
      expect(
        checkInput({ warehouseId: UUID, itemName: "Syringe", sku: "x".repeat(101) }, createStockSchema).errors,
      ).toEqual([{ field: "sku", message: "Too big: expected string to have <=100 characters" }]);
    });
  });

  describe("updateStockSchema", () => {
    it("should validate a partial update", () => {
      expect(checkInput({ quantity: 5 }, updateStockSchema)).toEqual({ ok: true, value: { quantity: 5 } });
    });

    it("should reject a short itemName", () => {
      expect(checkInput({ itemName: "a" }, updateStockSchema).errors).toEqual([
        { field: "itemName", message: "Too small: expected string to have >=2 characters" },
      ]);
    });

    it("should reject a fractional minQuantity", () => {
      expect(checkInput({ minQuantity: 1.5 }, updateStockSchema).errors).toEqual([
        { field: "minQuantity", message: "Invalid input: expected int, received number" },
      ]);
    });
  });

  describe("createTransferSchema", () => {
    const transfer = { fromWarehouseId: UUID, toWarehouseId: UUID, itemName: "Syringe", quantity: 3 };

    it("should validate a valid transfer", () => {
      expect(checkInput(transfer, createTransferSchema)).toEqual({ ok: true, value: transfer });
    });

    it("should reject quantity below 1", () => {
      expect(checkInput({ ...transfer, quantity: 0 }, createTransferSchema).errors).toEqual([
        { field: "quantity", message: "Too small: expected number to be >=1" },
      ]);
    });

    it("should list every missing field", () => {
      expect(checkInput({}, createTransferSchema).errors).toEqual([
        { field: "fromWarehouseId", message: REQUIRED },
        { field: "toWarehouseId", message: REQUIRED },
        { field: "itemName", message: REQUIRED },
        { field: "quantity", message: "Invalid input: expected number, received undefined" },
      ]);
    });
  });

  describe("updateTransferStatusSchema", () => {
    it("should validate a valid status", () => {
      expect(checkInput({ status: "completed" }, updateTransferStatusSchema).ok).toBe(true);
    });

    it("should reject an invalid status", () => {
      expect(checkInput({ status: "shipped" }, updateTransferStatusSchema).errors).toEqual([
        { field: "status", message: 'Invalid option: expected one of "pending"|"in_transit"|"completed"|"cancelled"' },
      ]);
    });
  });

  describe("createAdjustmentSchema", () => {
    it("should validate a valid adjustment, with its reason trimmed", () => {
      const result = checkInput(
        { stockId: UUID, type: "addition", quantity: 5, reason: "  found in audit  " },
        createAdjustmentSchema,
      );
      expect(result.ok).toBe(true);
      expect(result.value.reason).toBe("found in audit");
    });

    // P6-09 — a reason is required, and the abuse case: one that accepts an
    // empty string is not a reason.
    it.each([
      ["missing", {}, "Invalid input: expected string, received undefined"],
      ["null", { reason: null }, "Invalid input: expected string, received null"],
      ["empty", { reason: "" }, "Too small: expected string to have >=3 characters"],
      ["whitespace", { reason: "     " }, "Too small: expected string to have >=3 characters"],
      ["too short", { reason: "ok" }, "Too small: expected string to have >=3 characters"],
      ["too long", { reason: "x".repeat(256) }, "Too big: expected string to have <=255 characters"],
    ])("P6-09: refuses a %s reason", (_label, extra, message) => {
      const result = checkInput({ stockId: UUID, type: "addition", quantity: 5, ...extra }, createAdjustmentSchema);
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([{ field: "reason", message }]);
    });

    it("P6-09: a request with no body at all is refused, naming the reason (A-09)", () => {
      const result = checkInput(undefined, createAdjustmentSchema);
      expect(result.errors.map((e) => e.field)).toEqual(["stockId", "type", "quantity", "reason"]);
    });

    it("should reject an invalid type", () => {
      const result = checkInput({ stockId: UUID, type: "explode", quantity: 5 }, createAdjustmentSchema);
      expect(result.errors).toContainEqual({
        field: "type",
        message: 'Invalid option: expected one of "addition"|"subtraction"|"write_off"',
      });
    });
  });

  describe("createOpnameSchema", () => {
    it("should validate a valid opname", () => {
      const result = checkInput({ warehouseId: UUID, scheduledAt: "2026-08-01T00:00:00Z" }, createOpnameSchema);
      expect(result.ok).toBe(true);
      expect(result.value.scheduledAt).toEqual(new Date("2026-08-01T00:00:00.000Z"));
    });

    it("should reject a missing or non-ISO scheduledAt", () => {
      expect(checkInput({ warehouseId: UUID }, createOpnameSchema).errors).toEqual([
        { field: "scheduledAt", message: "Invalid input" },
      ]);
      expect(checkInput({ warehouseId: UUID, scheduledAt: "tomorrow" }, createOpnameSchema).errors).toEqual([
        { field: "scheduledAt", message: "Invalid input" },
      ]);
    });
  });

  describe("updateOpnameStatusSchema", () => {
    it("should validate a valid status", () => {
      expect(checkInput({ status: "in_progress" }, updateOpnameStatusSchema).ok).toBe(true);
    });

    it("should reject an invalid status", () => {
      expect(checkInput({ status: "done" }, updateOpnameStatusSchema).errors).toEqual([
        { field: "status", message: 'Invalid option: expected one of "draft"|"in_progress"|"completed"' },
      ]);
    });
  });
});
