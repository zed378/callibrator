/**
 * Tests for mfa.service.js
 *
 * Covers: generateSecret, verifyAndEnable, verifyLogin, disable
 */

jest.mock("otplib", () => ({
  authenticator: {
    generateSecret: jest.fn().mockReturnValue("secret123"),
    check: jest.fn().mockReturnValue(true),
    keyuri: jest
      .fn()
      .mockReturnValue("otpauth://totp/Callibrator:test?secret=secret123"),
  },
}));

jest.mock("qrcode", () => ({
  toDataURL: jest.fn().mockResolvedValue("data:image/png;base64,abc123"),
}));

jest.mock("../../models", () => ({
  User: {},
}));

const { authenticator } = require("otplib");
const qrcode = require("qrcode");
const mfaService = require("../../services/mfa.service");

describe("mfa.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authenticator.check.mockReturnValue(true);
  });

  describe("generateSecret", () => {
    it("should generate TOTP secret and QR code URL", async () => {
      const mockUser = {
        email: "test@example.com",
        mfaSecretTemp: null,
        save: jest.fn().mockResolvedValue(undefined),
      };

      const result = await mfaService.generateSecret(mockUser);

      expect(result.secret).toBe("secret123");
      expect(result.qrCodeDataUrl).toBe("data:image/png;base64,abc123");
      expect(mockUser.mfaSecretTemp).toBe("secret123");
      expect(mockUser.save).toHaveBeenCalled();
      expect(authenticator.keyuri).toHaveBeenCalledWith(
        "test@example.com",
        "Callibrator",
        "secret123",
      );
    });

    it("should use correct issuer name in OTP URI", async () => {
      const mockUser = {
        email: "user@test.com",
        mfaSecretTemp: null,
        save: jest.fn().mockResolvedValue(undefined),
      };

      await mfaService.generateSecret(mockUser);

      expect(authenticator.keyuri).toHaveBeenCalledWith(
        "user@test.com",
        "Callibrator",
        "secret123",
      );
    });
  });

  describe("verifyAndEnable", () => {
    it("should throw error when no enrollment in progress", async () => {
      const mockUser = {
        mfaSecretTemp: null,
        mfaSecret: null,
        mfaEnabled: false,
        save: jest.fn().mockResolvedValue(undefined),
      };

      await expect(
        mfaService.verifyAndEnable(mockUser, "123456"),
      ).rejects.toThrow("No MFA enrollment in progress.");
    });

    it("should throw error when token is invalid", async () => {
      authenticator.check.mockReturnValue(false);

      const mockUser = {
        mfaSecretTemp: "secret123",
        mfaSecret: null,
        mfaEnabled: false,
        save: jest.fn().mockResolvedValue(undefined),
      };

      const result = await mfaService.verifyAndEnable(mockUser, "wrong-token");
      expect(result).toBe(false);
      expect(mockUser.save).not.toHaveBeenCalled();
    });

    it("should enable MFA when token is valid", async () => {
      authenticator.check.mockReturnValue(true);

      const mockUser = {
        mfaSecretTemp: "secret123",
        mfaSecret: null,
        mfaEnabled: false,
        save: jest.fn().mockResolvedValue(undefined),
      };

      const result = await mfaService.verifyAndEnable(mockUser, "123456");
      expect(result).toBe(true);
      expect(mockUser.mfaSecret).toBe("secret123");
      expect(mockUser.mfaEnabled).toBe(true);
      expect(mockUser.mfaSecretTemp).toBeNull();
      expect(mockUser.save).toHaveBeenCalled();
    });
  });

  describe("verifyLogin", () => {
    it("should throw error when MFA is not enabled", () => {
      const mockUser = {
        mfaEnabled: false,
        mfaSecret: null,
      };

      expect(() => mfaService.verifyLogin(mockUser, "123456")).toThrow(
        "MFA is not enabled for this user.",
      );
    });

    it("should throw error when MFA secret is null", () => {
      const mockUser = {
        mfaEnabled: true,
        mfaSecret: null,
      };

      expect(() => mfaService.verifyLogin(mockUser, "123456")).toThrow(
        "MFA is not enabled for this user.",
      );
    });

    it("should return true when token is valid", () => {
      authenticator.check.mockReturnValue(true);

      const mockUser = {
        mfaEnabled: true,
        mfaSecret: "secret123",
      };

      const result = mfaService.verifyLogin(mockUser, "123456");
      expect(result).toBe(true);
      expect(authenticator.check).toHaveBeenCalledWith("123456", "secret123");
    });

    it("should return false when token is invalid", () => {
      authenticator.check.mockReturnValue(false);

      const mockUser = {
        mfaEnabled: true,
        mfaSecret: "secret123",
      };

      const result = mfaService.verifyLogin(mockUser, "wrong-token");
      expect(result).toBe(false);
    });
  });

  describe("disable", () => {
    it("should disable MFA and clear secrets", async () => {
      const mockUser = {
        mfaEnabled: true,
        mfaSecret: "secret123",
        mfaSecretTemp: "temp456",
        save: jest.fn().mockResolvedValue(undefined),
      };

      await mfaService.disable(mockUser);

      expect(mockUser.mfaEnabled).toBe(false);
      expect(mockUser.mfaSecret).toBeNull();
      expect(mockUser.mfaSecretTemp).toBeNull();
      expect(mockUser.save).toHaveBeenCalled();
    });

    it("should handle already disabled MFA", async () => {
      const mockUser = {
        mfaEnabled: false,
        mfaSecret: null,
        mfaSecretTemp: null,
        save: jest.fn().mockResolvedValue(undefined),
      };

      await mfaService.disable(mockUser);

      expect(mockUser.mfaEnabled).toBe(false);
      expect(mockUser.mfaSecret).toBeNull();
      expect(mockUser.mfaSecretTemp).toBeNull();
      expect(mockUser.save).toHaveBeenCalled();
    });
  });
});
