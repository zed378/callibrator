/**
 * P6-07 — break-glass reset of a PLATFORM OPERATOR's second factor.
 *
 *   tsx src/scripts/breakGlassMfaReset.ts \
 *     --user <username-or-email> --requested-by "<your name>" --ticket <change/incident ref>
 *
 * For the one case nothing else covers: the only super admin has lost both the
 * authenticator and every recovery code. Try these first, in order:
 *   1. the operator's own recovery codes ("use a recovery code" at sign-in);
 *   2. another super admin: POST /api/v1/users/:userId/mfa/reset.
 *
 * What it does (auth.service#breakGlassResetOperatorMfa), in one transaction:
 * clears the operator's MFA enrolment, revokes every session, and writes an
 * audit row (actor `system:break-glass`, naming you and the ticket). It does
 * NOT turn the requirement off: the operator's next password sign-in is an
 * enrolment-only session, and they must enrol a new authenticator before
 * anything else. Refuses a tenant user (403) and an operator without MFA (409).
 *
 * It needs the database credentials (the backend .env) — holding those is the
 * break-glass. Run it on the backend host; record the ticket.
 *
 * P9-21 (ADR-087): converted from breakGlassMfaReset.js with no behaviour
 * change — `auth.service` and the models are still required inside `main`, at
 * call time, as before; the output and exit code are unchanged (proved by
 * running both against PostgreSQL 18).
 */
// A-42 console-allowed: a CLI run by hand in a terminal; its console output is the operator's report, not application logging (backend/src/tests/guards/noConsole.a42.test.js).
import "../utils/env.util";
import type AuthService from "../services/auth.service";
import type Models from "../models";

const readFlag = (argv: readonly string[], name: string): string => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && at + 1 < argv.length ? (argv[at + 1] as string) : "";
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const params = {
    identifier: readFlag(argv, "user"),
    requestedBy: readFlag(argv, "requested-by"),
    ticket: readFlag(argv, "ticket"),
  };
  /* eslint-disable @typescript-eslint/no-require-imports -- as built: loaded at call time, after env.util */
  const authService = require("../services/auth.service") as typeof AuthService;
  const { sequelize } = require("../models") as typeof Models;
  /* eslint-enable @typescript-eslint/no-require-imports */
  try {
    const result = await authService.breakGlassResetOperatorMfa(params);
    console.log(
      `MFA reset for operator ${String(result["userId"])}; ${String(result["sessionsRevoked"])} session(s) revoked. ` +
        "Their next sign-in must enrol a new authenticator.",
    );
    process.exitCode = 0;
  } catch (err) {
    console.error(`Break-glass refused: ${String((err as { message?: unknown }).message)}`);
    process.exitCode = 1;
  } finally {
    await sequelize.close().catch(() => undefined);
  }
};

void main();
