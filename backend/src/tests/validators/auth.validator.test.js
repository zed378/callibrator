/**
 * Auth validator tests
 */
const {
  validate,
  formatErrors,
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} = require("../../validators/auth.validator");

describe("Auth Validators", () => {
  describe("registerSchema", () => {
    it("should validate correct registration data", () => {
      const data = {
        firstName: "John",
        lastName: "Doe",
        username: "johndoe",
        email: "john@example.com",
        password: "Password123",
      };

      const { error, value } = validate(data, registerSchema);

      expect(error).toBeUndefined();
      expect(value).toEqual({
        firstName: "John",
        lastName: "Doe",
        username: "johndoe",
        email: "john@example.com",
        password: "Password123",
      });
    });

    it("should reject missing required fields", () => {
      const data = {
        firstName: "John",
      };

      const { error } = validate(data, registerSchema);

      expect(error).toBeDefined();
      expect(error.details).toHaveLength(3);
    });

    it("should reject invalid email", () => {
      const data = {
        firstName: "John",
        lastName: "Doe",
        username: "johndoe",
        email: "invalid-email",
        password: "Password123",
      };

      const { error } = validate(data, registerSchema);

      expect(error).toBeDefined();
      expect(error.details[0].path).toContain("email");
    });

    it("should reject weak password", () => {
      const data = {
        firstName: "John",
        lastName: "Doe",
        username: "johndoe",
        email: "john@example.com",
        password: "weak",
      };

      const { error } = validate(data, registerSchema);

      expect(error).toBeDefined();
      expect(error.details[0].path).toContain("password");
    });

    it("should allow null lastName", () => {
      const data = {
        firstName: "John",
        lastName: null,
        username: "johndoe",
        email: "john@example.com",
        password: "Password123",
      };

      const { error } = validate(data, registerSchema);

      expect(error).toBeUndefined();
    });
  });

  describe("loginSchema", () => {
    it("should validate correct login data with email", () => {
      const data = {
        user: "john@example.com",
        password: "Password123",
      };

      const { error } = validate(data, loginSchema);

      expect(error).toBeUndefined();
    });

    it("should validate correct login data with username", () => {
      const data = {
        user: "johndoe",
        password: "Password123",
      };

      const { error } = validate(data, loginSchema);

      expect(error).toBeUndefined();
    });

    it("should reject missing password", () => {
      const data = {
        user: "johndoe",
      };

      const { error } = validate(data, loginSchema);

      expect(error).toBeDefined();
      expect(error.details[0].path).toContain("password");
    });

    it("should accept optional ip and userAgent", () => {
      const data = {
        user: "johndoe",
        password: "Password123",
        ip: "192.168.1.1",
        userAgent: "Mozilla/5.0",
      };

      const { error } = validate(data, loginSchema);

      expect(error).toBeUndefined();
    });

    it("should validate correct login data with username as key", () => {
      const data = {
        username: "johndoe",
        password: "Password123",
      };

      const { error } = validate(data, loginSchema);

      expect(error).toBeUndefined();
    });

    it("should validate correct login data with email as key", () => {
      const data = {
        email: "john@example.com",
        password: "Password123",
      };

      const { error } = validate(data, loginSchema);

      expect(error).toBeUndefined();
    });

    it("should reject when all identity fields (user, username, email) are missing", () => {
      const data = {
        password: "Password123",
      };

      const { error } = validate(data, loginSchema);

      expect(error).toBeDefined();
    });
  });

  describe("forgotPasswordSchema", () => {
    it("should validate correct email", () => {
      const data = {
        email: "john@example.com",
      };

      const { error } = validate(data, forgotPasswordSchema);

      expect(error).toBeUndefined();
    });

    it("should reject invalid email", () => {
      const data = {
        email: "invalid",
      };

      const { error } = validate(data, forgotPasswordSchema);

      expect(error).toBeDefined();
    });
  });

  describe("resetPasswordSchema", () => {
    it("should validate correct data", () => {
      const data = {
        email: "john@example.com",
        otp: "123456",
        password: "NewPassword123",
      };

      const { error } = validate(data, resetPasswordSchema);

      expect(error).toBeUndefined();
    });

    it("should reject missing otp", () => {
      const data = {
        email: "john@example.com",
        password: "NewPassword123",
      };

      const { error } = validate(data, resetPasswordSchema);

      expect(error).toBeDefined();
    });
  });

  describe("formatErrors", () => {
    it("should format error details correctly", () => {
      const details = [
        { path: ["email"], message: "Invalid email" },
        { path: ["password"], message: "Password too weak" },
      ];

      const errors = formatErrors(details);

      expect(errors).toEqual([
        { field: "email", message: "Invalid email" },
        { field: "password", message: "Password too weak" },
      ]);
    });

    it("should handle nested paths", () => {
      const details = [{ path: ["user", "email"], message: "Invalid email" }];

      const errors = formatErrors(details);

      expect(errors).toEqual([
        { field: "user.email", message: "Invalid email" },
      ]);
    });
  });
});
