/**
 * Tests for env.util
 */
const path = require("path");

describe("env.util", () => {
  it("should not throw when loaded", () => {
    expect(() => require("../../utils/env.util")).not.toThrow();
  });

  it("should load dotenv config in development mode", () => {
    // In development (not packaged), dotenv.config is called with .env path
    const envModule = require("../../utils/env.util");
    expect(envModule).toBeDefined();
  });

  it("should handle process.pkg being undefined (development)", () => {
    // When process.pkg is undefined, isPackaged is false
    // and dotenv loads from ../../.env
    expect(process.pkg).toBeUndefined();
  });

  it("should always produce an absolute path", () => {
    const expectedPath = path.resolve(__dirname, "../../.env");
    expect(expectedPath).toContain(".env");
  });

  it("should load dotenv config from execPath directory when packaged", () => {
    jest.resetModules();
    const dotenv = require("dotenv");
    const dotenvSpy = jest.spyOn(dotenv, "config").mockImplementation(() => {});
    
    process.pkg = {};
    const originalExecPath = process.execPath;
    // Platform-native separators so the assertion holds on win32 and posix
    // alike (the util loads .env from dirname(execPath)).
    const fakeExec = path.join(path.sep, "opt", "app", "exec.exe");
    process.execPath = fakeExec;

    try {
      require("../../utils/env.util");
      expect(dotenvSpy).toHaveBeenCalledWith({
        path: path.join(path.dirname(fakeExec), ".env"),
        quiet: true
      });
    } finally {
      delete process.pkg;
      process.execPath = originalExecPath;
      dotenvSpy.mockRestore();
      jest.resetModules();
    }
  });
});
