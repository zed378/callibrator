const fs = require("fs");
const path = require("path");
const { AppError } = require("./appError.util");

// ==========================================
// MAGIC BYTE SIGNATURES
// ==========================================

// D0 CF 11 E0 A1 B1 1A E1 — OLE2 / Compound File Binary header.
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
// PK\3\4 — a ZIP local file header.
const ZIP_LOCAL_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

// How much of the file's head is inspected. Also the window the text check
// scans for NUL bytes.
const HEAD_BYTES = 8 * 1024;

// S-11: OOXML types are ZIP containers. A ZIP signature alone would let any
// archive through under an Office type, so the central directory must list
// `[Content_Types].xml` (every OPC package has it) and at least one part under
// the declared type's own folder.
const OOXML_PART_PREFIX = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "word/",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xl/",
};

// S-11: text has no magic bytes, so it cannot be matched by signature. It is
// accepted as text when its first HEAD_BYTES contain no NUL byte — UTF-8 and
// ASCII text never carry one, while nearly every binary format (images,
// archives, executables, Office files) has one within its first few hundred
// bytes. UTF-16 text does carry NULs and is refused; export as UTF-8.
const TEXT_TYPES = ["text/plain", "text/csv"];

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
  // S-11: legacy Office (.doc, .xls) is an OLE2 Compound File. Both share one
  // signature — telling them apart means walking the CFB directory for a
  // WordDocument or Workbook stream, which this check does not do.
  "application/msword": {
    signatures: [{ offset: 0, bytes: OLE2_SIGNATURE }],
    extensions: [".doc"],
  },
  "application/vnd.ms-excel": {
    signatures: [{ offset: 0, bytes: OLE2_SIGNATURE }],
    extensions: [".xls"],
  },
  "application/zip": {
    signatures: [{ offset: 0, bytes: ZIP_LOCAL_SIGNATURE }],
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

const matchesSignature = (buffer, bytes, offset = 0) =>
  buffer.length >= offset + bytes.length &&
  bytes.every((byte, i) => buffer[offset + i] === byte);

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_EOCD_LENGTH = 22;
const ZIP_CENTRAL_HEADER_LENGTH = 46;

/**
 * The entry names in a ZIP's central directory, read from the file itself (no
 * archive library: only the names are needed, nothing is decompressed).
 * @param {import("fs").promises.FileHandle} fd - open handle on the file
 * @param {number} size - the file's size in bytes
 * @returns {Promise<string[]|null>} the names, or null when the file has no
 *   well-formed single-disk central directory (ZIP64 sentinels fail the bounds
 *   check and are refused)
 */
const readZipEntryNames = async (fd, size) => {
  // The end-of-central-directory record is 22 bytes plus a comment of at most
  // 65535, so it sits somewhere in the last 65557 bytes.
  const tailLength = Math.min(size, ZIP_EOCD_LENGTH + 0xffff);
  const tail = Buffer.alloc(tailLength);
  await fd.read(tail, 0, tailLength, size - tailLength);

  let eocd = -1;
  for (let i = tailLength - ZIP_EOCD_LENGTH; i >= 0; i--) {
    if (tail.readUInt32LE(i) === ZIP_EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    return null;
  }

  const entryCount = tail.readUInt16LE(eocd + 10);
  const directorySize = tail.readUInt32LE(eocd + 12);
  const directoryOffset = tail.readUInt32LE(eocd + 16);
  if (directoryOffset + directorySize > size) {
    return null;
  }

  const directory = Buffer.alloc(directorySize);
  await fd.read(directory, 0, directorySize, directoryOffset);

  const names = [];
  let pos = 0;
  for (let n = 0; n < entryCount; n++) {
    if (
      pos + ZIP_CENTRAL_HEADER_LENGTH > directorySize ||
      directory.readUInt32LE(pos) !== ZIP_CENTRAL_SIGNATURE
    ) {
      return null;
    }
    const nameLength = directory.readUInt16LE(pos + 28);
    const extraLength = directory.readUInt16LE(pos + 30);
    const commentLength = directory.readUInt16LE(pos + 32);
    const nameStart = pos + ZIP_CENTRAL_HEADER_LENGTH;
    names.push(directory.toString("utf8", nameStart, nameStart + nameLength));
    pos = nameStart + nameLength + extraLength + commentLength;
  }
  return names;
};

/**
 * Whether a file is an OOXML package of the declared kind: a ZIP whose central
 * directory lists `[Content_Types].xml` and a part under the kind's folder
 * (`word/` for .docx, `xl/` for .xlsx).
 */
const isOoxmlOfKind = async (fd, size, head, partPrefix) => {
  if (!matchesSignature(head, ZIP_LOCAL_SIGNATURE)) {
    return false;
  }
  const names = await readZipEntryNames(fd, size);
  return (
    names !== null &&
    names.includes("[Content_Types].xml") &&
    names.some((name) => name.startsWith(partPrefix))
  );
};

/**
 * Validate file content by checking magic bytes against declared MIME type.
 *
 * - signature types (images, PDF, OLE2 .doc/.xls, zip): the head must carry
 *   the type's signature;
 * - OOXML (.docx, .xlsx): a ZIP that is an OPC package of that kind (S-11);
 * - text (.txt, .csv): no NUL byte in the first HEAD_BYTES (S-11).
 *
 * @param {string} filePath - Path to the file to validate
 * @param {string} declaredMime - The MIME type declared by the client or server
 * @returns {Promise<string>} The verified MIME type
 * @throws {AppError} 400 naming the declared type if the content doesn't match
 */
exports.validateFileMagicBytes = async (filePath, declaredMime) => {
  let fd;
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size === 0) {
      throw new AppError(400, "Uploaded file is empty");
    }

    fd = await fs.promises.open(filePath, "r");
    const head = Buffer.alloc(Math.min(HEAD_BYTES, stat.size));
    const { bytesRead } = await fd.read(head, 0, head.length, 0);

    if (bytesRead === 0) {
      throw new AppError(400, "Unable to read uploaded file");
    }
    const buffer = head.subarray(0, bytesRead);

    if (TEXT_TYPES.includes(declaredMime)) {
      if (!buffer.includes(0x00)) {
        return declaredMime;
      }
    } else if (Object.hasOwn(OOXML_PART_PREFIX, declaredMime)) {
      if (
        await isOoxmlOfKind(
          fd,
          stat.size,
          buffer,
          OOXML_PART_PREFIX[declaredMime],
        )
      ) {
        return declaredMime;
      }
    } else {
      // Check against known signatures
      for (const [mime, config] of Object.entries(MAGIC_BYTES)) {
        const matchesSig = (sig) =>
          matchesSignature(buffer, sig.bytes, sig.offset);
        const matched = config.customCheck
          ? config.customCheck(buffer)
          : config.signatures.some(matchesSig);
        if (
          matched &&
          (declaredMime === mime || declaredMime === "application/octet-stream")
        ) {
          return mime;
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
    }

    // If we get here, the declared MIME doesn't match the actual content
    // This could indicate a MIME type confusion attack
    throw new AppError(
      400,
      `File content does not match declared type "${declaredMime}"`,
    );
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(500, "File validation error");
  } finally {
    if (fd) {
      await fd.close();
    }
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

/** What a client is told in production when an error's message is not safe to show. */
const GENERIC_ERROR_MESSAGE = "An unexpected error occurred. Please try again later.";
exports.GENERIC_ERROR_MESSAGE = GENERIC_ERROR_MESSAGE;

/**
 * Whether an error's own message may be shown to the client in production
 * (A-132). One rule for every error path: the global errorHandler (through
 * sanitizeError), asyncHandler and asyncHandlerWithMapping.
 *
 * Only a 4xx the code raised on purpose qualifies:
 * - an AppError that is operational (the default), e.g. a 409 state
 *   explanation or a 404;
 * - a plain `{ status, message }` object — the validators' and services'
 *   deliberate throw shape; no library throws a non-Error;
 * - an http-errors error marked `expose` (body-parser's 400 and 413).
 *
 * A 5xx, a non-operational AppError, and an arbitrary Error that merely
 * carries a 4xx status (a library error, a driver error) do not: their message
 * can name tables, hosts or internals.
 *
 * @param {*} err
 * @param {number} status - the status the response is answered with
 * @returns {boolean}
 */
exports.isExposableError = (err, status) => {
  if (!err || typeof err !== "object") {
    return false;
  }
  if (!Number.isInteger(status) || status < 400 || status > 499) {
    return false;
  }
  if (err instanceof AppError) {
    return err.isOperational !== false;
  }
  if (!(err instanceof Error)) {
    return true;
  }
  return err.expose === true;
};

/**
 * The message a client receives for an error: its own outside production, and
 * in production its own only when isExposableError allows it.
 *
 * @param {*} err
 * @param {number} status
 * @param {boolean} isProduction
 * @returns {string}
 */
exports.publicErrorMessage = (err, status, isProduction) => {
  if (isProduction && !exports.isExposableError(err, status)) {
    return GENERIC_ERROR_MESSAGE;
  }
  return (err && err.message) || "Internal server error";
};

/**
 * Sanitize error object for production response
 * Strips sensitive information like stack traces. In production an error's
 * message and field `errors` are kept only for an operational 4xx (A-132,
 * isExposableError); anything else gets GENERIC_ERROR_MESSAGE.
 * @param {Error} err - The error object
 * @param {boolean} isProduction - Whether running in production
 * @returns {Object} Sanitized error object
 */
exports.sanitizeError = (
  err,
  isProduction = process.env.NODE_ENV === "production",
) => {
  const status = err.status || err.statusCode || 500;
  const sanitized = {
    success: false,
    status,
    message: exports.publicErrorMessage(err, status, isProduction),
  };

  // Field-level validation errors, wherever the message itself may be shown.
  // A driver's error list (a Sequelize ValidationErrorItem carries the row
  // instance) is not shown in production.
  if (err.errors && (!isProduction || exports.isExposableError(err, status))) {
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
