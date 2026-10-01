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
 *
 * P9-18 (ADR-087, Stage C): converted from clamAv.service.js with no behaviour
 * change. `export =` keeps the object `require()` returned, with the same keys
 * in the same order (`scanCache` is still added last, and only when NODE_ENV
 * is "test" at load); `scanFiles` calls `scanFile` through that object, as
 * `exports.scanFile` did, so a spy still intercepts it. `net`, `fs` and
 * `crypto` are the module objects; the logger, `AppError` and
 * `withCircuitBreaker` are captured once at load; `axios` is still required
 * lazily inside the HTTP scan. The configuration is still read at LOAD,
 * through src/config/env (P9-06).
 */

import net from "net";
import fs from "fs";
import crypto from "crypto";
import type AxiosModule from "axios";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { withCircuitBreaker as loadedWithCircuitBreaker } from "../utils/circuitBreaker.util";
import { env } from "../config/env";

const logger = loadedLogger;
const AppError = LoadedAppError;
const withCircuitBreaker = loadedWithCircuitBreaker;

/** A scan's outcome. */
interface ScanResult {
  isClean: boolean;
  code: string;
  result: string;
  signature?: string;
}

/** A clamd reply that is not a verdict. */
type NoVerdictError = Error & { code?: string; reply?: string };

/** The message of a caught error, read as the `.js` read `err.message`. */
const messageOf = (err: unknown): string => (err as Error).message;

// ==========================================
// CONFIGURATION
// ==========================================

/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: an empty variable means "unset"; parseInt applies ToString, so an unset variable parses "undefined" (NaN) */
const CLAMAV_ENABLED = env("CLAMAV_ENABLED") === "true";
const CLAMAV_HOST = env("CLAMAV_HOST") || "127.0.0.1";
const CLAMAV_PORT = parseInt(String(env("CLAMAV_PORT"))) || 3310;
const CLAMAV_TIMEOUT = parseInt(String(env("CLAMAV_TIMEOUT"))) || 10000; // 10 seconds
const CLAMAV_SOCKET_PATH = env("CLAMAV_SOCKET_PATH") || null; // Unix socket path
const CLAMAV_HTTP_MODE = env("CLAMAV_HTTP_MODE") === "true";
const CLAMAV_HTTP_URL = env("CLAMAV_HTTP_URL") || null;
const CLAMAV_HTTP_KEY = env("CLAMAV_HTTP_KEY") || null;
const CLAMAV_DISABLE_ON_ERROR = env("CLAMAV_DISABLE_ON_ERROR") === "true";
/* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

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
  declare _cache: Map<string, { isClean: boolean; expiresAt: number }>;
  declare _maxSize: number;
  declare _ttl: number;

  constructor(maxSize = 10000, ttlMs = 24 * 60 * 60 * 1000) {
    this._cache = new Map();
    this._maxSize = maxSize;
    this._ttl = ttlMs;
  }

  get(hash: string): boolean | null {
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

  set(hash: string, isClean: boolean): void {
    if (this._cache.size >= this._maxSize) {
      // Evict oldest entry
      const oldestKey = this._cache.keys().next().value;
      // As built: with a max size of 0 the cache is empty and `delete(undefined)` is a no-op.
      this._cache.delete(oldestKey as string);
    }

    this._cache.set(hash, {
      isClean,
      expiresAt: Date.now() + this._ttl,
    });
  }

  size(): number {
    return this._cache.size;
  }

  clear(): void {
    this._cache.clear();
  }
}

const scanCache = new ScanCache();

/**
 * SHA-256 of a file's content, hex: the scan cache key (S-17).
 * @param filePath - the file
 */
const hashFile = (filePath: string): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (d) => {
      hash.update(d);
    });
    stream.on("end", () => {
      resolve(hash.digest("hex"));
    });
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
 * @param chunk - the bytes
 */
function frameChunk(chunk: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(chunk.length, 0);
  return Buffer.concat([header, chunk]);
}

/** Strip a reply's NUL / CR / LF terminators and surrounding blanks. */
const cleanReply = (reply: unknown): string =>
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: String() of whatever arrived
  String(reply ?? "")
    .replace(/[\0\r\n]+$/g, "")
    .trim();

/**
 * Parse a clamd scan reply. Only two shapes are verdicts; everything else
 * (`UNKNOWN COMMAND`, `... ERROR`, an empty or truncated reply) throws.
 *
 * @param reply - the raw reply (NUL / newline terminators allowed)
 * @throws {Error} with `code: "CLAMAV_NO_VERDICT"` for a reply that is not a verdict
 */
function parseClamdReply(reply: unknown): ScanResult {
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
      signature: found[1] as string,
    };
  }
  const err: NoVerdictError = new Error(
    `ClamAV returned no verdict: ${text ? JSON.stringify(text.slice(0, 200)) : "an empty reply"}`,
  );
  err.code = "CLAMAV_NO_VERDICT";
  err.reply = text;
  throw err;
}

/**
 * Write to a socket, respecting back-pressure.
 * @param socket - the clamd connection
 * @param buf - the bytes
 */
function writeAsync(socket: net.Socket, buf: Buffer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
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
 * @param writeBody - writes the command and its body
 * @param label - the command, for error messages
 * @returns the reply text
 * @throws {Error} a connection error, or a timeout after CLAMAV_TIMEOUT ms
 */
function clamdExchange(writeBody: (socket: net.Socket) => Promise<void>, label: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = new net.Socket();
    const chunks: Buffer[] = [];
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const finish = (err: Error | null, value?: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      // As built: clearTimeout(null) is a no-op; the typings do not list null.
      clearTimeout(timer as NodeJS.Timeout);
      socket.destroy();
      if (err) {
        reject(err);
      } else {
        resolve(value as string);
      }
    };

    const replyText = (): string => Buffer.concat(chunks).toString("latin1");

    timer = setTimeout(
      () => {
        finish(new Error(`ClamAV ${label} timed out after ${String(CLAMAV_TIMEOUT)}ms`));
      },
      CLAMAV_TIMEOUT,
    );

    socket.on("data", (data: Buffer) => {
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
    socket.on("close", () => {
      finish(null, replyText());
    });
    socket.on("error", (err) => {
      finish(err);
    });

    const onConnect = (): void => {
      writeBody(socket).catch((err: unknown) => {
        finish(err as Error);
      });
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
 * @param filePath - the file
 * @throws {Error} on a connection failure, a timeout, or a reply that is not a verdict
 */
async function scanViaSocket(filePath: string): Promise<ScanResult> {
  const reply = await clamdExchange(async (socket) => {
    await writeAsync(socket, INSTREAM_COMMAND);
    const stream = fs.createReadStream(filePath, {
      highWaterMark: INSTREAM_CHUNK_SIZE,
    });
    try {
      for await (const chunk of stream) {
        await writeAsync(socket, frameChunk(chunk as Buffer));
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
 * @returns true only for a PONG
 * @throws {Error} a connection error or a timeout
 */
async function ping(): Promise<boolean> {
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
async function scanViaHttp(filePath: string): Promise<ScanResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: loaded on the first HTTP-mode scan only
  const axios = require("axios") as typeof AxiosModule;

  const fileBuffer = fs.readFileSync(filePath);
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
  };

  if (CLAMAV_HTTP_KEY) {
    headers["X-HTTP-Key"] = CLAMAV_HTTP_KEY;
  }

  let response;
  try {
    // scanViaHttp runs only when CLAMAV_HTTP_URL is set (scanFile checks it).
    response = await axios.post<string>(CLAMAV_HTTP_URL as string, fileBuffer, {
      headers,
      timeout: CLAMAV_TIMEOUT,
      responseType: "text",
    });
  } catch (err) {
    const httpError = err as { response?: { status: number } };
    if (httpError.response) {
      throw new AppError(500, `ClamAV HTTP error: ${String(httpError.response.status)}`);
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
 * @param filePath - Path to the file to scan
 * @param useCache - Whether to use the content-hash verdict cache
 * @returns `code` is OK, FOUND, CACHE, SKIPPED (CLAMAV_ENABLED is not "true")
 *   or ALLOWED (a scan error let through by CLAMAV_DISABLE_ON_ERROR)
 * @throws {AppError} 500 when the scan fails (connection, timeout, a reply
 *   that is not a verdict) and CLAMAV_DISABLE_ON_ERROR is not set
 */
const scanFile = async (filePath: string | null | undefined, useCache = true): Promise<ScanResult> => {
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

    let result: ScanResult;

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
          error: messageOf(err),
          filePath,
        },
      );
      return {
        isClean: true,
        result: `Allowed (scan error: ${messageOf(err)})`,
        code: "ALLOWED",
      };
    }

    logger.error("ClamAV scan error", { error: messageOf(err), filePath });
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
 * @param files - Array of file objects
 */
const scanFiles = async (
  files: readonly { path: string; mimetype?: string }[],
): Promise<{ path: string; isClean: boolean; result: string }[]> => {
  const results: { path: string; isClean: boolean; result: string }[] = [];

  for (const file of files) {
    try {
      const scanResult = await service.scanFile(file.path);
      results.push({
        path: file.path,
        isClean: scanResult.isClean,
        result: scanResult.result,
      });
    } catch (err) {
      results.push({
        path: file.path,
        isClean: false,
        result: `Scan error: ${messageOf(err)}`,
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
const clearCache = (): void => {
  scanCache.clear();
  logger.info("ClamAV scan cache cleared");
};

/**
 * Get cache stats
 */
const getCacheStats = (): { size: number; maxSize: number; ttl: number } => {
  return {
    size: scanCache.size(),
    maxSize: scanCache._maxSize,
    ttl: scanCache._ttl,
  };
};

/**
 * Check if ClamAV is configured and available
 */
const isConfigured = (): boolean | number => {
  return (
    // A-32: CLAMAV_PORT is `parseInt(env) || 3310`, always truthy, so a
    // trailing `|| CLAMAV_SOCKET_PATH` was never evaluated and has been removed:
    // "configured" means enabled plus a reachable transport, and there always is one.
    CLAMAV_ENABLED &&
    (CLAMAV_HTTP_MODE || CLAMAV_PORT)
  );
};

/**
 * Get service status
 */
const getStatus = (): { enabled: boolean; mode: string; host: string | null; cacheSize: number } => {
  return {
    enabled: CLAMAV_ENABLED,
    mode: CLAMAV_HTTP_MODE ? "http" : "socket",
    host: CLAMAV_HTTP_MODE ? CLAMAV_HTTP_URL : `${CLAMAV_HOST}:${String(CLAMAV_PORT)}`,
    cacheSize: scanCache.size(),
  };
};

const service: {
  scanFile: typeof scanFile;
  scanFiles: typeof scanFiles;
  clearCache: typeof clearCache;
  getCacheStats: typeof getCacheStats;
  isConfigured: typeof isConfigured;
  getStatus: typeof getStatus;
  ping: typeof ping;
  parseClamdReply: typeof parseClamdReply;
  frameChunk: typeof frameChunk;
  hashFile: typeof hashFile;
  writeAsync: typeof writeAsync;
  INSTREAM_CHUNK_SIZE: number;
  scanCache?: ScanCache;
} = {
  scanFile,
  scanFiles,
  clearCache,
  getCacheStats,
  isConfigured,
  getStatus,
  ping,
  parseClamdReply,
  frameChunk,
  hashFile,
  writeAsync,
  INSTREAM_CHUNK_SIZE,
};

if (env("NODE_ENV") === "test") {
  service.scanCache = scanCache;
}

export = service;
