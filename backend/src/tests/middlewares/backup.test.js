/**
 * Tests for backup middleware
 */

// Create mock functions for fs-extra
const mockFse = {
  readdir: jest.fn(),
  stat: jest.fn().mockResolvedValue({ isDirectory: () => false }),
  readFile: jest.fn().mockResolvedValue(Buffer.from("data")),
  copy: jest.fn(),
  remove: jest.fn().mockResolvedValue(undefined),
  pathExists: jest.fn(),
  ensureDir: jest.fn().mockResolvedValue(undefined),
  outputJson: jest.fn(),
  outputFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
};

// Mock node-cron before importing
const mockSchedule = jest.fn();
jest.mock("node-cron", () => ({ schedule: mockSchedule }));

// Default JSZip mock
const defaultJSZipImpl = () => ({
  file: jest.fn().mockReturnThis(),
  generateAsync: jest.fn().mockResolvedValue(Buffer.from([])),
  loadAsync: jest.fn().mockResolvedValue({ files: {} }),
});
jest.mock("jszip", () => jest.fn().mockImplementation(defaultJSZipImpl));

jest.mock("fs-extra", () => mockFse);
jest.mock("../../utils/storagePath.util", () => () => "/fake-backup");
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

let diffReturnValue = 36;
jest.mock("moment-timezone", () => {
  const MockMoment = jest.fn();
  const mockMomentInstance = {
    diff: jest.fn().mockImplementation(() => diffReturnValue),
    tz: jest.fn().mockReturnValue({
      format: jest.fn().mockReturnValue("2026-07-14 10~00~00"),
    }),
  };
  MockMoment.mockImplementation(() => mockMomentInstance);
  MockMoment.default = MockMoment;
  return MockMoment;
});

const {
  backupAndZip,
  cronBackup,
  extractZip,
  deleteOldFiles,
} = require("../../middlewares/backup.middleware");
const { logger } = require("../../middlewares/activityLog.middleware");

describe("backup middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock implementations to defaults
    mockFse.readdir.mockReset().mockImplementation(() => []);
    mockFse.stat.mockReset().mockResolvedValue({ isDirectory: () => false });
    mockFse.readFile.mockReset().mockResolvedValue(Buffer.from("data"));
    mockFse.copy.mockReset();
    mockFse.remove.mockReset().mockResolvedValue(undefined);
    mockFse.pathExists.mockReset();
    mockFse.ensureDir.mockReset().mockResolvedValue(undefined);
    mockFse.writeFile.mockReset().mockResolvedValue(undefined);
    mockFse.outputFile.mockReset();
    process.env.BACKUP_SCHEDULER = "0 0 * * *";
    diffReturnValue = 36;
    // Reset JSZip to default (extractZip tests override it)
    const JSZip = require("jszip");
    JSZip.mockImplementation(defaultJSZipImpl);
  });

  describe("backupAndZip", () => {
    it("should skip log backup when log folder does not exist", async () => {
      mockFse.pathExists.mockResolvedValue(false);
      mockFse.readdir.mockResolvedValueOnce(["data1.db"]);

      await backupAndZip();

      expect(mockFse.copy).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        "Log folder does not exist, skipping log backup",
      );
    });

    it("should create backup of data and log folders", async () => {
      // pathExists is called once for log folder
      mockFse.pathExists.mockResolvedValue(true);
      // readdir called: log folder, data folder
      // But zipFolder calls addFolderToZip which calls readdir per call
      // log folder: readdir(["log1.txt"]) -> for zipFolder
      // data folder: readdir(["data1.db"]) -> for zipFolder
      mockFse.readdir
        .mockResolvedValueOnce(["log1.txt"]) // log folder
        .mockResolvedValueOnce(["data1.db"]); // data folder

      // copy called 2 times: log then data
      // writeFile called 2 times: log zip then data zip

      await backupAndZip();

      expect(mockFse.ensureDir).toHaveBeenCalled();
      expect(mockFse.copy).toHaveBeenCalledTimes(2);
      expect(mockFse.writeFile).toHaveBeenCalled();
      expect(logger.info).toHaveBeenNthCalledWith(
        2,
        "Data folder successfully zipped!",
      );
    });

    it("should handle errors gracefully", async () => {
      mockFse.ensureDir.mockRejectedValueOnce(new Error("Disk error"));

      await backupAndZip();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error during backup and zipping process"),
      );
    });

    it("should handle errors during data folder copy", async () => {
      mockFse.pathExists.mockResolvedValue(false);
      mockFse.copy.mockRejectedValueOnce(new Error("Copy failed"));

      await backupAndZip();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error during backup and zipping process"),
      );
    });

    it("should handle subdirectories recursively via addFolderToZip", async () => {
      mockFse.pathExists.mockResolvedValue(false);
      // First readdir returns a subfolder name
      mockFse.readdir
        .mockResolvedValueOnce(["subfolder"]) // data folder has subfolder
        .mockResolvedValueOnce([]); // subfolder is empty
      // stat: first call (subfolder) is a directory, second call (data1.db) is not
      mockFse.stat
        .mockResolvedValueOnce({ isDirectory: () => true }) // subfolder
        .mockResolvedValueOnce({ isDirectory: () => false }); // data1.db

      await backupAndZip();

      // Should have called readdir for data folder and subfolder
      expect(mockFse.readdir).toHaveBeenCalledTimes(2);
      // zip.file should still be called for data1.db
      expect(logger.info).toHaveBeenCalledWith(
        "Data folder successfully zipped!",
      );
    });

    it("should pass filter to skip mysql.sock in data backup", async () => {
      mockFse.pathExists.mockResolvedValue(false);
      mockFse.readdir.mockResolvedValueOnce(["data1.db"]);

      await backupAndZip();

      // copy was called with options object containing filter
      const copyOptions = mockFse.copy.mock.calls[0][2];
      expect(copyOptions).toHaveProperty("filter");
      expect(copyOptions.filter("/fake-backup/data1.db")).toBe(true);
      expect(copyOptions.filter("/fake-backup/mysql.sock")).toBe(false);
    });
  });

  describe("extractZip", () => {
    it("should extract zip file to destination", async () => {
      const JSZip = require("jszip");
      JSZip.mockImplementation(() => ({
        loadAsync: jest.fn().mockResolvedValue({
          files: {
            "file1.txt": {
              dir: false,
              async: jest.fn().mockResolvedValue(Buffer.from("content")),
            },
          },
        }),
      }));

      await extractZip("/backup/test.zip", "/dest");

      expect(logger.error).not.toHaveBeenCalled();
    });

    it("should skip directories during extraction", async () => {
      const JSZip = require("jszip");
      JSZip.mockImplementation(() => ({
        loadAsync: jest.fn().mockResolvedValue({
          files: { "dir:/": { dir: true } },
        }),
      }));

      await extractZip("/backup/test.zip", "/dest");

      expect(logger.error).not.toHaveBeenCalled();
    });

    it("should log error when fse.outputFile fails for a file", async () => {
      const JSZip = require("jszip");
      mockFse.outputFile.mockRejectedValueOnce(new Error("Permission denied"));
      JSZip.mockImplementation(() => ({
        loadAsync: jest.fn().mockResolvedValue({
          files: {
            "file1.txt": {
              dir: false,
              async: jest.fn().mockResolvedValue(Buffer.from("content")),
            },
          },
        }),
      }));

      await extractZip("/backup/test.zip", "/dest");

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to write file"),
      );
    });
  });

  describe("deleteOldFiles", () => {
    it("should remove files older than 30 days", async () => {
      diffReturnValue = 36;
      mockFse.readdir.mockImplementation(() => [
        "old-backup.zip",
        "recent.zip",
      ]);

      await deleteOldFiles();

      expect(mockFse.remove).toHaveBeenCalledWith(
        expect.stringContaining("old-backup"),
      );
    });

    it("should not remove files within 30 days", async () => {
      diffReturnValue = 5;
      mockFse.readdir.mockImplementation(() => ["recent.zip"]);

      await deleteOldFiles();

      expect(mockFse.remove).not.toHaveBeenCalled();
    });

    it("should handle errors gracefully", async () => {
      mockFse.readdir.mockRejectedValueOnce(new Error("Read error"));

      await deleteOldFiles();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error deleting old files"),
      );
    });
  });

  describe("cronBackup", () => {
    it("should schedule cron job", () => {
      process.env.BACKUP_SCHEDULER = "0 0 * * *";
      cronBackup();
      expect(mockSchedule).toHaveBeenCalled();
    });

    it("should call backupAndZip and deleteOldFiles in scheduled callback", async () => {
      process.env.BACKUP_SCHEDULER = "0 0 * * *";
      mockFse.pathExists.mockResolvedValue(false);
      mockFse.readdir.mockResolvedValueOnce(["data1.db"]);
      cronBackup();
      // Trigger the scheduled callback to execute lines 141-148
      const scheduledCb = mockSchedule.mock.calls[0][1];
      await scheduledCb();

      expect(logger.info).toHaveBeenCalledWith("Backup completed successfully");
    });

    it("should complete without error when backupAndZip and deleteOldFiles absorb their own failures", async () => {
      // Both helpers catch internally, so a failure inside either of them is
      // logged by that helper and the cron callback still reports success.
      mockFse.pathExists.mockResolvedValue(false);
      mockFse.copy.mockRejectedValueOnce(new Error("Copy failed"));
      mockFse.readdir.mockResolvedValue(["data1.db"]);

      cronBackup();
      const scheduledCb = mockSchedule.mock.calls[0][1];
      await scheduledCb();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error during backup and zipping process"),
      );
      expect(logger.info).toHaveBeenCalledWith("Backup completed successfully");
    });

    it("should log an error when the scheduled backup rejects", async () => {
      // backupAndZip builds its filename prefix with moment().tz(...) BEFORE
      // entering its own try block, so a clock failure there escapes
      // backupAndZip's internal catch and reaches the cron callback's catch.
      const momentMock = require("moment-timezone");
      const instance = momentMock();
      const originalTz = instance.tz;
      instance.tz = jest.fn(() => {
        throw new Error("clock unavailable");
      });

      try {
        cronBackup();
        const scheduledCb = mockSchedule.mock.calls[0][1];
        await scheduledCb();
      } finally {
        instance.tz = originalTz;
      }

      expect(logger.error).toHaveBeenCalledWith(
        "Error during cron backup: clock unavailable",
      );
      expect(logger.info).not.toHaveBeenCalledWith(
        "Backup completed successfully",
      );
    });

    it("should fall back to the default expression when BACKUP_SCHEDULER is unset", () => {
      const saved = process.env.BACKUP_SCHEDULER;
      delete process.env.BACKUP_SCHEDULER;

      try {
        // cronExp is read at module load, so the module must be re-required
        // with the variable absent.
        jest.isolateModules(() => {
          const {
            cronBackup: freshCronBackup,
          } = require("../../middlewares/backup.middleware");
          const {
            logger: freshLogger,
          } = require("../../middlewares/activityLog.middleware");

          freshCronBackup();

          // NOTE: the announcement is driven by `cronExp !== "0 0 * * *"`,
          // which is true when cronExp is undefined — so an unset variable is
          // reported as a custom expression. Cosmetic only; the schedule below
          // is still the correct default.
          expect(freshLogger.info).toHaveBeenCalledWith(
            "You set cron expression as undefined",
          );
        });
      } finally {
        if (saved === undefined) {
          delete process.env.BACKUP_SCHEDULER;
        } else {
          process.env.BACKUP_SCHEDULER = saved;
        }
      }

      expect(mockSchedule).toHaveBeenCalledWith(
        "0 0 * * *",
        expect.any(Function),
      );
    });
  });
});
