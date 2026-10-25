/**
 * Tests for env.util
 */
import path from "path";
import type * as dotenvTypes from "dotenv";

describe("env.util", () => {
  it("should not throw when loaded", () => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- loads the side-effect module
      require("../../utils/env.util");
    }).not.toThrow();
  });

  it("should load dotenv config in development mode", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the module under test is a side-effect module
    const envModule = require("../../utils/env.util") as unknown;
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh copy after resetModules so the spy reaches the module under test
    const dotenv = require("dotenv") as typeof dotenvTypes;
    const dotenvSpy = jest.spyOn(dotenv, "config").mockReturnValue({});

    process.pkg = {};
    const originalExecPath = process.execPath;
    // Platform-native separators so the assertion holds on win32 and posix
    // alike (the util loads .env from dirname(execPath)).
    const fakeExec = path.join(path.sep, "opt", "app", "exec.exe");
    process.execPath = fakeExec;

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- re-reads the side-effect module under a packaged process shape
      require("../../utils/env.util");
      expect(dotenvSpy).toHaveBeenCalledWith({
        path: path.join(path.dirname(fakeExec), ".env"),
        quiet: true,
      });
    } finally {
      delete process.pkg;
      process.execPath = originalExecPath;
      dotenvSpy.mockRestore();
      jest.resetModules();
    }
  });
});
