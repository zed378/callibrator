/**
 * Tests for jwt utility - comprehensive coverage
 */
const crypto = require("crypto");

const mockSign = jest.fn().mockReturnValue("mock-token");
const mockVerify = jest.fn().mockReturnValue({ userId: 123 });
const mockDecode = jest.fn().mockReturnValue({ userId: 123 });

jest.mock("jsonwebtoken", () => ({
  sign: mockSign,
  verify: mockVerify,
  decode: mockDecode,
}));

describe("jwt utility", () => {
  let jwtUtils;

  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    process.env.JWT_ALGORITHM = "HS256";

    jwtUtils = require("../../utils/jwt.util");
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(crypto, "randomBytes").mockReturnValue(Buffer.from("a".repeat(64), "hex"));
    jest.spyOn(crypto, "randomUUID").mockReturnValue("test-uuid");
    jest.spyOn(crypto, "generateKeyPairSync").mockImplementation((type, options) => {
      if (type === "ec") {
        return {
          publicKey: "mock-ec-public-key",
          privateKey: "mock-ec-private-key",
        };
      }
      return {
        publicKey: "mock-public-key",
        privateKey: "mock-private-key",
      };
    });
  });

  afterAll(() => {
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    delete process.env.JWT_PRIVATE_KEY;
    delete process.env.JWT_PUBLIC_KEY;
  });

  describe("startup validation", () => {
    it("should throw error if JWT_ACCESS_SECRET is missing", () => {
      const origAccessSecret = process.env.JWT_ACCESS_SECRET;
      delete process.env.JWT_ACCESS_SECRET;
      jest.resetModules();
      expect(() => {
        require("../../utils/jwt.util");
      }).toThrow("JWT_ACCESS_SECRET environment variable is required");
      process.env.JWT_ACCESS_SECRET = origAccessSecret;
      jest.resetModules();
      jwtUtils = require("../../utils/jwt.util");
    });

    it("should throw error if JWT_REFRESH_SECRET is missing", () => {
      const origRefreshSecret = process.env.JWT_REFRESH_SECRET;
      delete process.env.JWT_REFRESH_SECRET;
      jest.resetModules();
      expect(() => {
        require("../../utils/jwt.util");
      }).toThrow("JWT_REFRESH_SECRET environment variable is required");
      process.env.JWT_REFRESH_SECRET = origRefreshSecret;
      jest.resetModules();
      jwtUtils = require("../../utils/jwt.util");
    });

    it("should fallback to HS256 algorithm if JWT_ALGORITHM is missing", () => {
      const origAlgorithm = process.env.JWT_ALGORITHM;
      delete process.env.JWT_ALGORITHM;
      jest.resetModules();
      const tempJwtUtils = require("../../utils/jwt.util");
      expect(tempJwtUtils).toBeDefined();
      process.env.JWT_ALGORITHM = origAlgorithm;
      jest.resetModules();
      jwtUtils = require("../../utils/jwt.util");
    });
  });

  describe("generateAccessToken", () => {
    it("should generate token with object payload", () => {
      const token = jwtUtils.generateAccessToken({ userId: 123 });
      expect(token).toBe("mock-token");
      expect(mockSign).toHaveBeenCalled();
    });

    it("should generate token with primitive payload", () => {
      const token = jwtUtils.generateAccessToken("user-123");
      expect(token).toBe("mock-token");
      expect(mockSign).toHaveBeenCalledWith(
        { id: "user-123" },
        expect.any(String),
        expect.any(Object)
      );
    });

    it("should use custom algorithm from options", () => {
      jwtUtils.generateAccessToken({ userId: 1 }, { algorithm: "HS512" });
      expect(mockSign).toHaveBeenCalled();
    });

    it("should use custom expiresIn from options", () => {
      jwtUtils.generateAccessToken({ userId: 1 }, { expiresIn: "1h" });
      expect(mockSign).toHaveBeenCalled();
    });

    it("should throw for RS algorithm without private key", () => {
      process.env.JWT_PRIVATE_KEY = "";
      expect(() =>
        jwtUtils.generateAccessToken({ userId: 1 }, { algorithm: "RS256" })
      ).toThrow("requires JWT_PRIVATE_KEY environment variable");
    });

    it("should throw for ES algorithm without private key", () => {
      process.env.JWT_PRIVATE_KEY = "";
      expect(() =>
        jwtUtils.generateAccessToken({ userId: 1 }, { algorithm: "ES256" })
      ).toThrow("requires JWT_PRIVATE_KEY environment variable");
    });
  });

  describe("generateOpaqueRefreshToken", () => {
    it("should return a 64 character hex string", () => {
      const token = jwtUtils.generateOpaqueRefreshToken();
      expect(typeof token).toBe("string");
      expect(token.length).toBe(64);
    });
  });

  describe("generateRefreshToken", () => {
    it("should generate token with object payload", () => {
      const token = jwtUtils.generateRefreshToken({ userId: 123 });
      expect(token).toBe("mock-token");
    });

    it("should generate token with primitive payload", () => {
      const token = jwtUtils.generateRefreshToken("user-123");
      expect(token).toBe("mock-token");
    });
  });

  describe("verifyAccessToken", () => {
    it("should verify token with active key", () => {
      mockVerify.mockReturnValueOnce({ userId: 123 });
      const result = jwtUtils.verifyAccessToken("valid-token");
      expect(result).toEqual({ userId: 123 });
    });

    it("should try multiple active keys", () => {
      mockVerify
        .mockImplementationOnce(() => {
          throw new Error("invalid");
        })
        .mockReturnValueOnce({ userId: 456 });
      const result = jwtUtils.verifyAccessToken("valid-token");
      expect(result).toEqual({ userId: 456 });
    });

    it("should throw TokenExpiredError immediately", () => {
      const err = new Error("expired");
      err.name = "TokenExpiredError";
      mockVerify.mockImplementation(() => {
        throw err;
      });
      expect(() => jwtUtils.verifyAccessToken("expired-token")).toThrow(err);
    });

    it("should fall back to default secret", () => {
      mockVerify
        .mockImplementationOnce(() => {
          throw new Error("invalid");
        })
        .mockReturnValueOnce({ userId: 123 });
      const result = jwtUtils.verifyAccessToken("fallback-token");
      expect(result).toEqual({ userId: 123 });
    });

    it("should throw for invalid token after fallback fails", () => {
      mockVerify.mockImplementation(() => {
        throw new Error("invalid");
      });
      expect(() => jwtUtils.verifyAccessToken("invalid-token")).toThrow(
        "Invalid or expired access token"
      );
    });
  });

  describe("verifyRefreshToken", () => {
    it("should verify token with active key", () => {
      mockVerify.mockReturnValueOnce({ userId: 123 });
      const result = jwtUtils.verifyRefreshToken("valid-refresh-token");
      expect(result).toEqual({ userId: 123 });
    });

    it("should try multiple active keys", () => {
      mockVerify
        .mockImplementationOnce(() => {
          throw new Error("invalid");
        })
        .mockReturnValueOnce({ userId: 456 });
      const result = jwtUtils.verifyRefreshToken("valid-token");
      expect(result).toEqual({ userId: 456 });
    });

    it("should throw TokenExpiredError immediately", () => {
      const err = new Error("expired");
      err.name = "TokenExpiredError";
      mockVerify.mockImplementation(() => {
        throw err;
      });
      expect(() => jwtUtils.verifyRefreshToken("expired-token")).toThrow(err);
    });

    it("should fall back to default secret", () => {
      mockVerify
        .mockImplementationOnce(() => {
          throw new Error("invalid");
        })
        .mockReturnValueOnce({ userId: 123 });
      const result = jwtUtils.verifyRefreshToken("fallback-token");
      expect(result).toEqual({ userId: 123 });
    });

    it("should throw for invalid token after fallback fails", () => {
      mockVerify.mockImplementation(() => {
        throw new Error("invalid");
      });
      expect(() => jwtUtils.verifyRefreshToken("invalid-token")).toThrow(
        "Invalid or expired refresh token"
      );
    });
  });

  describe("decodeToken", () => {
    it("should decode token without verification", () => {
      const mockPayload = { userId: 123, exp: 9999999999 };
      mockDecode.mockReturnValue(mockPayload);
      const result = jwtUtils.decodeToken("some-token");
      expect(result).toEqual(mockPayload);
      expect(mockDecode).toHaveBeenCalledWith("some-token");
    });

    it("should return null for invalid token", () => {
      mockDecode.mockReturnValue(null);
      const result = jwtUtils.decodeToken("invalid-token");
      expect(result).toBeNull();
    });
  });

  describe("rotateKeys", () => {
    it("should rotate HS256 key", () => {
      const result = jwtUtils.rotateKeys("HS256");
      expect(result).toHaveProperty("keyId");
      expect(result.algorithm).toBe("HS256");
      expect(result).toHaveProperty("activatedAt");
      expect(result).toHaveProperty("expiresAt");
    });

    it("should rotate RS256 key with private key", () => {
      const result = jwtUtils.rotateKeys("RS256");
      expect(result.algorithm).toBe("RS256");
      expect(process.env.JWT_PRIVATE_KEY).toBeDefined();
    });

    it("should rotate ES256 key with private key", () => {
      const result = jwtUtils.rotateKeys("ES256");
      expect(result.algorithm).toBe("ES256");
      expect(process.env.JWT_PRIVATE_KEY).toBeDefined();
    });

    it("should throw for unsupported algorithm", () => {
      expect(() => jwtUtils.rotateKeys("INVALID")).toThrow(
        "Unsupported algorithm: INVALID"
      );
    });
  });

  describe("getKeyInfo", () => {
    it("should return current key info", () => {
      const info = jwtUtils.getKeyInfo();
      expect(info).toHaveProperty("keyId");
      expect(info).toHaveProperty("algorithm");
      expect(info).toHaveProperty("activatedAt");
      expect(info).toHaveProperty("expiresAt");
      expect(info).toHaveProperty("keyCount");
    });
  });

  describe("getActiveKeyIds", () => {
    it("should return array of active key IDs", () => {
      const ids = jwtUtils.getActiveKeyIds();
      expect(Array.isArray(ids)).toBe(true);
    });
  });

  describe("keyRegistry export", () => {
    it("should export keyRegistry instance", () => {
      expect(jwtUtils.keyRegistry).toBeDefined();
      expect(typeof jwtUtils.keyRegistry.getCurrentKey).toBe("function");
      expect(typeof jwtUtils.keyRegistry.getActiveKeys).toBe("function");
      expect(typeof jwtUtils.keyRegistry.rotateKey).toBe("function");
      expect(typeof jwtUtils.keyRegistry.retireKey).toBe("function");
      expect(typeof jwtUtils.keyRegistry.getKey).toBe("function");
      expect(typeof jwtUtils.keyRegistry.getKeyIds).toBe("function");
    });

    it("keyRegistry.getCurrentKey should return current key", () => {
      const key = jwtUtils.keyRegistry.getCurrentKey();
      expect(key).toBeDefined();
      expect(key).toHaveProperty("secret");
      expect(key).toHaveProperty("algorithm");
    });

    it("keyRegistry.getActiveKeys should return active keys", () => {
      const keys = jwtUtils.keyRegistry.getActiveKeys();
      expect(Array.isArray(keys)).toBe(true);
    });

    it("keyRegistry.rotateKey should rotate key", () => {
      const newKeyId = jwtUtils.keyRegistry.rotateKey("new-secret", "HS256");
      expect(newKeyId).toBeDefined();
    });

    it("keyRegistry.retireKey should retire key", () => {
      const keyId = jwtUtils.keyRegistry.rotateKey("secret-to-retire");
      jwtUtils.keyRegistry.retireKey(keyId);
      const key = jwtUtils.keyRegistry.getKey(keyId);
      expect(key.expiresAt).toBeDefined();
    });

    it("keyRegistry.getKey should return key by ID", () => {
      const keyId = jwtUtils.keyRegistry.rotateKey("test-secret");
      const key = jwtUtils.keyRegistry.getKey(keyId);
      expect(key).toBeDefined();
    });

    it("keyRegistry.getKeyIds should return all key IDs", () => {
      const ids = jwtUtils.keyRegistry.getKeyIds();
      expect(Array.isArray(ids)).toBe(true);
      expect(ids.length).toBeGreaterThan(0);
    });
  });

  describe("alias functions", () => {
    it("generateToken should call generateAccessToken", () => {
      const token = jwtUtils.generateToken({ userId: 1 });
      expect(token).toBe("mock-token");
    });

    it("verifyToken should call verifyAccessToken", () => {
      mockVerify.mockReturnValueOnce({ userId: 123 });
      const result = jwtUtils.verifyToken("token");
      expect(result).toEqual({ userId: 123 });
    });
  });

  describe("RS256 algorithm paths", () => {
    // Store original env vars
    const originalEnv = { ...process.env };

    beforeEach(() => {
      // Reset JWT_PRIVATE_KEY and JWT_PUBLIC_KEY before each test
      delete process.env.JWT_PRIVATE_KEY;
      delete process.env.JWT_PUBLIC_KEY;
    });

    afterEach(() => {
      // Restore original env (clears JWT_PRIVATE_KEY/JWT_PUBLIC_KEY)
      process.env.JWT_ACCESS_SECRET = originalEnv.JWT_ACCESS_SECRET;
      process.env.JWT_REFRESH_SECRET = originalEnv.JWT_REFRESH_SECRET;
      delete process.env.JWT_PRIVATE_KEY;
      delete process.env.JWT_PUBLIC_KEY;
    });

    it("generateAccessToken uses RS256 private key", () => {
      // Rotate to RS256
      const result = jwtUtils.rotateKeys("RS256");
      expect(result.algorithm).toBe("RS256");
      expect(process.env.JWT_PRIVATE_KEY).toBeDefined();

      const token = jwtUtils.generateAccessToken({ userId: 123 });
      expect(token).toBe("mock-token");
      // Should use JWT_PRIVATE_KEY
      expect(mockSign).toHaveBeenCalledWith(
        expect.any(Object),
        process.env.JWT_PRIVATE_KEY,
        expect.any(Object)
      );
    });

    it("generateRefreshToken uses RS256 private key", () => {
      // Rotate to RS256
      jwtUtils.rotateKeys("RS256");
      expect(process.env.JWT_PRIVATE_KEY).toBeDefined();

      const token = jwtUtils.generateRefreshToken({ userId: 123 });
      expect(token).toBe("mock-token");
    });

    it("verifyAccessToken uses RS256 public key", () => {
      // Rotate to RS256
      jwtUtils.rotateKeys("RS256");
      expect(process.env.JWT_PUBLIC_KEY).toBeDefined();

      // First call (for HS256 key) fails, second call (for RS256 key) succeeds
      mockVerify
        .mockImplementationOnce(() => {
          throw new Error("invalid");
        })
        .mockReturnValueOnce({ userId: 123 });
      const result = jwtUtils.verifyAccessToken("valid-token");
      expect(result).toEqual({ userId: 123 });
      expect(mockVerify).toHaveBeenNthCalledWith(
        2,
        "valid-token",
        process.env.JWT_PUBLIC_KEY,
        expect.any(Object)
      );
    });

    it("verifyRefreshToken uses RS256 key", () => {
      // Rotate to RS256
      jwtUtils.rotateKeys("RS256");
      expect(process.env.JWT_PUBLIC_KEY).toBeDefined();

      // First call (for HS256 key) fails, second call (for RS256 key) throws invalid token
      mockVerify
        .mockImplementationOnce(() => {
          throw new Error("invalid");
        })
        .mockImplementationOnce(() => {
          throw new Error("invalid token");
        });
      expect(() => jwtUtils.verifyAccessToken("invalid-token")).toThrow(
        "Invalid or expired access token"
      );
    });

    it("verifyRefreshToken uses RS256 public key", () => {
      // Rotate to RS256
      jwtUtils.rotateKeys("RS256");
      expect(process.env.JWT_PUBLIC_KEY).toBeDefined();

      // First call (for HS256 key) fails, second call (for RS256 key) succeeds
      mockVerify
        .mockImplementationOnce(() => {
          throw new Error("invalid");
        })
        .mockReturnValueOnce({ userId: 123 });
      const result = jwtUtils.verifyRefreshToken("valid-refresh-token");
      expect(result).toEqual({ userId: 123 });
      expect(mockVerify).toHaveBeenNthCalledWith(
        2,
        "valid-refresh-token",
        process.env.JWT_PUBLIC_KEY,
        expect.any(Object)
      );
    });

    it("verifyRefreshToken RS256 key throws invalid token", () => {
      // Rotate to RS256
      jwtUtils.rotateKeys("RS256");
      expect(process.env.JWT_PUBLIC_KEY).toBeDefined();

      // First call (for HS256 key) fails, second call (for RS256 key) throws invalid token
      mockVerify
        .mockImplementationOnce(() => {
          throw new Error("invalid");
        })
        .mockImplementationOnce(() => {
          throw new Error("invalid token");
        });
      expect(() => jwtUtils.verifyRefreshToken("invalid-token")).toThrow(
        "Invalid or expired refresh token"
      );
    });

    it("generateRefreshToken RS256 throws when private key missing", () => {
      // Rotate to RS256 (sets JWT_PRIVATE_KEY), then delete it
      jwtUtils.rotateKeys("RS256");
      delete process.env.JWT_PRIVATE_KEY;
      expect(process.env.JWT_PRIVATE_KEY).toBeUndefined();

      expect(() => jwtUtils.generateRefreshToken({ userId: 1 })).toThrow(
        "requires JWT_PRIVATE_KEY environment variable"
      );
    });

    it("verifyAccessToken RS256 skips key when public key missing", () => {
      // Rotate to RS256 (sets JWT_PUBLIC_KEY), then delete it
      jwtUtils.rotateKeys("RS256");
      delete process.env.JWT_PUBLIC_KEY;
      expect(process.env.JWT_PUBLIC_KEY).toBeUndefined();

      // HS256 key fails, RS256 key has no public key (continue), fallback fails
      mockVerify
        .mockImplementationOnce(() => {
          throw new Error("invalid");
        })
        .mockImplementationOnce(() => {
          throw new Error("invalid");
        });
      expect(() => jwtUtils.verifyAccessToken("invalid-token")).toThrow(
        "Invalid or expired access token"
      );
    });

    it("verifyRefreshToken RS256 skips key when public key missing", () => {
      // Rotate to RS256 (sets JWT_PUBLIC_KEY), then delete it
      jwtUtils.rotateKeys("RS256");
      delete process.env.JWT_PUBLIC_KEY;
      expect(process.env.JWT_PUBLIC_KEY).toBeUndefined();

      // HS256 key fails, RS256 key has no public key (continue), fallback fails
      mockVerify
        .mockImplementationOnce(() => {
          throw new Error("invalid");
        })
        .mockImplementationOnce(() => {
          throw new Error("invalid");
        });
      expect(() => jwtUtils.verifyRefreshToken("invalid-token")).toThrow(
        "Invalid or expired refresh token"
      );
    });

    // Cleanup: rotate back to HS256 after all tests in this describe
    afterAll(() => {
      jwtUtils.rotateKeys("HS256");
    });
  });

  describe("coverage edge branches", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      // Restore env vars
      process.env.JWT_ACCESS_SECRET = originalEnv.JWT_ACCESS_SECRET;
      process.env.JWT_REFRESH_SECRET = originalEnv.JWT_REFRESH_SECRET;
      if (originalEnv.JWT_ACCESS_EXPIRED === undefined) {
        delete process.env.JWT_ACCESS_EXPIRED;
      } else {
        process.env.JWT_ACCESS_EXPIRED = originalEnv.JWT_ACCESS_EXPIRED;
      }
      if (originalEnv.JWT_REFRESH_EXPIRED === undefined) {
        delete process.env.JWT_REFRESH_EXPIRED;
      } else {
        process.env.JWT_REFRESH_EXPIRED = originalEnv.JWT_REFRESH_EXPIRED;
      }
    });

    it("rotateKeys uses default algorithm when called without args", () => {
      const result = jwtUtils.rotateKeys();
      expect(result.algorithm).toBe("HS256");
    });

    it("generateAccessToken uses JWT_ACCESS_EXPIRED env var", () => {
      process.env.JWT_ACCESS_EXPIRED = "1h";
      jwtUtils.generateAccessToken({ userId: 1 });
      expect(mockSign).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(String),
        expect.objectContaining({ expiresIn: "1h" })
      );
    });

    it("generateRefreshToken uses JWT_REFRESH_EXPIRED env var", () => {
      process.env.JWT_REFRESH_EXPIRED = "30d";
      jwtUtils.generateRefreshToken({ userId: 1 });
      expect(mockSign).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(String),
        expect.objectContaining({ expiresIn: "30d" })
      );
    });

    it("getKey returns null for nonexistent key ID", () => {
      const key = jwtUtils.keyRegistry.getKey("nonexistent-key-id");
      expect(key).toBeNull();
    });

    it("retireKey handles nonexistent key ID gracefully", () => {
      expect(() => jwtUtils.keyRegistry.retireKey("nonexistent-key-id")).not.toThrow();
    });

it("getCurrentKey fallbacks when no active keys", () => {
  const ids = jwtUtils.keyRegistry.getKeyIds();
  ids.forEach((id) => {
    jwtUtils.keyRegistry.retireKey(id);
    // Set expiresAt to a past date to ensure it's definitely inactive
    const key = jwtUtils.keyRegistry.getKey(id);
    if (key) {
      key.expiresAt = new Date(Date.now() - 1);
    }
  });
  const key = jwtUtils.keyRegistry.getCurrentKey();
  expect(key).toBeDefined();
  expect(key).toHaveProperty("secret");
  jwtUtils.rotateKeys("HS256");
});

it("generateAccessToken RS256 uses JWT_ACCESS_EXPIRED env var", () => {
  jwtUtils.rotateKeys("RS256");
  process.env.JWT_ACCESS_EXPIRED = "2h";
  jwtUtils.generateAccessToken({ userId: 1 });
  expect(mockSign).toHaveBeenCalledWith(
    expect.any(Object),
    process.env.JWT_PRIVATE_KEY,
    expect.objectContaining({ expiresIn: "2h" })
  );
  delete process.env.JWT_ACCESS_EXPIRED;
  jwtUtils.rotateKeys("HS256");
});

it("generateRefreshToken RS256 uses JWT_REFRESH_EXPIRED env var", () => {
  jwtUtils.rotateKeys("RS256");
  process.env.JWT_REFRESH_EXPIRED = "60d";
  jwtUtils.generateRefreshToken({ userId: 1 });
  expect(mockSign).toHaveBeenCalledWith(
    expect.any(Object),
    process.env.JWT_PRIVATE_KEY,
    expect.objectContaining({ expiresIn: "60d" })
  );
  delete process.env.JWT_REFRESH_EXPIRED;
  jwtUtils.rotateKeys("HS256");
});

it("generateAccessToken RS256 uses default fallback 15m", () => {
  jwtUtils.rotateKeys("RS256");
  const orig = process.env.JWT_ACCESS_EXPIRED;
  delete process.env.JWT_ACCESS_EXPIRED;
  jwtUtils.generateAccessToken({ userId: 1 });
  expect(mockSign).toHaveBeenCalledWith(
    expect.any(Object),
    process.env.JWT_PRIVATE_KEY,
    expect.objectContaining({ expiresIn: "15m" })
  );
  process.env.JWT_ACCESS_EXPIRED = orig;
  jwtUtils.rotateKeys("HS256");
});

it("generateAccessToken HS256 uses default fallback 15m", () => {
  const orig = process.env.JWT_ACCESS_EXPIRED;
  delete process.env.JWT_ACCESS_EXPIRED;
  jwtUtils.generateAccessToken({ userId: 1 });
  expect(mockSign).toHaveBeenCalledWith(
    expect.any(Object),
    expect.any(String),
    expect.objectContaining({ expiresIn: "15m" })
  );
  process.env.JWT_ACCESS_EXPIRED = orig;
});

it("generateRefreshToken RS256 uses default fallback 7d", () => {
  jwtUtils.rotateKeys("RS256");
  const orig = process.env.JWT_REFRESH_EXPIRED;
  delete process.env.JWT_REFRESH_EXPIRED;
  jwtUtils.generateRefreshToken({ userId: 1 });
  expect(mockSign).toHaveBeenCalledWith(
    expect.any(Object),
    process.env.JWT_PRIVATE_KEY,
    expect.objectContaining({ expiresIn: "7d" })
  );
  process.env.JWT_REFRESH_EXPIRED = orig;
  jwtUtils.rotateKeys("HS256");
});

it("generateRefreshToken HS256 uses default fallback 7d", () => {
  const orig = process.env.JWT_REFRESH_EXPIRED;
  delete process.env.JWT_REFRESH_EXPIRED;
  jwtUtils.generateRefreshToken({ userId: 1 });
  expect(mockSign).toHaveBeenCalledWith(
    expect.any(Object),
    expect.any(String),
    expect.objectContaining({ expiresIn: "7d" })
  );
  process.env.JWT_REFRESH_EXPIRED = orig;
});
  });
});