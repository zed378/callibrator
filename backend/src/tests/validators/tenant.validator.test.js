/**
 * Tenant validator tests
 */
const {
  getAllTenantsQuery,
  getTenantSchema,
  createTenantSchema,
  updateTenantSchema,
  deleteTenantSchema,
  tenantIdSchema,
  validate,
  formatErrors,
} = require("../../validators/tenant.validator");

const UUID = "8c352a92-d6cf-4b71-b0db-6e69622d1b11";
const UUID2 = "8c352a92-d6cf-4b71-b0db-6e69622d1b12";

describe("Tenant Validators", () => {
  describe("getAllTenantsQuery", () => {
    it("should apply defaults", () => {
      const result = validate({}, getAllTenantsQuery);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it("should coerce and accept valid query", () => {
      const result = validate(
        { page: "2", limit: "50", find: "acme", status: "active" },
        getAllTenantsQuery,
      );
      expect(result.page).toBe(2);
      expect(result.limit).toBe(50);
      expect(result.find).toBe("acme");
    });

    it("should reject invalid status", () => {
      expect(() => validate({ status: "NOPE" }, getAllTenantsQuery)).toThrow();
    });

    it("should accept null and empty string for find", () => {
      let result = validate({ find: null }, getAllTenantsQuery);
      expect(result.find).toBeNull();

      result = validate({ find: "" }, getAllTenantsQuery);
      expect(result.find).toBe("");
    });

    it("should accept null and empty string for status", () => {
      let result = validate({ status: null }, getAllTenantsQuery);
      expect(result.status).toBeNull();

      result = validate({ status: "" }, getAllTenantsQuery);
      expect(result.status).toBe("");
    });

    it("should accept all valid status values", () => {
      const statuses = [
        "ACTIVE",
        "INACTIVE",
        "SUSPENDED",
        "active",
        "inactive",
        "suspended",
      ];
      statuses.forEach((status) => {
        const result = validate({ status }, getAllTenantsQuery);
        expect(result.status).toBe(status);
      });
    });

    it("should reject non-integer page", () => {
      expect(() => validate({ page: 1.5 }, getAllTenantsQuery)).toThrow();
      expect(() => validate({ page: -1 }, getAllTenantsQuery)).toThrow();
    });

    it("should reject page below 1", () => {
      expect(() => validate({ page: 0 }, getAllTenantsQuery)).toThrow();
    });

    it("should reject limit over maximum", () => {
      expect(() => validate({ limit: 101 }, getAllTenantsQuery)).toThrow();
    });

    it("should reject limit below 1", () => {
      expect(() => validate({ limit: 0 }, getAllTenantsQuery)).toThrow();
    });

    it("should coerce string page and limit to integers", () => {
      const result = validate({ page: "1", limit: "10" }, getAllTenantsQuery);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });
  });

  describe("getTenantSchema", () => {
    it("should validate a uuid tenantId", () => {
      const result = validate({ tenantId: UUID }, getTenantSchema);
      expect(result.tenantId).toBe(UUID);
    });

    it("should reject a non-uuid tenantId", () => {
      expect(() => validate({ tenantId: "bad" }, getTenantSchema)).toThrow();
    });

    it("should reject missing tenantId", () => {
      expect(() => validate({}, getTenantSchema)).toThrow();
    });

    it("should reject empty string tenantId", () => {
      expect(() => validate({ tenantId: "" }, getTenantSchema)).toThrow();
    });
  });

  describe("createTenantSchema", () => {
    it("should validate and normalize a valid tenant", () => {
      const result = validate(
        { name: "Acme", code: "ACME", status: "active" },
        createTenantSchema,
      );
      expect(result.name).toBe("Acme");
      expect(result.code).toBe("ACME");
      expect(result.status).toBe("ACTIVE");
    });

    it("should default status to ACTIVE", () => {
      const result = validate(
        { name: "Acme", code: "ACME" },
        createTenantSchema,
      );
      expect(result.status).toBe("ACTIVE");
    });

    it("should throw when required fields are missing", () => {
      expect(() => validate({ name: "Acme" }, createTenantSchema)).toThrow();
    });

    it("should throw when code is missing", () => {
      expect(() => validate({ name: "Acme" }, createTenantSchema)).toThrow();
    });

    it("should throw when both name and code are missing", () => {
      expect(() => validate({}, createTenantSchema)).toThrow();
    });

    it("should reject an invalid color", () => {
      expect(() =>
        validate(
          { name: "Acme", code: "ACME", primaryColor: "red" },
          createTenantSchema,
        ),
      ).toThrow();
    });

    it("should accept valid hex color", () => {
      const result = validate(
        { name: "Acme", code: "ACME", primaryColor: "#ff00aa" },
        createTenantSchema,
      );
      expect(result.primaryColor).toBe("#ff00aa");
    });

    it("should accept uppercase hex color", () => {
      const result = validate(
        { name: "Acme", code: "ACME", primaryColor: "#FF00AA" },
        createTenantSchema,
      );
      expect(result.primaryColor).toBe("#FF00AA");
    });

    it("should accept null and empty string for primaryColor", () => {
      let result = validate(
        { name: "Acme", code: "ACME", primaryColor: null },
        createTenantSchema,
      );
      expect(result.primaryColor).toBeNull();

      result = validate(
        { name: "Acme", code: "ACME", primaryColor: "" },
        createTenantSchema,
      );
      expect(result.primaryColor).toBe("");
    });

    it("should trim name and code", () => {
      const result = validate(
        { name: "  Acme  ", code: "  ACME  " },
        createTenantSchema,
      );
      expect(result.name).toBe("Acme");
      expect(result.code).toBe("ACME");
    });

    it("should reject name shorter than 2 characters", () => {
      expect(() =>
        validate({ name: "A", code: "ACME" }, createTenantSchema),
      ).toThrow();
    });

    it("should reject name longer than 100 characters", () => {
      const longName = "A".repeat(101);
      expect(() =>
        validate({ name: longName, code: "ACME" }, createTenantSchema),
      ).toThrow();
    });

    it("should reject code shorter than 2 characters", () => {
      expect(() =>
        validate({ name: "Acme", code: "A" }, createTenantSchema),
      ).toThrow();
    });

    it("should reject code longer than 50 characters", () => {
      const longCode = "A".repeat(51);
      expect(() =>
        validate({ name: "Acme", code: longCode }, createTenantSchema),
      ).toThrow();
    });

    it("should accept all valid status values", () => {
      const statuses = [
        "ACTIVE",
        "INACTIVE",
        "SUSPENDED",
        "active",
        "inactive",
        "suspended",
      ];
      statuses.forEach((status) => {
        const result = validate(
          { name: "Acme", code: "ACME", status },
          createTenantSchema,
        );
        expect(result.status).toBe(status.toUpperCase());
      });
    });

    it("should accept optional contact fields", () => {
      const result = validate(
        {
          name: "Acme",
          code: "ACME",
          description: "Test tenant",
          logo: "https://example.com/logo.png",
          phone: "+1234567890",
          address: "123 Main St",
          city: "New York",
          state: "NY",
          zipCode: "10001",
          country: "US",
          website: "https://example.com",
        },
        createTenantSchema,
      );
      expect(result.description).toBe("Test tenant");
      expect(result.logo).toBe("https://example.com/logo.png");
      expect(result.phone).toBe("+1234567890");
      expect(result.address).toBe("123 Main St");
      expect(result.city).toBe("New York");
      expect(result.state).toBe("NY");
      expect(result.zipCode).toBe("10001");
      expect(result.country).toBe("US");
      expect(result.website).toBe("https://example.com");
    });

    it("should accept email field", () => {
      const result = validate(
        { name: "Acme", code: "ACME", email: "test@example.com" },
        createTenantSchema,
      );
      expect(result.email).toBe("test@example.com");
    });

    it("should reject invalid email", () => {
      expect(() =>
        validate(
          { name: "Acme", code: "ACME", email: "not-an-email" },
          createTenantSchema,
        ),
      ).toThrow();
    });

    it("should accept valid createdBy UUID", () => {
      const result = validate(
        { name: "Acme", code: "ACME", createdBy: UUID },
        createTenantSchema,
      );
      expect(result.createdBy).toBe(UUID);
    });

    it("should reject invalid createdBy UUID", () => {
      expect(() =>
        validate(
          { name: "Acme", code: "ACME", createdBy: "not-a-uuid" },
          createTenantSchema,
        ),
      ).toThrow();
    });

    it("should accept null for createdBy", () => {
      const result = validate(
        { name: "Acme", code: "ACME", createdBy: null },
        createTenantSchema,
      );
      expect(result.createdBy).toBeNull();
    });

    it("should accept maxUsers", () => {
      const result = validate(
        { name: "Acme", code: "ACME", maxUsers: 100 },
        createTenantSchema,
      );
      expect(result.maxUsers).toBe(100);
    });

    it("should reject maxUsers below 1", () => {
      expect(() =>
        validate(
          { name: "Acme", code: "ACME", maxUsers: 0 },
          createTenantSchema,
        ),
      ).toThrow();
      expect(() =>
        validate(
          { name: "Acme", code: "ACME", maxUsers: -1 },
          createTenantSchema,
        ),
      ).toThrow();
    });

    it("should accept null and empty string for optional text fields", () => {
      const result = validate(
        {
          name: "Acme",
          code: "ACME",
          description: null,
          logo: null,
          phone: null,
          address: null,
          city: null,
          state: null,
          zipCode: null,
          country: null,
          website: null,
          email: null,
        },
        createTenantSchema,
      );
      expect(result.description).toBeNull();
      expect(result.logo).toBeNull();
      expect(result.phone).toBeNull();
      expect(result.address).toBeNull();
      expect(result.city).toBeNull();
      expect(result.state).toBeNull();
      expect(result.zipCode).toBeNull();
      expect(result.country).toBeNull();
      expect(result.website).toBeNull();
      expect(result.email).toBeNull();
    });

    it("should reject invalid website URI", () => {
      expect(() =>
        validate(
          { name: "Acme", code: "ACME", website: "not-a-uri" },
          createTenantSchema,
        ),
      ).toThrow();
    });

    it("should strip unknown fields", () => {
      const result = validate(
        { name: "Acme", code: "ACME", unknownField: "value" },
        createTenantSchema,
      );
      expect(result.unknownField).toBeUndefined();
    });

    it("should handle status normalization when status is provided as null", () => {
      const result = validate(
        { name: "Acme", code: "ACME", status: null },
        createTenantSchema,
      );
      expect(result.status).toBeNull();
    });

    it("should reject empty string for status", () => {
      expect(() =>
        validate(
          { name: "Acme", code: "ACME", status: "" },
          createTenantSchema,
        ),
      ).toThrow();
    });

    it("should normalize status to uppercase for mixed case values", () => {
      const result = validate(
        { name: "Acme", code: "ACME", status: "AcTiVe" },
        createTenantSchema,
      );
      expect(result.status).toBe("ACTIVE");
    });

    it("should preserve default status when not provided", () => {
      const result = validate(
        { name: "Acme", code: "ACME" },
        createTenantSchema,
      );
      expect(result.status).toBe("ACTIVE");
    });
  });

  describe("updateTenantSchema", () => {
    it("should validate a partial update", () => {
      const result = validate({ name: "New Name" }, updateTenantSchema);
      expect(result.name).toBe("New Name");
    });

    it("should normalize status to uppercase", () => {
      const result = validate({ status: "active" }, updateTenantSchema);
      expect(result.status).toBe("ACTIVE");
    });

    it("should accept all valid status values", () => {
      const statuses = [
        "ACTIVE",
        "INACTIVE",
        "SUSPENDED",
        "active",
        "inactive",
        "suspended",
      ];
      statuses.forEach((status) => {
        const result = validate({ status }, updateTenantSchema);
        expect(result.status).toBe(status.toUpperCase());
      });
    });

    it("should accept valid hex color", () => {
      const result = validate({ primaryColor: "#ff00aa" }, updateTenantSchema);
      expect(result.primaryColor).toBe("#ff00aa");
    });

    it("should reject invalid color", () => {
      expect(() =>
        validate({ primaryColor: "red" }, updateTenantSchema),
      ).toThrow();
    });

    it("should accept optional contact fields", () => {
      const result = validate(
        {
          email: "test@example.com",
          phone: "+1234567890",
          address: "123 Main St",
          city: "New York",
          state: "NY",
          zipCode: "10001",
          country: "US",
          website: "https://example.com",
        },
        updateTenantSchema,
      );
      expect(result.email).toBe("test@example.com");
      expect(result.phone).toBe("+1234567890");
      expect(result.website).toBe("https://example.com");
    });

    it("should reject invalid email", () => {
      expect(() =>
        validate({ email: "not-an-email" }, updateTenantSchema),
      ).toThrow();
    });

    it("should accept valid updatedBy UUID", () => {
      const result = validate({ updatedBy: UUID }, updateTenantSchema);
      expect(result.updatedBy).toBe(UUID);
    });

    it("should accept null for updatedBy", () => {
      const result = validate({ updatedBy: null }, updateTenantSchema);
      expect(result.updatedBy).toBeNull();
    });

    it("should accept maxUsers", () => {
      const result = validate({ maxUsers: 100 }, updateTenantSchema);
      expect(result.maxUsers).toBe(100);
    });

    it("should reject maxUsers below 1", () => {
      expect(() => validate({ maxUsers: 0 }, updateTenantSchema)).toThrow();
    });

    it("should trim name and code", () => {
      const result = validate(
        { name: "  New Name  ", code: "  new-code  " },
        updateTenantSchema,
      );
      expect(result.name).toBe("New Name");
      expect(result.code).toBe("new-code");
    });

    it("should reject name shorter than 2 characters", () => {
      expect(() => validate({ name: "A" }, updateTenantSchema)).toThrow();
    });

    it("should reject name longer than 100 characters", () => {
      const longName = "A".repeat(101);
      expect(() => validate({ name: longName }, updateTenantSchema)).toThrow();
    });

    it("should reject code shorter than 2 characters", () => {
      expect(() => validate({ code: "A" }, updateTenantSchema)).toThrow();
    });

    it("should reject code longer than 50 characters", () => {
      const longCode = "A".repeat(51);
      expect(() => validate({ code: longCode }, updateTenantSchema)).toThrow();
    });

    it("should accept null and empty string for optional text fields", () => {
      const result = validate(
        {
          description: null,
          logo: null,
          primaryColor: null,
          phone: null,
          address: null,
          city: null,
          state: null,
          zipCode: null,
          country: null,
          website: null,
          email: null,
        },
        updateTenantSchema,
      );
      expect(result.description).toBeNull();
      expect(result.phone).toBeNull();
    });

    it("should reject invalid website URI", () => {
      expect(() =>
        validate({ website: "not-a-uri" }, updateTenantSchema),
      ).toThrow();
    });

    it("should accept tenantId in update", () => {
      const result = validate({ tenantId: UUID }, updateTenantSchema);
      expect(result.tenantId).toBe(UUID);
    });

    it("should reject invalid tenantId UUID", () => {
      expect(() =>
        validate({ tenantId: "not-a-uuid" }, updateTenantSchema),
      ).toThrow();
    });
  });

  describe("deleteTenantSchema", () => {
    it("should require a uuid tenantId", () => {
      const result = validate({ tenantId: UUID }, deleteTenantSchema);
      expect(result.tenantId).toBe(UUID);
    });

    it("should accept deletedBy", () => {
      const result = validate(
        { tenantId: UUID, deletedBy: UUID2 },
        deleteTenantSchema,
      );
      expect(result.deletedBy).toBe(UUID2);
    });

    it("should accept null for deletedBy", () => {
      const result = validate(
        { tenantId: UUID, deletedBy: null },
        deleteTenantSchema,
      );
      expect(result.deletedBy).toBeNull();
    });

    it("should reject missing tenantId", () => {
      expect(() => validate({}, deleteTenantSchema)).toThrow();
    });

    it("should reject invalid tenantId UUID", () => {
      expect(() =>
        validate({ tenantId: "not-a-uuid" }, deleteTenantSchema),
      ).toThrow();
    });

    it("should reject invalid deletedBy UUID", () => {
      expect(() =>
        validate(
          { tenantId: UUID, deletedBy: "not-a-uuid" },
          deleteTenantSchema,
        ),
      ).toThrow();
    });
  });

  describe("tenantIdSchema", () => {
    it("should validate a uuid tenantId", () => {
      const result = validate({ tenantId: UUID }, tenantIdSchema);
      expect(result.tenantId).toBe(UUID);
    });

    it("should reject missing tenantId", () => {
      expect(() => validate({}, tenantIdSchema)).toThrow();
    });

    it("should reject invalid tenantId UUID", () => {
      expect(() =>
        validate({ tenantId: "not-a-uuid" }, tenantIdSchema),
      ).toThrow();
    });

    it("should reject empty string tenantId", () => {
      expect(() => validate({ tenantId: "" }, tenantIdSchema)).toThrow();
    });
  });

  describe("formatErrors", () => {
    it("should format validation error details", () => {
      const { error } = createTenantSchema.validate({}, { abortEarly: false });
      const formatted = formatErrors(error.details);
      expect(Array.isArray(formatted)).toBe(true);
      expect(formatted[0]).toHaveProperty("field");
      expect(formatted[0]).toHaveProperty("message");
    });

    it("should handle nested field paths", () => {
      const formatted = formatErrors([
        { path: ["name"], message: '"name" is not allowed to be empty' },
      ]);
      expect(formatted[0].field).toBe("name");
    });

    it("should handle multi-level nested field paths", () => {
      const formatted = formatErrors([
        { path: ["nested", "field"], message: '"nested.field" is required' },
      ]);
      expect(formatted[0].field).toBe("nested.field");
    });

    it("should return empty array for empty input", () => {
      const formatted = formatErrors([]);
      expect(formatted).toEqual([]);
    });

    it("should format multiple errors", () => {
      const formatted = formatErrors([
        { path: ["name"], message: '"name" is required' },
        { path: ["code"], message: '"code" is required' },
      ]);
      expect(formatted.length).toBe(2);
      expect(formatted[0].field).toBe("name");
      expect(formatted[1].field).toBe("code");
    });
  });

  describe("validate helper", () => {
    it("should return validated value on success", () => {
      const result = validate(
        { name: "Acme", code: "ACME" },
        createTenantSchema,
      );
      expect(result).toHaveProperty("name", "Acme");
      expect(result).toHaveProperty("code", "ACME");
    });

    it("should throw structured error on validation failure", () => {
      try {
        validate({ name: "A" }, createTenantSchema);
        expect(() => {}).toThrow();
      } catch (error) {
        expect(error.status).toBe(400);
        expect(error.message).toBe("Validation failed");
        expect(Array.isArray(error.errors)).toBe(true);
      }
    });

    it("should include formatted errors in thrown error", () => {
      try {
        validate({}, createTenantSchema);
        expect(() => {}).toThrow();
      } catch (error) {
        expect(Array.isArray(error.errors)).toBe(true);
        expect(error.errors.length).toBeGreaterThan(0);
        expect(error.errors[0]).toHaveProperty("field");
        expect(error.errors[0]).toHaveProperty("message");
      }
    });
  });
});
