/**
 * Tests for user.validator
 *
 * P9-11: the schemas are Zod, and the file's own validate()/formatErrors()
 * are gone. `run` checks through the shared checkInput and answers in the
 * old `{ error, value }` shape, with `error` the `{ field, message }` list.
 * The old tests called `schema.validate(x)` without options; the app never
 * did, and checkInput is always strip-unknown with every issue reported.
 */
const {
  getAllUsersQuery,
  createUserSchema,
  updateUserSchema,
  updateProfileSchema,
  userParamSchema,
  updateRoleSchema,
  usernameCheckSchema,
} = require("../../validators/user.validator");
const { checkInput, validateInput } = require("../../validators/input");

const run = (schema, data) => {
  const result = checkInput(data, schema);
  return result.ok ? { error: undefined, value: result.value } : { error: result.errors, value: undefined };
};

describe("user.validator", () => {
  // ================================================================
  // getAllUsersQuery
  // ================================================================
  describe("getAllUsersQuery", () => {
    it("should accept valid query with defaults", () => {
      const { error, value } = run(getAllUsersQuery, {});
      expect(error).toBeUndefined();
      expect(value.page).toBe(1);
      expect(value.limit).toBe(50);
    });

    it("should accept valid query with custom values", () => {
      const { error, value } = run(getAllUsersQuery, {
        page: 2,
        limit: 20,
        find: "john",
        status: "ACTIVE",
        roleFilter: "role-uuid",
        tenantId: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(error).toBeUndefined();
      expect(value.page).toBe(2);
      expect(value.limit).toBe(20);
      expect(value.find).toBe("john");
    });

    it("should reject invalid page", () => {
      const { error } = run(getAllUsersQuery, { page: 0 });
      expect(error).toBeDefined();
      expect(error).toEqual([{ field: "page", message: "Too small: expected number to be >=1" }]);
    });

    it("should reject limit over max", () => {
      const { error } = run(getAllUsersQuery, { limit: 101 });
      expect(error).toBeDefined();
    });

    it("should fold a status filter to upper case", () => {
      // P9-11 NORMALISATION DIFF: the old insensitive match returned the
      // listed spelling ("active" stayed "active"; this schema had no
      // upper-casing custom()). Zod folds every match to upper case, the case
      // the users table stores.
      expect(run(getAllUsersQuery, { status: "active" }).value.status).toBe("ACTIVE");
      expect(run(getAllUsersQuery, { status: "InActive" }).value.status).toBe("INACTIVE");
    });

    it("should convert numeric-string page and limit, and accept an empty tenantId", () => {
      const { error, value } = run(getAllUsersQuery, { page: "3", limit: "10", tenantId: "" });
      expect(error).toBeUndefined();
      expect(value).toEqual({ page: 3, limit: 10, tenantId: "" });
    });

    it("should accept null status", () => {
      const { error, value } = run(getAllUsersQuery, { status: null });
      expect(error).toBeUndefined();
      expect(value.status).toBeNull();
    });

    it("should accept empty string status", () => {
      const { error } = run(getAllUsersQuery, { status: "" });
      expect(error).toBeUndefined();
    });

    it("should reject invalid tenantId (not UUID)", () => {
      const { error } = run(getAllUsersQuery, { tenantId: "not-a-uuid" });
      expect(error).toBeDefined();
    });
  });

  // ================================================================
  // createUserSchema
  // ================================================================
  describe("createUserSchema", () => {
    const validInput = {
      username: "newuser",
      firstName: "New",
      lastName: "User",
      email: "new@test.com",
      password: "securepass123",
      roleId: "550e8400-e29b-41d4-a716-446655440000",
    };

    it("should accept valid user data", () => {
      const { error, value } = run(createUserSchema, validInput);
      expect(error).toBeUndefined();
      expect(value.email).toBe("new@test.com");
    });

    it("should normalize status to uppercase", () => {
      const { error, value } = run(createUserSchema, {
        ...validInput,
        status: "active",
      });
      expect(error).toBeUndefined();
      expect(value.status).toBe("ACTIVE");
    });

    it("should reject missing username", () => {
      run(createUserSchema, { ...validInput });
      const { error: err } = run(createUserSchema, {
        firstName: "New",
        lastName: "User",
        email: "new@test.com",
        password: "securepass123",
        roleId: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(err).toBeDefined();
    });

    it("should reject username too short", () => {
      const { error } = run(createUserSchema, {
        ...validInput,
        username: "ab",
      });
      expect(error).toBeDefined();
    });

    it("should reject non-alphanumeric username", () => {
      const { error } = run(createUserSchema, {
        ...validInput,
        username: "new@user",
      });
      expect(error).toEqual([
        { field: "username", message: "Username must only contain letters and digits" },
      ]);
    });

    it("should report every failing username rule", () => {
      const { error } = run(createUserSchema, { ...validInput, username: "a@" });
      expect(error).toEqual([
        { field: "username", message: "Username must only contain letters and digits" },
        { field: "username", message: "Too small: expected string to have >=3 characters" },
      ]);
    });

    it("should trim first and last names", () => {
      const { value } = run(createUserSchema, { ...validInput, firstName: "  Al  ", lastName: " Bo " });
      expect(value.firstName).toBe("Al");
      expect(value.lastName).toBe("Bo");
    });

    it("should refuse an empty status (null is the only blank allowed)", () => {
      const { error } = run(createUserSchema, { ...validInput, status: "" });
      expect(error).toEqual([
        { field: "status", message: 'Invalid option: expected one of "ACTIVE"|"INACTIVE"|"SUSPENDED"' },
      ]);
    });

    it("should reject invalid email", () => {
      const { error } = run(createUserSchema, {
        ...validInput,
        email: "not-an-email",
      });
      expect(error).toEqual([{ field: "email", message: "Invalid email address" }]);
    });

    it("should reject short password", () => {
      const { error } = run(createUserSchema, {
        ...validInput,
        password: "short",
      });
      expect(error).toBeDefined();
    });

    it("should reject missing roleId", () => {
      const { error } = run(createUserSchema, {
        ...validInput,
        roleId: "not-a-uuid",
      });
      expect(error).toBeDefined();
    });

    it("should lowercase email and username", () => {
      const { error, value } = run(createUserSchema, {
        ...validInput,
        email: "NEW@TEST.COM",
        username: "NEWUSER",
      });
      expect(error).toBeUndefined();
      expect(value.email).toBe("new@test.com");
      expect(value.username).toBe("newuser");
    });

    it("should accept null tenantId", () => {
      const { error, value } = run(createUserSchema, {
        ...validInput,
        tenantId: null,
      });
      expect(error).toBeUndefined();
      expect(value.tenantId).toBeNull();
    });

    it("should reject invalid status value", () => {
      const { error } = run(createUserSchema, {
        ...validInput,
        status: "INVALID",
      });
      expect(error).toBeDefined();
    });

    it("should accept null status and skip uppercase transformation", () => {
      const { error, value } = run(createUserSchema, {
        ...validInput,
        status: null,
      });
      expect(error).toBeUndefined();
      expect(value.status).toBeNull();
    });
  });

  // ================================================================
  // updateUserSchema
  // ================================================================
  describe("updateUserSchema", () => {
    it("should accept partial update", () => {
      const { error, value } = run(updateUserSchema, {
        userId: "11111111-1111-4111-8111-111111111111",
        firstName: "Updated",
      });
      expect(error).toBeUndefined();
      expect(value).toEqual({ userId: "11111111-1111-4111-8111-111111111111", firstName: "Updated" });
    });

    it("should reject invalid email", () => {
      const { error } = run(updateUserSchema, {
        userId: "11111111-1111-4111-8111-111111111111",
        email: "not-an-email",
      });
      expect(error).toBeDefined();
    });

    it("should normalize status to uppercase", () => {
      const { error, value } = run(updateUserSchema, {
        userId: "11111111-1111-4111-8111-111111111111",
        status: "inactive",
      });
      expect(error).toBeUndefined();
      expect(value.status).toBe("INACTIVE");
    });

    it("should reject username too short", () => {
      const { error } = run(updateUserSchema, {
        userId: "11111111-1111-4111-8111-111111111111",
        username: "ab",
      });
      expect(error).toBeDefined();
    });

    it("should lowercase username", () => {
      const { value } = run(updateUserSchema, {
        userId: "11111111-1111-4111-8111-111111111111",
        username: "ABCdef",
      });
      expect(value.username).toBe("abcdef");
    });

    it("should refuse a null or empty status", () => {
      const userId = "11111111-1111-4111-8111-111111111111";
      expect(run(updateUserSchema, { userId, status: null }).error).toEqual([
        { field: "status", message: "Invalid input: expected string, received null" },
      ]);
      expect(run(updateUserSchema, { userId, status: "" }).error).toBeDefined();
    });

    it("should require userId", () => {
      expect(run(updateUserSchema, { firstName: "Updated" }).error).toEqual([
        { field: "userId", message: "Invalid input: expected string, received undefined" },
      ]);
    });

    it("should lowercase email", () => {
      const { error, value } = run(updateUserSchema, {
        userId: "11111111-1111-4111-8111-111111111111",
        email: "TEST@UPPER.COM",
      });
      expect(error).toBeUndefined();
      expect(value.email).toBe("test@upper.com");
    });

    it("should reject empty firstName", () => {
      const { error } = run(updateUserSchema, {
        userId: "11111111-1111-4111-8111-111111111111",
        firstName: "A",
      });
      expect(error).toBeDefined();
    });

    it("should accept all fields", () => {
      const { error, value } = run(updateUserSchema, {
        userId: "11111111-1111-4111-8111-111111111111",
        username: "validuser",
        firstName: "First",
        lastName: "Last",
        email: "valid@test.com",
        status: "ACTIVE",
      });
      expect(error).toBeUndefined();
      expect(value.status).toBe("ACTIVE");
    });
  });

  // ================================================================
  // updateProfileSchema (A-63)
  // ================================================================
  describe("updateProfileSchema", () => {
    const userId = "11111111-1111-4111-8111-111111111111";

    it("keeps only the profile fields: status and email are stripped", () => {
      const { error, value } = run(updateProfileSchema, {
        userId,
        username: "ABCdef",
        firstName: " First ",
        email: "x@y.com",
        status: "ACTIVE",
      });
      expect(error).toBeUndefined();
      expect(value).toEqual({ userId, username: "abcdef", firstName: "First" });
    });

    it("requires userId and checks the name rules", () => {
      expect(run(updateProfileSchema, {}).error).toEqual([
        { field: "userId", message: "Invalid input: expected string, received undefined" },
      ]);
      expect(run(updateProfileSchema, { userId, lastName: "B" }).error).toBeDefined();
    });
  });

  // ================================================================
  // userParamSchema
  // ================================================================
  describe("userParamSchema", () => {
    it("should accept valid userId", () => {
      const { error } = run(userParamSchema, {
        userId: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(error).toBeUndefined();
    });

    it("should reject missing userId", () => {
      const { error } = run(userParamSchema, {});
      expect(error).toBeDefined();
    });

    it("should reject invalid userId format", () => {
      const { error } = run(userParamSchema, { userId: "not-a-uuid" });
      expect(error).toBeDefined();
    });
  });

  // ================================================================
  // updateRoleSchema
  // ================================================================
  describe("updateRoleSchema", () => {
    it("should accept valid userId and roleId", () => {
      const { error } = run(updateRoleSchema, {
        userId: "550e8400-e29b-41d4-a716-446655440000",
        roleId: "550e8400-e29b-41d4-a716-446655440001",
      });
      expect(error).toBeUndefined();
    });

    it("should reject missing userId", () => {
      const { error } = run(updateRoleSchema, {
        roleId: "550e8400-e29b-41d4-a716-446655440001",
      });
      expect(error).toBeDefined();
    });

    it("should reject missing roleId", () => {
      const { error } = run(updateRoleSchema, {
        userId: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(error).toBeDefined();
    });
  });

  // ================================================================
  // usernameCheckSchema
  // ================================================================
  describe("usernameCheckSchema", () => {
    it("should accept valid username", () => {
      const { error } = run(usernameCheckSchema, { username: "validuser" });
      expect(error).toBeUndefined();
    });

    it("should reject missing username", () => {
      const { error } = run(usernameCheckSchema, {});
      expect(error).toBeDefined();
    });

    it("should reject short username", () => {
      const { error } = run(usernameCheckSchema, { username: "ab" });
      expect(error).toBeDefined();
    });

    it("should reject a username over 30 characters", () => {
      expect(run(usernameCheckSchema, { username: "a".repeat(31) }).error).toEqual([
        { field: "username", message: "Too big: expected string to have <=30 characters" },
      ]);
    });

    it("should not change the case of a checked username", () => {
      expect(run(usernameCheckSchema, { username: "ABCdef" }).value).toEqual({ username: "ABCdef" });
    });

    it("should reject non-alphanumeric username", () => {
      const { error } = run(usernameCheckSchema, { username: "user@name" });
      expect(error).toBeDefined();
    });
  });

  // ================================================================
  // shared helpers (P9-11: the file's validate/formatErrors are gone)
  // ================================================================
  describe("checkInput / validateInput", () => {
    const valid = {
      username: "newuser",
      firstName: "New",
      lastName: "User",
      email: "new@test.com",
      password: "securepass123",
      roleId: "550e8400-e29b-41d4-a716-446655440000",
    };

    it("should list every missing required field, in schema order", () => {
      const result = checkInput(undefined, createUserSchema);
      expect(result.ok).toBe(false);
      expect(result.errors.map((e) => e.field)).toEqual([
        "username",
        "firstName",
        "lastName",
        "email",
        "password",
        "roleId",
      ]);
      expect(result.errors[0].message).toBe("Invalid input: expected string, received undefined");
    });

    it("should return value for valid data", () => {
      expect(validateInput(valid, createUserSchema)).toEqual({ ...valid, status: "ACTIVE" });
    });

    it("should strip unknown keys", () => {
      const value = validateInput({ ...valid, unknownField: "should be stripped" }, createUserSchema);
      expect(value.unknownField).toBeUndefined();
    });

    it("should throw the 400 object for invalid data", () => {
      let thrown;
      try {
        validateInput({ ...valid, password: "short" }, createUserSchema);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toEqual({
        status: 400,
        message: "Validation failed",
        errors: [{ field: "password", message: "Too small: expected string to have >=8 characters" }],
      });
    });
  });
});
