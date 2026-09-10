/**
 * ClamAV Virus Scanning Service
 *
 * Scans uploaded files using ClamAV antivirus engine.
 * Supports both socket mode (local ClamAV) and HTTP mode (ClamAV HTTP).
 *
 * Usage:
 *   const { scanFile } = require('./services/clamAv.service');
 *   const isClean = await scanFile(filePath);
 */

const net = require("net");
const fs = require("fs");
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
// FILE HASH CACHE (prevent re-scanning)
// ==========================================

class ScanCache {
  constructor(maxSize = 10000, ttlMs = 24 * 60 * 60 * 1000) {
    this._cache = new Map();
    this._maxSize = maxSize;
    this._ttl = ttlMs;
  }

  get(hash) {
    const entry = this._cache.get(hash);
    if (!entry) return null;

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

// ==========================================
// SOCKET MODE SCAN
// ==========================================

/**
 * Send STANDBY command to ClamAV
 */
async function sendStandby(socket) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("ClamAV STANDBY timeout")),
      5000,
    );

    socket.write("STANDBY\r\n");
    socket.once("data", (data) => {
      clearTimeout(timeout);
      if (data.toString().trim() === "OK") {
        resolve();
      } else {
        reject(new Error("ClamAV STANDBY failed"));
      }
    });
  });
}

/**
 * Scan a file via ClamAV socket
 */
async function scanViaSocket(filePath) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("ClamAV scan timeout"));
    }, CLAMAV_TIMEOUT);

    socket.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    const connectPromise = new Promise((resolve, reject) => {
      if (CLAMAV_SOCKET_PATH) {
        socket.connect(CLAMAV_SOCKET_PATH, () => resolve());
      } else {
        socket.connect(CLAMAV_PORT, CLAMAV_HOST, () => resolve());
      }
    });

    connectPromise
      .then(async () => {
        try {
          // Send STANDBY to ensure server is ready
          await sendStandby(socket);

          // Read file and send to scanner
          const fileBuffer = fs.readFileSync(filePath);
          const fileSize = fileBuffer.length;

          // Send INSTREAM command
          socket.write("INSTREAM\r\n");

          // Send file data
          socket.write(fileBuffer);
          socket.write("\r\n");

          // Read response
          let response = "";
          socket.once("data", (data) => {
            response = data.toString();
            clearTimeout(timeout);
            socket.destroy();

            const statusCode = response.includes(CLAMAV_CODES.FOUND)
              ? CLAMAV_CODES.FOUND
              : CLAMAV_CODES.OK;

            resolve({
              isClean: statusCode === CLAMAV_CODES.OK,
              result: response.trim(),
              code: statusCode,
            });
          });
        } catch (err) {
          clearTimeout(timeout);
          socket.destroy();
          reject(err);
        }
      })
      .catch(reject);
  });
}

// ==========================================
// HTTP MODE SCAN
// ==========================================

/**
 * Scan a file via ClamAV HTTP interface
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

  try {
    const response = await axios.post(CLAMAV_HTTP_URL, fileBuffer, {
      headers,
      timeout: CLAMAV_TIMEOUT,
      responseType: "text",
    });

    const result = response.data.trim();
    const isClean = !result.includes(CLAMAV_CODES.FOUND);

    return {
      isClean,
      result,
      code: isClean ? CLAMAV_CODES.OK : CLAMAV_CODES.FOUND,
    };
  } catch (err) {
    if (err.response) {
      throw new AppError(500, `ClamAV HTTP error: ${err.response.status}`);
    }
    throw new AppError(500, "ClamAV HTTP scan failed");
  }
}

// ==========================================
// MAIN SCAN FUNCTION
// ==========================================

/**
 * Scan a file for viruses using ClamAV
 * @param {string} filePath - Path to the file to scan
 * @param {boolean} useCache - Whether to use hash cache
 * @returns {Promise<{isClean: boolean, result: string, code: string}>}
 * @throws {AppError} If scanning fails and CLAMAV_DISABLE_ON_ERROR is false
 */
exports.scanFile = async (filePath, useCache = true) => {
  if (!CLAMAV_ENABLED) {
    logger.debug("ClamAV scanning disabled, skipping");
    return { isClean: true, result: "Skipped (disabled)", code: "SKIPPED" };
  }

  if (!filePath) {
    throw new AppError(400, "File path is required for scanning");
  }

  // Check cache
  if (useCache) {
    const stat = await fs.promises.stat(filePath);
    const hash = `${stat.size}:${stat.mtimeMs}`;
    const cached = scanCache.get(hash);
    if (cached !== null) {
      logger.debug("ClamAV cache hit", { filePath, isClean: cached });
      return { isClean: cached, result: "Cache hit", code: "CACHE" };
    }
  }

  try {
    let result;

    if (CLAMAV_HTTP_MODE && CLAMAV_HTTP_URL) {
      result = await scanViaHttp(filePath);
    } else {
      result = await withCircuitBreaker("storage", () =>
        scanViaSocket(filePath),
      );
    }

    // Cache result
    if (useCache) {
      const stat = await fs.promises.stat(filePath);
      const hash = `${stat.size}:${stat.mtimeMs}`;
      scanCache.set(hash, result.isClean);
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
    throw new AppError(
      500,
      "File scan service unavailable. Please try again later.",
    );
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

if (process.env.NODE_ENV === "test") {
  exports.scanCache = scanCache;
}
