/**
 * Warehouse validator tests
 */
const {
  validate,
  formatErrors,
  getWarehousesQuery,
  warehouseIdSchema,
  locationIdSchema,
  createWarehouseSchema,
  updateWarehouseSchema,
  createLocationSchema,
  updateLocationSchema,
} = require("../../validators/warehouse.validator");

describe("Warehouse Validators", () => {
  describe("getWarehousesQuery", () => {
    it("should validate correct query parameters and apply defaults", () => {
      const data = {
        page: "2",
        limit: "15",
        find: "central",
        status: "active",
      };

      const { error, value } = validate(data, getWarehousesQuery);

      expect(error).toBeUndefined();
      expect(value).toEqual({
        page: 2,
        limit: 15,
        find: "central",
        status: "active",
      });
    });

    it("should allow empty find and status", () => {
      const data = {
        find: "",
        status: null,
      };

      const { error, value } = validate(data, getWarehousesQuery);

      expect(error).toBeUndefined();
      expect(value.find).toBe("");
      expect(value.status).toBeNull();
    });

    it("should reject invalid status", () => {
      const data = {
        status: "invalid_status",
      };

      const { error } = validate(data, getWarehousesQuery);
      expect(error).toBeDefined();
    });

    it("should reject invalid page or limit", () => {
      const data = {
        page: "0",
        limit: "200",
      };

      const { error } = validate(data, getWarehousesQuery);
      expect(error).toBeDefined();
    });
  });

  describe("warehouseIdSchema", () => {
    it("should validate correct uuid", () => {
      const data = {
        warehouseId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
      };

      const { error } = validate(data, warehouseIdSchema);
      expect(error).toBeUndefined();
    });

    it("should reject invalid uuid or missing", () => {
      const data = {
        warehouseId: "not-a-uuid",
      };

      const { error } = validate(data, warehouseIdSchema);
      expect(error).toBeDefined();
    });
  });

  describe("locationIdSchema", () => {
    it("should validate correct uuid", () => {
      const data = {
        locationId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
      };

      const { error } = validate(data, locationIdSchema);
      expect(error).toBeUndefined();
    });

    it("should reject invalid uuid or missing", () => {
      const data = {
        locationId: "not-a-uuid",
      };

      const { error } = validate(data, locationIdSchema);
      expect(error).toBeDefined();
    });
  });

  describe("createWarehouseSchema", () => {
    it("should validate correct data and lowercase status", () => {
      const data = {
        name: "Central Warehouse",
        code: "WH-CTR",
        address: "123 Main St",
        description: "Main storage",
        status: "ACTIVE",
      };

      const { error, value } = validate(data, createWarehouseSchema);

      expect(error).toBeUndefined();
      expect(value.status).toBe("active");
      expect(value.name).toBe("Central Warehouse");
    });

    it("should reject missing required fields name or code", () => {
      const data = {
        address: "123 Main St",
      };

      const { error } = validate(data, createWarehouseSchema);
      expect(error).toBeDefined();
      expect(error.details).toHaveLength(2);
    });

    it("should handle null status and type conversions gracefully", () => {
      const data = {
        name: "Central Warehouse",
        code: "WH-CTR",
        status: null,
      };

      const { error, value } = validate(data, createWarehouseSchema);
      expect(error).toBeUndefined();
      expect(value.status).toBeNull();
    });
  });

  describe("updateWarehouseSchema", () => {
    it("should validate correct partial data", () => {
      const data = {
        name: "Updated WH Name",
        status: "INACTIVE",
      };

      const { error, value } = validate(data, updateWarehouseSchema);

      expect(error).toBeUndefined();
      expect(value.status).toBe("inactive");
      expect(value.name).toBe("Updated WH Name");
    });

    it("should reject invalid fields", () => {
      const data = {
        name: "A", // too short (min 2)
      };

      const { error } = validate(data, updateWarehouseSchema);
      expect(error).toBeDefined();
    });

    it("should validate correct partial data without status", () => {
      const data = {
        name: "Updated WH Name",
      };

      const { error, value } = validate(data, updateWarehouseSchema);
      expect(error).toBeUndefined();
      expect(value.status).toBeUndefined();
    });

    it("should validate correct partial data with null status", () => {
      const data = {
        name: "Updated WH Name",
        status: null,
      };

      const { error, value } = validate(data, updateWarehouseSchema);
      expect(error).toBeUndefined();
      expect(value.status).toBeNull();
    });
  });

  describe("createLocationSchema", () => {
    it("should validate correct data", () => {
      const data = {
        warehouseId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
        name: "Shelf A1",
        code: "LOC-A1",
        description: "Top shelf",
        isActive: true,
      };

      const { error, value } = validate(data, createLocationSchema);

      expect(error).toBeUndefined();
      expect(value.name).toBe("Shelf A1");
      expect(value.isActive).toBe(true);
    });

    it("should reject missing warehouseId, name, or code", () => {
      const data = {
        name: "Shelf A1",
      };

      const { error } = validate(data, createLocationSchema);
      expect(error).toBeDefined();
    });
  });

  describe("updateLocationSchema", () => {
    it("should validate correct partial data", () => {
      const data = {
        code: "LOC-A1-UPDATED",
        isActive: false,
      };

      const { error, value } = validate(data, updateLocationSchema);

      expect(error).toBeUndefined();
      expect(value.code).toBe("LOC-A1-UPDATED");
      expect(value.isActive).toBe(false);
    });
  });

  describe("formatErrors", () => {
    it("should format errors correctly", () => {
      const details = [
        { path: ["name"], message: "Name is required" },
        { path: ["code"], message: "Code is required" },
      ];

      const formatted = formatErrors(details);
      expect(formatted).toEqual([
        { field: "name", message: "Name is required" },
        { field: "code", message: "Code is required" },
      ]);
    });
  });
});
