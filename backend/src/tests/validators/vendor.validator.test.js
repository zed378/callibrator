/**
 * Vendor validator tests
 */
const {
  createVendor,
  updateVendor,
  validate,
  formatErrors,
} = require("../../validators/vendor.validator");

describe("Vendor Validators", () => {
  describe("createVendor", () => {
    it("should validate correct vendor data", () => {
      const data = {
        name: "Acme Calibration Lab",
      };

      const result = createVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
      expect(result.value.name).toBe("Acme Calibration Lab");
    });

    it("should validate with default type", () => {
      const data = {
        name: "Acme Calibration Lab",
      };

      const result = createVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
      expect(result.value.type).toBe("Other");
    });

    it("should validate with default status", () => {
      const data = {
        name: "Acme Calibration Lab",
      };

      const result = createVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
      expect(result.value.status).toBe("Active");
    });

    it("should validate with CalibrationLab type", () => {
      const data = {
        name: "Acme Calibration Lab",
        type: "CalibrationLab",
      };

      const result = createVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should validate with PartsSupplier type", () => {
      const data = {
        name: "Acme Parts Supplier",
        type: "PartsSupplier",
      };

      const result = createVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should validate with Inactive status", () => {
      const data = {
        name: "Acme Parts Supplier",
        status: "Inactive",
      };

      const result = createVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should validate with contact person", () => {
      const data = {
        name: "Acme Parts Supplier",
        contactPerson: "John Doe",
      };

      const result = createVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should validate with email", () => {
      const data = {
        name: "Acme Parts Supplier",
        email: "contact@acme.com",
      };

      const result = createVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should validate with phone", () => {
      const data = {
        name: "Acme Parts Supplier",
        phone: "+1-555-123-4567",
      };

      const result = createVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should validate with address", () => {
      const data = {
        name: "Acme Parts Supplier",
        address: "123 Main St, City, Country",
      };

      const result = createVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should validate with notes", () => {
      const data = {
        name: "Acme Parts Supplier",
        notes: "Preferred vendor for calibration equipment",
      };

      const result = createVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should reject missing name", () => {
      const data = {};

      const result = createVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeDefined();
    });

    it("should reject name too short", () => {
      const data = {
        name: "A",
      };

      const result = createVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeDefined();
    });

    it("should reject name too long", () => {
      const data = {
        name: "a".repeat(101),
      };

      const result = createVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeDefined();
    });

    it("should reject invalid type", () => {
      const data = {
        name: "Acme",
        type: "InvalidType",
      };

      const result = createVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeDefined();
    });

    it("should reject invalid email", () => {
      const data = {
        name: "Acme",
        email: "not-an-email",
      };

      const result = createVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeDefined();
    });

    it("should accept null contactPerson", () => {
      const data = {
        name: "Acme",
        contactPerson: null,
      };

      const result = createVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should accept empty string contactPerson", () => {
      const data = {
        name: "Acme",
        contactPerson: "",
      };

      const result = createVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should trim whitespace from name", () => {
      const data = {
        name: "  Acme Calibration Lab  ",
      };

      const result = createVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
      expect(result.value.name).toBe("Acme Calibration Lab");
    });
  });

  describe("updateVendor", () => {
    it("should validate partial update with name", () => {
      const data = {
        name: "Updated Name",
      };

      const result = updateVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should validate with rating", () => {
      const data = {
        name: "Updated Name",
        rating: 4,
      };

      const result = updateVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should validate with minimum rating", () => {
      const data = {
        rating: 1,
      };

      const result = updateVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should validate with maximum rating", () => {
      const data = {
        rating: 5,
      };

      const result = updateVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should validate with null rating", () => {
      const data = {
        rating: null,
      };

      const result = updateVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should reject rating below minimum", () => {
      const data = {
        rating: 0,
      };

      const result = updateVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeDefined();
    });

    it("should reject rating above maximum", () => {
      const data = {
        rating: 6,
      };

      const result = updateVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeDefined();
    });

    it("should validate with all fields", () => {
      const data = {
        name: "Updated Name",
        type: "CalibrationLab",
        contactPerson: "Jane Doe",
        email: "jane@updated.com",
        phone: "+1-555-999-8888",
        address: "456 Updated St",
        notes: "Updated notes",
        status: "Inactive",
        rating: 5,
      };

      const result = updateVendor.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });
  });

  describe("validate", () => {
    it("should return validated value", () => {
      const mockSchema = {
        validate: jest.fn().mockReturnValue({
          value: { name: "test", type: "Other" },
          error: null,
        }),
      };

      const result = validate({ name: "test" }, mockSchema);

      expect(result).toEqual({ error: null, value: { name: "test", type: "Other" } });
    });
  });

  describe("formatErrors", () => {
    it("should format error details correctly", () => {
      const details = [
        { path: ["name"], message: "name is required" },
        { path: ["email"], message: "Invalid email" },
      ];

      const result = formatErrors(details);

      expect(result).toEqual([
        { field: "name", message: "name is required" },
        { field: "email", message: "Invalid email" },
      ]);
    });

    it("should handle nested field paths", () => {
      const details = [
        { path: ["vendor", "name"], message: "Name is required" },
      ];

      const result = formatErrors(details);

      expect(result).toEqual([
        { field: "vendor.name", message: "Name is required" },
      ]);
    });

    it("should return empty array for empty input", () => {
      const result = formatErrors([]);

      expect(result).toEqual([]);
    });
  });
});
