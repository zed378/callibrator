const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const storagePath = require("./storagePath.util");
const { logger } = require("../middlewares/activityLog.middleware");
const { AppError } = require("./appError.util");
const {
  validateFileMagicBytes,
  sanitizeFilename,
} = require("./fileValidation.util");

// ==========================================
// STORAGE CONFIGURATION
// ==========================================

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = req.uploadFolder || "uploads";
    const fullPath = storagePath(folder);
    cb(null, fullPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const randomPrefix = Date.now() + "-" + Math.floor(Math.random() * 10000);
    const fileName = `${randomPrefix}-${uuidv4()}${ext}`;
    req.uploadFilename = fileName;
    cb(null, fileName);
  },
});

// ==========================================
// FILE FILTER
// ==========================================

const fileFilter = (req, file, cb) => {
  // NOTE: SVG is intentionally excluded from the default allowlist. SVG files
  // can embed executable JavaScript and are served inline from /uploads, which
  // would enable stored XSS. Routes that genuinely need SVG must opt in
  // explicitly via allowedMimes/allowedExtensions and serve them safely.
  const allowedMimes = req.allowedMimes || [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
  ];
  const allowedExtensions = req.allowedExtensions || [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
  ];

  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedMimes.includes(file.mimetype) && allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(
      new AppError(
        400,
        `Invalid file type. Allowed: ${allowedExtensions.join(", ")}`,
      ),
    );
  }
};

// ==========================================
// MULTER CONFIG
// ==========================================

const DEFAULT_MAX_FILE_SIZE =
  parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024; // 5MB default

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: DEFAULT_MAX_FILE_SIZE,
  },
});

// ==========================================
// UPLOAD HELPERS
// ==========================================

/**
 * Create a multer upload middleware for specific folder and file types
 * @param {Object} options - Configuration options
 * @param {string} options.folder - Destination folder (default: "uploads")
 * @param {Array} options.allowedMimes - Allowed MIME types
 * @param {Array} options.allowedExtensions - Allowed file extensions
 * @param {number} options.maxFileSize - Max file size in bytes (defaults to MAX_FILE_SIZE env)
 * @param {boolean} options.validateMagicBytes - Whether to validate magic bytes (default: true)
 * @returns {Function} Multer middleware
 */
exports.upload = (options = {}) => {
  const {
    folder = "uploads",
    allowedMimes,
    allowedExtensions,
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
    validateMagicBytes = true,
  } = options;

  // Create a new multer instance with custom file size
  const uploader = multer({
    storage,
    fileFilter,
    limits: { fileSize: maxFileSize },
  });

  return (req, res, next) => {
    req.uploadFolder = folder;
    req.allowedMimes = allowedMimes;
    req.allowedExtensions = allowedExtensions;

    uploader.single("file")(req, res, async (err) => {
      if (err instanceof AppError) {
        return next(err);
      }
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return next(
            new AppError(
              400,
              `File too large. Max size: ${maxFileSize / 1024 / 1024}MB`,
            ),
          );
        }
        return next(err);
      }

      // Validate magic bytes if file was uploaded
      if (req.file && validateMagicBytes) {
        try {
          const declaredMime = req.file.mimetype;
          const verifiedMime = await validateFileMagicBytes(
            req.file.path,
            declaredMime,
          );

          if (!verifiedMime) {
            return next(
              new AppError(400, "File content does not match declared type"),
            );
          }

          // Update the file mimetype to verified type
          req.file.mimetype = verifiedMime;
        } catch (validationErr) {
          // Clean up the uploaded file
          try {
            const fs = require("fs");
            await fs.promises.unlink(req.file.path);
          } catch {}
          return next(validationErr);
        }
      }

      next();
    });
  };
};

/**
 * Create a multer multi-upload middleware
 * @param {Object} options - Configuration options
 * @param {string} options.folder - Destination folder
 * @param {Array} options.allowedMimes - Allowed MIME types
 * @param {Array} options.allowedExtensions - Allowed file extensions
 * @param {number} options.maxFileSize - Max file size in bytes
 * @param {number} options.maxFiles - Maximum number of files
 * @param {boolean} options.validateMagicBytes - Whether to validate magic bytes
 * @returns {Function} Multer middleware
 */
exports.uploadMulti = (options = {}) => {
  const {
    folder = "uploads",
    allowedMimes,
    allowedExtensions,
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
    maxFiles = 5,
    validateMagicBytes = true,
  } = options;

  const uploader = multer({
    storage,
    fileFilter,
    limits: {
      fileSize: maxFileSize,
      files: maxFiles,
    },
  });

  return async (req, res, next) => {
    req.uploadFolder = folder;
    req.allowedMimes = allowedMimes;
    req.allowedExtensions = allowedExtensions;

    uploader.array("files", maxFiles)(req, res, async (err) => {
      if (err instanceof AppError) {
        return next(err);
      }
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return next(
            new AppError(
              400,
              `File too large. Max size: ${maxFileSize / 1024 / 1024}MB`,
            ),
          );
        }
        return next(err);
      }

      // Validate magic bytes for each uploaded file
      if (validateMagicBytes && req.files && req.files.length > 0) {
        try {
          for (const file of req.files) {
            const verifiedMime = await validateFileMagicBytes(
              file.path,
              file.mimetype,
            );
            file.mimetype = verifiedMime;
          }
        } catch (validationErr) {
          // Clean up all uploaded files on validation failure
          if (req.files) {
            for (const file of req.files) {
              try {
                const fs = require("fs");
                await fs.promises.unlink(file.path);
              } catch {}
            }
          }
          return next(validationErr);
        }
      }

      next();
    });
  };
};

/**
 * Delete uploaded file
 * @param {string} filename - Name of the file to delete
 * @param {string} folder - Folder path
 */
exports.deleteUpload = (filename, folder = "uploads") => {
  const fs = require("fs");
  const path = require("path");
  const filePath = storagePath(folder, filename);
  const resolvedRoot = storagePath(folder);

  return new Promise((resolve, reject) => {
    // Prevent Path Traversal - resolve both paths before comparing
    const normalizedFilePath = path.resolve(filePath);
    const normalizedRoot = path.resolve(resolvedRoot);

    if (!normalizedFilePath.startsWith(normalizedRoot)) {
      return reject(new AppError(400, "Invalid file path for deletion"));
    }

    fs.unlink(filePath, (err) => {
      if (err) {
        // Ignore ENOENT - file already deleted or doesn't exist
        if (err.code === "ENOENT") {
          logger.warn(`File already deleted or does not exist: ${filePath}`);
          return resolve();
        }
        logger.error(`Failed to delete file: ${filePath}`, err);
        return reject(err);
      }
      resolve();
    });
  });
};

/**
 * Get public URL for uploaded file
 * @param {string} filename - Name of the file
 * @param {string} folder - Folder path
 */
exports.getUploadUrl = (filename, folder = "uploads") => {
  // Prevent path traversal in URL generation
  if (filename && filename.includes("..")) {
    throw new AppError(400, "Invalid filename");
  }
  return `/${folder}/${filename}`;
};
