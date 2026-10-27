/**
 * Tests for createFolder middleware
 */
import fs from "fs";
import { ensureFolderExisted } from "../../middlewares/createFolder.middleware";

// Mock the logger to prevent console logs/errors
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

describe("createFolder middleware", () => {
  let originalExit: typeof process.exit;
  let exitSpy: jest.Mock;
  let spyExists: jest.SpiedFunction<typeof fs.existsSync>;
  let spyMkdir: jest.SpiedFunction<typeof fs.mkdirSync>;

  beforeEach(() => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- saved to restore the real exit after the suite
    originalExit = process.exit;
    exitSpy = jest.fn();
    process.exit = exitSpy as unknown as typeof process.exit;

    spyExists = jest.spyOn(fs, "existsSync").mockImplementation(() => true);
    spyMkdir = jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.exit = originalExit;
    jest.restoreAllMocks();
  });

  it("should create folders if they do not exist", () => {
    spyExists.mockReturnValue(false);
    ensureFolderExisted();
    expect(spyMkdir).toHaveBeenCalled();
  });

  it("should not create folders if they exist", () => {
    spyExists.mockReturnValue(true);
    ensureFolderExisted();
    expect(spyMkdir).not.toHaveBeenCalled();
  });

  it("should call process.exit on error", () => {
    spyExists.mockImplementation(() => {
      throw new Error("Disk error");
    });
    ensureFolderExisted();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("should handle packaged environment (process.pkg set)", () => {
    jest.isolateModules(() => {
      process.pkg = {};
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- re-reads the module under the packaged flag
      const { ensureFolderExisted: ensurePackaged } = require(
        "../../middlewares/createFolder.middleware",
      ) as { ensureFolderExisted: () => void };
      const packagedExists = jest.spyOn(fs, "existsSync").mockReturnValue(true);
      ensurePackaged();
      expect(packagedExists).toHaveBeenCalled();
      delete process.pkg;
    });
  });
});
