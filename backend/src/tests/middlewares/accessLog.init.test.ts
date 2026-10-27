/**
 * Tests for accessLog middleware module initialization.
 *
 * accessLog.middleware.js creates its log directory at require time when the
 * directory does not already exist. accessLog.test.js loads the module with
 * fs.existsSync stubbed to true (the directory-present path); this file covers
 * the directory-absent path. It lives in its own file because the behaviour is
 * decided once, during module load.
 */

jest.mock("rotating-file-stream", () => ({
  createStream: jest.fn(() => ({ write: jest.fn() })),
}));

jest.mock("morgan", () => {
  const fn = jest.fn(
    () =>
      (_req: unknown, _res: unknown, next: () => void): void => { next(); },
  ) as unknown as { (...args: unknown[]): unknown; token: jest.Mock };
  fn.token = jest.fn();
  return fn;
});

jest.mock("moment-timezone", () => () => ({
  tz: () => ({ format: () => "2026-01-01" }),
}));

jest.mock("fs", () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

jest.mock("../../utils/storagePath.util", () => jest.fn(() => "/tmp/log/access"));

interface FsDouble {
    existsSync: jest.Mock;
    mkdirSync: jest.Mock;
}

describe("accessLog middleware log directory setup", () => {
  it("should create the log directory recursively when it does not exist", () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- re-reads the module under a stubbed fs
      const fs = require("fs") as FsDouble;
      fs.existsSync.mockReturnValue(false);

      // eslint-disable-next-line @typescript-eslint/no-require-imports -- module load is the behaviour under test
      require("../../middlewares/accessLog.middleware");

      expect(fs.existsSync).toHaveBeenCalledWith("/tmp/log/access");
      expect(fs.mkdirSync).toHaveBeenCalledWith("/tmp/log/access", {
        recursive: true,
      });
    });
  });

  it("should not create the log directory when it already exists", () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- re-reads the module under a stubbed fs
      const fs = require("fs") as FsDouble;
      fs.existsSync.mockReturnValue(true);

      // eslint-disable-next-line @typescript-eslint/no-require-imports -- module load is the behaviour under test
      require("../../middlewares/accessLog.middleware");

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });
  });
});
