/**
 * P6-07 — break-glass reset of a PLATFORM OPERATOR's second factor.
 *
 *   node src/scripts/breakGlassMfaReset.js \
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
 */
require("../utils/env.util");

const readFlag = (argv, name) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : "";
};

const main = async () => {
  const argv = process.argv.slice(2);
  const params = {
    identifier: readFlag(argv, "user"),
    requestedBy: readFlag(argv, "requested-by"),
    ticket: readFlag(argv, "ticket"),
  };
  const authService = require("../services/auth.service");
  const { sequelize } = require("../models");
  try {
    const result = await authService.breakGlassResetOperatorMfa(params);
    // eslint-disable-next-line no-console
    console.log(
      `MFA reset for operator ${result.userId}; ${result.sessionsRevoked} session(s) revoked. ` +
        "Their next sign-in must enrol a new authenticator.",
    );
    process.exitCode = 0;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Break-glass refused: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await sequelize.close().catch(() => undefined);
  }
};

main();
