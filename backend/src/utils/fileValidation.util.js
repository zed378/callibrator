const fs = require("fs");
const path = require("path");
const { AppError } = require("./appError.util");

// ==========================================
// MAGIC BYTE SIGNATURES
// ==========================================

// Map of MIME types to their magic byte signatures
const MAGIC_BYTES = {
  "image/jpeg": {
    signatures: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
    extensions: [".jpg", ".jpeg"],
  },
  "image/png": {
    signatures: [
      { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    ],
    extensions: [".png"],
  },
  "image/gif": {
    signatures: [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }],
    extensions: [".gif"],
  },
  "image/webp": {
    signatures: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF
    ],
    // Need to check offset 8 for WEBP
    customCheck: (buffer) => {
      if (buffer.length < 12) return false;
      const riff = buffer.slice(0, 4).toString();
      const webp = buffer.slice(8, 12).toString();
      return riff === "RIFF" && webp === "WEBP";
    },
    extensions: [".webp"],
  },
  "application/pdf": {
    signatures: [
      { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
    ],
    extensions: [".pdf"],
  },
  "application/zip": {
    signatures: [{ offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }],
    extensions: [".zip"],
  },
  "application/octet-stream": {
    // Binary file, no specific signature
    signatures: [],
    extensions: [".bin"],
  },
};

// Dangerous file types that should always be blocked
const DANGEROUS_EXTENSIONS = [
  ".php",
  ".php3",
  ".php4",
  ".php5",
  ".phtml",
  ".asp",
  ".aspx",
  ".ascx",
  ".ashx",
  ".asmx",
  ".jsp",
  ".jspa",
  ".cgi",
  ".fcgi",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bat",
  ".cmd",
  ".com",
  ".sh",
  ".bash",
  ".zsh",
  ".csh",
  ".ps1",
  ".psm1",
  ".psd1",
  ".pl",
  ".pm",
  ".py",
  ".rb",
  ".php",
  ".svg",
  ".svgz", // SVG can contain executable JavaScript
  ".html",
  ".htm",
  ".xhtml",
  ".shtml",
  ".js",
  ".mjs",
  ".wasm",
  ".hta",
  ".css",
  ".etl",
  ".scr",
  ".msi",
  ".inf",
  ".reg",
  ".docm",
  ".xlsm",
  ".pptm",
  ".dotm",
  ".xlam",
];

const DANGEROUS_MIMES = [
  "application/x-php",
  "application/x-perl",
  "application/x-python",
  "application/x-ruby",
  "application/x-msdownload",
  "application/x-executable",
  "application/x-shellscript",
  "application/x-dosexec",
];

// ==========================================
// MAGIC BYTE VALIDATION
// ==========================================

/**
 * Validate file content by checking magic bytes against declared MIME type
 * @param {string} filePath - Path to the file to validate
 * @param {string} declaredMime - The MIME type declared by the client or server
 * @returns {Promise<string>} The verified MIME type, or null if invalid
 * @throws {AppError} If the file content doesn't match the declared type
 */
exports.validateFileMagicBytes = async (filePath, declaredMime) => {
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size === 0) {
      throw new AppError(400, "Uploaded file is empty");
    }

    // Read the first 16 bytes for magic byte inspection
    const fd = await fs.promises.open(filePath, "r");
    const buffer = Buffer.alloc(Math.min(16, stat.size));
    const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
    await fd.close();

    if (bytesRead === 0) {
      throw new AppError(400, "Unable to read uploaded file");
    }

    // Check against known signatures
    for (const [mime, config] of Object.entries(MAGIC_BYTES)) {
      if (config.customCheck) {
        if (config.customCheck(buffer)) {
          // MIME matches content - allow if declared matches
          if (
            declaredMime === mime ||
            declaredMime === "application/octet-stream"
          ) {
            return mime;
          }
        }
      } else {
        for (const sig of config.signatures) {
          if (buffer.length >= sig.offset + sig.bytes.length) {
            const match = sig.bytes.every(
              (byte, i) => buffer[sig.offset + i] === byte,
            );
            if (match) {
              if (
                declaredMime === mime ||
                declaredMime === "application/octet-stream"
              ) {
                return mime;
              }
            }
          }
        }
      }
    }

    // If declared MIME doesn't match any known signature, check if it's a generic type
    if (
      declaredMime === "application/octet-stream" ||
      declaredMime === "application/x-unknown"
    ) {
      // For generic types, just verify the file is readable
      return "application/octet-stream";
    }

    // If we get here, the declared MIME doesn't match the actual content
    // This could indicate a MIME type confusion attack
    throw new AppError(
      400,
      `File content does not match declared type. Expected: ${declaredMime}`,
    );
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(500, "File validation error");
  }
};

// ==========================================
// EXTENSION VALIDATION
// ==========================================

/**
 * Check if a file extension is dangerous
 * @param {string} ext - File extension (e.g., ".php")
 * @returns {boolean} True if dangerous
 */
exports.isDangerousExtension = (ext) => {
  const lowerExt = ext.toLowerCase();
  return DANGEROUS_EXTENSIONS.includes(lowerExt);
};

/**
 * Check if a MIME type is dangerous
 * @param {string} mime - MIME type
 * @returns {boolean} True if dangerous
 */
exports.isDangerousMime = (mime) => {
  const lowerMime = mime.toLowerCase();
  return DANGEROUS_MIMES.includes(lowerMime);
};

// ==========================================
// SAFE FILE STORAGE
// ==========================================

/**
 * Sanitize filename to prevent path traversal and dangerous extensions
 * @param {string} filename - Original filename
 * @param {string} allowedExtensions - Array of allowed extensions
 * @returns {string} Sanitized filename
 * @throws {AppError} If the filename is dangerous
 */
exports.sanitizeFilename = (filename, allowedExtensions = []) => {
  if (!filename) {
    throw new AppError(400, "Filename is required");
  }

  // Get the extension
  const ext = path.extname(filename).toLowerCase();

  // Check for dangerous extensions
  if (exports.isDangerousExtension(ext)) {
    throw new AppError(400, `File type not allowed: ${ext}`);
  }

  // Check against allowed extensions if specified
  if (allowedExtensions.length > 0 && !allowedExtensions.includes(ext)) {
    throw new AppError(
      400,
      `File type not allowed. Allowed: ${allowedExtensions.join(", ")}`,
    );
  }

  // Prevent path traversal
  const basename = path.basename(filename);
  if (basename !== filename) {
    throw new AppError(400, "Invalid filename: path traversal detected");
  }

  // Remove any null bytes
  const cleanName = basename.replace(/\0/g, "");

  if (cleanName.length === 0) {
    throw new AppError(400, "Invalid filename");
  }

  // Return filename with lowercase extension
  const nameWithoutExt = path.parse(cleanName).name;
  return nameWithoutExt + ext;
};

// ==========================================
// ERROR SANITIZATION
// ==========================================

/**
 * Sanitize error object for production response
 * Strips sensitive information like stack traces
 * @param {Error} err - The error object
 * @param {boolean} isProduction - Whether running in production
 * @returns {Object} Sanitized error object
 */
exports.sanitizeError = (
  err,
  isProduction = process.env.NODE_ENV === "production",
) => {
  const sanitized = {
    success: false,
    status: err.status || err.statusCode || 500,
    message: isProduction
      ? "An unexpected error occurred. Please try again later."
      : err.message || "Internal server error",
  };

  // Include validation errors regardless of environment
  if (err.errors) {
    sanitized.errors = err.errors;
  }

  // Include stack trace only in development
  if (!isProduction && err.stack) {
    sanitized.stack = err.stack;
  }

  // Include error name in development
  if (!isProduction && err.name) {
    sanitized.name = err.name;
  }

  return sanitized;
};

/**
 * Wrap error handler to automatically sanitize errors in production
 * @param {Function} handler - Express error handler middleware
 * @returns {Function} Wrapped error handler
 */
exports.createSanitizedErrorHandler = (handler) => {
  return (err, req, res, next) => {
    // Call the original handler
    handler(err, req, res, next);

    // If the response hasn't been sent yet, sanitize it
    if (!res.headersSent) {
      const isProduction = process.env.NODE_ENV === "production";
      const sanitized = exports.sanitizeError(err, isProduction);

      // Override the JSON response with sanitized version
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        // If this is an error response, use sanitized version
        if (body && typeof body === "object" && body.success === false) {
          body.message = sanitized.message;
          if (!isProduction) {
            delete body.stack;
            delete body.name;
          }
        }
        return originalJson(body);
      };
    }
  };
};

const FILE_SIZES = {
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
};

const ALLOWED_TYPES = {
  IMAGE: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  DOCUMENT: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  CALIBRATION: ["application/json", "text/csv"],
};

const validateFileSize = (file, maxSize = 10 * FILE_SIZES.MB) => {
  if (!file || typeof file.size !== "number") {
    return { valid: false, message: "Invalid file object or missing size" };
  }
  if (file.size > maxSize) {
    return { valid: false, message: `File size exceeds the limit of ${maxSize} bytes` };
  }
  return { valid: true, message: "File size is within limits" };
};

const validateFileType = (file, allowedTypes = []) => {
  if (!file || !file.mimetype) {
    return { valid: false, message: "Invalid file object or missing mimetype" };
  }
  const typesArray = Array.isArray(allowedTypes) ? allowedTypes : [allowedTypes];
  if (typesArray.length > 0 && !typesArray.includes(file.mimetype)) {
    return { valid: false, message: `MIME type ${file.mimetype} is not allowed` };
  }
  return { valid: true, message: "File type is allowed" };
};

const validateUpload = (file, options = {}) => {
  if (!file) {
    return { valid: false, message: "No file provided" };
  }

  // Reject empty originalname
  if (!file.originalname || typeof file.originalname !== "string" || file.originalname.trim() === "") {
    return { valid: false, message: "Original file name is required" };
  }

  const { maxSize, allowedTypes } = options;

  const sizeResult = validateFileSize(file, maxSize);
  if (!sizeResult.valid) {
    return sizeResult;
  }

  const typeResult = validateFileType(file, allowedTypes);
  if (!typeResult.valid) {
    return typeResult;
  }

  return { valid: true, message: "Upload is valid" };
};

exports.FILE_SIZES = FILE_SIZES;
exports.ALLOWED_TYPES = ALLOWED_TYPES;
exports.validateFileSize = validateFileSize;
exports.validateFileType = validateFileType;
exports.validateUpload = validateUpload;
