// P9-18 (ADR-087, Stage C leaves): converted from quarantineSweep.service.js
// with no behaviour change. `fs` and `path` are the module objects themselves
// (default imports of CommonJS modules), so `fs.promises.*` is read at call
// time and the tests' `jest.spyOn(fs.promises, …)` still applies. The three
// destructured dependencies are captured once at load, as the `.js` did. The
// two environment reads go through src/config/env (P9-06), at call time.
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
import fs from "fs";
import path from "path";
import { quarantinePath as loadedQuarantinePath } from "../utils/upload.util";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import {
  runAsSystem as loadedRunAsSystem,
  SYSTEM_TASKS as loadedSystemTasks,
} from "../utils/jobContext.util";
import { env } from "../config/env";

const quarantinePath = loadedQuarantinePath;
const logger = loadedLogger;
const runAsSystem = loadedRunAsSystem;
const SYSTEM_TASKS = loadedSystemTasks;

interface SweepOptions {
  now?: Date;
  limit?: number;
}

interface SweepSummary {
  scanned: number;
  removed: number;
  errors: number;
  truncated: boolean;
}

const DEFAULT_MAX_AGE_MINUTES = 60;
/** Entries one run examines at most (W-17); the rest wait for the next run. */
const DEFAULT_MAX_ENTRIES = 5000;

const maxEntries = (): number => {
  const n = Number(env("QUARANTINE_SWEEP_MAX_ENTRIES"));
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_ENTRIES;
};

const maxAgeMs = (): number => {
  const n = Number(env("QUARANTINE_MAX_AGE_MINUTES"));
  return (Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_AGE_MINUTES) * 60 * 1000;
};

/**
 * W-12: an explicit platform context (SYSTEM_TASKS.QUARANTINE_SWEEP). The
 * quarantine is one directory for every tenant and this reads no table.
 *
 * W-17: the directory is streamed (`opendir`), never read whole, and a run
 * stops after `maxEntries` entries with `truncated: true`. A crash loop that
 * filled the quarantine cannot make one run hold every name in memory.
 *
 * @param opts.now - the sweep's clock
 * @param opts.limit - entries to examine (default QUARANTINE_SWEEP_MAX_ENTRIES, 5000)
 */
function sweepQuarantine({ now = new Date(), limit = maxEntries() }: SweepOptions = {}): Promise<SweepSummary> {
  return runAsSystem(SYSTEM_TASKS.QUARANTINE_SWEEP, () => sweep(now, limit));
}

/**
 * The `code` of a thrown filesystem error, read as the `.js` read it: a plain
 * property read, so a thrown `null` still raises a TypeError here, as before.
 */
const codeOf = (err: unknown): unknown => (err as { code?: unknown }).code;

async function sweep(now: Date, limit: number): Promise<SweepSummary> {
  const dir = quarantinePath();
  const summary: SweepSummary = { scanned: 0, removed: 0, errors: 0, truncated: false };
  let handle: fs.Dir;
  try {
    handle = await fs.promises.opendir(dir);
  } catch (err) {
    if (codeOf(err) === "ENOENT") {
      return summary;
    }
    throw err;
  }

  const cutoff = now.getTime() - maxAgeMs();
  let seen = 0;
  // Leaving the loop early (the bound) closes the handle: for-await calls return().
  for await (const entry of handle) {
    if (seen >= limit) {
      summary.truncated = true;
      break;
    }
    seen += 1;
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
      if (codeOf(err) !== "ENOENT") {
        summary.errors += 1;
        logger.error(`Quarantine sweep could not remove ${entry.name}: ${(err as Error).message}`);
      }
    }
  }
  return summary;
}

export = { sweepQuarantine, DEFAULT_MAX_AGE_MINUTES, DEFAULT_MAX_ENTRIES };
