/**
 * Tests for upload utility - focusing on middleware behavior.
 *
 * `multer` is mocked so that we can drive the middleware logic
 * (magic-byte validation, error handling) without a real multipart
 * HTTP request, and so we can directly invoke the storage/destination
 * and fileFilter functions to cover those code paths.
 */
const { v4: uuidv4 } = require("uuid");
const { AppError } = require("../../utils/appError.util");

jest.mock("uuid", () => ({ v4: () => "test-uuid-1234" }));

jest.mock("../../utils/storagePath.util", () =>
  jest.fn((...paths) => `C:/uploads/${paths.join("/")}`),
);

jest.mock("../../utils/fileValidation.util", () => ({
  validateFileMagicBytes: jest.fn().mockResolvedValue("image/jpeg"),
  sanitizeFilename: jest.fn((filename) => filename),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Capture the configs passed to multer so we can exercise the
// storage destination/filename and fileFilter functions directly.
let capturedStorage = null;
let capturedMulterConfig = null;
// When set, the mocked multer callbacks are invoked with this error.
let forcedError = null;

jest.mock("multer", () => {
  const diskStorage = (config) => {
    capturedStorage = config;
    return { __isStorage: true };
  };
  const instance = {
    single: () => (req, res, cb) => {
      cb(forcedError);
    },
    array: () => (req, res, cb) => {
      cb(forcedError);
    },
  };
  const multerFn = jest.fn((config) => {
    capturedMulterConfig = config;
    return instance;
  });
  multerFn.diskStorage = diskStorage;
  return multerFn;
});

const {
  upload,
  uploadMulti,
  deleteUpload,
  getUploadUrl,
} = require("../../utils/upload.util");
const storagePath = require("../../utils/storagePath.util");
const fs = require("fs");
const { validateFileMagicBytes } = require("../../utils/fileValidation.util");
const { logger } = require("../../middlewares/activityLog.middleware");

describe("upload utility - comprehensive middleware tests", () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    forcedError = null;
    mockReq = {
      uploadFolder: "uploads",
      allowedMimes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
      allowedExtensions: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
    jest.clearAllMocks();
    // Reset validator default between tests.
    validateFileMagicBytes.mockReset();
    validateFileMagicBytes.mockResolvedValue("image/jpeg");
  });

  // ================================================================
  // EXPORTED FUNCTIONS
  // ================================================================
  describe("Exported functions", () => {
    it("should export upload factory function", () => {
      expect(typeof upload).toBe("function");
    });

    it("should export uploadMulti factory function", () => {
      expect(typeof uploadMulti).toBe("function");
    });

    it("should export deleteUpload function", () => {
      expect(typeof deleteUpload).toBe("function");
    });

    it("should export getUploadUrl function", () => {
      expect(typeof getUploadUrl).toBe("function");
    });

    it("should create a single-file middleware from upload()", () => {
      expect(typeof upload({})).toBe("function");
    });

    it("should create a multi-file middleware from uploadMulti()", () => {
      expect(typeof uploadMulti({})).toBe("function");
    });

    it("should create a middleware from upload() with no options", () => {
      expect(typeof upload()).toBe("function");
    });

    it("should create a middleware from uploadMulti() with no options", () => {
      expect(typeof uploadMulti()).toBe("function");
    });
  });

  // ================================================================
  // STORAGE (destination + filename) - lines 18-27
  // ================================================================
  describe("storage configuration", () => {
    it("should resolve destination using req.uploadFolder", () => {
      const req = { uploadFolder: "avatars" };
      const cb = jest.fn();
      capturedStorage.destination(req, { originalname: "x.jpg" }, cb);
      expect(cb).toHaveBeenCalledWith(null, "C:/uploads/avatars");
      expect(storagePath).toHaveBeenCalledWith("avatars");
    });

    it("should fall back to 'uploads' folder when unset", () => {
      const req = {};
      const cb = jest.fn();
      capturedStorage.destination(req, { originalname: "x.jpg" }, cb);
      expect(cb).toHaveBeenCalledWith(null, "C:/uploads/uploads");
    });

    it("should generate a filename with timestamp and uuid", () => {
      const req = {};
      const cb = jest.fn();
      capturedStorage.filename(req, { originalname: "photo.png" }, cb);
      expect(req.uploadFilename).toMatch(/^\d+-\d+-test-uuid-1234\.png$/);
      expect(cb).toHaveBeenCalledWith(null, req.uploadFilename);
    });
  });

  // ================================================================
  // FILE FILTER - lines 40-59
  // ================================================================
  describe("fileFilter behavior", () => {
    const runFilter = (req, file) =>
      new Promise((resolve) => {
        capturedMulterConfig.fileFilter(req, file, (err, accepted) =>
          resolve({ err, accepted }),
        );
      });

    it("should accept an allowed mime + extension (defaults)", async () => {
      const req = {};
      const file = { originalname: "a.png", mimetype: "image/png" };
      const { err, accepted } = await runFilter(req, file);
      expect(err).toBeNull();
      expect(accepted).toBe(true);
    });

    it("should accept custom allowed mime + extension", async () => {
      const req = {
        allowedMimes: ["image/jpeg"],
        allowedExtensions: [".jpg"],
      };
      const file = { originalname: "a.jpg", mimetype: "image/jpeg" };
      const { err, accepted } = await runFilter(req, file);
      expect(err).toBeNull();
      expect(accepted).toBe(true);
    });

    it("should reject a disallowed extension", async () => {
      const req = { allowedMimes: ["image/png"], allowedExtensions: [".png"] };
      const file = { originalname: "a.gif", mimetype: "image/png" };
      const { err } = await runFilter(req, file);
      expect(err).toBeInstanceOf(AppError);
      expect(err.status).toBe(400);
      expect(err.message).toContain("Invalid file type");
    });

    it("should reject a disallowed mime type", async () => {
      const req = { allowedMimes: ["image/png"], allowedExtensions: [".png"] };
      const file = { originalname: "a.png", mimetype: "text/plain" };
      const { err } = await runFilter(req, file);
      expect(err).toBeInstanceOf(AppError);
      expect(err.status).toBe(400);
    });
  });

  // ================================================================
  // UPLOAD MIDDLEWARE - SINGLE FILE - lines 114-161
  // ================================================================
  describe("upload middleware (single file)", () => {
    const runMiddleware = (middleware, req) =>
      new Promise((resolve) => {
        mockNext.mockImplementationOnce((arg) => resolve(arg));
        middleware(req, mockRes, mockNext);
      });

    it("should call next with no error and update mimetype for valid file", async () => {
      const middleware = upload({ validateMagicBytes: true });
      mockReq.file = {
        originalname: "test.jpg",
        mimetype: "image/jpeg",
        path: "/tmp/test.jpg",
      };
      const result = await runMiddleware(middleware, mockReq);
      expect(result).toBeUndefined();
      expect(mockReq.file.mimetype).toBe("image/jpeg");
      expect(validateFileMagicBytes).toHaveBeenCalledWith(
        "/tmp/test.jpg",
        "image/jpeg",
      );
    });

    it("should call next with no error when there is no file", async () => {
      const middleware = upload({ validateMagicBytes: true });
      mockReq.file = undefined;
      const result = await runMiddleware(middleware, mockReq);
      expect(result).toBeUndefined();
      expect(validateFileMagicBytes).not.toHaveBeenCalled();
    });

    it("should call next with no error when validateMagicBytes is disabled", async () => {
      const middleware = upload({ validateMagicBytes: false });
      mockReq.file = {
        originalname: "test.jpg",
        mimetype: "image/jpeg",
        path: "/tmp/test.jpg",
      };
      const result = await runMiddleware(middleware, mockReq);
      expect(result).toBeUndefined();
      expect(validateFileMagicBytes).not.toHaveBeenCalled();
    });

    it("should call next with AppError when magic bytes mismatch", async () => {
      validateFileMagicBytes.mockResolvedValueOnce(null);
      const middleware = upload({ validateMagicBytes: true });
      mockReq.file = {
        originalname: "test.jpg",
        mimetype: "image/jpeg",
        path: "/tmp/test.jpg",
      };
      const err = await runMiddleware(middleware, mockReq);
      expect(err).toBeInstanceOf(AppError);
      expect(err.status).toBe(400);
      expect(err.message).toBe("File content does not match declared type");
    });

    it("should delete the file and forward the error when validation throws", async () => {
      const validationErr = new Error("boom");
      validateFileMagicBytes.mockRejectedValueOnce(validationErr);
      const unlinkSpy = jest
        .spyOn(fs.promises, "unlink")
        .mockResolvedValue();
      const middleware = upload({ validateMagicBytes: true });
      mockReq.file = {
        originalname: "test.jpg",
        mimetype: "image/jpeg",
        path: "/tmp/test.jpg",
      };
      const err = await runMiddleware(middleware, mockReq);
      expect(err).toBe(validationErr);
      expect(unlinkSpy).toHaveBeenCalledWith("/tmp/test.jpg");
      unlinkSpy.mockRestore();
    });

    it("should forward an AppError produced by multer as-is", async () => {
      const appErr = new AppError(401, "nope");
      forcedError = appErr;
      const middleware = upload({});
      const result = await runMiddleware(middleware, mockReq);
      expect(result).toBe(appErr);
    });

    it("should forward a LIMIT_FILE_SIZE error as a 400 AppError", async () => {
      const sizeErr = new Error("too big");
      sizeErr.code = "LIMIT_FILE_SIZE";
      forcedError = sizeErr;
      const middleware = upload({ maxFileSize: 1024 });
      const err = await runMiddleware(middleware, mockReq);
      expect(err).toBeInstanceOf(AppError);
      expect(err.status).toBe(400);
      expect(err.message).toContain("File too large");
    });

    it("should forward generic multer errors", async () => {
      const genericErr = new Error("weird");
      forcedError = genericErr;
      const middleware = upload({});
      const err = await runMiddleware(middleware, mockReq);
      expect(err).toBe(genericErr);
    });
  });

  // ================================================================
  // UPLOAD MULTI MIDDLEWARE - lines 197-241
  // ================================================================
  describe("uploadMulti middleware", () => {
    const runMiddleware = (middleware, req) =>
      new Promise((resolve) => {
        mockNext.mockImplementationOnce((arg) => resolve(arg));
        middleware(req, mockRes, mockNext);
      });

    it("should call next with no error and update mimetypes for valid files", async () => {
      validateFileMagicBytes.mockImplementation((p, m) =>
        Promise.resolve(m),
      );
      const middleware = uploadMulti({ validateMagicBytes: true });
      mockReq.files = [
        { originalname: "a.jpg", mimetype: "image/jpeg", path: "/tmp/a.jpg" },
        { originalname: "b.png", mimetype: "image/png", path: "/tmp/b.png" },
      ];
      const result = await runMiddleware(middleware, mockReq);
      expect(result).toBeUndefined();
      expect(mockReq.files[0].mimetype).toBe("image/jpeg");
      expect(mockReq.files[1].mimetype).toBe("image/png");
      expect(validateFileMagicBytes).toHaveBeenCalledTimes(2);
    });

    it("should call next with no error when there are no files", async () => {
      const middleware = uploadMulti({ validateMagicBytes: true });
      mockReq.files = undefined;
      const result = await runMiddleware(middleware, mockReq);
      expect(result).toBeUndefined();
      expect(validateFileMagicBytes).not.toHaveBeenCalled();
    });

    it("should call next with no error when validateMagicBytes is disabled", async () => {
      const middleware = uploadMulti({ validateMagicBytes: false });
      mockReq.files = [
        { originalname: "a.jpg", mimetype: "image/jpeg", path: "/tmp/a.jpg" },
      ];
      const result = await runMiddleware(middleware, mockReq);
      expect(result).toBeUndefined();
      expect(validateFileMagicBytes).not.toHaveBeenCalled();
    });

    it("should set mimetype to null when magic bytes mismatch (no throw)", async () => {
      validateFileMagicBytes.mockResolvedValueOnce(null);
      const middleware = uploadMulti({ validateMagicBytes: true });
      mockReq.files = [
        { originalname: "a.jpg", mimetype: "image/jpeg", path: "/tmp/a.jpg" },
      ];
      const result = await runMiddleware(middleware, mockReq);
      expect(result).toBeUndefined();
      expect(mockReq.files[0].mimetype).toBeNull();
    });

    it("should delete all files and forward error when validation throws", async () => {
      const validationErr = new Error("boom");
      validateFileMagicBytes.mockRejectedValueOnce(validationErr);
      const unlinkSpy = jest
        .spyOn(fs.promises, "unlink")
        .mockResolvedValue();
      const middleware = uploadMulti({ validateMagicBytes: true });
      mockReq.files = [
        { originalname: "a.jpg", mimetype: "image/jpeg", path: "/tmp/a.jpg" },
        { originalname: "b.png", mimetype: "image/png", path: "/tmp/b.png" },
      ];
      const err = await runMiddleware(middleware, mockReq);
      expect(err).toBe(validationErr);
      expect(unlinkSpy).toHaveBeenCalledWith("/tmp/a.jpg");
      expect(unlinkSpy).toHaveBeenCalledWith("/tmp/b.png");
      unlinkSpy.mockRestore();
    });

    it("should handle error when validation throws and req.files is cleared during process", async () => {
      const validationErr = new Error("boom");
      validateFileMagicBytes.mockImplementationOnce(() => {
        mockReq.files = undefined;
        throw validationErr;
      });
      const middleware = uploadMulti({ validateMagicBytes: true });
      mockReq.files = [
        { originalname: "a.jpg", mimetype: "image/jpeg", path: "/tmp/a.jpg" },
      ];
      const err = await runMiddleware(middleware, mockReq);
      expect(err).toBe(validationErr);
    });

    it("should forward a LIMIT_FILE_SIZE error as a 400 AppError", async () => {
      const sizeErr = new Error("too big");
      sizeErr.code = "LIMIT_FILE_SIZE";
      forcedError = sizeErr;
      const middleware = uploadMulti({ maxFileSize: 1024 });
      const err = await runMiddleware(middleware, mockReq);
      expect(err).toBeInstanceOf(AppError);
      expect(err.status).toBe(400);
      expect(err.message).toContain("File too large");
    });

    it("should forward generic multer errors", async () => {
      const genericErr = new Error("weird");
      forcedError = genericErr;
      const middleware = uploadMulti({});
      const err = await runMiddleware(middleware, mockReq);
      expect(err).toBe(genericErr);
    });

    it("should forward an AppError produced by multer as-is", async () => {
      const appErr = new AppError(401, "nope");
      forcedError = appErr;
      const middleware = uploadMulti({});
      const result = await runMiddleware(middleware, mockReq);
      expect(result).toBe(appErr);
    });
  });

  // ================================================================
  // DELETE UPLOAD
  // ================================================================
  describe("deleteUpload", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should be a function", () => {
      expect(typeof deleteUpload).toBe("function");
    });

    it("should delete a file successfully", async () => {
      const unlinkMock = jest
        .spyOn(fs, "unlink")
        .mockImplementation((p, cb) => cb(null));
      await expect(deleteUpload("test.jpg", "avatars")).resolves.toBeUndefined();
      expect(storagePath).toHaveBeenCalledWith("avatars", "test.jpg");
      expect(unlinkMock).toHaveBeenCalledWith(
        "C:/uploads/avatars/test.jpg",
        expect.any(Function),
      );
      unlinkMock.mockRestore();
    });

    it("should handle ENOENT error gracefully", async () => {
      const unlinkMock = jest.spyOn(fs, "unlink").mockImplementation((p, cb) => {
        const err = new Error("File not found");
        err.code = "ENOENT";
        cb(err);
      });
      await expect(deleteUpload("test.jpg", "avatars")).resolves.toBeUndefined();
      expect(storagePath).toHaveBeenCalledWith("avatars", "test.jpg");
      expect(unlinkMock).toHaveBeenCalledWith(
        "C:/uploads/avatars/test.jpg",
        expect.any(Function),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        "File already deleted or does not exist: C:/uploads/avatars/test.jpg",
      );
      unlinkMock.mockRestore();
    });

    it("should reject with other filesystem errors", async () => {
      const unlinkMock = jest.spyOn(fs, "unlink").mockImplementation((p, cb) => {
        const err = new Error("Permission denied");
        err.code = "EACCES";
        cb(err);
      });
      await expect(deleteUpload("test.jpg", "avatars")).rejects.toThrow(
        "Permission denied",
      );
      expect(storagePath).toHaveBeenCalledWith("avatars", "test.jpg");
      expect(unlinkMock).toHaveBeenCalledWith(
        "C:/uploads/avatars/test.jpg",
        expect.any(Function),
      );
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to delete file: C:/uploads/avatars/test.jpg",
        expect.any(Error),
      );
      unlinkMock.mockRestore();
    });

    it("should reject path traversal attempts", async () => {
      await expect(deleteUpload("../etc/passwd", "uploads")).rejects.toThrow(
        "Invalid file path for deletion",
      );
    });

    it("should use default folder when not specified", async () => {
      const unlinkMock = jest
        .spyOn(fs, "unlink")
        .mockImplementation((p, cb) => cb(null));
      await expect(deleteUpload("test.jpg")).resolves.toBeUndefined();
      expect(storagePath).toHaveBeenCalledWith("uploads", "test.jpg");
      expect(unlinkMock).toHaveBeenCalledWith(
        "C:/uploads/uploads/test.jpg",
        expect.any(Function),
      );
      unlinkMock.mockRestore();
    });

    it("should call storagePath with folder and filename", async () => {
      const unlinkMock = jest
        .spyOn(fs, "unlink")
        .mockImplementation((p, cb) => cb(null));
      await expect(deleteUpload("test.jpg", "avatars")).resolves.toBeUndefined();
      expect(storagePath).toHaveBeenCalledWith("avatars", "test.jpg");
      unlinkMock.mockRestore();
    });
  });

  // ================================================================
  // GET UPLOAD URL
  // ================================================================
  describe("getUploadUrl", () => {
    it("should return correct URL with default folder", () => {
      expect(getUploadUrl("test.jpg")).toBe("/uploads/test.jpg");
    });

    it("should return correct URL with custom folder", () => {
      expect(getUploadUrl("avatar.png", "avatars")).toBe(
        "/avatars/avatar.png",
      );
    });

    it("should handle filenames with special characters", () => {
      expect(getUploadUrl("my-file_123.png", "documents")).toBe(
        "/documents/my-file_123.png",
      );
    });

    it("should handle filenames with dots", () => {
      expect(getUploadUrl("my.file.with.dots.jpg")).toBe(
        "/uploads/my.file.with.dots.jpg",
      );
    });

    it("should reject path traversal in filename", () => {
      expect(() => getUploadUrl("../etc/passwd")).toThrow("Invalid filename");
    });

    it("should reject filenames with double dots", () => {
      expect(() => getUploadUrl("test/../evil.jpg")).toThrow(
        "Invalid filename",
      );
    });

    it("should handle empty filename", () => {
      expect(getUploadUrl("", "uploads")).toBe("/uploads/");
    });

    it("should handle filename with spaces", () => {
      expect(getUploadUrl("my file.jpg", "uploads")).toBe(
        "/uploads/my file.jpg",
      );
    });
  });
});
