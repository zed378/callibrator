/**
 * Tests for createFolder middleware
 */
const fs = require("fs");
const { ensureFolderExisted } = require("../../middlewares/createFolder.middleware");

// Mock the logger to prevent console logs/errors
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

describe("createFolder middleware", () => {
  let originalExit;
  let spyExists, spyMkdir;

  beforeEach(() => {
    jest.clearAllMocks();
    originalExit = process.exit;
    process.exit = jest.fn();
    
    spyExists = jest.spyOn(fs, "existsSync").mockImplementation(() => true);
    spyMkdir = jest.spyOn(fs, "mkdirSync").mockImplementation(() => {});
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
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("should handle packaged environment (process.pkg set)", () => {
    jest.isolateModules(() => {
      process.pkg = {};
      const { ensureFolderExisted } = require("../../middlewares/createFolder.middleware");
      const spyExists = jest.spyOn(fs, "existsSync").mockReturnValue(true);
      ensureFolderExisted();
      expect(spyExists).toHaveBeenCalled();
      delete process.pkg;
    });
  });
});
