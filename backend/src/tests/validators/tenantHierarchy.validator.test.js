/**
 * Tenant Hierarchy validator tests
 *
 * P9-11: the file's own validate() (which nothing called) is gone; the
 * schemas are checked through the shared validateInput / checkInput.
 */
const {
  createSubOrganization,
  addChild,
} = require("../../validators/tenantHierarchy.validator");
const { validateInput: validate, checkInput } = require("../../validators/input");

describe("Tenant Hierarchy Validators", () => {
  describe("createSubOrganization", () => {
    it("should validate correct sub-organization data", () => {
      const value = validate({ name: "Sub Org" }, createSubOrganization);

      expect(value).toEqual({ name: "Sub Org" });
    });

    it("should reject name that is too short", () => {
      expect(() => validate({ name: "A" }, createSubOrganization)).toThrow();
      expect(checkInput({ name: "A" }, createSubOrganization).errors).toEqual([
        { field: "name", message: "Too small: expected string to have >=2 characters" },
      ]);
    });

    it("should reject name that is too long", () => {
      expect(() => validate({ name: "a".repeat(256) }, createSubOrganization)).toThrow();
    });

    it("should reject missing name", () => {
      expect(() => validate({}, createSubOrganization)).toThrow();
      expect(() => validate(undefined, createSubOrganization)).toThrow();
    });

    it("should strip unknown fields", () => {
      expect(validate({ name: "Sub Org", tenantId: "x" }, createSubOrganization)).toEqual({ name: "Sub Org" });
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
      expect(
        validate({ name: "Child Tenant", code: "CHILD", settings: { theme: "dark" } }, addChild),
      ).toEqual({ name: "Child Tenant", code: "CHILD", settings: { theme: "dark" }, plan: "free" });
    });

    it("should reject settings that are not an object", () => {
      expect(checkInput({ name: "Child", settings: [] }, addChild).errors).toEqual([
        { field: "settings", message: "Invalid input: expected record, received array" },
      ]);
    });

    it("should reject name that is too short", () => {
      expect(() => validate({ name: "A" }, addChild)).toThrow();
    });

    it("should reject code that is too long", () => {
      expect(() => validate({ name: "Child", code: "a".repeat(51) }, addChild)).toThrow();
    });

    it("should reject an empty code", () => {
      expect(() => validate({ name: "Child", code: "" }, addChild)).toThrow();
    });

    it("should reject missing name", () => {
      expect(() => validate({}, addChild)).toThrow();
    });

    it("should reject invalid plan", () => {
      expect(checkInput({ name: "Child", plan: "invalid" }, addChild).errors).toEqual([
        {
          field: "plan",
          message: 'Invalid option: expected one of "free"|"professional"|"business"|"enterprise"',
        },
      ]);
    });
  });

  it("has no cross-hierarchy role assignment schema (ADR-084, Q-05)", () => {
    expect(require("../../validators/tenantHierarchy.validator").assignRole).toBeUndefined();
  });
});
