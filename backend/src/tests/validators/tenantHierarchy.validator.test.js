/**
 * Tenant Hierarchy validator tests
 */
const {
  createSubOrganization,
  addChild,
  assignRole,
  validate,
} = require("../../validators/tenantHierarchy.validator");

describe("Tenant Hierarchy Validators", () => {
  describe("createSubOrganization", () => {
    it("should validate correct sub-organization data", () => {
      const value = validate({ name: "Sub Org" }, createSubOrganization);

      expect(value.name).toBe("Sub Org");
    });

    it("should reject name that is too short", () => {
      expect(() => validate({ name: "A" }, createSubOrganization)).toThrow();
    });

    it("should reject name that is too long", () => {
      expect(() => validate({ name: "a".repeat(256) }, createSubOrganization)).toThrow();
    });

    it("should reject missing name", () => {
      expect(() => validate({}, createSubOrganization)).toThrow();
    });
  });

  describe("addChild", () => {
    it("should validate with default plan", () => {
      const value = validate({ name: "Child Tenant" }, addChild);

      expect(value.name).toBe("Child Tenant");
      expect(value.plan).toBe("free");
    });

    it("should validate with custom plan", () => {
      const value = validate({ name: "Child Tenant", plan: "enterprise" }, addChild);

      expect(value.plan).toBe("enterprise");
    });

    it("should validate with code and settings", () => {
      expect(() =>
        validate({ name: "Child Tenant", code: "CHILD", settings: { theme: "dark" } }, addChild),
      ).not.toThrow();
    });

    it("should reject name that is too short", () => {
      expect(() => validate({ name: "A" }, addChild)).toThrow();
    });

    it("should reject code that is too long", () => {
      expect(() => validate({ name: "Child", code: "a".repeat(51) }, addChild)).toThrow();
    });

    it("should reject missing name", () => {
      expect(() => validate({}, addChild)).toThrow();
    });

    it("should reject invalid plan", () => {
      expect(() => validate({ name: "Child", plan: "invalid" }, addChild)).toThrow();
    });
  });

  describe("assignRole", () => {
    it("should validate with default scope", () => {
      const value = validate(
        { roleId: "123e4567-e89b-12d3-a456-426614174000" },
        assignRole,
      );

      expect(value.roleId).toBe("123e4567-e89b-12d3-a456-426614174000");
      expect(value.scope).toBe("subtree");
    });

    it("should validate with self scope", () => {
      const value = validate(
        { roleId: "123e4567-e89b-12d3-a456-426614174000", scope: "self" },
        assignRole,
      );

      expect(value.scope).toBe("self");
    });

    it("should reject invalid role UUID", () => {
      expect(() =>
        validate({ roleId: "not-a-uuid" }, assignRole),
      ).toThrow();
    });

    it("should reject missing role ID", () => {
      expect(() => validate({}, assignRole)).toThrow();
    });

    it("should reject invalid scope", () => {
      expect(() =>
        validate({ roleId: "123e4567-e89b-12d3-a456-426614174000", scope: "invalid" }, assignRole),
      ).toThrow();
    });
  });
});
