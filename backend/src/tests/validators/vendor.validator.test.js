/**
 * Vendor validator tests
 */
const {
  createVendor,
  updateVendor,
  qualifyVendor,
} = require("../../validators/vendor.validator");
const { checkInput } = require("../../validators/input");

// P9-11: the schemas are Zod and the file's own validate()/formatErrors() are
// gone. `run` checks through the shared checkInput (strip-unknown, every issue
// listed, as the old options here were) and answers in the old
// `{ error, value }` shape, with `error` the `{ field, message }` list.
const run = (schema, data) => {
  const result = checkInput(data, schema);
  return result.ok ? { error: undefined, value: result.value } : { error: result.errors, value: undefined };
};

describe("Vendor Validators", () => {
  describe("createVendor", () => {
    it("should validate correct vendor data", () => {
      const data = {
        name: "Acme Calibration Lab",
      };

      const result = run(createVendor, data);

      expect(result.error).toBeUndefined();
      expect(result.value).toEqual({ name: "Acme Calibration Lab", type: "Other", status: "Active" });
    });

    it("should validate with default type", () => {
      const data = {
        name: "Acme Calibration Lab",
      };

      const result = run(createVendor, data);

      expect(result.error).toBeUndefined();
      expect(result.value.type).toBe("Other");
    });

    it("should validate with default status", () => {
      const data = {
        name: "Acme Calibration Lab",
      };

      const result = run(createVendor, data);

      expect(result.error).toBeUndefined();
      expect(result.value.status).toBe("Active");
    });

    it("should validate with CalibrationLab type", () => {
      const data = {
        name: "Acme Calibration Lab",
        type: "CalibrationLab",
      };

      const result = run(createVendor, data);

      expect(result.error).toBeUndefined();
    });

    it("should validate with PartsSupplier type", () => {
      const data = {
        name: "Acme Parts Supplier",
        type: "PartsSupplier",
      };

      const result = run(createVendor, data);

      expect(result.error).toBeUndefined();
    });

    it("should validate with Inactive status", () => {
      const data = {
        name: "Acme Parts Supplier",
        status: "Inactive",
      };

      const result = run(createVendor, data);

      expect(result.error).toBeUndefined();
    });

    it("should validate with contact person", () => {
      const data = {
        name: "Acme Parts Supplier",
        contactPerson: "John Doe",
      };

      const result = run(createVendor, data);

      expect(result.error).toBeUndefined();
    });

    it("should validate with email", () => {
      const data = {
        name: "Acme Parts Supplier",
        email: "contact@acme.com",
      };

      const result = run(createVendor, data);

      expect(result.error).toBeUndefined();
    });

    it("should validate with phone", () => {
      const data = {
        name: "Acme Parts Supplier",
        phone: "+1-555-123-4567",
      };

      const result = run(createVendor, data);

      expect(result.error).toBeUndefined();
    });

    it("should validate with address", () => {
      const data = {
        name: "Acme Parts Supplier",
        address: "123 Main St, City, Country",
      };

      const result = run(createVendor, data);

      expect(result.error).toBeUndefined();
    });

    it("should validate with notes", () => {
      const data = {
        name: "Acme Parts Supplier",
        notes: "Preferred vendor for calibration equipment",
      };

      const result = run(createVendor, data);

      expect(result.error).toBeUndefined();
    });

    it("should reject missing name", () => {
      const data = {};

      const result = run(createVendor, data);

      expect(result.error).toEqual([
        { field: "name", message: "Invalid input: expected string, received undefined" },
      ]);
    });

    it("should reject name too short", () => {
      const data = {
        name: "A",
      };

      const result = run(createVendor, data);

      expect(result.error).toBeDefined();
    });

    it("should reject name too long", () => {
      const data = {
        name: "a".repeat(101),
      };

      const result = run(createVendor, data);

      expect(result.error).toBeDefined();
    });

    it("should reject invalid type", () => {
      const data = {
        name: "Acme",
        type: "InvalidType",
      };

      const result = run(createVendor, data);

      expect(result.error).toEqual([
        { field: "type", message: 'Invalid option: expected one of "CalibrationLab"|"PartsSupplier"|"Other"' },
      ]);
    });

    it("should reject invalid email", () => {
      const data = {
        name: "Acme",
        email: "not-an-email",
      };

      const result = run(createVendor, data);

      expect(result.error).toEqual([{ field: "email", message: "Invalid email address" }]);
    });

    it("should accept null contactPerson", () => {
      const data = {
        name: "Acme",
        contactPerson: null,
      };

      const result = run(createVendor, data);

      expect(result.error).toBeUndefined();
    });

    it("should accept empty string contactPerson", () => {
      const data = {
        name: "Acme",
        contactPerson: "",
      };

      const result = run(createVendor, data);

      expect(result.error).toBeUndefined();
    });

    it("should trim the email and text fields, and accept a blank email", () => {
      const result = run(createVendor, {
        name: "Acme",
        email: "  a@b.com  ",
        contactPerson: " ",
        phone: " 555 ",
      });

      expect(result.error).toBeUndefined();
      expect(result.value).toEqual({
        name: "Acme",
        type: "Other",
        contactPerson: "",
        email: "a@b.com",
        phone: "555",
        status: "Active",
      });
      expect(run(createVendor, { name: "Acme", email: "   " }).value.email).toBe("");
      expect(run(createVendor, { name: "Acme", email: null }).value.email).toBeNull();
    });

    it("should reject an over-long phone or contact person", () => {
      expect(run(createVendor, { name: "Acme", phone: "x".repeat(51) }).error).toEqual([
        { field: "phone", message: "Too big: expected string to have <=50 characters" },
      ]);
      expect(run(createVendor, { name: "Acme", contactPerson: "x".repeat(101) }).error).toBeDefined();
    });

    it("should reject an invalid status", () => {
      expect(run(createVendor, { name: "Acme", status: "active" }).error).toBeDefined();
    });

    it("should strip unknown fields", () => {
      expect(run(createVendor, { name: "Acme", tenantId: "x" }).value.tenantId).toBeUndefined();
    });

    it("should trim whitespace from name", () => {
      const data = {
        name: "  Acme Calibration Lab  ",
      };

      const result = run(createVendor, data);

      expect(result.error).toBeUndefined();
      expect(result.value.name).toBe("Acme Calibration Lab");
    });
  });

  describe("updateVendor", () => {
    it("should validate partial update with name", () => {
      const data = {
        name: "Updated Name",
      };

      const result = run(updateVendor, data);

      expect(result.error).toBeUndefined();
    });

    it("should validate with rating", () => {
      const data = {
        name: "Updated Name",
        rating: 4,
      };

      const result = run(updateVendor, data);

      expect(result.error).toBeUndefined();
    });

    it("should validate with minimum rating", () => {
      const data = {
        rating: 1,
      };

      const result = run(updateVendor, data);

      expect(result.error).toBeUndefined();
    });

    it("should validate with maximum rating", () => {
      const data = {
        rating: 5,
      };

      const result = run(updateVendor, data);

      expect(result.error).toBeUndefined();
    });

    it("should validate with null rating", () => {
      const data = {
        rating: null,
      };

      const result = run(updateVendor, data);

      expect(result.error).toBeUndefined();
    });

    it("should convert a numeric-string rating", () => {
      expect(run(updateVendor, { rating: "4.5" }).value).toEqual({ rating: 4.5 });
    });

    it("should reject a non-numeric rating", () => {
      expect(run(updateVendor, { rating: "abc" }).error).toEqual([
        { field: "rating", message: "Invalid input: expected number, received string" },
      ]);
    });

    it("should reject rating below minimum", () => {
      const data = {
        rating: 0,
      };

      const result = run(updateVendor, data);

      expect(result.error).toBeDefined();
    });

    it("should reject rating above maximum", () => {
      const data = {
        rating: 6,
      };

      const result = run(updateVendor, data);

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

      const result = run(updateVendor, data);

      expect(result.error).toBeUndefined();
    });
  });

  describe("qualifyVendor (P6-02)", () => {
    it("should upper-case and trim the approval status to the enum's case", () => {
      expect(run(qualifyVendor, { approvalStatus: " approved " }).value).toEqual({ approvalStatus: "APPROVED" });
      expect(run(qualifyVendor, { approvalStatus: "rejected" }).value.approvalStatus).toBe("REJECTED");
    });

    it("should reject an approval status outside the enum", () => {
      expect(run(qualifyVendor, { approvalStatus: "yes" }).error).toEqual([
        {
          field: "approvalStatus",
          message: 'Invalid option: expected one of "APPROVED"|"PENDING"|"REJECTED"|"CONDITIONAL"',
        },
      ]);
      expect(run(qualifyVendor, { approvalStatus: "" }).error).toBeDefined();
    });

    it("should accept an empty body", () => {
      expect(run(qualifyVendor, {}).value).toEqual({});
    });

    it("should convert the scorecard and parse ISO audit dates", () => {
      const { error, value } = run(qualifyVendor, {
        scorecard: "80",
        lastAuditDate: "2026-01-15",
        nextAuditDate: "2026-07-15T10:00:00+07:00",
      });

      expect(error).toBeUndefined();
      expect(value).toEqual({
        scorecard: 80,
        lastAuditDate: new Date("2026-01-15T00:00:00.000Z"),
        nextAuditDate: new Date("2026-07-15T03:00:00.000Z"),
      });
    });

    it("should accept a Date and nulls", () => {
      const date = new Date("2026-01-15T00:00:00.000Z");
      expect(run(qualifyVendor, { lastAuditDate: date, nextAuditDate: null, scorecard: null }).value).toEqual({
        lastAuditDate: date,
        nextAuditDate: null,
        scorecard: null,
      });
    });

    it("should reject a fractional or out-of-range scorecard", () => {
      expect(run(qualifyVendor, { scorecard: 80.5 }).error).toEqual([
        { field: "scorecard", message: "Invalid input: expected int, received number" },
      ]);
      expect(run(qualifyVendor, { scorecard: 101 }).error).toBeDefined();
      expect(run(qualifyVendor, { scorecard: -1 }).error).toBeDefined();
    });

    it("should reject a non-ISO audit date", () => {
      expect(run(qualifyVendor, { lastAuditDate: "01/15/2026" }).error).toEqual([
        { field: "lastAuditDate", message: "Invalid input" },
      ]);
      expect(run(qualifyVendor, { nextAuditDate: 1700000000000 }).error).toBeDefined();
    });
  });
});
