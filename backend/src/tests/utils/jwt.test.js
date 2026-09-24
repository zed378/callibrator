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
        { id: "user-123", typ: "access" },
        expect.any(String),
        expect.any(Object)
      );
    });

    it("should use custom expiresIn from options", () => {
      jwtUtils.generateAccessToken({ userId: 1 }, { expiresIn: "1h" });
      expect(mockSign).toHaveBeenCalled();
    });

    // S-26: there is no per-call algorithm override any more — a token signed
    // with an algorithm the verifier does not pin could never verify. The
    // asymmetric paths are proved with real keys in jwt.keyring.s26.test.js.
    it("signs with the pinned algorithm and names its key (kid)", () => {
      jwtUtils.generateAccessToken({ userId: 1 });
      expect(mockSign).toHaveBeenCalledWith(
        expect.any(Object),
        "test-access-secret",
        expect.objectContaining({ algorithm: "HS256", keyid: expect.stringMatching(/^[0-9a-f]{16}$/) }),
      );
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
    afterEach(() => {
      delete process.env.JWT_ACCESS_SECRET_PREVIOUS;
    });

    it("verifies with the current key and the pinned algorithm", () => {
      mockVerify.mockReturnValueOnce({ userId: 123 });
      const result = jwtUtils.verifyAccessToken("valid-token");
      expect(result).toEqual({ userId: 123 });
      expect(mockVerify).toHaveBeenCalledWith("valid-token", "test-access-secret", { algorithms: ["HS256"] });
    });

    it("tries the PREVIOUS secret when the current one does not verify (S-26 rotation window)", () => {
      process.env.JWT_ACCESS_SECRET_PREVIOUS = "test-access-secret-old";
      mockVerify
        .mockImplementationOnce(() => {
          throw new Error("invalid");
        })
        .mockReturnValueOnce({ userId: 456 });
      const result = jwtUtils.verifyAccessToken("valid-token");
      expect(result).toEqual({ userId: 456 });
      expect(mockVerify).toHaveBeenLastCalledWith("valid-token", "test-access-secret-old", { algorithms: ["HS256"] });
    });

    it("should throw TokenExpiredError immediately", () => {
      const err = new Error("expired");
      err.name = "TokenExpiredError";
      mockVerify.mockImplementation(() => {
        throw err;
      });
      expect(() => jwtUtils.verifyAccessToken("expired-token")).toThrow(err);
    });

    it("S-26: there is NO HS256 fallback — a token no ring key verifies is refused after one attempt", () => {
      mockVerify.mockImplementation(() => {
        throw new Error("invalid");
      });
      expect(() => jwtUtils.verifyAccessToken("invalid-token")).toThrow(
        "Invalid or expired access token"
      );
      expect(mockVerify).toHaveBeenCalledTimes(1);
    });
  });

  describe("verifyRefreshToken", () => {
    // A-31: one secret, one algorithm, no fallback. Verifying a refresh token
    // against the access-key registry is what made the two token types
    // interchangeable — the registry holds ACCESS_SECRET.
    it("verifies against the refresh secret alone, with HS256 pinned", () => {
      mockVerify.mockReturnValueOnce({ userId: 123, typ: "refresh" });
      const result = jwtUtils.verifyRefreshToken("refresh-token");
      expect(result).toEqual({ userId: 123, typ: "refresh" });
      expect(mockVerify).toHaveBeenCalledTimes(1);
      expect(mockVerify).toHaveBeenCalledWith("refresh-token", "test-refresh-secret", {
        algorithms: ["HS256"],
      });
    });

    it("does not fall back to the access secret", () => {
      mockVerify.mockImplementation(() => {
        throw new Error("invalid");
      });
      expect(() => jwtUtils.verifyRefreshToken("token-signed-with-access-secret")).toThrow(
        "Invalid or expired refresh token",
      );
      expect(mockVerify).toHaveBeenCalledTimes(1);
      expect(mockVerify).not.toHaveBeenCalledWith(
        expect.anything(),
        "test-access-secret",
        expect.anything(),
      );
    });

    it("refuses a token whose type claim says access", () => {
      mockVerify.mockReturnValueOnce({ userId: 123, typ: "access" });
      expect(() => jwtUtils.verifyRefreshToken("an-access-token")).toThrow(
        "Invalid or expired refresh token",
      );
    });

    it("should throw TokenExpiredError immediately", () => {
      const err = new Error("expired");
      err.name = "TokenExpiredError";
      mockVerify.mockImplementation(() => {
        throw err;
      });
      expect(() => jwtUtils.verifyRefreshToken("expired-token")).toThrow(err);
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

  describe("getKeyInfo / getActiveKeyIds (S-26: reporting only, nothing rotates in-process)", () => {
    it("reports the current key id and the pinned algorithm", () => {
      const info = jwtUtils.getKeyInfo();
      expect(info).toEqual({
        keyId: expect.stringMatching(/^[0-9a-f]{16}$/),
        algorithm: "HS256",
        previousKeyIds: [],
        keyCount: 1,
      });
      expect(jwtUtils.getActiveKeyIds()).toEqual([info.keyId]);
    });

    it("the registry and its rotateKeys are gone", () => {
      expect(jwtUtils.rotateKeys).toBeUndefined();
      expect(jwtUtils.keyRegistry).toBeUndefined();
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

  describe("token lifetimes from the environment", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      for (const k of ["JWT_ACCESS_EXPIRED", "JWT_REFRESH_EXPIRED"]) {
        if (originalEnv[k] === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = originalEnv[k];
        }
      }
    });

    it("generateAccessToken uses JWT_ACCESS_EXPIRED", () => {
      process.env.JWT_ACCESS_EXPIRED = "1h";
      jwtUtils.generateAccessToken({ userId: 1 });
      expect(mockSign).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(String),
        expect.objectContaining({ expiresIn: "1h" }),
      );
    });

    it("generateAccessToken falls back to 15m", () => {
      delete process.env.JWT_ACCESS_EXPIRED;
      jwtUtils.generateAccessToken({ userId: 1 });
      expect(mockSign).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(String),
        expect.objectContaining({ expiresIn: "15m" }),
      );
    });

    it("generateRefreshToken uses JWT_REFRESH_EXPIRED, signed with the refresh secret (A-31)", () => {
      process.env.JWT_REFRESH_EXPIRED = "30d";
      jwtUtils.generateRefreshToken({ userId: 1 });
      expect(mockSign).toHaveBeenCalledWith(
        { userId: 1, typ: "refresh" },
        "test-refresh-secret",
        expect.objectContaining({ expiresIn: "30d", algorithm: "HS256" }),
      );
    });

    it("generateRefreshToken falls back to 7d", () => {
      delete process.env.JWT_REFRESH_EXPIRED;
      jwtUtils.generateRefreshToken({ userId: 1 });
      expect(mockSign).toHaveBeenCalledWith(
        expect.any(Object),
        "test-refresh-secret",
        expect.objectContaining({ expiresIn: "7d" }),
      );
    });
  });
});
