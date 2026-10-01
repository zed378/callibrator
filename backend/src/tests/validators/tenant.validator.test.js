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
} = require("../../validators/tenant.validator");
// P9-11: the file's own validate()/formatErrors() are gone; validateInput is
// the shared helper with the same contract (value, or a thrown 400 object).
const { validateInput: validate, checkInput } = require("../../validators/input");

/** @returns {unknown} what `fn` threw */
const thrown = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
};

const UUID = "8c352a92-d6cf-4b71-b0db-6e69622d1b11";

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
      // P9-11 NORMALISATION DIFF: the old insensitive match returned the
      // listed value an exact match hit, so "active" stayed "active" here (this
      // schema had no upper-casing custom()). The Zod schema folds every match
      // to upper case, which is what the tenants table stores.
      statuses.forEach((status) => {
        const result = validate({ status }, getAllTenantsQuery);
        expect(result.status).toBe(status.toUpperCase());
      });
    });

    it("should report an invalid status with its field", () => {
      expect(thrown(() => validate({ status: "NOPE" }, getAllTenantsQuery))).toEqual({
        status: 400,
        message: "Validation failed",
        errors: [{ field: "status", message: "Invalid input" }],
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
          // P7-08: an uploaded file name, never a URL (tenant.logoUrl.p708.test.js)
          logo: "1758600000000-4242-logo.png",
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
      expect(result.logo).toBe("1758600000000-4242-logo.png");
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

    // Seat limit (2026-09-30): limitSeats is the single source; maxUsers is stripped.
    it("should accept limitSeats, and null as unlimited, and strip maxUsers", () => {
      expect(validate({ name: "Acme", code: "ACME", limitSeats: 100 }, createTenantSchema).limitSeats).toBe(100);
      expect(validate({ name: "Acme", code: "ACME", limitSeats: null }, createTenantSchema).limitSeats).toBeNull();
      expect(validate({ name: "Acme", code: "ACME", maxUsers: 100 }, createTenantSchema)).not.toHaveProperty("maxUsers");
    });

    it("should reject limitSeats below 1", () => {
      expect(() => validate({ name: "Acme", code: "ACME", limitSeats: 0 }, createTenantSchema)).toThrow();
      expect(() => validate({ name: "Acme", code: "ACME", limitSeats: -1 }, createTenantSchema)).toThrow();
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

    // A-303: maxUsers is not an edit field (a platform plan value); as an
    // unknown key it is stripped, whatever its value.
    it("should strip maxUsers", () => {
      expect(validate({ maxUsers: 100 }, updateTenantSchema)).not.toHaveProperty("maxUsers");
      expect(validate({ maxUsers: 0 }, updateTenantSchema)).not.toHaveProperty("maxUsers");
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

    // A-95: the actor of a delete is the authenticated caller. A body or
    // query `deletedBy` is stripped, whatever its value — it was accepted and
    // passed to the service as the actor.
    it.each(["99999999-9999-4999-8999-999999999999", null, "not-a-uuid"])(
      "strips deletedBy (%s) — it never reaches the service",
      (deletedBy) => {
        const result = validate({ tenantId: UUID, deletedBy }, deleteTenantSchema);
        expect(result).toEqual({ tenantId: UUID });
      },
    );

    it("should reject missing tenantId", () => {
      expect(() => validate({}, deleteTenantSchema)).toThrow();
    });

    it("should reject invalid tenantId UUID", () => {
      expect(() =>
        validate({ tenantId: "not-a-uuid" }, deleteTenantSchema),
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

  // P9-11: formatErrors() is gone; checkInput reports the same
  // `{ field, message }` list, one per issue, in the schema's field order.
  describe("error reporting (checkInput)", () => {
    it("lists every missing required field with Zod's message", () => {
      expect(checkInput({}, createTenantSchema)).toEqual({
        ok: false,
        errors: [
          { field: "name", message: "Invalid input: expected string, received undefined" },
          { field: "code", message: "Invalid input: expected string, received undefined" },
        ],
      });
    });

    it("checks an absent body as {} (A-09)", () => {
      expect(checkInput(undefined, tenantIdSchema)).toEqual({
        ok: false,
        errors: [{ field: "tenantId", message: "Invalid input: expected string, received undefined" }],
      });
    });

    it("reports every invalid field at once, with the schemas' own messages", () => {
      const result = checkInput(
        {
          name: "A",
          code: "ACME",
          primaryColor: "red",
          email: "x",
          website: "not-a-uri",
          logo: "http://x/a.png",
          createdBy: "bad",
          limitSeats: 0,
        },
        createTenantSchema,
      );
      expect(result.errors).toEqual([
        { field: "name", message: "Too small: expected string to have >=2 characters" },
        { field: "logo", message: "logo must be an uploaded file name, not a URL or a path" },
        { field: "primaryColor", message: "primaryColor must be a #RRGGBB colour" },
        { field: "limitSeats", message: "Too small: expected number to be >=1" },
        { field: "createdBy", message: "Invalid GUID" },
        { field: "email", message: "Invalid email address" },
        { field: "website", message: "website must be an http:// or https:// address" },
      ]);
    });

    it("reports a query's page and limit together", () => {
      expect(checkInput({ page: 1.5, limit: 101 }, getAllTenantsQuery).errors).toEqual([
        { field: "page", message: "Invalid input: expected int, received number" },
        { field: "limit", message: "Too big: expected number to be <=100" },
      ]);
    });

    it("names the create status options when an empty status is sent", () => {
      expect(checkInput({ name: "Acme", code: "AC", status: "" }, createTenantSchema).errors).toEqual([
        { field: "status", message: 'Invalid option: expected one of "ACTIVE"|"INACTIVE"|"SUSPENDED"' },
      ]);
    });

    it("accepts empty strings for the optional id, email, website and logo, and converts limitSeats", () => {
      expect(
        checkInput(
          { name: "Acme", code: "AC", createdBy: "", email: "", website: "", logo: "", limitSeats: "5" },
          createTenantSchema,
        ),
      ).toEqual({
        ok: true,
        value: {
          name: "Acme",
          code: "AC",
          logo: "",
          status: "ACTIVE",
          limitSeats: 5,
          createdBy: "",
          email: "",
          website: "",
        },
      });
    });
  });

  describe("validate helper (validateInput)", () => {
    it("should return validated value on success", () => {
      const result = validate(
        { name: "Acme", code: "ACME" },
        createTenantSchema,
      );
      expect(result).toEqual({ name: "Acme", code: "ACME", status: "ACTIVE" });
    });

    it("should throw structured error on validation failure", () => {
      expect(thrown(() => validate({ name: "A" }, createTenantSchema))).toEqual({
        status: 400,
        message: "Validation failed",
        errors: [
          { field: "name", message: "Too small: expected string to have >=2 characters" },
          { field: "code", message: "Invalid input: expected string, received undefined" },
        ],
      });
    });

    it("should include formatted errors in thrown error", () => {
      const error = thrown(() => validate({}, createTenantSchema));
      expect(error.errors.map((e) => e.field)).toEqual(["name", "code"]);
    });
  });
});
