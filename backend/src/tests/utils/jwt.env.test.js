/**
 * Tests for jwt.util env validation - these must be in a separate file
 * because the env check happens at module load time
 */
describe("jwt.util env validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    // Clear all env vars related to JWT
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    delete process.env.JWT_ALGORITHM;
    delete process.env.JWT_KEY_VERSION;
    delete process.env.JWT_ROTATION_INTERVAL;
    delete process.env.JWT_KEY_ID;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should throw if JWT_ACCESS_SECRET is missing", () => {
    expect(() => require("../../utils/jwt.util")).toThrow(
      "JWT_ACCESS_SECRET environment variable is required"
    );
  });

  it("should throw if JWT_REFRESH_SECRET is missing", () => {
    process.env.JWT_ACCESS_SECRET = "test-access-secret";
    expect(() => require("../../utils/jwt.util")).toThrow(
      "JWT_REFRESH_SECRET environment variable is required"
    );
  });

  it("should load successfully with all required env vars", () => {
    process.env.JWT_ACCESS_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    expect(() => require("../../utils/jwt.util")).not.toThrow();
  });
});