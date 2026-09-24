/**
 * ClamAV Virus Scanning Service
 *
 * Scans uploaded files using ClamAV antivirus engine.
 * Supports both socket mode (clamd over TCP or a Unix socket) and HTTP mode
 * (a ClamAV HTTP front end).
 *
 * Usage:
 *   const { scanFile } = require('./services/clamAv.service');
 *   const { isClean } = await scanFile(filePath);
 *
 * S-04: a reply that is not a verdict is an ERROR, never clean. Only
 * `stream: OK` is clean and only `stream: <signature> FOUND` is infected.
 */

const net = require("net");
const fs = require("fs");
const crypto = require("crypto");
const { logger } = require("../middlewares/activityLog.middleware");
const { AppError } = require("../utils/appError.util");
const { withCircuitBreaker } = require("../utils/circuitBreaker.util");

// ==========================================
// CONFIGURATION
// ==========================================

const CLAMAV_ENABLED = process.env.CLAMAV_ENABLED === "true";
const CLAMAV_HOST = process.env.CLAMAV_HOST || "127.0.0.1";
const CLAMAV_PORT = parseInt(process.env.CLAMAV_PORT) || 3310;
const CLAMAV_TIMEOUT = parseInt(process.env.CLAMAV_TIMEOUT) || 10000; // 10 seconds
const CLAMAV_SOCKET_PATH = process.env.CLAMAV_SOCKET_PATH || null; // Unix socket path
const CLAMAV_HTTP_MODE = process.env.CLAMAV_HTTP_MODE === "true";
const CLAMAV_HTTP_URL = process.env.CLAMAV_HTTP_URL || null;
const CLAMAV_HTTP_KEY = process.env.CLAMAV_HTTP_KEY || null;
const CLAMAV_DISABLE_ON_ERROR = process.env.CLAMAV_DISABLE_ON_ERROR === "true";

// ==========================================
// CLAMAV RESPONSE CODES
// ==========================================

const CLAMAV_CODES = {
  OK: "OK",
  FOUND: "FOUND",
  ERROR: "ERROR",
  EMPTY: "EMPTY",
  SCANERR: "SCANERR",
};

// ==========================================
// SCAN VERDICT CACHE (S-17: keyed by content hash)
// ==========================================
//
// Keyed by the SHA-256 of the file's CONTENT. It used to be keyed by
// `${size}:${mtimeMs}` under a heading calling it a hash, so two files of the
// same length written in the same millisecond shared a verdict (S-17). Only a
// definitive verdict (clean or FOUND) is cached, never an error.

class ScanCache {
  constructor(maxSize = 10000, ttlMs = 24 * 60 * 60 * 1000) {
    this._cache = new Map();
    this._maxSize = maxSize;
    this._ttl = ttlMs;
  }

  get(hash) {
    const entry = this._cache.get(hash);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this._cache.delete(hash);
      return null;
    }

    return entry.isClean;
  }

  set(hash, isClean) {
    if (this._cache.size >= this._maxSize) {
      // Evict oldest entry
      const oldestKey = this._cache.keys().next().value;
      this._cache.delete(oldestKey);
    }

    this._cache.set(hash, {
      isClean,
      expiresAt: Date.now() + this._ttl,
    });
  }

  size() {
    return this._cache.size;
  }

  clear() {
    this._cache.clear();
  }
}

const scanCache = new ScanCache();

/**
 * SHA-256 of a file's content, hex: the scan cache key (S-17).
 * @param {string} filePath
 * @returns {Promise<string>}
 */
const hashFile = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (d) => hash.update(d));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });

// ==========================================
// CLAMD PROTOCOL (S-04)
// ==========================================
//
// clamd's INSTREAM, per clamd(8):
//
//   zINSTREAM\0                    the command. The `z` prefix means the
//                                  command and the reply are NUL-terminated.
//   <uint32 BE length><bytes> ...  the file in chunks, each prefixed with its
//                                  length as 4 bytes in network byte order
//   \0\0\0\0                       a zero-length chunk ends the stream
//
// and the reply is one of
//
//   stream: OK
//   stream: <signature> FOUND
//   <anything else> ERROR          e.g. "INSTREAM size limit exceeded. ERROR"
//
// The previous implementation sent `STANDBY` (not a clamd command: clamd
// answers `UNKNOWN COMMAND`), then the raw file with no framing, and read any
// reply without the literal `FOUND` as clean. Here anything that is not
// exactly OK or FOUND is an error, and an error is never clean.

/** The largest chunk written per INSTREAM frame (clamd's StreamMaxLength caps the total). */
const INSTREAM_CHUNK_SIZE = 64 * 1024;

/** The command that opens a stream scan: `z` prefix, NUL-terminated. */
const INSTREAM_COMMAND = Buffer.from("zINSTREAM\0", "latin1");

/** The zero-length chunk that ends a stream. */
const INSTREAM_TERMINATOR = Buffer.alloc(4);

/**
 * One INSTREAM frame: a 4-byte big-endian length, then the bytes.
 * @param {Buffer} chunk
 * @returns {Buffer}
 */
function frameChunk(chunk) {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(chunk.length, 0);
  return Buffer.concat([header, chunk]);
}

/** Strip a reply's NUL / CR / LF terminators and surrounding blanks. */
const cleanReply = (reply) =>
  String(reply === null || reply === undefined ? "" : reply)
    .replace(/[\0\r\n]+$/g, "")
    .trim();

/**
 * Parse a clamd scan reply. Only two shapes are verdicts; everything else
 * (`UNKNOWN COMMAND`, `... ERROR`, an empty or truncated reply) throws.
 *
 * @param {string} reply - the raw reply (NUL / newline terminators allowed)
 * @returns {{isClean: boolean, code: string, result: string, signature?: string}}
 * @throws {Error} with `code: "CLAMAV_NO_VERDICT"` for a reply that is not a verdict
 */
function parseClamdReply(reply) {
  const text = cleanReply(reply);
  if (/^(?:stream: )?OK$/.test(text)) {
    return { isClean: true, code: CLAMAV_CODES.OK, result: text };
  }
  const found = /^(?:stream: )?(.+) FOUND$/.exec(text);
  if (found) {
    return {
      isClean: false,
      code: CLAMAV_CODES.FOUND,
      result: text,
      signature: found[1],
    };
  }
  const err = new Error(
    `ClamAV returned no verdict: ${text ? JSON.stringify(text.slice(0, 200)) : "an empty reply"}`,
  );
  err.code = "CLAMAV_NO_VERDICT";
  err.reply = text;
  throw err;
}

/**
 * Write to a socket, respecting back-pressure.
 * @param {import("net").Socket} socket
 * @param {Buffer} buf
 * @returns {Promise<void>}
 */
function writeAsync(socket, buf) {
  return new Promise((resolve, reject) => {
    if (socket.destroyed) {
      reject(new Error("ClamAV connection closed while sending"));
      return;
    }
    if (socket.write(buf)) {
      resolve();
      return;
    }
    const onDrain = () => {
      socket.off("close", onClose);
      resolve();
    };
    const onClose = () => {
      socket.off("drain", onDrain);
      reject(new Error("ClamAV connection closed while sending"));
    };
    socket.once("drain", onDrain);
    socket.once("close", onClose);
  });
}

/**
 * Connect to clamd (TCP, or a Unix socket when CLAMAV_SOCKET_PATH is set), run
 * `writeBody`, and resolve with the reply up to its NUL terminator, or up to
 * the connection's end when clamd closes without one.
 *
 * @param {(socket: import("net").Socket) => Promise<void>} writeBody
 * @param {string} label - the command, for error messages
 * @returns {Promise<string>} the reply text
 * @throws {Error} a connection error, or a timeout after CLAMAV_TIMEOUT ms
 */
function clamdExchange(writeBody, label) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const chunks = [];
    let settled = false;
    let timer = null;

    const finish = (err, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) {
        reject(err);
      } else {
        resolve(value);
      }
    };

    const replyText = () => Buffer.concat(chunks).toString("latin1");

    timer = setTimeout(
      () => finish(new Error(`ClamAV ${label} timed out after ${CLAMAV_TIMEOUT}ms`)),
      CLAMAV_TIMEOUT,
    );

    socket.on("data", (data) => {
      chunks.push(data);
      const text = replyText();
      const nul = text.indexOf("\0");
      if (nul !== -1) {
        finish(null, text.slice(0, nul));
      }
    });
    // A `z` command's reply ends in NUL, which settles the exchange above
    // before clamd closes — so a write that fails after clamd has answered
    // (it stops reading once it has decided, e.g. "INSTREAM size limit
    // exceeded") is a no-op here: `finish` runs once. A close with no
    // NUL-terminated reply resolves whatever arrived, possibly "", and
    // parseClamdReply refuses anything that is not a verdict.
    socket.on("close", () => finish(null, replyText()));
    socket.on("error", (err) => finish(err));

    const onConnect = () => {
      writeBody(socket).catch((err) => finish(err));
    };
    if (CLAMAV_SOCKET_PATH) {
      socket.connect(CLAMAV_SOCKET_PATH, onConnect);
    } else {
      socket.connect(CLAMAV_PORT, CLAMAV_HOST, onConnect);
    }
  });
}

/**
 * Scan a file via clamd's INSTREAM command.
 * @param {string} filePath
 * @returns {Promise<{isClean: boolean, code: string, result: string, signature?: string}>}
 * @throws {Error} on a connection failure, a timeout, or a reply that is not a verdict
 */
async function scanViaSocket(filePath) {
  const reply = await clamdExchange(async (socket) => {
    await writeAsync(socket, INSTREAM_COMMAND);
    const stream = fs.createReadStream(filePath, {
      highWaterMark: INSTREAM_CHUNK_SIZE,
    });
    try {
      for await (const chunk of stream) {
        await writeAsync(socket, frameChunk(chunk));
      }
    } finally {
      stream.destroy();
    }
    await writeAsync(socket, INSTREAM_TERMINATOR);
  }, "INSTREAM");
  return parseClamdReply(reply);
}

/**
 * clamd's readiness probe: `zPING\0`, answered by `PONG`.
 * @returns {Promise<boolean>} true only for a PONG
 * @throws {Error} a connection error or a timeout
 */
async function ping() {
  const reply = await clamdExchange(
    (socket) => writeAsync(socket, Buffer.from("zPING\0", "latin1")),
    "PING",
  );
  return cleanReply(reply) === "PONG";
}

// ==========================================
// HTTP MODE SCAN
// ==========================================

/**
 * Scan a file via a ClamAV HTTP interface. The body is parsed exactly like a
 * clamd reply (S-04): a body that is neither OK nor FOUND is an error.
 */
async function scanViaHttp(filePath) {
  const axios = require("axios");

  const fileBuffer = fs.readFileSync(filePath);
  const headers = {
    "Content-Type": "application/octet-stream",
  };

  if (CLAMAV_HTTP_KEY) {
    headers["X-HTTP-Key"] = CLAMAV_HTTP_KEY;
  }

  let response;
  try {
    response = await axios.post(CLAMAV_HTTP_URL, fileBuffer, {
      headers,
      timeout: CLAMAV_TIMEOUT,
      responseType: "text",
    });
  } catch (err) {
    if (err.response) {
      throw new AppError(500, `ClamAV HTTP error: ${err.response.status}`);
    }
    throw new AppError(500, "ClamAV HTTP scan failed");
  }

  return parseClamdReply(response.data);
}

// ==========================================
// MAIN SCAN FUNCTION
// ==========================================

/**
 * Scan a file for viruses using ClamAV.
 *
 * @param {string} filePath - Path to the file to scan
 * @param {boolean} useCache - Whether to use the content-hash verdict cache
 * @returns {Promise<{isClean: boolean, result: string, code: string}>}
 *   `code` is OK, FOUND, CACHE, SKIPPED (CLAMAV_ENABLED is not "true") or
 *   ALLOWED (a scan error let through by CLAMAV_DISABLE_ON_ERROR)
 * @throws {AppError} 500 when the scan fails (connection, timeout, a reply
 *   that is not a verdict) and CLAMAV_DISABLE_ON_ERROR is not set
 */
exports.scanFile = async (filePath, useCache = true) => {
  if (!CLAMAV_ENABLED) {
    logger.debug("ClamAV scanning disabled, skipping");
    return { isClean: true, result: "Skipped (disabled)", code: "SKIPPED" };
  }

  if (!filePath) {
    throw new AppError(400, "File path is required for scanning");
  }

  try {
    const contentHash = useCache ? await hashFile(filePath) : null;
    if (contentHash) {
      const cached = scanCache.get(contentHash);
      if (cached !== null) {
        logger.debug("ClamAV cache hit", { filePath, isClean: cached });
        return { isClean: cached, result: "Cache hit", code: "CACHE" };
      }
    }

    let result;

    if (CLAMAV_HTTP_MODE && CLAMAV_HTTP_URL) {
      result = await scanViaHttp(filePath);
    } else {
      result = await withCircuitBreaker("storage", () =>
        scanViaSocket(filePath),
      );
    }

    // Only a verdict reaches here; an error has thrown above.
    if (contentHash) {
      scanCache.set(contentHash, result.isClean);
    }

    if (!result.isClean) {
      logger.warn("Virus detected in uploaded file", {
        filePath,
        result: result.result,
      });
    }

    return result;
  } catch (err) {
    if (CLAMAV_DISABLE_ON_ERROR) {
      logger.warn(
        "ClamAV scan failed, allowing file (CLAMAV_DISABLE_ON_ERROR=true)",
        {
          error: err.message,
          filePath,
        },
      );
      return {
        isClean: true,
        result: `Allowed (scan error: ${err.message})`,
        code: "ALLOWED",
      };
    }

    logger.error("ClamAV scan error", { error: err.message, filePath });
    const unavailable = new AppError(
      500,
      "File scan service unavailable. Please try again later.",
    );
    unavailable.cause = err;
    throw unavailable;
  }
};

/**
 * Scan multiple files
 * @param {Array<{path: string, mimetype: string}>} files - Array of file objects
 * @returns {Promise<Array<{path: string, isClean: boolean, result: string}>>}
 */
exports.scanFiles = async (files) => {
  const results = [];

  for (const file of files) {
    try {
      const scanResult = await exports.scanFile(file.path);
      results.push({
        path: file.path,
        isClean: scanResult.isClean,
        result: scanResult.result,
      });
    } catch (err) {
      results.push({
        path: file.path,
        isClean: false,
        result: `Scan error: ${err.message}`,
      });
    }
  }

  return results;
};

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Clear the scan cache
 */
exports.clearCache = () => {
  scanCache.clear();
  logger.info("ClamAV scan cache cleared");
};

/**
 * Get cache stats
 */
exports.getCacheStats = () => {
  return {
    size: scanCache.size(),
    maxSize: scanCache._maxSize,
    ttl: scanCache._ttl,
  };
};

/**
 * Check if ClamAV is configured and available
 */
exports.isConfigured = () => {
  return (
    // CLAMAV_SOCKET_PATH is never evaluated: CLAMAV_PORT is
    // `parseInt(env) || 3310`, so it is always truthy and short-circuits first.
    CLAMAV_ENABLED &&
    (CLAMAV_HTTP_MODE || CLAMAV_PORT || /* istanbul ignore next */ CLAMAV_SOCKET_PATH)
  );
};

/**
 * Get service status
 */
exports.getStatus = () => {
  return {
    enabled: CLAMAV_ENABLED,
    mode: CLAMAV_HTTP_MODE ? "http" : "socket",
    host: CLAMAV_HTTP_MODE ? CLAMAV_HTTP_URL : `${CLAMAV_HOST}:${CLAMAV_PORT}`,
    cacheSize: scanCache.size(),
  };
};

exports.ping = ping;
exports.parseClamdReply = parseClamdReply;
exports.frameChunk = frameChunk;
exports.hashFile = hashFile;
exports.writeAsync = writeAsync;
exports.INSTREAM_CHUNK_SIZE = INSTREAM_CHUNK_SIZE;

if (process.env.NODE_ENV === "test") {
  exports.scanCache = scanCache;
}
