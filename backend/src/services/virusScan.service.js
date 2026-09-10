// src/services/virusScan.service.js
//
// Pluggable virus-scan hook for uploaded files, called by attachment.service
// before a file is persisted. The default provider ("none") is a no-op that
// treats every file as clean, so the pipeline works out of the box in dev.
//
// Set VIRUS_SCAN_PROVIDER=clamav to enforce scanning via clamAv.service (clamd
// over a socket or HTTP). On a scanner error the default is FAIL-CLOSED (reject
// the upload); opt into fail-open with VIRUS_SCAN_FAIL_OPEN=true for
// environments where availability trumps scanning.

const { logger } = require("../middlewares/activityLog.middleware");

const failOpen = () => process.env.VIRUS_SCAN_FAIL_OPEN === "true";

/**
 * Scan a file on disk.
 * @param {string} absPath - Absolute path to the file.
 * @returns {Promise<{clean: boolean, provider: string, reason?: string}>}
 */
exports.scanFile = async (absPath) => {
  const provider = process.env.VIRUS_SCAN_PROVIDER || "none";

  if (provider === "none") {
    return { clean: true, provider };
  }

  if (provider === "clamav") {
    const clamav = require("./clamAv.service");
    try {
      const result = await clamav.scanFile(absPath);
      if (!result.isClean) {
        return { clean: false, provider, reason: result.result || "infected" };
      }
      return { clean: true, provider, reason: result.code };
    } catch (err) {
      // clamAv.service throws when the scanner is unavailable (and its own
      // CLAMAV_DISABLE_ON_ERROR is not set). Fail CLOSED unless explicitly told
      // to fail open.
      logger.error("ClamAV scan failed", {
        error: err.message,
        absPath,
        failOpen: failOpen(),
      });
      if (failOpen()) {
        return { clean: true, provider, reason: `scan-error-allowed: ${err.message}` };
      }
      return { clean: false, provider, reason: `scan-error: ${err.message}` };
    }
  }

  // Unknown provider: warn and fail CLOSED by default (the old behavior passed
  // the file through unscanned — unsafe). Opt into pass-through with
  // VIRUS_SCAN_FAIL_OPEN=true.
  logger.warn(
    `VIRUS_SCAN_PROVIDER="${provider}" is not implemented`,
    { absPath, failOpen: failOpen() },
  );
  return {
    clean: failOpen(),
    provider,
    reason: "provider-not-implemented",
  };
};
