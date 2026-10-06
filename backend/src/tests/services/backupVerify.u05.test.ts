/**
 * U-05 (ADR-116) — the infrastructure backup's outcome reaches the alert path.
 *
 *  - reportOutcome (the verifier's `backup-alert` step): a failed dump or a
 *    failed restore verification raises a critical alert; a pass raises none;
 *    an unreadable outcome is alerted, never read as a success.
 *  - checkRestoreVerification (the backend watchdog): a verifier that stopped
 *    writing outcomes is `backup.restore-verify.missed`; a failed run is
 *    alerted once per run; both repeat at most once per JOB_ALERT_REPEAT_HOURS.
 *  - the job watchdog runs that check, and survives it throwing.
 *  - the compiled binary's dispatcher knows `verify-schema` and `backup-alert`.
 *
 * Outcome files are written to a real temporary directory.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { environment } from "../../config/env";
import type BackupVerifyService from "../../services/backupVerify.service";
import type JobMonitorService from "../../services/jobMonitor.service";
import type * as CliDispatch from "../../scripts/cliDispatch";

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../services/alert.service", () => ({
  SEVERITY: { CRITICAL: "critical", WARNING: "warning", RESOLVED: "resolved" },
  raiseAlert: jest.fn(() => Promise.resolve({ webhook: "not-configured", email: "not-configured" })),
  describeRouting: jest.fn(() => ({ routed: false, webhook: "off", email: "off" })),
}));
jest.mock("../../models", () => ({ BatchJob: { findAll: jest.fn(() => Promise.resolve([])) } }));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after jest.mock, as the modules under test see them */
const { raiseAlert } = require("../../services/alert.service") as { raiseAlert: jest.Mock };
const { logger } = require("../../middlewares/activityLog.middleware") as { logger: { error: jest.Mock } };
const svc = require("../../services/backupVerify.service") as typeof BackupVerifyService;
const monitor = require("../../services/jobMonitor.service") as typeof JobMonitorService;
const dispatch = require("../../scripts/cliDispatch") as typeof CliDispatch;
/* eslint-enable @typescript-eslint/no-require-imports */

const HOUR = 60 * 60 * 1000;
const env = environment();
const saved = { ...env };

interface Alerted {
  key: string;
  severity: string;
  title: string;
  meaning: string;
  detail: string | null;
  context: Record<string, unknown>;
}
const alerted = (): Alerted[] => raiseAlert.mock.calls.map((call: unknown[]) => call[0] as Alerted);

const passing = (finishedAt: string): Record<string, unknown> => ({
  version: 1,
  ok: true,
  phase: "complete",
  startedAt: finishedAt,
  finishedAt,
  dumpFile: "db-20261005T023000Z.dump",
  dumpAgeSeconds: 12,
  restoreSeconds: 9,
  totalSeconds: 21,
  checks: [{ name: "sha256", ok: true, detail: "matches" }],
  error: null,
});

describe("U-05 backupVerify.service", () => {
  let dir: string;
  let file: string;
  const write = (body: unknown): void => {
    fs.writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "u05-"));
    file = path.join(dir, "last-restore-verify.json");
    delete env["RESTORE_VERIFY_MAX_AGE_HOURS"];
    delete env["JOB_ALERT_REPEAT_HOURS"];
    env["RESTORE_VERIFY_STATUS_FILE"] = file;
    raiseAlert.mockClear();
    logger.error.mockClear();
    svc.reset();
  });

  afterAll(() => {
    for (const key of Object.keys(env)) {
      if (!(key in saved)) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- restoring the environment the suite started with
        delete env[key];
      }
    }
    Object.assign(env, saved);
    monitor.reset();
  });

  describe("parseOutcome", () => {
    it("reads a full outcome and defaults what is missing", () => {
      const full = svc.parseOutcome(JSON.stringify(passing("2026-10-05T02:30:21Z")));
      expect(full).toMatchObject({ ok: true, phase: "complete", dumpFile: "db-20261005T023000Z.dump", totalSeconds: 21 });
      expect(full.checks).toEqual([{ name: "sha256", ok: true, detail: "matches" }]);

      const bare = svc.parseOutcome(
        JSON.stringify({ ok: false, finishedAt: "2026-10-05T02:30:21Z", checks: [{ name: "x", ok: "yes" }, 7], dumpAgeSeconds: "12" }),
      );
      expect(bare).toEqual({
        ok: false,
        phase: "unknown",
        startedAt: null,
        finishedAt: "2026-10-05T02:30:21Z",
        dumpFile: null,
        dumpAgeSeconds: null,
        restoreSeconds: null,
        totalSeconds: null,
        checks: [{ name: "x", ok: false, detail: null }],
        error: null,
      });
      expect(svc.parseOutcome(JSON.stringify({ ok: true, finishedAt: "2026-10-05T02:30:21Z", checks: "none" })).checks).toEqual([]);
    });

    it("refuses anything that is not an outcome — never read as a success", () => {
      expect(() => svc.parseOutcome("[]")).toThrow("not a backup outcome");
      expect(() => svc.parseOutcome("null")).toThrow("not a backup outcome");
      expect(() => svc.parseOutcome(JSON.stringify({ ok: "true", finishedAt: "2026-10-05" }))).toThrow("`ok` (boolean)");
      expect(() => svc.parseOutcome(JSON.stringify({ ok: true }))).toThrow("`finishedAt` (string)");
      expect(() => svc.parseOutcome(JSON.stringify({ ok: true, finishedAt: "yesterday" }))).toThrow('finishedAt "yesterday" is not a date');
      expect(() => svc.parseOutcome("{truncated")).toThrow(SyntaxError);
    });
  });

  describe("failureAlert", () => {
    it("a failed dump says no new dump exists", () => {
      const alert = svc.failureAlert(svc.parseOutcome(JSON.stringify({ ok: false, phase: "dump", finishedAt: "2026-10-05T02:30:21Z", error: "pg_dump: connection refused" })));
      expect(alert).toMatchObject({ key: "backup.dump.failed", severity: "critical", detail: "pg_dump: connection refused" });
      expect(alert.meaning).toContain("No new database dump was taken");
    });

    it("a failed verification names the dump and the failed checks, and truncates a long error", () => {
      const outcome = svc.parseOutcome(
        JSON.stringify({
          ok: false,
          phase: "verify",
          finishedAt: "2026-10-05T02:30:21Z",
          dumpFile: "db-x.dump",
          error: "e".repeat(600),
          checks: [
            { name: "sha256", ok: true },
            { name: "row-counts", ok: false },
            { name: "schema-verify", ok: false },
          ],
        }),
      );
      const alert = svc.failureAlert(outcome);
      expect(alert.key).toBe("backup.restore-verify.failed");
      expect(alert.meaning).toContain("db-x.dump");
      expect(alert.detail).toBe(`${"e".repeat(500)}…; failed checks: row-counts, schema-verify`);
      expect(alert.context).toMatchObject({ phase: "verify", failedChecks: ["row-counts", "schema-verify"] });
    });

    it("with no error and no failed check there is no detail, and an unnamed dump says so", () => {
      const alert = svc.failureAlert(svc.parseOutcome(JSON.stringify({ ok: false, phase: "verify", finishedAt: "2026-10-05T02:30:21Z" })));
      expect(alert.detail).toBeNull();
      expect(alert.meaning).toContain("(unknown)");
    });
  });

  describe("reportOutcome — the verifier's backup-alert step", () => {
    it("a passing run raises nothing", async () => {
      write(passing(new Date().toISOString()));
      await expect(svc.reportOutcome(file)).resolves.toBe(0);
      expect(raiseAlert).not.toHaveBeenCalled();
    });

    it("a failed run raises its alert", async () => {
      write({ ...passing(new Date().toISOString()), ok: false, phase: "verify", error: "pg_restore: unexpected end of file" });
      await expect(svc.reportOutcome(file)).resolves.toBe(0);
      expect(alerted().map((a) => a.key)).toEqual(["backup.restore-verify.failed"]);
    });

    it("an unreadable or missing outcome is alerted and exits 1", async () => {
      write("{");
      await expect(svc.reportOutcome(file)).resolves.toBe(1);
      await expect(svc.reportOutcome(path.join(dir, "absent.json"))).resolves.toBe(1);
      expect(alerted().map((a) => a.key)).toEqual(["backup.restore-verify.unreadable", "backup.restore-verify.unreadable"]);
    });
  });

  describe("checkRestoreVerification — the backend watchdog", () => {
    const t0 = new Date("2026-10-05T03:00:00Z");
    const at = (hours: number): Date => new Date(t0.getTime() + hours * HOUR);

    it("does nothing when no status file is configured", async () => {
      delete env["RESTORE_VERIFY_STATUS_FILE"];
      await expect(svc.checkRestoreVerification(t0)).resolves.toBe("not-configured");
      env["RESTORE_VERIFY_STATUS_FILE"] = "   ";
      await expect(svc.checkRestoreVerification()).resolves.toBe("not-configured");
      expect(raiseAlert).not.toHaveBeenCalled();
    });

    it("no outcome yet: quiet within the window, then MISSED, repeated at most once per repeat interval", async () => {
      await expect(svc.checkRestoreVerification(t0)).resolves.toBe("ok");
      await expect(svc.checkRestoreVerification(at(25))).resolves.toBe("ok");
      await expect(svc.checkRestoreVerification(at(27))).resolves.toBe("missed");
      await expect(svc.checkRestoreVerification(at(28))).resolves.toBe("missed");
      expect(alerted().map((a) => a.key)).toEqual(["backup.restore-verify.missed"]);
      expect(alerted()[0]?.meaning).toContain("No backup verification outcome has been written");
      await svc.checkRestoreVerification(at(27 + 24));
      expect(raiseAlert).toHaveBeenCalledTimes(2);
    });

    it("a stale outcome is MISSED and names when it last ran; a fresh one clears it", async () => {
      write(passing(t0.toISOString()));
      env["RESTORE_VERIFY_MAX_AGE_HOURS"] = "2";
      env["JOB_ALERT_REPEAT_HOURS"] = "1";
      await expect(svc.checkRestoreVerification(at(1))).resolves.toBe("ok");
      await expect(svc.checkRestoreVerification(at(3))).resolves.toBe("missed");
      expect(alerted()[0]?.meaning).toContain(`finished at ${t0.toISOString()}`);
      expect(alerted()[0]?.context).toMatchObject({ maxAgeHours: 2 });
      write(passing(at(3.5).toISOString()));
      await expect(svc.checkRestoreVerification(at(4))).resolves.toBe("ok");
      write(passing(t0.toISOString()));
      await expect(svc.checkRestoreVerification(at(4.1))).resolves.toBe("missed");
      expect(raiseAlert).toHaveBeenCalledTimes(2);
    });

    it("an invalid max age falls back to the default", async () => {
      env["RESTORE_VERIFY_MAX_AGE_HOURS"] = "soon";
      write(passing(t0.toISOString()));
      await expect(svc.checkRestoreVerification(at(svc.DEFAULT_MAX_AGE_HOURS - 1))).resolves.toBe("ok");
      await expect(svc.checkRestoreVerification(at(svc.DEFAULT_MAX_AGE_HOURS + 1))).resolves.toBe("missed");
    });

    it("a failed run is alerted once per run, even if the verifier's own alert never left", async () => {
      write({ ...passing(t0.toISOString()), ok: false, phase: "verify" });
      await expect(svc.checkRestoreVerification(at(0.1))).resolves.toBe("failed");
      await expect(svc.checkRestoreVerification(at(0.2))).resolves.toBe("failed");
      expect(alerted().map((a) => a.key)).toEqual(["backup.restore-verify.failed"]);
      write({ ...passing(at(1).toISOString()), ok: false, phase: "dump" });
      await svc.checkRestoreVerification(at(1.1));
      expect(alerted().map((a) => a.key)).toEqual(["backup.restore-verify.failed", "backup.dump.failed"]);
    });

    it("an unreadable outcome is alerted, throttled", async () => {
      write("not json");
      await expect(svc.checkRestoreVerification(t0)).resolves.toBe("unreadable");
      await expect(svc.checkRestoreVerification(at(1))).resolves.toBe("unreadable");
      await expect(svc.checkRestoreVerification(at(25))).resolves.toBe("unreadable");
      expect(alerted().map((a) => a.key)).toEqual(["backup.restore-verify.unreadable", "backup.restore-verify.unreadable"]);
    });
  });

  describe("the job watchdog runs the check", () => {
    it("a tick alerts a missed verification and survives the check throwing", async () => {
      write(passing(new Date(Date.now() - 48 * HOUR).toISOString()));
      await monitor.watchdogTick();
      expect(alerted().map((a) => a.key)).toContain("backup.restore-verify.missed");

      const spy = jest.spyOn(svc, "checkRestoreVerification").mockRejectedValueOnce(new Error("disk gone"));
      await expect(monitor.watchdogTick()).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith("Job watchdog: backup verification check failed: disk gone");
      spy.mockRestore();
    });
  });

  describe("the compiled binary's subcommands", () => {
    it("knows verify-schema and backup-alert", () => {
      expect(dispatch.cliCommandFrom(["node", "index.js", "verify-schema"])).toBe("verify-schema");
      expect(dispatch.cliCommandFrom(["node", "index.js", "backup-alert", "/x.json"])).toBe("backup-alert");
    });

    it("backup-alert reports through the service, and refuses no file", async () => {
      write({ ...passing(new Date().toISOString()), ok: false, phase: "dump" });
      const out = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
      const err = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        await expect(dispatch.runCliCommand(["node", "index.js", "backup-alert", file])).resolves.toBe(0);
        await expect(dispatch.runCliCommand(["node", "index.js", "backup-alert", path.join(dir, "absent.json")])).resolves.toBe(1);
        await expect(dispatch.runCliCommand(["node", "index.js", "backup-alert"])).resolves.toBe(2);
        expect(out).toHaveBeenCalledWith(`backup-alert: ${file} reported\n`);
        expect(err).toHaveBeenCalledWith("usage: backup-alert <outcome.json>\n");
      } finally {
        out.mockRestore();
        err.mockRestore();
      }
      expect(alerted().map((a) => a.key)).toEqual(["backup.dump.failed", "backup.restore-verify.unreadable"]);
    });
  });
});
