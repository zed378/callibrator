// src/services/virusScan.service.ts
//
// P9-18 (ADR-087, Stage C): converted from virusScan.service.js with no
// behaviour change. `export =` keeps the object `require()` returned (one key,
// `scanFile`). The logger is captured at load; clamAv.service is still required
// lazily, only when the provider is "clamav". The environment is read through
// src/config/env (P9-06), at call time.
//
// Pluggable virus-scan hook for uploaded files, called by attachment.service
// before a file is persisted. The default provider ("none") is a no-op that
// treats every file as clean, so the pipeline works out of the box in dev.
//
// Set VIRUS_SCAN_PROVIDER=clamav to enforce scanning via clamAv.service (clamd
// over a socket or HTTP). On a scanner error the default is FAIL-CLOSED (reject
// the upload); opt into fail-open with VIRUS_SCAN_FAIL_OPEN=true for
// environments where availability trumps scanning.

import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import { env, envOr } from "../config/env";
import type ClamAvService from "./clamAv.service";

const logger = loadedLogger;

/** A scan's verdict for the upload path. */
interface VirusScanResult {
  clean: boolean;
  provider: string;
  reason?: string;
}

const failOpen = (): boolean => env("VIRUS_SCAN_FAIL_OPEN") === "true";

/** The message of a caught error, read as the `.js` read `err.message`. */
const messageOf = (err: unknown): string => (err as Error).message;

/**
 * Scan a file on disk.
 * @param absPath - Absolute path to the file.
 */
const scanFile = async (absPath: string): Promise<VirusScanResult> => {
  const provider = envOr("VIRUS_SCAN_PROVIDER", "none");

  if (provider === "none") {
    return { clean: true, provider };
  }

  if (provider === "clamav") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: loaded only when the clamav provider is chosen
    const clamav = require("./clamAv.service") as typeof ClamAvService;
    try {
      const result = await clamav.scanFile(absPath);
      // S-04: VIRUS_SCAN_PROVIDER=clamav is a request to scan. With
      // CLAMAV_ENABLED unset (the Helm chart sets the provider and nothing
      // else) clamAv.service skips — which used to be reported clean, so the
      // manifests promised a fail-closed scanner while nothing was scanned.
      // A skipped scan is a scanner that is not there: it takes the same
      // fail-closed / fail-open path as an unreachable one.
      if (result.code === "SKIPPED") {
        throw new Error(
          "VIRUS_SCAN_PROVIDER=clamav but CLAMAV_ENABLED is not \"true\" — nothing would be scanned",
        );
      }
      if (!result.isClean) {
        return { clean: false, provider, reason: result.result || "infected" };
      }
      return { clean: true, provider, reason: result.code };
    } catch (err) {
      // clamAv.service throws when the scanner is unavailable (and its own
      // CLAMAV_DISABLE_ON_ERROR is not set). Fail CLOSED unless explicitly told
      // to fail open.
      logger.error("ClamAV scan failed", {
        error: messageOf(err),
        absPath,
        failOpen: failOpen(),
      });
      if (failOpen()) {
        return { clean: true, provider, reason: `scan-error-allowed: ${messageOf(err)}` };
      }
      return { clean: false, provider, reason: `scan-error: ${messageOf(err)}` };
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

export = { scanFile };
