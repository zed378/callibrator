/**
 * Tenant Hierarchy validator tests
 */
const {
  createSubOrganization,
  addChild,
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

  it("has no cross-hierarchy role assignment schema (ADR-084, Q-05)", () => {
    expect(require("../../validators/tenantHierarchy.validator").assignRole).toBeUndefined();
  });
});
