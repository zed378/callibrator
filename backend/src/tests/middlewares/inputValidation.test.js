/**
 * Tests for inputValidation middleware (Joi validation schemas)
 * Tests each exported Joi validation schema: register, login, verifyOtp,
 * resendOtp, forgotPassword, resetPassword, changePassword.
 */
const {
  registerValidation,
  loginValidation,
  verifyOtpValidation,
  resendOtpValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
  changePasswordValidation,
} = require("../../middlewares/inputValidation.middleware");

describe("inputValidation middleware", () => {
  describe("registerValidation", () => {
    it("should pass with valid data", () => {
      const { error } = registerValidation.validate({
        firstName: "John",
        lastName: "Doe",
        username: "johndoe",
        email: "john@example.com",
        password: "Password1",
      });
      expect(error).toBeFalsy();
    });

    it("should allow null/empty lastName", () => {
      const { error } = registerValidation.validate({
        firstName: "John",
        lastName: null,
        username: "johndoe",
        email: "john@example.com",
        password: "Password1",
      });
      expect(error).toBeFalsy();
    });

    it("should reject missing firstName", () => {
      const { error } = registerValidation.validate({
        lastName: "Doe",
        username: "johndoe",
        email: "john@example.com",
        password: "Password1",
      });
      expect(error).toBeTruthy();
      expect(error.details[0].path).toContain("firstName");
    });

    it("should reject firstName shorter than 2 chars", () => {
      const { error } = registerValidation.validate({
        firstName: "J",
        lastName: "Doe",
        username: "johndoe",
        email: "john@example.com",
        password: "Password1",
      });
      expect(error).toBeTruthy();
    });

    it("should reject invalid email", () => {
      const { error } = registerValidation.validate({
        firstName: "John",
        lastName: "Doe",
        username: "johndoe",
        email: "not-an-email",
        password: "Password1",
      });
      expect(error).toBeTruthy();
    });

    it("should trim and lowercase username and email", () => {
      const { value, error } = registerValidation.validate({
        firstName: "John",
        lastName: "Doe",
        username: "  JohnDoe  ",
        email: "  JOHN@EXAMPLE.COM  ",
        password: "Password1",
      });
      expect(error).toBeFalsy();
      expect(value.username).toBe("johndoe");
      expect(value.email).toBe("john@example.com");
    });

    it("should reject username with special characters", () => {
      const { error } = registerValidation.validate({
        firstName: "John",
        lastName: "Doe",
        username: "john doe!",
        email: "john@example.com",
        password: "Password1",
      });
      expect(error).toBeTruthy();
    });

    it("should reject weak password without uppercase", () => {
      const { error } = registerValidation.validate({
        firstName: "John",
        lastName: "Doe",
        username: "johndoe",
        email: "john@example.com",
        password: "password1",
      });
      expect(error).toBeTruthy();
    });

    it("should reject weak password without lowercase", () => {
      const { error } = registerValidation.validate({
        firstName: "John",
        lastName: "Doe",
        username: "johndoe",
        email: "john@example.com",
        password: "PASSWORD1",
      });
      expect(error).toBeTruthy();
    });

    it("should reject weak password without digit", () => {
      const { error } = registerValidation.validate({
        firstName: "John",
        lastName: "Doe",
        username: "johndoe",
        email: "john@example.com",
        password: "Password",
      });
      expect(error).toBeTruthy();
    });

    it("should reject password shorter than 8 chars", () => {
      const { error } = registerValidation.validate({
        firstName: "John",
        lastName: "Doe",
        username: "johndoe",
        email: "john@example.com",
        password: "Pass1",
      });
      expect(error).toBeTruthy();
    });
  });

  describe("loginValidation", () => {
    it("should pass with email as user", () => {
      const { error } = loginValidation.validate({
        user: "john@example.com",
        password: "Password1",
      });
      expect(error).toBeFalsy();
    });

    it("should pass with alphanumeric username as user", () => {
      const { error } = loginValidation.validate({
        user: "johndoe",
        password: "Password1",
      });
      expect(error).toBeFalsy();
    });

    it("should reject missing user", () => {
      const { error } = loginValidation.validate({
        password: "Password1",
      });
      expect(error).toBeTruthy();
    });

    it("should reject missing password", () => {
      const { error } = loginValidation.validate({
        user: "john@example.com",
      });
      expect(error).toBeTruthy();
    });
  });

  describe("verifyOtpValidation", () => {
    it("should pass with valid email and 6-digit OTP", () => {
      const { error } = verifyOtpValidation.validate({
        email: "john@example.com",
        otp: "123456",
      });
      expect(error).toBeFalsy();
    });

    it("should reject OTP that is not 6 digits", () => {
      const { error } = verifyOtpValidation.validate({
        email: "john@example.com",
        otp: "12345",
      });
      expect(error).toBeTruthy();
    });

    it("should reject OTP containing letters", () => {
      const { error } = verifyOtpValidation.validate({
        email: "john@example.com",
        otp: "12a456",
      });
      expect(error).toBeTruthy();
    });

    it("should reject missing email", () => {
      const { error } = verifyOtpValidation.validate({
        otp: "123456",
      });
      expect(error).toBeTruthy();
    });
  });

  describe("resendOtpValidation", () => {
    it("should pass with valid email", () => {
      const { error } = resendOtpValidation.validate({
        email: "john@example.com",
      });
      expect(error).toBeFalsy();
    });

    it("should reject missing email", () => {
      const { error } = resendOtpValidation.validate({});
      expect(error).toBeTruthy();
    });
  });

  describe("forgotPasswordValidation", () => {
    it("should pass with valid email", () => {
      const { error } = forgotPasswordValidation.validate({
        email: "john@example.com",
      });
      expect(error).toBeFalsy();
    });

    it("should reject missing email", () => {
      const { error } = forgotPasswordValidation.validate({});
      expect(error).toBeTruthy();
    });
  });

  describe("resetPasswordValidation", () => {
    it("should pass with valid data", () => {
      const { error } = resetPasswordValidation.validate({
        email: "john@example.com",
        otp: "123456",
        password: "Password1",
      });
      expect(error).toBeFalsy();
    });

    it("should reject missing email", () => {
      const { error } = resetPasswordValidation.validate({
        otp: "123456",
        password: "Password1",
      });
      expect(error).toBeTruthy();
    });

    it("should reject invalid OTP length", () => {
      const { error } = resetPasswordValidation.validate({
        email: "john@example.com",
        otp: "12345",
        password: "Password1",
      });
      expect(error).toBeTruthy();
    });

    it("should reject short password", () => {
      const { error } = resetPasswordValidation.validate({
        email: "john@example.com",
        otp: "123456",
        password: "Pass1",
      });
      expect(error).toBeTruthy();
    });
  });

  describe("changePasswordValidation", () => {
    it("should pass with valid data and matching passwords", () => {
      const { error } = changePasswordValidation.validate({
        oldPassword: "OldPass1",
        newPassword: "NewPass1",
        confirmPassword: "NewPass1",
      });
      expect(error).toBeFalsy();
    });

    it("should reject mismatched new and confirm passwords", () => {
      const { error } = changePasswordValidation.validate({
        oldPassword: "OldPass1",
        newPassword: "NewPass1",
        confirmPassword: "Different1",
      });
      expect(error).toBeTruthy();
      expect(error.details[0].message).toBe("Passwords do not match");
    });

    it("should reject missing oldPassword", () => {
      const { error } = changePasswordValidation.validate({
        newPassword: "NewPass1",
        confirmPassword: "NewPass1",
      });
      expect(error).toBeTruthy();
    });
  });
});
