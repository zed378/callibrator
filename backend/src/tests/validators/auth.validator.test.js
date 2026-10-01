/**
 * Auth validator tests
 *
 * P9-11 (ADR-093): the schemas are Zod; they are exercised through the shared
 * `checkInput` helper (the file's own `validate` / `formatErrors` are gone).
 */
const { checkInput, validateInput, fieldErrors } = require("../../validators/input");
const {
  registerSchema,
  loginSchema,
  verifyOtpSchema,
  resendOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} = require("../../validators/auth.validator");

const REQUIRED_STRING = "Invalid input: expected string, received undefined";

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

      const result = checkInput(data, registerSchema);

      expect(result.ok).toBe(true);
      expect(result.value).toEqual({
        firstName: "John",
        lastName: "Doe",
        username: "johndoe",
        email: "john@example.com",
        password: "Password123",
      });
    });

    it("trims and lowercases the username and email, and strips unknown keys", () => {
      const result = checkInput(
        {
          firstName: "  John  ",
          username: "  JohnDoe ",
          email: "  John@Example.COM ",
          password: "Password123",
          role: "admin",
        },
        registerSchema,
      );

      expect(result).toEqual({
        ok: true,
        value: { firstName: "John", username: "johndoe", email: "john@example.com", password: "Password123" },
      });
    });

    it("should reject missing required fields", () => {
      const result = checkInput({ firstName: "John" }, registerSchema);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([
        { field: "username", message: REQUIRED_STRING },
        { field: "email", message: REQUIRED_STRING },
        { field: "password", message: REQUIRED_STRING },
      ]);
    });

    it("should reject invalid email", () => {
      const data = {
        firstName: "John",
        lastName: "Doe",
        username: "johndoe",
        email: "invalid-email",
        password: "Password123",
      };

      const result = checkInput(data, registerSchema);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([{ field: "email", message: "Invalid email address" }]);
    });

    it("should reject weak password", () => {
      const data = {
        firstName: "John",
        lastName: "Doe",
        username: "johndoe",
        email: "john@example.com",
        password: "weak",
      };

      const result = checkInput(data, registerSchema);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([
        { field: "password", message: "Too small: expected string to have >=8 characters" },
        { field: "password", message: "Password must contain uppercase, lowercase, and number" },
      ]);
    });

    it("refuses a username with anything but letters and digits", () => {
      const result = checkInput(
        { firstName: "John", username: "john_doe", email: "john@example.com", password: "Password123" },
        registerSchema,
      );

      expect(result.errors).toEqual([{ field: "username", message: "Username must only contain letters and digits" }]);
    });

    it("should allow null lastName", () => {
      const data = {
        firstName: "John",
        lastName: null,
        username: "johndoe",
        email: "john@example.com",
        password: "Password123",
      };

      expect(checkInput(data, registerSchema).ok).toBe(true);
    });

    it("allows an empty lastName, and refuses a one-character one", () => {
      const base = { firstName: "John", username: "johndoe", email: "john@example.com", password: "Password123" };

      expect(checkInput({ ...base, lastName: "" }, registerSchema).ok).toBe(true);
      expect(checkInput({ ...base, lastName: "   " }, registerSchema).value.lastName).toBe("");
      expect(checkInput({ ...base, lastName: "  Doe  " }, registerSchema).value.lastName).toBe("Doe");
      expect(checkInput({ ...base, lastName: "D" }, registerSchema).ok).toBe(false);
    });
  });

  describe("loginSchema", () => {
    it("should validate correct login data with email", () => {
      const data = {
        user: "john@example.com",
        password: "Password123",
      };

      expect(checkInput(data, loginSchema).ok).toBe(true);
    });

    it("should validate correct login data with username", () => {
      const data = {
        user: "johndoe",
        password: "Password123",
      };

      expect(checkInput(data, loginSchema).ok).toBe(true);
    });

    it("should reject missing password", () => {
      const result = checkInput({ user: "johndoe" }, loginSchema);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([{ field: "password", message: REQUIRED_STRING }]);
    });

    it("should accept optional ip and userAgent", () => {
      const data = {
        user: "johndoe",
        password: "Password123",
        ip: "192.168.1.1",
        userAgent: "Mozilla/5.0",
      };

      const result = checkInput(data, loginSchema);

      expect(result.ok).toBe(true);
      expect(result.value).toEqual(data);
    });

    it("should validate correct login data with username as key", () => {
      const data = {
        username: "johndoe",
        password: "Password123",
      };

      expect(checkInput(data, loginSchema).ok).toBe(true);
    });

    it("should validate correct login data with email as key", () => {
      const data = {
        email: "john@example.com",
        password: "Password123",
      };

      expect(checkInput(data, loginSchema).ok).toBe(true);
    });

    it("should reject when all identity fields (user, username, email) are missing", () => {
      const result = checkInput({ password: "Password123" }, loginSchema);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([{ field: "", message: "Provide user, username or email" }]);
    });
  });

  describe("verifyOtpSchema", () => {
    it("accepts an email and a six-digit OTP", () => {
      expect(checkInput({ email: "john@example.com", otp: "123456" }, verifyOtpSchema)).toEqual({
        ok: true,
        value: { email: "john@example.com", otp: "123456" },
      });
    });

    it("refuses an OTP with anything but digits", () => {
      const result = checkInput({ email: "john@example.com", otp: "12345a" }, verifyOtpSchema);

      expect(result.errors).toEqual([{ field: "otp", message: "OTP must contain digits only" }]);
    });
  });

  describe("resendOtpSchema", () => {
    it("accepts an email and refuses none", () => {
      expect(checkInput({ email: "john@example.com" }, resendOtpSchema).ok).toBe(true);
      expect(checkInput(undefined, resendOtpSchema).errors).toEqual([{ field: "email", message: REQUIRED_STRING }]);
    });
  });

  describe("forgotPasswordSchema", () => {
    it("should validate correct email", () => {
      expect(checkInput({ email: "john@example.com" }, forgotPasswordSchema).ok).toBe(true);
    });

    it("should reject invalid email", () => {
      const result = checkInput({ email: "invalid" }, forgotPasswordSchema);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([{ field: "email", message: "Invalid email address" }]);
    });
  });

  describe("resetPasswordSchema", () => {
    it("should validate correct data", () => {
      const data = {
        email: "john@example.com",
        otp: "123456",
        password: "NewPassword123",
      };

      expect(checkInput(data, resetPasswordSchema).ok).toBe(true);
    });

    it("should reject missing otp", () => {
      const data = {
        email: "john@example.com",
        password: "NewPassword123",
      };

      const result = checkInput(data, resetPasswordSchema);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([{ field: "otp", message: REQUIRED_STRING }]);
    });
  });

  describe("changePasswordSchema", () => {
    it("accepts a matching confirmation", () => {
      const data = { oldPassword: "old", newPassword: "NewPassword123", confirmPassword: "NewPassword123" };

      expect(checkInput(data, changePasswordSchema)).toEqual({ ok: true, value: data });
    });

    it("refuses a mismatched confirmation on confirmPassword", () => {
      const result = checkInput(
        { oldPassword: "old", newPassword: "NewPassword123", confirmPassword: "Other123" },
        changePasswordSchema,
      );

      expect(result.errors).toEqual([{ field: "confirmPassword", message: "Passwords do not match" }]);
    });

    it("refuses a missing confirmation with the same message", () => {
      const result = checkInput({ oldPassword: "old", newPassword: "NewPassword123" }, changePasswordSchema);

      expect(result.errors).toEqual([{ field: "confirmPassword", message: "Passwords do not match" }]);
    });
  });

  describe("validateInput / fieldErrors (formerly formatErrors)", () => {
    it("throws the plain 400 object with every field's error", () => {
      expect(() => validateInput({ email: "invalid" }, forgotPasswordSchema)).toThrow(
        expect.objectContaining({
          status: 400,
          message: "Validation failed",
          errors: [{ field: "email", message: "Invalid email address" }],
        }),
      );
    });

    it("maps each Zod issue to { field, message }", () => {
      const result = registerSchema.safeParse({ firstName: "John", username: "johndoe", email: "bad", password: "Password123" });

      expect(fieldErrors(result.error)).toEqual([{ field: "email", message: "Invalid email address" }]);
    });
  });
});
