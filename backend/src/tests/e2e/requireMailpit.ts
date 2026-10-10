/**
 * The e2e runner's globalSetup (jest.e2e.config.js): MAIL IS MANDATORY.
 *
 * The invitation link and the reset code exist only in an email, and the
 * disposable stack (deploy/compose/docker-compose.e2e.yml) always runs Mailpit
 * as its SMTP sink. Until 2026-10-10 the mailed-secret tests were
 * `mailAvailable() ? test : test.skip` — a run without Mailpit went green with
 * them skipped. The owner's rule is that no test may be skipped, so a run
 * without a reachable Mailpit now refuses to start, naming what is missing,
 * instead of reporting a smaller green.
 *
 * Not a spec (the e2e testMatch is `*.test.{js,ts}`).
 */
import { environment } from "../../config/env";

const describeFailure = (base: string, reason: string): Error =>
  new Error(
    `E2E: Mailpit is mandatory for the e2e runner and ${reason}. ` +
      "Start the disposable stack (deploy/compose/docker-compose.e2e.yml runs Mailpit) and set " +
      `E2E_MAILPIT_URL to its HTTP API (e.g. http://127.0.0.1:27132)${base === "" ? "" : `; tried ${base}/api/v1/info`}.`,
  );

const requireMailpit = async (): Promise<void> => {
  const base = (environment()["E2E_MAILPIT_URL"] ?? "").replace(/\/$/, "");
  if (base === "") {
    throw describeFailure(base, "E2E_MAILPIT_URL is not set");
  }
  let status = 0;
  try {
    const res = await fetch(`${base}/api/v1/info`, { signal: AbortSignal.timeout(10000) });
    status = res.status;
  } catch (err) {
    throw describeFailure(base, `it could not be reached (${err instanceof Error ? err.message : String(err)})`);
  }
  if (status !== 200) {
    throw describeFailure(base, `its API answered ${String(status)}`);
  }
};

export = requireMailpit;
