/**
 * Tests for fileValidation utility
 */
const fs = require("fs");
const path = require("path");
const {
  validateFileMagicBytes,
  isDangerousExtension,
  isDangerousMime,
  sanitizeFilename,
  sanitizeError,
  createSanitizedErrorHandler,
  validateFileSize,
  validateFileType,
  validateUpload,
  FILE_SIZES,
  ALLOWED_TYPES,
} = require("../../utils/fileValidation.util");

describe("fileValidation", () => {
  // ================================================================
  // Magic Bytes
  // ================================================================
  describe("validateFileMagicBytes", () => {
    const mockStat = { size: 100 };
    let mockFd;

    beforeEach(() => {
      jest.restoreAllMocks();
      jest.spyOn(fs.promises, "stat").mockResolvedValue(mockStat);
      mockFd = {
        read: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
      };
      jest.spyOn(fs.promises, "open").mockResolvedValue(mockFd);
    });

    it("should reject empty files", async () => {
      jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 0 });
      await expect(
        validateFileMagicBytes("/path/to/file.jpg", "image/jpeg"),
      ).rejects.toThrow("empty");
    });

    it("should reject unreadable files", async () => {
      mockFd.read.mockResolvedValue({ bytesRead: 0, buffer: Buffer.alloc(0) });
      await expect(
        validateFileMagicBytes("/path/to/file.jpg", "image/jpeg"),
      ).rejects.toThrow("Unable to read");
    });

    it("should return MIME type for matching magic bytes", async () => {
      // JPEG magic bytes: FF D8 FF
      const jpegBuffer = Buffer.from([
        0xff, 0xd8, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00,
      ]);

      mockFd.read.mockImplementation(async (buf) => {
        jpegBuffer.copy(buf, 0, 0, Math.min(16, jpegBuffer.length));
        return { bytesRead: Math.min(16, jpegBuffer.length), buffer: buf };
      });

      const result = await validateFileMagicBytes(
        "/path/to/file.jpg",
        "image/jpeg",
      );
      expect(result).toBe("image/jpeg");
    });

    it("should accept octet-stream for readable files", async () => {
      mockFd.read.mockImplementation(async (buf) => {
        buf[0] = 0x00;
        return { bytesRead: 1, buffer: buf };
      });
      const result = await validateFileMagicBytes(
        "/path/to/file.bin",
        "application/octet-stream",
      );
      expect(result).toBe("application/octet-stream");
    });

    it("should throw error for mismatched MIME", async () => {
      mockFd.read.mockImplementation(async (buf) => {
        buf[0] = 0x00;
        return { bytesRead: 1, buffer: buf };
      });
      await expect(
        validateFileMagicBytes("/path/to/file.jpg", "image/png"),
      ).rejects.toThrow("File content does not match");
    });

    it("should handle AppError by re-throwing", async () => {
      jest.spyOn(fs.promises, "stat").mockRejectedValue(new Error("DB error"));
      await expect(
        validateFileMagicBytes("/path/to/file.jpg", "image/jpeg"),
      ).rejects.toThrow();
    });

    it("should handle generic errors with 500 status", async () => {
      jest.spyOn(fs.promises, "stat").mockRejectedValue(new Error("Unknown"));
      await expect(
        validateFileMagicBytes("/path/to/file.jpg", "image/jpeg"),
      ).rejects.toThrow();
    });

    it("should handle WebP custom check", async () => {
      // WebP: RIFF....WEBP
      const webpBuffer = Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42,
        0x50, 0x00, 0x00, 0x00, 0x00,
      ]);

      mockFd.read.mockImplementation(async (buf) => {
        webpBuffer.copy(buf, 0, 0, Math.min(16, webpBuffer.length));
        return { bytesRead: Math.min(16, webpBuffer.length), buffer: buf };
      });

      const result = await validateFileMagicBytes(
        "/path/to/file.webp",
        "image/webp",
      );
      expect(result).toBe("image/webp");
    });

    it("should handle short buffer for WebP", async () => {
      const shortBuffer = Buffer.from([0x52, 0x49, 0x46, 0x46]);
      mockFd.read.mockImplementation(async (buf) => {
        shortBuffer.copy(buf, 0, 0, Math.min(16, shortBuffer.length));
        return { bytesRead: Math.min(16, shortBuffer.length), buffer: buf };
      });
      await expect(
        validateFileMagicBytes("/path/to/file.webp", "image/webp"),
      ).rejects.toThrow("File content does not match");
    });

    it("should handle very short file size for WebP custom check", async () => {
      jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 10 });
      mockFd.read.mockImplementation(async (buf) => {
        return { bytesRead: 10, buffer: buf };
      });
      await expect(
        validateFileMagicBytes("/path/to/file.webp", "image/webp"),
      ).rejects.toThrow("File content does not match");
    });

    it("should throw when signature matches but declared MIME is different", async () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00]);
      mockFd.read.mockImplementation(async (buf) => {
        jpegBuffer.copy(buf);
        return { bytesRead: 5, buffer: buf };
      });
      await expect(
        validateFileMagicBytes("/path/to/file.jpg", "image/png"),
      ).rejects.toThrow("File content does not match");
    });

    it("should throw when customCheck matches but declared MIME is different", async () => {
      const webpBuffer = Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42,
        0x50, 0x00, 0x00, 0x00, 0x00,
      ]);
      mockFd.read.mockImplementation(async (buf) => {
        webpBuffer.copy(buf);
        return { bytesRead: 16, buffer: buf };
      });
      await expect(
        validateFileMagicBytes("/path/to/file.webp", "image/png"),
      ).rejects.toThrow("File content does not match");
    });

    it("should reject short file for signature checks", async () => {
      jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 2 });
      mockFd.read.mockImplementation(async (buf) => {
        buf[0] = 0xff;
        buf[1] = 0xd8;
        return { bytesRead: 2, buffer: buf };
      });
      await expect(
        validateFileMagicBytes("/path/to/file.jpg", "image/jpeg"),
      ).rejects.toThrow("File content does not match");
    });
  });

  // ================================================================
  // Dangerous Extensions / MIMEs
  // ================================================================
  describe("isDangerousExtension", () => {
    it("should detect PHP extensions as dangerous", () => {
      expect(isDangerousExtension(".php")).toBe(true);
      expect(isDangerousExtension(".php3")).toBe(true);
      expect(isDangerousExtension(".phtml")).toBe(true);
    });

    it("should detect executable extensions as dangerous", () => {
      expect(isDangerousExtension(".exe")).toBe(true);
      expect(isDangerousExtension(".dll")).toBe(true);
      expect(isDangerousExtension(".bat")).toBe(true);
    });

    it("should detect script extensions as dangerous", () => {
      expect(isDangerousExtension(".sh")).toBe(true);
      expect(isDangerousExtension(".ps1")).toBe(true);
      expect(isDangerousExtension(".py")).toBe(true);
      expect(isDangerousExtension(".rb")).toBe(true);
    });

    it("should detect HTML extensions as dangerous", () => {
      expect(isDangerousExtension(".html")).toBe(true);
      expect(isDangerousExtension(".svg")).toBe(true);
      expect(isDangerousExtension(".js")).toBe(true);
    });

    it("should allow safe extensions", () => {
      expect(isDangerousExtension(".jpg")).toBe(false);
      expect(isDangerousExtension(".png")).toBe(false);
      expect(isDangerousExtension(".pdf")).toBe(false);
    });

    it("should be case insensitive", () => {
      expect(isDangerousExtension(".PHP")).toBe(true);
      expect(isDangerousExtension(".Exe")).toBe(true);
    });
  });

  describe("isDangerousMime", () => {
    it("should detect dangerous MIME types", () => {
      expect(isDangerousMime("application/x-php")).toBe(true);
      expect(isDangerousMime("application/x-perl")).toBe(true);
      expect(isDangerousMime("application/x-msdownload")).toBe(true);
    });

    it("should allow safe MIME types", () => {
      expect(isDangerousMime("image/jpeg")).toBe(false);
      expect(isDangerousMime("application/pdf")).toBe(false);
    });

    it("should be case insensitive", () => {
      expect(isDangerousMime("APPLICATION/X-PHP")).toBe(true);
    });
  });

  // ================================================================
  // sanitizeFilename
  // ================================================================
  describe("sanitizeFilename", () => {
    it("should reject empty filename", () => {
      expect(() => sanitizeFilename("")).toThrow("Filename is required");
    });

    it("should reject dangerous extensions", () => {
      expect(() => sanitizeFilename("malware.php")).toThrow(
        "File type not allowed",
      );
      expect(() => sanitizeFilename("malware.exe")).toThrow(
        "File type not allowed",
      );
    });

    it("should reject path traversal", () => {
      expect(() => sanitizeFilename("../etc/passwd")).toThrow(
        "path traversal detected",
      );
    });

    it("should remove null bytes", () => {
      const result = sanitizeFilename("test\0.jpg");
      expect(result).toBe("test.jpg");
    });

    it("should reject empty basename after null removal", () => {
      expect(() => sanitizeFilename("\0\0")).toThrow("Invalid filename");
    });

    it("should allow safe filenames", () => {
      const result = sanitizeFilename("document.pdf");
      expect(result).toBe("document.pdf");
    });

    it("should check against allowed extensions", () => {
      expect(() => sanitizeFilename("script.php", [".jpg", ".png"])).toThrow(
        "File type not allowed",
      );
    });

    it("should reject safe extension if not in allowedExtensions list", () => {
      expect(() => sanitizeFilename("document.pdf", [".jpg", ".png"])).toThrow(
        "File type not allowed. Allowed: .jpg, .png",
      );
    });

    it("should lowercase extension for checks", () => {
      const result = sanitizeFilename("Document.PDF");
      expect(result).toBe("Document.pdf");
    });
  });

  // ================================================================
  // sanitizeError
  // ================================================================
  describe("sanitizeError", () => {
    it("should return sanitized error object", () => {
      const err = new Error("Test error");
      err.status = 500;
      const result = sanitizeError(err, false);
      expect(result.success).toBe(false);
      expect(result.status).toBe(500);
      expect(result.message).toBe("Test error");
    });

    it("should sanitize message in production", () => {
      const err = new Error("DB connection failed");
      const result = sanitizeError(err, true);
      expect(result.message).toBe(
        "An unexpected error occurred. Please try again later.",
      );
    });

    it("should include errors property", () => {
      const err = new Error("Test");
      err.errors = [{ message: "Invalid field" }];
      const result = sanitizeError(err, false);
      expect(result.errors).toEqual([{ message: "Invalid field" }]);
    });

    it("should include stack in development", () => {
      const err = new Error("Test");
      err.stack = "Error: Test\n    at ...";
      const result = sanitizeError(err, false);
      expect(result.stack).toBe(err.stack);
    });

    it("should exclude stack in production", () => {
      const err = new Error("Test");
      err.stack = "Error: Test\n    at ...";
      const result = sanitizeError(err, true);
      expect(result.stack).toBeUndefined();
    });

    it("should include name in development", () => {
      const err = new Error("Test");
      err.name = "TypeError";
      const result = sanitizeError(err, false);
      expect(result.name).toBe("TypeError");
    });

    it("should default status to 500", () => {
      const err = new Error("Test");
      const result = sanitizeError(err, false);
      expect(result.status).toBe(500);
    });

    it("should use err.statusCode when available", () => {
      const err = new Error("Test");
      err.statusCode = 404;
      const result = sanitizeError(err, false);
      expect(result.status).toBe(404);
    });

    it("should use default parameter for isProduction in sanitizeError", () => {
      const err = new Error("Test");
      const result = sanitizeError(err);
      expect(result.message).toBe("Test");
    });

    it("should fallback to Internal server error if error message is empty", () => {
      const err = { status: 500 };
      const result = sanitizeError(err, false);
      expect(result.message).toBe("Internal server error");
    });
  });

  // ================================================================
  // createSanitizedErrorHandler
  // ================================================================
  describe("createSanitizedErrorHandler", () => {
    it("should return a function", () => {
      const handler = createSanitizedErrorHandler(() => {});
      expect(typeof handler).toBe("function");
    });

    it("should call the original handler", () => {
      let called = false;
      const wrapped = createSanitizedErrorHandler((err, req, res, next) => {
        called = true;
      });
      const mockErr = new Error("test");
      const mockReq = {};
      const mockRes = { headersSent: false, json: jest.fn() };
      const mockNext = jest.fn();
      wrapped(mockErr, mockReq, mockRes, mockNext);
      expect(called).toBe(true);
    });

    it("should not modify response when headers already sent", () => {
      let called = false;
      const wrapped = createSanitizedErrorHandler((err, req, res, next) => {
        called = true;
      });
      const mockErr = new Error("test");
      const mockRes = { headersSent: true, json: jest.fn() };
      wrapped(mockErr, {}, mockRes, jest.fn());
      expect(called).toBe(true);
    });

    it("should override res.json to sanitize error responses", async () => {
      const originalJsonMock = jest.fn();
      const mockRes = {
        headersSent: false,
        json: originalJsonMock,
      };
      const wrapped = createSanitizedErrorHandler((err, req, res, next) => {
        setImmediate(() => {
          res.json({ success: false, message: "original message" });
        });
      });
      const mockErr = new Error("Custom error message");
      wrapped(mockErr, {}, mockRes, jest.fn());
      
      await new Promise((resolve) => {
        originalJsonMock.mockImplementation(() => {
          resolve();
        });
      });
      
      expect(originalJsonMock).toHaveBeenCalled();
      const body = originalJsonMock.mock.calls[0][0];
      expect(body.success).toBe(false);
      expect(body.message).toBe("Custom error message");
    });

    it("should not sanitize if body is null or not an error object", async () => {
      const originalJsonMock = jest.fn();
      const mockRes = {
        headersSent: false,
        json: originalJsonMock,
      };
      const wrapped = createSanitizedErrorHandler((err, req, res, next) => {
        setImmediate(() => {
          res.json(null);
          res.json("string response");
          res.json({ success: true, data: "ok" });
        });
      });
      wrapped(new Error("err"), {}, mockRes, jest.fn());
      await new Promise(resolve => setImmediate(resolve));
      expect(originalJsonMock).toHaveBeenNthCalledWith(1, null);
      expect(originalJsonMock).toHaveBeenNthCalledWith(2, "string response");
      expect(originalJsonMock).toHaveBeenNthCalledWith(3, { success: true, data: "ok" });
    });

    it("should sanitize using production message in production environment", async () => {
      const originalJsonMock = jest.fn();
      const mockRes = {
        headersSent: false,
        json: originalJsonMock,
      };
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      const wrapped = createSanitizedErrorHandler((err, req, res, next) => {
        setImmediate(() => {
          res.json({ success: false, message: "original message" });
        });
      });
      wrapped(new Error("Prod error message"), {}, mockRes, jest.fn());
      
      await new Promise((resolve) => {
        originalJsonMock.mockImplementation(() => {
          resolve();
        });
      });
      process.env.NODE_ENV = origEnv;
      
      const body = originalJsonMock.mock.calls[0][0];
      expect(body.message).toBe("An unexpected error occurred. Please try again later.");
    });
  });

  // ================================================================
  // FILE_SIZES / ALLOWED_TYPES
  // ================================================================
  describe("FILE_SIZES", () => {
    it("should define size constants", () => {
      expect(FILE_SIZES.KB).toBe(1024);
      expect(FILE_SIZES.MB).toBe(1024 * 1024);
      expect(FILE_SIZES.GB).toBe(1024 * 1024 * 1024);
    });
  });

  describe("ALLOWED_TYPES", () => {
    it("should define allowed file types", () => {
      expect(ALLOWED_TYPES.IMAGE).toBeDefined();
      expect(ALLOWED_TYPES.DOCUMENT).toBeDefined();
      expect(ALLOWED_TYPES.CALIBRATION).toBeDefined();
    });
  });

  // ================================================================
  // validateFileSize / validateFileType / validateUpload
  // ================================================================
  describe("validateFileSize", () => {
    it("should reject file exceeding size limit", () => {
      const file = { size: FILE_SIZES.MB * 20 };
      const result = validateFileSize(file, FILE_SIZES.MB * 10);
      expect(result.valid).toBe(false);
    });

    it("should reject invalid file object", () => {
      const result = validateFileSize(null);
      expect(result.valid).toBe(false);
      expect(result.message).toBe("Invalid file object or missing size");
    });

    it("should reject file with missing size", () => {
      const result = validateFileSize({});
      expect(result.valid).toBe(false);
    });
  });

  describe("validateFileType", () => {
    it("should reject invalid file object", () => {
      const result = validateFileType(null);
      expect(result.valid).toBe(false);
      expect(result.message).toBe("Invalid file object or missing mimetype");
    });

    it("should reject file with missing mimetype", () => {
      const result = validateFileType({});
      expect(result.valid).toBe(false);
    });

    it("should accept single string type", () => {
      const file = { mimetype: "image/jpeg" };
      const result = validateFileType(file, "image/jpeg");
      expect(result.valid).toBe(true);
    });

    it("should reject disallowed type", () => {
      const file = { mimetype: "application/executable" };
      const result = validateFileType(file, ["image/jpeg"]);
      expect(result.valid).toBe(false);
    });
  });

  describe("validateUpload", () => {
    it("should reject missing file", () => {
      const result = validateUpload(null);
      expect(result.valid).toBe(false);
      expect(result.message).toBe("No file provided");
    });

    it("should reject empty originalname", () => {
      const file = { size: 1024, mimetype: "image/jpeg", originalname: "" };
      const result = validateUpload(file);
      expect(result.valid).toBe(false);
    });

    it("should reject whitespace-only originalname", () => {
      const file = { size: 1024, mimetype: "image/jpeg", originalname: "   " };
      const result = validateUpload(file);
      expect(result.valid).toBe(false);
    });

    it("should reject failed size check", () => {
      const file = {
        size: 1024 * 1024 * 20,
        mimetype: "image/jpeg",
        originalname: "photo.jpg",
      };
      const result = validateUpload(file, { maxSize: FILE_SIZES.MB });
      expect(result.valid).toBe(false);
    });

    it("should reject failed type check", () => {
      const file = {
        size: 1024,
        mimetype: "application/executable",
        originalname: "app.exe",
      };
      const result = validateUpload(file, {
        allowedTypes: ALLOWED_TYPES.IMAGE,
      });
      expect(result.valid).toBe(false);
    });

    it("should return valid: true for correct uploads", () => {
      const file = {
        size: 1024,
        mimetype: "image/jpeg",
        originalname: "photo.jpg",
      };
      const result = validateUpload(file, {
        maxSize: 2048,
        allowedTypes: ["image/jpeg"],
      });
      expect(result.valid).toBe(true);
      expect(result.message).toBe("Upload is valid");
    });
  });
});