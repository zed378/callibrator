/**
 * Tests for jwt.util env validation - these must be in a separate file
 * because the env check happens at module load time
 */
describe("jwt.util env validation", () => {
  // eslint-disable-next-line no-restricted-properties -- the test snapshots the environment the module validates at load
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    // Clear all env vars related to JWT
    // eslint-disable-next-line no-restricted-properties -- the module under test reads the environment raw at load
    delete process.env["JWT_ACCESS_SECRET"];
    // eslint-disable-next-line no-restricted-properties -- as above
    delete process.env["JWT_REFRESH_SECRET"];
    // eslint-disable-next-line no-restricted-properties -- as above
    delete process.env["JWT_ALGORITHM"];
    // eslint-disable-next-line no-restricted-properties -- as above
    delete process.env["JWT_KEY_VERSION"];
    // eslint-disable-next-line no-restricted-properties -- as above
    delete process.env["JWT_ROTATION_INTERVAL"];
    // eslint-disable-next-line no-restricted-properties -- as above
    delete process.env["JWT_KEY_ID"];
  });

  afterEach(() => {
    // eslint-disable-next-line no-restricted-properties -- restore what beforeEach cleared
    process.env = originalEnv;
  });

  it("should throw if JWT_ACCESS_SECRET is missing", () => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- re-reads the module under a mutated environment
      require("../../utils/jwt.util");
    }).toThrow("JWT_ACCESS_SECRET environment variable is required");
  });

  it("should throw if JWT_REFRESH_SECRET is missing", () => {
    // eslint-disable-next-line no-restricted-properties -- the test sets the environment the module validates at load
    process.env["JWT_ACCESS_SECRET"] = "test-access-secret";
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- re-reads the module under a mutated environment
      require("../../utils/jwt.util");
    }).toThrow("JWT_REFRESH_SECRET environment variable is required");
  });

  it("should load successfully with all required env vars", () => {
    // eslint-disable-next-line no-restricted-properties -- the test sets the environment the module validates at load
    process.env["JWT_ACCESS_SECRET"] = "test-access-secret";
    // eslint-disable-next-line no-restricted-properties -- as above
    process.env["JWT_REFRESH_SECRET"] = "test-refresh-secret";
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- re-reads the module under a mutated environment
      require("../../utils/jwt.util");
    }).not.toThrow();
  });
});
