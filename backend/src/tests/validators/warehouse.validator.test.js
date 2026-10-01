/**
 * Warehouse validator tests
 */
const {
  getWarehousesQuery,
  warehouseIdSchema,
  locationIdSchema,
  createWarehouseSchema,
  updateWarehouseSchema,
  createLocationSchema,
  updateLocationSchema,
} = require("../../validators/warehouse.validator");
const { checkInput } = require("../../validators/input");

// P9-11: the schemas are Zod and the file's own validate()/formatErrors() are
// gone. `run` checks through the shared checkInput (strip-unknown, every issue
// listed, as the old options here were) and answers in the old
// `{ error, value }` shape, with `error` the `{ field, message }` list.
const run = (schema, data) => {
  const result = checkInput(data, schema);
  return result.ok ? { error: undefined, value: result.value } : { error: result.errors, value: undefined };
};

describe("Warehouse Validators", () => {
  describe("getWarehousesQuery", () => {
    it("should validate correct query parameters and apply defaults", () => {
      const data = {
        page: "2",
        limit: "15",
        find: "central",
        status: "active",
      };

      const { error, value } = run(getWarehousesQuery, data);

      expect(error).toBeUndefined();
      expect(value).toEqual({
        page: 2,
        limit: 15,
        find: "central",
        status: "active",
      });
    });

    it("should fold a status filter to lower case", () => {
      // P9-11 NORMALISATION DIFF: the old insensitive match returned the
      // listed spelling ("ACTIVE" and "Active" came back "ACTIVE"; this schema
      // had no lower-casing custom()). Zod folds every match to lower case,
      // the case the warehouses table stores.
      expect(run(getWarehousesQuery, { status: "ACTIVE" }).value.status).toBe("active");
      expect(run(getWarehousesQuery, { status: "Inactive" }).value.status).toBe("inactive");
    });

    it("should allow empty find and status", () => {
      const data = {
        find: "",
        status: null,
      };

      const { error, value } = run(getWarehousesQuery, data);

      expect(error).toBeUndefined();
      expect(value.find).toBe("");
      expect(value.status).toBeNull();
    });

    it("should reject invalid status", () => {
      const data = {
        status: "invalid_status",
      };

      const { error } = run(getWarehousesQuery, data);
      expect(error).toEqual([{ field: "status", message: "Invalid input" }]);
    });

    it("should accept an empty-string status", () => {
      expect(run(getWarehousesQuery, { status: "" }).value.status).toBe("");
    });

    it("should reject invalid page or limit", () => {
      const data = {
        page: "0",
        limit: "200",
      };

      const { error } = run(getWarehousesQuery, data);
      expect(error).toEqual([
        { field: "page", message: "Too small: expected number to be >=1" },
        { field: "limit", message: "Too big: expected number to be <=100" },
      ]);
    });
  });

  describe("warehouseIdSchema", () => {
    it("should validate correct uuid", () => {
      const data = {
        warehouseId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
      };

      const { error } = run(warehouseIdSchema, data);
      expect(error).toBeUndefined();
    });

    it("should reject invalid uuid or missing", () => {
      const data = {
        warehouseId: "not-a-uuid",
      };

      const { error } = run(warehouseIdSchema, data);
      expect(error).toBeDefined();
    });
  });

  describe("locationIdSchema", () => {
    it("should validate correct uuid", () => {
      const data = {
        locationId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
      };

      const { error } = run(locationIdSchema, data);
      expect(error).toBeUndefined();
    });

    it("should reject invalid uuid or missing", () => {
      const data = {
        locationId: "not-a-uuid",
      };

      const { error } = run(locationIdSchema, data);
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

      const { error, value } = run(createWarehouseSchema, data);

      expect(error).toBeUndefined();
      expect(value.status).toBe("active");
      expect(value.name).toBe("Central Warehouse");
    });

    it("should reject missing required fields name or code", () => {
      const data = {
        address: "123 Main St",
      };

      const { error } = run(createWarehouseSchema, data);
      expect(error).toEqual([
        { field: "name", message: "Invalid input: expected string, received undefined" },
        { field: "code", message: "Invalid input: expected string, received undefined" },
      ]);
    });

    it("should handle null status and type conversions gracefully", () => {
      const data = {
        name: "Central Warehouse",
        code: "WH-CTR",
        status: null,
      };

      const { error, value } = run(createWarehouseSchema, data);
      expect(error).toBeUndefined();
      expect(value.status).toBeNull();
    });
  });

  describe("createWarehouseSchema defaults and limits", () => {
    it("should default status to active and strip unknown fields", () => {
      expect(run(createWarehouseSchema, { name: "WH", code: "W1", tenantId: "x" }).value).toEqual({
        name: "WH",
        code: "W1",
        status: "active",
      });
    });

    it("should refuse an empty status and an over-long address", () => {
      expect(run(createWarehouseSchema, { name: "WH", code: "W1", status: "" }).error).toEqual([
        { field: "status", message: 'Invalid option: expected one of "active"|"inactive"' },
      ]);
      expect(run(createWarehouseSchema, { name: "WH", code: "W1", address: "a".repeat(501) }).error).toBeDefined();
    });
  });

  describe("updateWarehouseSchema", () => {
    it("should validate correct partial data", () => {
      const data = {
        name: "Updated WH Name",
        status: "INACTIVE",
      };

      const { error, value } = run(updateWarehouseSchema, data);

      expect(error).toBeUndefined();
      expect(value.status).toBe("inactive");
      expect(value.name).toBe("Updated WH Name");
    });

    it("should reject invalid fields", () => {
      const data = {
        name: "A", // too short (min 2)
      };

      const { error } = run(updateWarehouseSchema, data);
      expect(error).toBeDefined();
    });

    it("should validate correct partial data without status", () => {
      const data = {
        name: "Updated WH Name",
      };

      const { error, value } = run(updateWarehouseSchema, data);
      expect(error).toBeUndefined();
      expect(value.status).toBeUndefined();
    });

    it("should validate correct partial data with null status", () => {
      const data = {
        name: "Updated WH Name",
        status: null,
      };

      const { error, value } = run(updateWarehouseSchema, data);
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

      const { error, value } = run(createLocationSchema, data);

      expect(error).toBeUndefined();
      expect(value.name).toBe("Shelf A1");
      expect(value.isActive).toBe(true);
    });

    it("should reject missing warehouseId, name, or code", () => {
      const data = {
        name: "Shelf A1",
      };

      const { error } = run(createLocationSchema, data);
      expect(error.map((e) => e.field)).toEqual(["warehouseId", "code"]);
    });

    it("should default isActive to true and convert a boolean string", () => {
      const base = { warehouseId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11", name: "L1", code: "C1" };
      expect(run(createLocationSchema, base).value.isActive).toBe(true);
      expect(run(createLocationSchema, { ...base, isActive: "false" }).value.isActive).toBe(false);
    });
  });

  describe("updateLocationSchema", () => {
    it("should validate correct partial data", () => {
      const data = {
        code: "LOC-A1-UPDATED",
        isActive: false,
      };

      const { error, value } = run(updateLocationSchema, data);

      expect(error).toBeUndefined();
      expect(value.code).toBe("LOC-A1-UPDATED");
      expect(value.isActive).toBe(false);
    });
  });

  describe("updateLocationSchema refusals", () => {
    it("should refuse a non-boolean isActive", () => {
      expect(run(updateLocationSchema, { isActive: "no" }).error).toEqual([
        { field: "isActive", message: "Invalid input: expected boolean, received string" },
      ]);
    });
  });

  describe("id schemas (P9-11: formatErrors is gone; checkInput lists the issues)", () => {
    it("should report a missing id with its field", () => {
      expect(run(warehouseIdSchema, undefined).error).toEqual([
        { field: "warehouseId", message: "Invalid input: expected string, received undefined" },
      ]);
      expect(run(locationIdSchema, { locationId: "x" }).error).toEqual([
        { field: "locationId", message: "Invalid GUID" },
      ]);
    });
  });
});
