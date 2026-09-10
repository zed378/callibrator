/**
 * Stock validator tests
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
  validate,
  formatErrors,
} = require("../../validators/stock.validator");

const UUID = "8c352a92-d6cf-4b71-b0db-6e69622d1b11";

describe("Stock Validators", () => {
  describe("getStocksQuery", () => {
    it("should apply defaults", () => {
      const { value } = validate({}, getStocksQuery);
      expect(value.page).toBe(1);
      expect(value.limit).toBe(20);
    });

    it("should accept valid query params", () => {
      const { error, value } = validate(
        { page: "2", warehouseId: UUID, locationId: UUID },
        getStocksQuery,
      );
      expect(error).toBeUndefined();
      expect(value.page).toBe(2);
      expect(value.warehouseId).toBe(UUID);
    });
  });

  describe("stockIdSchema", () => {
    it("should validate a uuid stockId", () => {
      const { error } = validate({ stockId: UUID }, stockIdSchema);
      expect(error).toBeUndefined();
    });
  });

  describe("createStockSchema", () => {
    it("should validate a valid stock item", () => {
      const { error, value } = validate(
        { warehouseId: UUID, itemName: "Syringe", quantity: 10 },
        createStockSchema,
      );
      expect(error).toBeUndefined();
      expect(value.quantity).toBe(10);
    });

    it("should require itemName and warehouseId", () => {
      const { error } = validate({ quantity: 10 }, createStockSchema);
      expect(error).toBeDefined();
    });
  });

  describe("updateStockSchema", () => {
    it("should validate a partial update", () => {
      const { error, value } = validate({ quantity: 5 }, updateStockSchema);
      expect(error).toBeUndefined();
      expect(value.quantity).toBe(5);
    });
  });

  describe("createTransferSchema", () => {
    it("should validate a valid transfer", () => {
      const { error } = validate(
        {
          fromWarehouseId: UUID,
          toWarehouseId: UUID,
          itemName: "Syringe",
          quantity: 3,
        },
        createTransferSchema,
      );
      expect(error).toBeUndefined();
    });

    it("should reject quantity below 1", () => {
      const { error } = validate(
        {
          fromWarehouseId: UUID,
          toWarehouseId: UUID,
          itemName: "Syringe",
          quantity: 0,
        },
        createTransferSchema,
      );
      expect(error).toBeDefined();
    });
  });

  describe("updateTransferStatusSchema", () => {
    it("should validate a valid status", () => {
      const { error } = validate(
        { status: "completed" },
        updateTransferStatusSchema,
      );
      expect(error).toBeUndefined();
    });

    it("should reject an invalid status", () => {
      const { error } = validate(
        { status: "shipped" },
        updateTransferStatusSchema,
      );
      expect(error).toBeDefined();
    });
  });

  describe("createAdjustmentSchema", () => {
    it("should validate a valid adjustment", () => {
      const { error } = validate(
        { stockId: UUID, type: "addition", quantity: 5 },
        createAdjustmentSchema,
      );
      expect(error).toBeUndefined();
    });

    it("should reject an invalid type", () => {
      const { error } = validate(
        { stockId: UUID, type: "explode", quantity: 5 },
        createAdjustmentSchema,
      );
      expect(error).toBeDefined();
    });
  });

  describe("createOpnameSchema", () => {
    it("should validate a valid opname", () => {
      const { error } = validate(
        { warehouseId: UUID, scheduledAt: "2026-08-01T00:00:00Z" },
        createOpnameSchema,
      );
      expect(error).toBeUndefined();
    });
  });

  describe("updateOpnameStatusSchema", () => {
    it("should validate a valid status", () => {
      const { error } = validate(
        { status: "in_progress" },
        updateOpnameStatusSchema,
      );
      expect(error).toBeUndefined();
    });
  });

  describe("formatErrors", () => {
    it("should format validation error details", () => {
      const { error } = validate({}, createStockSchema);
      const formatted = formatErrors(error.details);
      expect(Array.isArray(formatted)).toBe(true);
      expect(formatted[0]).toHaveProperty("field");
      expect(formatted[0]).toHaveProperty("message");
    });

    it("should handle nested field paths", () => {
      const formatted = formatErrors([
        { path: ["warehouseId"], message: '"warehouseId" is required' },
      ]);
      expect(formatted[0].field).toBe("warehouseId");
    });

    it("should return empty array for empty input", () => {
      const formatted = formatErrors([]);
      expect(formatted).toEqual([]);
    });
  });
});
