/**
 * Tenant Hierarchy validator tests
 *
 * P9-11: the file's own validate() (which nothing called) is gone; the
 * schemas are checked through the shared validateInput / checkInput.
 */
import { addChild, createSubOrganization } from "../../validators/tenantHierarchy.validator";
import { checkInput, validateInput } from "../../validators/input";

describe("Tenant Hierarchy Validators", () => {
  describe("createSubOrganization", () => {
    it("should validate correct sub-organization data", () => {
      const value = validateInput({ name: "Sub Org" }, createSubOrganization);

      expect(value).toEqual({ name: "Sub Org" });
    });

    it("should reject name that is too short", () => {
      expect(() => validateInput({ name: "A" }, createSubOrganization)).toThrow();
      expect(checkInput({ name: "A" }, createSubOrganization)).toEqual({
        ok: false,
        errors: [{ field: "name", message: "Too small: expected string to have >=2 characters" }],
      });
    });

    it("should reject name that is too long", () => {
      expect(() => validateInput({ name: "a".repeat(256) }, createSubOrganization)).toThrow();
    });

    it("should reject missing name", () => {
      expect(() => validateInput({}, createSubOrganization)).toThrow();
      expect(() => validateInput(undefined, createSubOrganization)).toThrow();
    });

    it("should strip unknown fields", () => {
      expect(validateInput({ name: "Sub Org", tenantId: "x" }, createSubOrganization)).toEqual({ name: "Sub Org" });
    });
  });

  describe("addChild", () => {
    it("should validate with default plan", () => {
      const value = validateInput({ name: "Child Tenant" }, addChild);

      expect(value.name).toBe("Child Tenant");
      expect(value.plan).toBe("free");
    });

    it("should validate with custom plan", () => {
      const value = validateInput({ name: "Child Tenant", plan: "enterprise" }, addChild);

      expect(value.plan).toBe("enterprise");
    });

    it("should validate with code and settings", () => {
      expect(validateInput({ name: "Child Tenant", code: "CHILD", settings: { theme: "dark" } }, addChild)).toEqual({
        name: "Child Tenant",
        code: "CHILD",
        settings: { theme: "dark" },
        plan: "free",
      });
    });

    it("should reject settings that are not an object", () => {
      expect(checkInput({ name: "Child", settings: [] }, addChild)).toEqual({
        ok: false,
        errors: [{ field: "settings", message: "Invalid input: expected record, received array" }],
      });
    });

    it("should reject name that is too short", () => {
      expect(() => validateInput({ name: "A" }, addChild)).toThrow();
    });

    it("should reject code that is too long", () => {
      expect(() => validateInput({ name: "Child", code: "a".repeat(51) }, addChild)).toThrow();
    });

    it("should reject an empty code", () => {
      expect(() => validateInput({ name: "Child", code: "" }, addChild)).toThrow();
    });

    it("should reject missing name", () => {
      expect(() => validateInput({}, addChild)).toThrow();
    });

    it("should reject invalid plan", () => {
      expect(checkInput({ name: "Child", plan: "invalid" }, addChild)).toEqual({
        ok: false,
        errors: [
          {
            field: "plan",
            message: 'Invalid option: expected one of "free"|"professional"|"business"|"enterprise"',
          },
        ],
      });
    });
  });

  it("has no cross-hierarchy role assignment schema (ADR-084, Q-05)", () => {
    const mod = jest.requireActual<Record<string, unknown>>("../../validators/tenantHierarchy.validator");
    expect(mod["assignRole"]).toBeUndefined();
  });
});
