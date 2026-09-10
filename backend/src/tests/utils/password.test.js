/**
 * Tests for password utility
 */

const { hashPassword, comparePassword } = require("../../utils/password.util");

describe("password utility", () => {
  describe("hashPassword", () => {
    it("should hash a password", async () => {
      const plainPassword = "MySecureP@ssw0rd";
      const hashed = await hashPassword(plainPassword);

      expect(hashed).toBeDefined();
      expect(typeof hashed).toBe("string");
      expect(hashed).not.toBe(plainPassword);
    });

    it("should produce different hashes for the same password", async () => {
      const plainPassword = "MySecureP@ssw0rd";
      const hash1 = await hashPassword(plainPassword);
      const hash2 = await hashPassword(plainPassword);

      expect(hash1).not.toBe(hash2);
    });

    it("should handle empty string", async () => {
      const hashed = await hashPassword("");

      expect(hashed).toBeDefined();
    });

    it("should handle long passwords", async () => {
      const longPassword = "a".repeat(1000);
      const hashed = await hashPassword(longPassword);

      expect(hashed).toBeDefined();
    });
  });

  describe("comparePassword", () => {
    it("should return true for matching password", async () => {
      const plainPassword = "MySecureP@ssw0rd";
      const hashed = await hashPassword(plainPassword);
      const result = await comparePassword(plainPassword, hashed);

      expect(result).toBe(true);
    });

    it("should return false for non-matching password", async () => {
      const hashed = await hashPassword("correctPassword");
      const result = await comparePassword("wrongPassword", hashed);

      expect(result).toBe(false);
    });

    it("should handle empty string comparison", async () => {
      const hashed = await hashPassword("");
      const result = await comparePassword("", hashed);

      expect(result).toBe(true);
    });
  });
});
