/**
 * S-33 — sweep abandoned files out of the upload quarantine.
 *
 * Every upload lands in `uploads/.quarantine` and is moved out only once it
 * has passed the magic-byte check and the virus scan (S-17). A process that
 * dies mid-scan — a crash, an OOM kill, a rollout — leaves its file there
 * forever: unscanned, unreachable (the static mount ignores dot-directories),
 * and using disk. Nothing removed them.
 *
 * This removes regular files older than QUARANTINE_MAX_AGE_MINUTES (default
 * 60). A scan takes seconds, so an hour-old quarantined file belongs to no
 * request that is still running. Only the quarantine directory's own entries
 * are considered; a sub-directory or a symbolic link is never followed.
 */
const fs = require("fs");
const path = require("path");
const { quarantinePath } = require("../utils/upload.util");
const { logger } = require("../middlewares/activityLog.middleware");

const DEFAULT_MAX_AGE_MINUTES = 60;

const maxAgeMs = () => {
  const n = Number(process.env.QUARANTINE_MAX_AGE_MINUTES);
  return (Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_AGE_MINUTES) * 60 * 1000;
};

/**
 * @param {object} [opts]
 * @param {Date} [opts.now]
 * @returns {Promise<{scanned: number, removed: number, errors: number}>}
 */
async function sweepQuarantine({ now = new Date() } = {}) {
  const dir = quarantinePath();
  const summary = { scanned: 0, removed: 0, errors: 0 };
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") {
      return summary;
    }
    throw err;
  }

  const cutoff = now.getTime() - maxAgeMs();
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    summary.scanned += 1;
    const file = path.join(dir, entry.name);
    try {
      const stat = await fs.promises.lstat(file);
      if (stat.mtimeMs < cutoff) {
        await fs.promises.unlink(file);
        summary.removed += 1;
      }
    } catch (err) {
      if (err.code !== "ENOENT") {
        summary.errors += 1;
        logger.error(`Quarantine sweep could not remove ${entry.name}: ${err.message}`);
      }
    }
  }
  return summary;
}

module.exports = { sweepQuarantine, DEFAULT_MAX_AGE_MINUTES };
