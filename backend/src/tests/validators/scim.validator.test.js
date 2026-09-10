/**
 * SCIM validator tests
 */
const {
  scimUserSchema,
  scimGroupSchema,
  scimPatchSchema,
  validate,
} = require("../../validators/scim.validator");

describe("SCIM Validators", () => {
  describe("scimUserSchema", () => {
    it("should validate correct SCIM user", () => {
      const value = validate(
        { userName: "user@example.com", active: true },
        scimUserSchema,
      );

      expect(value.userName).toBe("user@example.com");
    });

    it("should validate with name object", () => {
      expect(() =>
        validate(
          {
            userName: "user@example.com",
            name: { givenName: "John", familyName: "Doe" },
          },
          scimUserSchema,
        ),
      ).not.toThrow();
    });

    it("should validate with partial name", () => {
      expect(() =>
        validate(
          {
            userName: "user@example.com",
            name: { givenName: "John" },
          },
          scimUserSchema,
        ),
      ).not.toThrow();
    });

    it("should validate with emails array", () => {
      expect(() =>
        validate(
          {
            userName: "user@example.com",
            emails: [{ value: "user@example.com", type: "work", primary: true }],
          },
          scimUserSchema,
        ),
      ).not.toThrow();
    });

    it("should validate with multiple emails", () => {
      expect(() =>
        validate(
          {
            userName: "user@example.com",
            emails: [
              { value: "user@example.com", type: "work", primary: true },
              { value: "john@example.com", type: "home" },
            ],
          },
          scimUserSchema,
        ),
      ).not.toThrow();
    });

    it("should validate with roleId", () => {
      expect(() =>
        validate(
          {
            userName: "user@example.com",
            roleId: "123e4567-e89b-12d3-a456-426614174000",
          },
          scimUserSchema,
        ),
      ).not.toThrow();
    });

    it("should validate with inactive user", () => {
      expect(() =>
        validate(
          { userName: "user@example.com", active: false },
          scimUserSchema,
        ),
      ).not.toThrow();
    });

    it("should reject invalid email in userName", () => {
      expect(() =>
        validate({ userName: "not-an-email" }, scimUserSchema),
      ).toThrow();
    });

    it("should reject missing userName", () => {
      expect(() =>
        validate({ active: true }, scimUserSchema),
      ).toThrow();
    });

    it("should reject invalid email in emails array", () => {
      expect(() =>
        validate(
          {
            userName: "user@example.com",
            emails: [{ value: "not-an-email" }],
          },
          scimUserSchema,
        ),
      ).toThrow();
    });

    it("should reject invalid UUID in roleId", () => {
      expect(() =>
        validate(
          { userName: "user@example.com", roleId: "not-a-uuid" },
          scimUserSchema,
        ),
      ).toThrow();
    });
  });

  describe("scimGroupSchema", () => {
    it("should validate correct SCIM group", () => {
      const value = validate(
        { displayName: "Developers" },
        scimGroupSchema,
      );

      expect(value.displayName).toBe("Developers");
    });

    it("should validate with members", () => {
      expect(() =>
        validate(
          {
            displayName: "Developers",
            members: [{ value: "123e4567-e89b-12d3-a456-426614174000", display: "John Doe" }],
          },
          scimGroupSchema,
        ),
      ).not.toThrow();
    });

    it("should validate with multiple members", () => {
      expect(() =>
        validate(
          {
            displayName: "Developers",
            members: [
              { value: "123e4567-e89b-12d3-a456-426614174000" },
              { value: "123e4567-e89b-12d3-a456-426614174001", display: "Jane Smith" },
            ],
          },
          scimGroupSchema,
        ),
      ).not.toThrow();
    });

    it("should reject missing displayName", () => {
      expect(() =>
        validate({ members: [] }, scimGroupSchema),
      ).toThrow();
    });

    it("should reject invalid member UUID", () => {
      expect(() =>
        validate(
          {
            displayName: "Developers",
            members: [{ value: "not-a-uuid" }],
          },
          scimGroupSchema,
        ),
      ).toThrow();
    });
  });

  describe("scimPatchSchema", () => {
    it("should validate add operation", () => {
      expect(() =>
        validate(
          {
            Operations: [
              { op: "add", path: "userName", value: "newuser@example.com" },
            ],
          },
          scimPatchSchema,
        ),
      ).not.toThrow();
    });

    it("should validate replace operation with string value", () => {
      expect(() =>
        validate(
          {
            Operations: [
              { op: "replace", path: "active", value: "false" },
            ],
          },
          scimPatchSchema,
        ),
      ).not.toThrow();
    });

    it("should validate remove operation", () => {
      expect(() =>
        validate(
          {
            Operations: [
              { op: "remove", path: "emails" },
            ],
          },
          scimPatchSchema,
        ),
      ).not.toThrow();
    });

    it("should validate with object value", () => {
      expect(() =>
        validate(
          {
            Operations: [
              { op: "replace", value: { name: { givenName: "John" } } },
            ],
          },
          scimPatchSchema,
        ),
      ).not.toThrow();
    });

    it("should validate with array value", () => {
      expect(() =>
        validate(
          {
            Operations: [
              { op: "replace", value: ["a", "b", "c"] },
            ],
          },
          scimPatchSchema,
        ),
      ).not.toThrow();
    });

    it("should reject invalid op value", () => {
      expect(() =>
        validate(
          {
            Operations: [
              { op: "invalid", path: "userName" },
            ],
          },
          scimPatchSchema,
        ),
      ).toThrow();
    });

    it("should reject missing op", () => {
      expect(() =>
        validate(
          {
            Operations: [
              { path: "userName" },
            ],
          },
          scimPatchSchema,
        ),
      ).toThrow();
    });

    it("should reject missing Operations array", () => {
      expect(() =>
        validate({}, scimPatchSchema),
      ).toThrow();
    });
  });
});
