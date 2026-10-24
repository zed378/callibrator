/**
 * Tests for appPath util
 */
import path from "path";

type AppPathFn = (...paths: string[]) => string;

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the module under test is `export =` (CommonJS)
const appPath = require("../../utils/appPath.util") as AppPathFn;

describe("appPath util", () => {
  it("should join a single segment to the app root", () => {
    const result = appPath("uploads");
    expect(result.endsWith(path.join("uploads"))).toBe(true);
    expect(result).toContain("uploads");
  });

  it("should join multiple segments", () => {
    const result = appPath("uploads", "avatars", "pic.png");
    expect(result.endsWith(path.join("uploads", "avatars", "pic.png"))).toBe(true);
  });

  it("should return the app root when given no segments", () => {
    const result = appPath();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("should always produce an absolute path", () => {
    expect(path.isAbsolute(appPath("x"))).toBe(true);
  });

  it("should return correct path when packaged", () => {
    jest.resetModules();
    process.pkg = {};
    const originalExecPath = process.execPath;
    // Build the fake exec path with the platform's own separators so the
    // assertion holds on both win32 and posix (the util joins
    // dirname(execPath) + segments).
    const fakeExec = path.join(path.sep, "opt", "app", "exec.exe");
    process.execPath = fakeExec;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- re-reads the module under a packaged process shape
      const appPathPackaged = require("../../utils/appPath.util") as AppPathFn;
      const result = appPathPackaged("uploads");
      expect(result).toBe(path.join(path.dirname(fakeExec), "uploads"));
    } finally {
      delete process.pkg;
      process.execPath = originalExecPath;
      jest.resetModules();
    }
  });
});
