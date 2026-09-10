/**
 * Tests for storagePath util
 */
const path = require("path");

describe("storagePath util", () => {
  beforeEach(() => {
    // Reset module registry to allow re-evaluation of modules
    jest.resetModules();
  });

  describe("non-packaged mode (default)", () => {
    it("should join a single segment to the storage root", () => {
      // Ensure process.pkg is undefined for non-packaged mode
      delete process.pkg;
      delete process.env.APP_STORAGE_PATH;

      const storagePath = require("../../utils/storagePath.util");
      const result = storagePath("exports");
      expect(result.endsWith(path.join("exports"))).toBe(true);
    });

    it("should join multiple segments", () => {
      delete process.pkg;
      delete process.env.APP_STORAGE_PATH;

      const storagePath = require("../../utils/storagePath.util");
      const result = storagePath("exports", "abc", "file.zip");
      expect(result.endsWith(path.join("exports", "abc", "file.zip"))).toBe(
        true,
      );
    });

    it("should always produce an absolute path", () => {
      delete process.pkg;
      delete process.env.APP_STORAGE_PATH;

      const storagePath = require("../../utils/storagePath.util");
      expect(path.isAbsolute(storagePath("x"))).toBe(true);
    });

    it("should return a string for the storage root with no segments", () => {
      delete process.pkg;
      delete process.env.APP_STORAGE_PATH;

      const storagePath = require("../../utils/storagePath.util");
      const result = storagePath();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should use path.resolve with __dirname for non-packaged mode", () => {
      delete process.pkg;
      delete process.env.APP_STORAGE_PATH;

      const storagePath = require("../../utils/storagePath.util");
      const result = storagePath("test");
      // In non-packaged mode, storageRoot = path.resolve(__dirname, "../../")
      expect(result).toContain("backend");
    });
  });

  describe("packaged mode (process.pkg is set)", () => {
    it("should use APP_STORAGE_PATH when set in packaged mode", () => {
      // Set process.pkg BEFORE requiring the module
      process.pkg = { file: "/app/app.exe" };
      process.env.APP_STORAGE_PATH = "/custom/storage";

      const storagePath = require("../../utils/storagePath.util");
      const result = storagePath("exports");
      expect(result).toBe(path.join("/custom/storage", "exports"));

      // Clean up
      delete process.pkg;
      delete process.env.APP_STORAGE_PATH;
    });

    it("should use fallback path when APP_STORAGE_PATH is not set in packaged mode", () => {
      process.pkg = { file: "/app/app.exe" };
      delete process.env.APP_STORAGE_PATH;

      const storagePath = require("../../utils/storagePath.util");
      const result = storagePath("exports");
      // Fallback: path.join(path.dirname(process.execPath), "storage")
      const expectedRoot = path.join(path.dirname(process.execPath), "storage");
      expect(result).toBe(expectedRoot + path.sep + "exports");

      // Clean up
      delete process.pkg;
    });

    it("should join multiple segments in packaged mode with custom path", () => {
      process.pkg = { file: "/app/app.exe" };
      process.env.APP_STORAGE_PATH = "/custom/storage";

      const storagePath = require("../../utils/storagePath.util");
      const result = storagePath("exports", "abc", "file.zip");
      expect(result).toBe(
        path.join("/custom/storage", "exports", "abc", "file.zip"),
      );

      // Clean up
      delete process.pkg;
      delete process.env.APP_STORAGE_PATH;
    });

    it("should produce absolute path in packaged mode", () => {
      process.pkg = { file: "/app/app.exe" };
      process.env.APP_STORAGE_PATH = "/custom/storage";

      const storagePath = require("../../utils/storagePath.util");
      expect(path.isAbsolute(storagePath("x"))).toBe(true);

      // Clean up
      delete process.pkg;
      delete process.env.APP_STORAGE_PATH;
    });

    it("should return string for storage root with no segments in packaged mode", () => {
      process.pkg = { file: "/app/app.exe" };
      process.env.APP_STORAGE_PATH = "/custom/storage";

      const storagePath = require("../../utils/storagePath.util");
      const result = storagePath();
      expect(typeof result).toBe("string");
      // path.join() normalizes slashes, so on Windows it becomes backslashes
      expect(result).toBe(path.join("/custom/storage"));
    });

    it("should prioritize APP_STORAGE_PATH over fallback in packaged mode", () => {
      process.pkg = { file: "/app/app.exe" };
      process.env.APP_STORAGE_PATH = "/my/custom/path";

      const storagePath = require("../../utils/storagePath.util");
      const result = storagePath();
      // When APP_STORAGE_PATH is set, it should be used directly
      // path.join() normalizes slashes, so on Windows it becomes backslashes
      expect(result).toBe(path.join("/my/custom/path"));

      // Clean up
      delete process.pkg;
    });
  });

  describe("edge cases", () => {
    it("should handle empty string segments", () => {
      delete process.pkg;
      delete process.env.APP_STORAGE_PATH;

      const storagePath = require("../../utils/storagePath.util");
      const result = storagePath("");
      expect(typeof result).toBe("string");
    });

    it("should handle segments with leading slashes", () => {
      delete process.pkg;
      delete process.env.APP_STORAGE_PATH;

      const storagePath = require("../../utils/storagePath.util");
      const result = storagePath("/absolute/path");
      expect(typeof result).toBe("string");
    });

    it("should handle APP_STORAGE_PATH with trailing slash", () => {
      process.pkg = { file: "/app/app.exe" };
      process.env.APP_STORAGE_PATH = "/custom/storage/";

      const storagePath = require("../../utils/storagePath.util");
      const result = storagePath("exports");
      // On Windows, path.join normalizes to backslashes
      const expected = path.join("/custom/storage", "exports");
      expect(result).toBe(expected);

      // Clean up
      delete process.pkg;
    });
  });
});
