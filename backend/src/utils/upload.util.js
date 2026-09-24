const multer = require("multer");
const fs = require("fs");
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
// QUARANTINE (S-17)
// ==========================================
//
// multer used to write each upload straight into its destination folder (for
// attachments `uploads/attachments`, inside the public `/uploads` static
// mount) and the magic-byte check and the virus scan ran on the file AFTER it
// was already world-readable there. Every upload now lands in the quarantine
// directory and is moved to its folder only once it has passed: the
// magic-byte check here, and, for a route that holds it (`holdInQuarantine`),
// the virus scan in its service, which then calls promoteFromQuarantine.
//
// The quarantine lives INSIDE the uploads tree, as a dot-directory, on
// purpose: `/app/uploads` is its own bind mount in compose, so a directory
// beside it would be on another filesystem and the promoting `rename` would
// fail with EXDEV (and the image does not make `/app` itself writable). The
// static mount never serves it: UPLOADS_STATIC_OPTIONS sets
// `dotfiles: "ignore"`, which answers 404 for any path with a dot segment.
// tests/utils/upload.quarantine.s17.test.js asserts that against the same
// options object index.js mounts.

/** The quarantine directory's name, relative to the uploads root. */
const QUARANTINE_DIRNAME = ".quarantine";

/** Absolute path of the quarantine directory, or of a file in it. */
const quarantinePath = (...parts) =>
  storagePath("uploads", QUARANTINE_DIRNAME, ...parts);

/**
 * The express.static options for the public `/uploads` mount (index.js).
 * `dotfiles: "ignore"` is what keeps the quarantine unreachable. It is the
 * default; it is stated here so nobody changes it without seeing why.
 */
const UPLOADS_STATIC_OPTIONS = Object.freeze({
  dotfiles: "ignore",
  setHeaders: (res) => {
    // Defense-in-depth for user-uploaded content: prevent MIME sniffing and
    // force inline rendering only (never treat an upload as active content).
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", "inline");
  },
});

/** Remove a file, ignoring one that is already gone. */
const discard = (filePath) => fs.promises.unlink(filePath).catch(() => {});

/**
 * Move a quarantined upload into its destination folder, and point the multer
 * file object at its new home.
 *
 * @param {{path: string, filename: string, destination?: string}} file - a multer file
 * @param {string} folder - destination, relative to the storage root
 * @returns {Promise<string>} the new absolute path
 * @throws {AppError} 500 when the file is not in quarantine: only a
 *   quarantined file may be promoted, so nothing un-vetted is moved
 */
const promoteFromQuarantine = async (file, folder) => {
  const qRoot = path.resolve(quarantinePath());
  const from = path.resolve(file.path);
  if (path.dirname(from) !== qRoot) {
    throw new AppError(500, "Refusing to promote a file that is not in quarantine");
  }
  const destination = storagePath(folder);
  const to = path.join(destination, path.basename(from));
  await fs.promises.mkdir(destination, { recursive: true });
  await fs.promises.rename(from, to);
  file.path = to;
  file.destination = destination;
  return to;
};

// ==========================================
// STORAGE CONFIGURATION
// ==========================================

const storage = multer.diskStorage({
  // S-17: always the quarantine, whatever the route's folder.
  destination: (req, file, cb) => {
    const fullPath = quarantinePath();
    fs.promises
      .mkdir(fullPath, { recursive: true })
      .then(() => cb(null, fullPath), cb);
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
    holdInQuarantine = false,
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
            // S-17: a rejected upload leaves nothing behind.
            await discard(req.file.path);
            return next(
              new AppError(400, "File content does not match declared type"),
            );
          }

          // Update the file mimetype to verified type
          req.file.mimetype = verifiedMime;
        } catch (validationErr) {
          // Clean up the uploaded file
          await discard(req.file.path);
          return next(validationErr);
        }
      }

      // S-17: out of quarantine only now, unless the route's service still
      // has to scan it, in which case the service promotes it.
      if (req.file && !holdInQuarantine) {
        try {
          await promoteFromQuarantine(req.file, folder);
        } catch (promoteErr) {
          await discard(req.file.path);
          return next(promoteErr);
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

      const files = req.files || [];
      const discardAll = () => Promise.all(files.map((f) => discard(f.path)));

      // Validate magic bytes for each uploaded file
      if (validateMagicBytes && files.length > 0) {
        try {
          for (const file of files) {
            const verifiedMime = await validateFileMagicBytes(
              file.path,
              file.mimetype,
            );
            if (!verifiedMime) {
              // S-17: this used to keep the file with a null mimetype.
              throw new AppError(400, "File content does not match declared type");
            }
            file.mimetype = verifiedMime;
          }
        } catch (validationErr) {
          // Clean up all uploaded files on validation failure
          await discardAll();
          return next(validationErr);
        }
      }

      // S-17: out of quarantine only after every file has passed.
      try {
        for (const file of files) {
          await promoteFromQuarantine(file, folder);
        }
      } catch (promoteErr) {
        await discardAll();
        return next(promoteErr);
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

exports.QUARANTINE_DIRNAME = QUARANTINE_DIRNAME;
exports.quarantinePath = quarantinePath;
exports.promoteFromQuarantine = promoteFromQuarantine;
exports.UPLOADS_STATIC_OPTIONS = UPLOADS_STATIC_OPTIONS;
