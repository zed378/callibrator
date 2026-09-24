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

    // ADR-053 / A-39: a group may name the role it grants.
    it("accepts a UUID roleId and keeps it", () => {
      const roleId = "11111111-1111-4111-8111-111111111111";
      expect(validate({ displayName: "Techs", roleId }, scimGroupSchema)).toEqual({ displayName: "Techs", roleId });
    });

    it("rejects a malformed roleId, and a displayName longer than its 255-character column", () => {
      expect(() => validate({ displayName: "Techs", roleId: "not-a-uuid" }, scimGroupSchema)).toThrow();
      expect(() => validate({ displayName: "x".repeat(256) }, scimGroupSchema)).toThrow();
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

    // A-33: the canonical Okta/Entra deprovision payload carries a JSON
    // boolean. The alternatives used to list only object/array/string, so this
    // was a 400 from the validator before the service was ever reached.
    it("accepts the boolean value an IdP sends to deactivate a user", () => {
      const value = validate(
        { Operations: [{ op: "replace", path: "active", value: false }] },
        scimPatchSchema,
      );

      expect(value.Operations[0]).toEqual({ op: "replace", path: "active", value: false });
    });

    it("accepts a numeric value", () => {
      const value = validate(
        { Operations: [{ op: "replace", path: "roleId", value: 3 }] },
        scimPatchSchema,
      );

      expect(value.Operations[0].value).toBe(3);
    });

    it("accepts an Okta members value filter as a path", () => {
      const value = validate(
        { Operations: [{ op: "remove", path: 'members[value eq "abc"]' }] },
        scimPatchSchema,
      );

      expect(value.Operations[0].path).toBe('members[value eq "abc"]');
    });
  });
});
