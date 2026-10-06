/**
 * U-05 (ADR-116) — the infrastructure backup's outcome, made an alert.
 *
 * "Backups are good" was assumed, not known. The scheduled dump and the
 * restore verification run OUTSIDE this process — in the `db-backup` compose
 * service and the Helm CronJob (deploy/backup/backup-verify.sh) — because they
 * need `pg_dump`, `pg_restore` and a throwaway PostgreSQL 18 server, none of
 * which the backend image has. That script writes one JSON outcome per run
 * (`last-restore-verify.json`). This module is how that outcome reaches the
 * EXISTING alert path (alert.service: the log line of record, the webhook, the
 * email), from two places:
 *
 *  1. `reportOutcome` — the verifier runs the compiled backend binary's
 *     `backup-alert <file>` subcommand after every run (scripts/backupAlert.ts).
 *     A failed dump or a failed restore verification raises a critical alert
 *     there and then, through the same sinks as every other P7-02 alert.
 *  2. `checkRestoreVerification` — the backend's job watchdog (every 5 min)
 *     reads the same file when RESTORE_VERIFY_STATUS_FILE names it. A run
 *     older than RESTORE_VERIFY_MAX_AGE_HOURS (default 26) — the verifier
 *     stopped, crashed, or was never started — is `backup.restore-verify.missed`.
 *     A failed run is alerted here too, once per run: if the verifier's own
 *     alert could not be sent, the failure must still not be silent.
 *
 * Nothing here reads a dump or a secret: the outcome file carries file names,
 * sizes, a SHA-256, timings and check results only.
 */
import fs from "fs";
import alertService from "./alert.service";
import { env } from "../config/env";

const { raiseAlert, SEVERITY } = alertService;

/** One check the verifier ran on the restored copy. */
interface OutcomeCheck {
  name: string;
  ok: boolean;
  detail?: string | null;
}

/** One run's outcome, as backup-verify.sh writes it. */
interface Outcome {
  ok: boolean;
  /** Where the run stopped: "dump", "verify", or "complete". */
  phase: string;
  startedAt: string | null;
  finishedAt: string;
  dumpFile: string | null;
  dumpAgeSeconds: number | null;
  restoreSeconds: number | null;
  totalSeconds: number | null;
  checks: OutcomeCheck[];
  error: string | null;
}

/** What one watchdog pass concluded. */
type WatchResult = "not-configured" | "ok" | "missed" | "failed" | "unreadable";

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_MAX_AGE_HOURS = 26;
const DEFAULT_REPEAT_HOURS = 24;
/** Longest error text carried into an alert. */
const MAX_DETAIL = 500;

const positiveNumberEnv = (name: string, fallback: number): number => {
  const n = Number(env(name));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);
const numberOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/**
 * Parse an outcome file's text. Throws on anything that is not an outcome —
 * an unreadable outcome is reported as such, never read as a success.
 * @param text - the file's contents
 * @returns the outcome
 */
function parseOutcome(text: string): Outcome {
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw) || typeof raw["ok"] !== "boolean" || typeof raw["finishedAt"] !== "string") {
    throw new Error("not a backup outcome: `ok` (boolean) and `finishedAt` (string) are required");
  }
  if (Number.isNaN(Date.parse(raw["finishedAt"]))) {
    throw new Error(`not a backup outcome: finishedAt "${raw["finishedAt"]}" is not a date`);
  }
  const checks = Array.isArray(raw["checks"]) ? raw["checks"].filter(isRecord) : [];
  return {
    ok: raw["ok"],
    phase: stringOrNull(raw["phase"]) ?? "unknown",
    startedAt: stringOrNull(raw["startedAt"]),
    finishedAt: raw["finishedAt"],
    dumpFile: stringOrNull(raw["dumpFile"]),
    dumpAgeSeconds: numberOrNull(raw["dumpAgeSeconds"]),
    restoreSeconds: numberOrNull(raw["restoreSeconds"]),
    totalSeconds: numberOrNull(raw["totalSeconds"]),
    checks: checks.map((c) => ({
      name: String(c["name"]),
      ok: c["ok"] === true,
      detail: stringOrNull(c["detail"]),
    })),
    error: stringOrNull(raw["error"]),
  };
}

/**
 * Read and parse an outcome file.
 * @param file - its path
 * @returns the outcome
 */
const readOutcome = (file: string): Outcome => parseOutcome(fs.readFileSync(file, "utf8"));

const truncate = (text: string): string => (text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL)}…` : text);

/**
 * The alert a failed run raises: what failed, what it means, what to do.
 * @param outcome - a failed run
 * @returns the alert input
 */
function failureAlert(outcome: Outcome): Parameters<typeof raiseAlert>[0] {
  const failedChecks = outcome.checks.filter((c) => !c.ok).map((c) => c.name);
  const isDump = outcome.phase === "dump";
  const detailParts = [
    outcome.error ? truncate(outcome.error) : null,
    failedChecks.length > 0 ? `failed checks: ${failedChecks.join(", ")}` : null,
  ].filter((part): part is string => part !== null);
  return {
    key: isDump ? "backup.dump.failed" : "backup.restore-verify.failed",
    severity: SEVERITY.CRITICAL,
    title: isDump ? "Infrastructure database dump FAILED" : "Backup restore verification FAILED",
    meaning: isDump
      ? "No new database dump was taken. The newest restorable dump is older than you think, and RPO grows with every failed night."
      : `The dump ${outcome.dumpFile ?? "(unknown)"} did NOT restore into a clean PostgreSQL 18 cleanly, or the restored copy does not match the source. Treat it as NOT a backup until a run passes.`,
    action: isDump
      ? "Read the error and the db-backup logs (compose) or the failed Job's logs (Kubernetes), fix the cause, then run `backup-verify run-once` by hand and confirm it passes."
      : "Read the failed checks and the db-backup logs; keep the previous verified dump; fix the cause and run `backup-verify run-once` until it passes. docs/DEVOPS/04-DATABASE-BACKUP.md § Scheduled restore verification.",
    detail: detailParts.length > 0 ? detailParts.join("; ") : null,
    context: {
      phase: outcome.phase,
      dumpFile: outcome.dumpFile,
      finishedAt: outcome.finishedAt,
      dumpAgeSeconds: outcome.dumpAgeSeconds,
      totalSeconds: outcome.totalSeconds,
      failedChecks,
    },
  };
}

/** The alert for an outcome file that cannot be read as one. */
const unreadableAlert = (file: string, reason: string): Parameters<typeof raiseAlert>[0] => ({
  key: "backup.restore-verify.unreadable",
  severity: SEVERITY.CRITICAL,
  title: "Backup verification outcome UNREADABLE",
  meaning: "The backup verifier's outcome file could not be read, so nobody knows whether the last dump is restorable.",
  action: "Inspect the file and the db-backup logs (compose) or the CronJob's last Job (Kubernetes); run `backup-verify run-once` by hand.",
  detail: truncate(reason),
  context: { file },
});

/**
 * The verifier's report step (`./backend backup-alert <file>`): a failed run
 * raises its alert through every configured sink. A passing run raises none.
 * @param file - the outcome file the run wrote
 * @returns 0 when the outcome was read (and alerted if it failed); 1 when it could not be read (alerted too)
 */
async function reportOutcome(file: string): Promise<number> {
  let outcome: Outcome;
  try {
    outcome = readOutcome(file);
  } catch (err) {
    await raiseAlert(unreadableAlert(file, (err as Error).message));
    return 1;
  }
  if (!outcome.ok) {
    await raiseAlert(failureAlert(outcome));
  }
  return 0;
}

/** Watchdog memory: when this process started watching, what it last alerted. */
const watch = {
  startedAt: 0,
  missedAlertAt: 0,
  failedRunAlerted: "",
  unreadableAlertAt: 0,
};

/**
 * One watchdog pass over the verifier's outcome (RESTORE_VERIFY_STATUS_FILE).
 * Never alerts on an unset variable: the Helm CronJob has no shared file and
 * relies on its Job status (ADR-116).
 * @param now - the watchdog's clock
 * @returns what the pass concluded
 */
async function checkRestoreVerification(now = new Date()): Promise<WatchResult> {
  const file = (env("RESTORE_VERIFY_STATUS_FILE") ?? "").trim();
  if (!file) {
    return "not-configured";
  }
  if (!watch.startedAt) {
    watch.startedAt = now.getTime();
  }
  const maxAgeMs = positiveNumberEnv("RESTORE_VERIFY_MAX_AGE_HOURS", DEFAULT_MAX_AGE_HOURS) * HOUR_MS;
  const repeatMs = positiveNumberEnv("JOB_ALERT_REPEAT_HOURS", DEFAULT_REPEAT_HOURS) * HOUR_MS;
  const due = (last: number): boolean => !last || now.getTime() - last >= repeatMs;

  let outcome: Outcome | null = null;
  if (fs.existsSync(file)) {
    try {
      outcome = readOutcome(file);
    } catch (err) {
      if (due(watch.unreadableAlertAt)) {
        watch.unreadableAlertAt = now.getTime();
        await raiseAlert(unreadableAlert(file, (err as Error).message));
      }
      return "unreadable";
    }
  }

  // Age of the newest run; with none on record, the time this process has been watching.
  const since = outcome ? Date.parse(outcome.finishedAt) : watch.startedAt;
  if (now.getTime() - since > maxAgeMs) {
    if (due(watch.missedAlertAt)) {
      watch.missedAlertAt = now.getTime();
      await raiseAlert({
        key: "backup.restore-verify.missed",
        severity: SEVERITY.CRITICAL,
        title: "Backup restore verification DID NOT RUN",
        meaning: outcome
          ? `The last verified run finished at ${outcome.finishedAt}, more than ${String(maxAgeMs / HOUR_MS)} h ago. Dumps since then — if any were taken — are unverified.`
          : `No backup verification outcome has been written in the ${String(maxAgeMs / HOUR_MS)} h this backend has been watching for one.`,
        action:
          "Check that the db-backup service is running (`docker compose ps db-backup`, its logs) and that its schedule is not disabled; run `backup-verify run-once` by hand.",
        detail: `status file: ${file}`,
        context: { file, finishedAt: outcome?.finishedAt ?? null, maxAgeHours: maxAgeMs / HOUR_MS },
      });
    }
    return "missed";
  }
  watch.missedAlertAt = 0;

  if (outcome && !outcome.ok) {
    if (watch.failedRunAlerted !== outcome.finishedAt) {
      watch.failedRunAlerted = outcome.finishedAt;
      await raiseAlert(failureAlert(outcome));
    }
    return "failed";
  }
  return "ok";
}

/** Forget the watchdog's memory (tests; a restart does the same). */
function reset(): void {
  watch.startedAt = 0;
  watch.missedAlertAt = 0;
  watch.failedRunAlerted = "";
  watch.unreadableAlertAt = 0;
}

export = {
  DEFAULT_MAX_AGE_HOURS,
  parseOutcome,
  readOutcome,
  failureAlert,
  reportOutcome,
  checkRestoreVerification,
  reset,
};
