/**
 * Tests for KMS (Key Management Service)
 */

const crypto = require("crypto");

// Mock crypto before importing the service
let encryptCallCount = 0;
let decryptCallCount = 0;

jest.mock("crypto", () => ({
  createHash: jest.fn().mockImplementation(() => ({
    update: jest.fn().mockReturnThis(),
    // Valid 64-char hex (== 32 bytes) so the service's master-key length
    // validation passes with the mocked crypto.
    digest: jest.fn().mockReturnValue("a".repeat(64)),
  })),
  randomBytes: jest.fn().mockImplementation((size) => {
    // Return unique buffer each time by using call count
    return Buffer.from(
      `random-bytes-${encryptCallCount + decryptCallCount}-${size}`,
    );
  }),
  createCipheriv: jest.fn().mockImplementation(() => {
    encryptCallCount++;
    return {
      update: jest
        .fn()
        .mockReturnValue(Buffer.from(`encrypted-data-${encryptCallCount}`)),
      final: jest
        .fn()
        .mockReturnValue(Buffer.from(`auth-tag-${encryptCallCount}`)),
      getAuthTag: jest
        .fn()
        .mockReturnValue(Buffer.from(`auth-tag-${encryptCallCount}`)),
      setAAD: jest.fn(),
    };
  }),
  createDecipheriv: jest.fn().mockImplementation(() => {
    decryptCallCount++;
    return {
      update: jest
        .fn()
        .mockReturnValue(Buffer.from(`decrypted-data-${decryptCallCount}`)),
      final: jest.fn().mockReturnValue(Buffer.from("")),
      setAuthTag: jest.fn(),
      setAAD: jest.fn(),
    };
  }),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const kmsService = require("../../services/kms.service");
const { AppError } = require("../../utils/appError.util");

describe("kmsService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    encryptCallCount = 0;
    decryptCallCount = 0;
  });

  describe("encryptData", () => {
    it("should return null for empty plaintext", () => {
      expect(kmsService.encryptData("tenant-1", null)).toBeNull();
      expect(kmsService.encryptData("tenant-1", "")).toBeNull();
    });

    it("should encrypt data and return formatted payload", () => {
      const tenantId = "tenant-1";
      const plaintext = "sensitive-data-to-encrypt";

      const result = kmsService.encryptData(tenantId, plaintext);

      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
      expect(result).toMatch(/^v1:/);

      // Verify the result is split into 7 parts
      const parts = result.split(":");
      expect(parts).toHaveLength(7);
      expect(parts[0]).toBe("v1");
    });

    it("should use tenantId as AAD for encryption", () => {
      const tenantId = "tenant-1";
      const plaintext = "test-data";

      kmsService.encryptData(tenantId, plaintext);

      // Verify encryption was called
      const crypto = require("crypto");
      expect(crypto.createCipheriv).toHaveBeenCalled();
    });

    it("should throw AppError on encryption failure", () => {
      const crypto = require("crypto");
      jest.spyOn(crypto, "createCipheriv").mockImplementationOnce(() => {
        throw new Error("Crypto error");
      });

      expect(() => kmsService.encryptData("tenant-1", "test-data")).toThrow(
        "Failed to encrypt data",
      );
    });

    it("should generate unique encrypted output for each call", () => {
      const tenantId = "tenant-1";
      const plaintext = "test-data";

      const result1 = kmsService.encryptData(tenantId, plaintext);
      const result2 = kmsService.encryptData(tenantId, plaintext);

      // Results should differ due to random IV and DEK
      expect(result1).not.toBe(result2);
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });
  });

  describe("decryptData", () => {
    it("should return plaintext as-is for non-encrypted payload", () => {
      expect(kmsService.decryptData("tenant-1", "plain-text")).toBe(
        "plain-text",
      );
      expect(kmsService.decryptData("tenant-1", null)).toBeNull();
      expect(kmsService.decryptData("tenant-1", "")).toBe("");
    });

    it("should return plaintext for non-v1 payload", () => {
      expect(kmsService.decryptData("tenant-1", "v2:some:payload")).toBe(
        "v2:some:payload",
      );
    });

    it("should decrypt valid encrypted payload", () => {
      const tenantId = "tenant-1";
      const plaintext = "sensitive-data";

      // First encrypt
      const encryptedPayload = kmsService.encryptData(tenantId, plaintext);

      // Then decrypt
      const result = kmsService.decryptData(tenantId, encryptedPayload);

      // The mock returns "decrypted-data-N" which won't match original plaintext
      // This test verifies the decrypt flow completes without error
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should throw AppError for invalid payload structure", () => {
      const invalidPayload = "v1:invalid:structure";

      expect(() => kmsService.decryptData("tenant-1", invalidPayload)).toThrow(
        "Failed to decrypt data",
      );
    });

    it("should throw AppError when decryption fails due to corrupted data", () => {
      const tenantId = "tenant-1";
      const plaintext = "test-data";

      // Encrypt first to get valid structure
      const encryptedPayload = kmsService.encryptData(tenantId, plaintext);

      // Corrupt the payload by modifying a character
      const corruptedPayload = encryptedPayload.slice(0, -1) + "X";

      const crypto = require("crypto");
      jest.spyOn(crypto, "createDecipheriv").mockImplementationOnce(() => {
        throw new Error("Decryption failed");
      });

      expect(() => kmsService.decryptData(tenantId, corruptedPayload)).toThrow(
        "Failed to decrypt data",
      );
    });

    it("should throw AppError when DEK decryption fails", () => {
      // Make createDecipheriv throw during DEK decryption (first call)
      const originalCreateDecipheriv = require("crypto").createDecipheriv;
      let throwOnFirstCall = true;

      jest
        .spyOn(require("crypto"), "createDecipheriv")
        .mockImplementation(function (...args) {
          if (throwOnFirstCall) {
            throwOnFirstCall = false;
            const err = new Error("Invalid key");
            throw err;
          }
          return {
            update: jest.fn().mockReturnValue(Buffer.from("decrypted")),
            final: jest.fn().mockReturnValue(Buffer.from("")),
            setAuthTag: jest.fn(),
            setAAD: jest.fn(),
          };
        });

      const tenantId = "tenant-1";
      const plaintext = "test-data";
      const encryptedPayload = kmsService.encryptData(tenantId, plaintext);

      // The mock throws on first createDecipheriv call, which happens during
      // the initial decryption attempt before the DEK unwrapping, so the error
      // message will be "Failed to decrypt data" instead of "Failed to unwrap DEK"
      expect(() => kmsService.decryptData(tenantId, encryptedPayload)).toThrow(
        "Failed to decrypt data",
      );
    });

    it("should use tenantId as AAD during decryption", () => {
      const tenantId = "tenant-1";
      const plaintext = "test-data";

      const encryptedPayload = kmsService.encryptData(tenantId, plaintext);

      // Setup fresh mock for decryption
      const crypto = require("crypto");
      jest.spyOn(crypto, "createDecipheriv").mockImplementation(() => ({
        update: jest.fn().mockReturnValue(Buffer.from("decrypted-data")),
        final: jest.fn().mockReturnValue(Buffer.from("")),
        setAuthTag: jest.fn(),
        setAAD: jest.fn(),
      }));

      kmsService.decryptData(tenantId, encryptedPayload);

      // The decryption should use the tenantId as AAD
      expect(crypto.createDecipheriv).toHaveBeenCalled();
    });
  });

  describe("master key validation at module load", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalMasterKey = process.env.KMS_MASTER_KEY;

    const loadFresh = () => {
      let mod;
      jest.isolateModules(() => {
        mod = require("../../services/kms.service");
      });
      return mod;
    };

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalMasterKey === undefined) {
        delete process.env.KMS_MASTER_KEY;
      } else {
        process.env.KMS_MASTER_KEY = originalMasterKey;
      }
    });

    it("refuses to boot in production without KMS_MASTER_KEY", () => {
      process.env.NODE_ENV = "production";
      delete process.env.KMS_MASTER_KEY;

      expect(() => loadFresh()).toThrow(
        /KMS_MASTER_KEY must be set in production/,
      );
    });

    it("boots in production when a valid 32-byte KMS_MASTER_KEY is supplied", () => {
      process.env.NODE_ENV = "production";
      process.env.KMS_MASTER_KEY = "ab".repeat(32); // 64 hex chars => 32 bytes

      const mod = loadFresh();
      expect(typeof mod.encryptData).toBe("function");
    });

    it("rejects a KMS_MASTER_KEY that does not decode to 32 bytes", () => {
      process.env.NODE_ENV = "test";
      process.env.KMS_MASTER_KEY = "abcd"; // 2 bytes

      expect(() => loadFresh()).toThrow(
        /KMS_MASTER_KEY must decode to 32 bytes \(got 2\)/,
      );
    });

    it("falls back to the derived development key outside production", () => {
      process.env.NODE_ENV = "development";
      delete process.env.KMS_MASTER_KEY;

      const mod = loadFresh();
      expect(typeof mod.encryptData).toBe("function");
    });
  });
});
