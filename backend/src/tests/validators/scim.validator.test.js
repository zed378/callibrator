/**
 * SCIM validator tests
 *
 * P9-11 (ADR-093): the module's own validate() is gone; the SCIM controller
 * checks bodies with the shared validateInput (validators/input), so that is
 * what these tests call. It returns the parsed value or throws
 * { status: 400, message: "Validation failed", errors: [{ field, message }] }.
 */
const {
  scimUserSchema,
  scimGroupSchema,
  scimPatchSchema,
} = require("../../validators/scim.validator");
const { validateInput } = require("../../validators/input");

const validate = validateInput;

/**
 * @param {unknown} data - the input
 * @param {import("zod").ZodType} schema - the schema
 * @returns {Array<{field: string, message: string}>} the field errors validateInput threw
 */
const errorsOf = (data, schema) => {
  try {
    validate(data, schema);
  } catch (error) {
    expect(error).toMatchObject({ status: 400, message: "Validation failed" });
    return error.errors;
  }
  throw new Error("expected a validation failure");
};

const OP_OPTIONS = 'Invalid option: expected one of "add"|"remove"|"replace"';

describe("SCIM Validators", () => {
  describe("scimUserSchema", () => {
    it("should validate correct SCIM user", () => {
      const value = validate({ userName: "user@example.com", active: true }, scimUserSchema);

      expect(value).toEqual({ userName: "user@example.com", active: true });
    });

    it("should validate with name object", () => {
      const value = validate(
        { userName: "user@example.com", name: { givenName: "John", familyName: "Doe" } },
        scimUserSchema,
      );
      expect(value.name).toEqual({ givenName: "John", familyName: "Doe" });
    });

    it("should validate with partial name", () => {
      expect(() => validate({ userName: "user@example.com", name: { givenName: "John" } }, scimUserSchema)).not.toThrow();
    });

    it("should validate with emails array", () => {
      expect(() =>
        validate(
          { userName: "user@example.com", emails: [{ value: "user@example.com", type: "work", primary: true }] },
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
        validate({ userName: "user@example.com", roleId: "123e4567-e89b-12d3-a456-426614174000" }, scimUserSchema),
      ).not.toThrow();
    });

    it("should validate with inactive user", () => {
      expect(validate({ userName: "user@example.com", active: false }, scimUserSchema).active).toBe(false);
    });

    it("should convert boolean strings for active and primary", () => {
      const value = validate(
        { userName: "user@example.com", active: "False", emails: [{ value: "a@b.co", primary: "true" }] },
        scimUserSchema,
      );
      expect(value.active).toBe(false);
      expect(value.emails[0].primary).toBe(true);
    });

    it("should strip unknown keys, at the top level and nested", () => {
      const value = validate(
        { schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], userName: "user@example.com", name: { givenName: "J", x: 1 } },
        scimUserSchema,
      );
      expect(value).toEqual({ userName: "user@example.com", name: { givenName: "J" } });
    });

    it("should reject invalid email in userName", () => {
      expect(errorsOf({ userName: "not-an-email" }, scimUserSchema)).toEqual([
        { field: "userName", message: "Invalid email address" },
      ]);
    });

    it("should reject missing userName", () => {
      expect(errorsOf({ active: true }, scimUserSchema)).toEqual([
        { field: "userName", message: "Invalid input: expected string, received undefined" },
      ]);
    });

    it("should reject an absent body (A-09)", () => {
      expect(errorsOf(undefined, scimUserSchema)).toEqual([
        { field: "userName", message: "Invalid input: expected string, received undefined" },
      ]);
    });

    it("should reject invalid email in emails array", () => {
      expect(errorsOf({ userName: "user@example.com", emails: [{ value: "not-an-email" }] }, scimUserSchema)).toEqual([
        { field: "emails.0.value", message: "Invalid email address" },
      ]);
    });

    it("should reject an empty givenName", () => {
      expect(errorsOf({ userName: "user@example.com", name: { givenName: "" } }, scimUserSchema)).toEqual([
        { field: "name.givenName", message: "Too small: expected string to have >=1 characters" },
      ]);
    });

    it("should reject invalid UUID in roleId", () => {
      expect(errorsOf({ userName: "user@example.com", roleId: "not-a-uuid" }, scimUserSchema)).toEqual([
        { field: "roleId", message: "Invalid GUID" },
      ]);
    });
  });

  describe("scimGroupSchema", () => {
    it("should validate correct SCIM group", () => {
      const value = validate({ displayName: "Developers" }, scimGroupSchema);

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
      expect(errorsOf({ members: [] }, scimGroupSchema)).toEqual([
        { field: "displayName", message: "Invalid input: expected string, received undefined" },
      ]);
    });

    it("should reject an empty displayName", () => {
      expect(errorsOf({ displayName: "" }, scimGroupSchema)).toEqual([
        { field: "displayName", message: "Too small: expected string to have >=1 characters" },
      ]);
    });

    it("should reject invalid member UUID", () => {
      expect(errorsOf({ displayName: "Developers", members: [{ value: "not-a-uuid" }] }, scimGroupSchema)).toEqual([
        { field: "members.0.value", message: "Invalid GUID" },
      ]);
    });

    // ADR-053 / A-39: a group may name the role it grants.
    it("accepts a UUID roleId and keeps it", () => {
      const roleId = "11111111-1111-4111-8111-111111111111";
      expect(validate({ displayName: "Techs", roleId }, scimGroupSchema)).toEqual({ displayName: "Techs", roleId });
    });

    it("rejects a malformed roleId, and a displayName longer than its 255-character column", () => {
      expect(errorsOf({ displayName: "Techs", roleId: "not-a-uuid" }, scimGroupSchema)).toEqual([
        { field: "roleId", message: "Invalid GUID" },
      ]);
      expect(errorsOf({ displayName: "x".repeat(256) }, scimGroupSchema)).toEqual([
        { field: "displayName", message: "Too big: expected string to have <=255 characters" },
      ]);
    });
  });

  describe("scimPatchSchema", () => {
    it("should validate add operation", () => {
      expect(() =>
        validate({ Operations: [{ op: "add", path: "userName", value: "newuser@example.com" }] }, scimPatchSchema),
      ).not.toThrow();
    });

    it("should validate replace operation with string value", () => {
      const value = validate({ Operations: [{ op: "replace", path: "active", value: "false" }] }, scimPatchSchema);
      // The string is passed through as sent; the service interprets it.
      expect(value.Operations[0].value).toBe("false");
    });

    it("should validate remove operation", () => {
      expect(() => validate({ Operations: [{ op: "remove", path: "emails" }] }, scimPatchSchema)).not.toThrow();
    });

    it("should validate with object value", () => {
      const value = validate({ Operations: [{ op: "replace", value: { name: { givenName: "John" } } }] }, scimPatchSchema);
      expect(value.Operations[0].value).toEqual({ name: { givenName: "John" } });
    });

    it("should validate with array value", () => {
      const value = validate({ Operations: [{ op: "replace", value: ["a", "b", "c"] }] }, scimPatchSchema);
      expect(value.Operations[0].value).toEqual(["a", "b", "c"]);
    });

    it("should strip unknown keys (schemas, and extra keys on an operation)", () => {
      const value = validate(
        { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "add", value: "x", extra: 1 }] },
        scimPatchSchema,
      );
      expect(value).toEqual({ Operations: [{ op: "add", value: "x" }] });
    });

    it("should reject invalid op value", () => {
      expect(errorsOf({ Operations: [{ op: "invalid", path: "userName" }] }, scimPatchSchema)).toEqual([
        { field: "Operations.0.op", message: OP_OPTIONS },
      ]);
    });

    it("should reject missing op", () => {
      expect(errorsOf({ Operations: [{ path: "userName" }] }, scimPatchSchema)).toEqual([
        { field: "Operations.0.op", message: OP_OPTIONS },
      ]);
    });

    it("should reject missing Operations array", () => {
      expect(errorsOf({}, scimPatchSchema)).toEqual([
        { field: "Operations", message: "Invalid input: expected array, received undefined" },
      ]);
    });

    it("should reject an empty path", () => {
      expect(errorsOf({ Operations: [{ op: "replace", path: "" }] }, scimPatchSchema)).toEqual([
        { field: "Operations.0.path", message: "Too small: expected string to have >=1 characters" },
      ]);
    });

    it("should reject a null value", () => {
      expect(errorsOf({ Operations: [{ op: "replace", value: null }] }, scimPatchSchema)).toEqual([
        { field: "Operations.0.value", message: "Invalid input" },
      ]);
    });

    // A-33: the canonical Okta/Entra deprovision payload carries a JSON
    // boolean. The alternatives used to list only object/array/string, so this
    // was a 400 from the validator before the service was ever reached.
    it("accepts the boolean value an IdP sends to deactivate a user", () => {
      const value = validate({ Operations: [{ op: "replace", path: "active", value: false }] }, scimPatchSchema);

      expect(value.Operations[0]).toEqual({ op: "replace", path: "active", value: false });
    });

    it("accepts a numeric value", () => {
      const value = validate({ Operations: [{ op: "replace", path: "roleId", value: 3 }] }, scimPatchSchema);

      expect(value.Operations[0].value).toBe(3);
    });

    it("accepts an Okta members value filter as a path", () => {
      const value = validate({ Operations: [{ op: "remove", path: 'members[value eq "abc"]' }] }, scimPatchSchema);

      expect(value.Operations[0].path).toBe('members[value eq "abc"]');
    });
  });
});
