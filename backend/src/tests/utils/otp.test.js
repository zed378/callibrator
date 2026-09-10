/**
 * Tests for OTP utility
 */

const { generateOTP, verifyOTP, hashOTP } = require("../../utils/otp.util");

describe("OTP utility", () => {
  describe("generateOTP", () => {
    it("should generate a 6-digit OTP by default", () => {
      const otp = generateOTP();

      expect(otp).toBeDefined();
      expect(typeof otp).toBe("string");
      expect(otp).toHaveLength(6);
      expect(otp).toMatch(/^\d{6}$/);
    });

    it("should generate OTP with custom length", () => {
      const otp = generateOTP(8);

      expect(otp).toHaveLength(8);
      expect(otp).toMatch(/^\d{8}$/);
    });

    it("should generate numeric OTP", () => {
      const otp = generateOTP(10);

      expect(otp).toMatch(/^\d+$/);
    });
  });

  describe("hashOTP", () => {
    it("should hash an OTP", () => {
      const otp = "123456";
      const hashed = hashOTP(otp);

      expect(hashed).toBeDefined();
      expect(hashed).not.toBe(otp);
    });

    it("should produce consistent hash for same OTP", () => {
      const otp = "123456";
      const hash1 = hashOTP(otp);
      const hash2 = hashOTP(otp);

      expect(hash1).toBe(hash2);
    });
  });

  describe("verifyOTP", () => {
    it("should verify correct OTP", () => {
      const otp = "123456";
      const hashed = hashOTP(otp);
      const result = verifyOTP(otp, hashed);

      expect(result).toBe(true);
    });

    it("should reject incorrect OTP", () => {
      const otp = "123456";
      const hashed = hashOTP(otp);
      const result = verifyOTP("654321", hashed);

      expect(result).toBe(false);
    });

    it("should handle null hashed value", () => {
      const result = verifyOTP("123456", null);

      expect(result).toBe(false);
    });
  });
});
