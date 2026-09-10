/**
 * Tests for user.validator.js
 */
const Joi = require("joi");
const {
  getAllUsersQuery,
  createUserSchema,
  updateUserSchema,
  userParamSchema,
  updateRoleSchema,
  usernameCheckSchema,
  validate,
  formatErrors,
} = require("../../validators/user.validator");

describe("user.validator", () => {
  // ================================================================
  // getAllUsersQuery
  // ================================================================
  describe("getAllUsersQuery", () => {
    it("should accept valid query with defaults", () => {
      const { error, value } = getAllUsersQuery.validate({});
      expect(error).toBeUndefined();
      expect(value.page).toBe(1);
      expect(value.limit).toBe(50);
    });

    it("should accept valid query with custom values", () => {
      const { error, value } = getAllUsersQuery.validate({
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
      const { error } = getAllUsersQuery.validate({ page: 0 });
      expect(error).toBeDefined();
      expect(error.details[0].message).toContain("greater than or equal to");
    });

    it("should reject limit over max", () => {
      const { error } = getAllUsersQuery.validate({ limit: 101 });
      expect(error).toBeDefined();
    });

    it("should accept null status", () => {
      const { error, value } = getAllUsersQuery.validate({ status: null });
      expect(error).toBeUndefined();
    });

    it("should accept empty string status", () => {
      const { error } = getAllUsersQuery.validate({ status: "" });
      expect(error).toBeUndefined();
    });

    it("should reject invalid tenantId (not UUID)", () => {
      const { error } = getAllUsersQuery.validate({ tenantId: "not-a-uuid" });
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
      const { error, value } = createUserSchema.validate(validInput);
      expect(error).toBeUndefined();
      expect(value.email).toBe("new@test.com");
    });

    it("should normalize status to uppercase", () => {
      const { error, value } = createUserSchema.validate({
        ...validInput,
        status: "active",
      });
      expect(error).toBeUndefined();
      expect(value.status).toBe("ACTIVE");
    });

    it("should reject missing username", () => {
      createUserSchema.validate({ ...validInput });
      const { error: err } = createUserSchema.validate({
        firstName: "New",
        lastName: "User",
        email: "new@test.com",
        password: "securepass123",
        roleId: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(err).toBeDefined();
    });

    it("should reject username too short", () => {
      const { error } = createUserSchema.validate({
        ...validInput,
        username: "ab",
      });
      expect(error).toBeDefined();
    });

    it("should reject non-alphanumeric username", () => {
      const { error } = createUserSchema.validate({
        ...validInput,
        username: "new@user",
      });
      expect(error).toBeDefined();
    });

    it("should reject invalid email", () => {
      const { error } = createUserSchema.validate({
        ...validInput,
        email: "not-an-email",
      });
      expect(error).toBeDefined();
    });

    it("should reject short password", () => {
      const { error } = createUserSchema.validate({
        ...validInput,
        password: "short",
      });
      expect(error).toBeDefined();
    });

    it("should reject missing roleId", () => {
      const { error } = createUserSchema.validate({
        ...validInput,
        roleId: "not-a-uuid",
      });
      expect(error).toBeDefined();
    });

    it("should lowercase email and username", () => {
      const { error, value } = createUserSchema.validate({
        ...validInput,
        email: "NEW@TEST.COM",
        username: "NEWUSER",
      });
      expect(error).toBeUndefined();
      expect(value.email).toBe("new@test.com");
    });

    it("should accept null tenantId", () => {
      const { error, value } = createUserSchema.validate({
        ...validInput,
        tenantId: null,
      });
      expect(error).toBeUndefined();
    });

    it("should reject invalid status value", () => {
      const { error } = createUserSchema.validate({
        ...validInput,
        status: "INVALID",
      });
      expect(error).toBeDefined();
    });

    it("should accept null status and skip uppercase transformation", () => {
      const { error, value } = createUserSchema.validate({
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
      const { error, value } = updateUserSchema.validate({
        userId: "11111111-1111-4111-8111-111111111111",
        firstName: "Updated",
      });
      expect(error).toBeUndefined();
    });

    it("should reject invalid email", () => {
      const { error } = updateUserSchema.validate({
        userId: "11111111-1111-4111-8111-111111111111",
        email: "not-an-email",
      });
      expect(error).toBeDefined();
    });

    it("should normalize status to uppercase", () => {
      const { error, value } = updateUserSchema.validate({
        userId: "11111111-1111-4111-8111-111111111111",
        status: "inactive",
      });
      expect(error).toBeUndefined();
      expect(value.status).toBe("INACTIVE");
    });

    it("should reject username too short", () => {
      const { error } = updateUserSchema.validate({
        userId: "11111111-1111-4111-8111-111111111111",
        username: "ab",
      });
      expect(error).toBeDefined();
    });

    it("should lowercase email", () => {
      const { error, value } = updateUserSchema.validate({
        userId: "11111111-1111-4111-8111-111111111111",
        email: "TEST@UPPER.COM",
      });
      expect(error).toBeUndefined();
      expect(value.email).toBe("test@upper.com");
    });

    it("should reject empty firstName", () => {
      const { error } = updateUserSchema.validate({
        userId: "11111111-1111-4111-8111-111111111111",
        firstName: "A",
      });
      expect(error).toBeDefined();
    });

    it("should accept all fields", () => {
      const { error, value } = updateUserSchema.validate({
        userId: "11111111-1111-4111-8111-111111111111",
        username: "validuser",
        firstName: "First",
        lastName: "Last",
        email: "valid@test.com",
        status: "ACTIVE",
      });
      expect(error).toBeUndefined();
    });
  });

  // ================================================================
  // userParamSchema
  // ================================================================
  describe("userParamSchema", () => {
    it("should accept valid userId", () => {
      const { error } = userParamSchema.validate({
        userId: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(error).toBeUndefined();
    });

    it("should reject missing userId", () => {
      const { error } = userParamSchema.validate({});
      expect(error).toBeDefined();
    });

    it("should reject invalid userId format", () => {
      const { error } = userParamSchema.validate({ userId: "not-a-uuid" });
      expect(error).toBeDefined();
    });
  });

  // ================================================================
  // updateRoleSchema
  // ================================================================
  describe("updateRoleSchema", () => {
    it("should accept valid userId and roleId", () => {
      const { error } = updateRoleSchema.validate({
        userId: "550e8400-e29b-41d4-a716-446655440000",
        roleId: "550e8400-e29b-41d4-a716-446655440001",
      });
      expect(error).toBeUndefined();
    });

    it("should reject missing userId", () => {
      const { error } = updateRoleSchema.validate({
        roleId: "550e8400-e29b-41d4-a716-446655440001",
      });
      expect(error).toBeDefined();
    });

    it("should reject missing roleId", () => {
      const { error } = updateRoleSchema.validate({
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
      const { error } = usernameCheckSchema.validate({ username: "validuser" });
      expect(error).toBeUndefined();
    });

    it("should reject missing username", () => {
      const { error } = usernameCheckSchema.validate({});
      expect(error).toBeDefined();
    });

    it("should reject short username", () => {
      const { error } = usernameCheckSchema.validate({ username: "ab" });
      expect(error).toBeDefined();
    });

    it("should reject non-alphanumeric username", () => {
      const { error } = usernameCheckSchema.validate({ username: "user@name" });
      expect(error).toBeDefined();
    });
  });

  // ================================================================
  // validate helper
  // ================================================================
  describe("validate", () => {
    it("should return error for invalid data", () => {
      const { error, value } = validate({}, createUserSchema);
      expect(error).toBeDefined();
    });

    it("should return value for valid data", () => {
      const { error, value } = validate(
        {
          username: "newuser",
          firstName: "New",
          lastName: "User",
          email: "new@test.com",
          password: "securepass123",
          roleId: "550e8400-e29b-41d4-a716-446655440000",
        },
        createUserSchema,
      );
      expect(error).toBeUndefined();
      expect(value.username).toBe("newuser");
    });

    it("should strip unknown keys", () => {
      const { error, value } = validate(
        {
          username: "newuser",
          firstName: "New",
          lastName: "User",
          email: "new@test.com",
          password: "securepass123",
          roleId: "550e8400-e29b-41d4-a716-446655440000",
          unknownField: "should be stripped",
        },
        createUserSchema,
      );
      expect(error).toBeUndefined();
      expect(value.unknownField).toBeUndefined();
    });
  });

  // ================================================================
  // formatErrors
  // ================================================================
  describe("formatErrors", () => {
    it("should format a single error", () => {
      const errors = formatErrors([
        { path: ["username"], message: '"username" is required' },
      ]);
      expect(errors).toEqual([
        { field: "username", message: '"username" is required' },
      ]);
    });

    it("should format nested path errors", () => {
      const errors = formatErrors([
        { path: ["profile", "email"], message: '"profile.email" is invalid' },
      ]);
      expect(errors).toEqual([
        { field: "profile.email", message: '"profile.email" is invalid' },
      ]);
    });

    it("should format multiple errors", () => {
      const errors = formatErrors([
        { path: ["username"], message: '"username" is required' },
        { path: ["email"], message: '"email" must be a valid email' },
      ]);
      expect(errors).toHaveLength(2);
      expect(errors[0].field).toBe("username");
      expect(errors[1].field).toBe("email");
    });
  });
});
