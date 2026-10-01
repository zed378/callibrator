/**
 * P10-16 (ADR-099) — recovery: issue a NEW one-time password to a super admin
 * whose bootstrap password was lost, expired unused (72 h), or consumed by a
 * first sign-in whose password change was never finished.
 *
 *   in the container (the image has no Node):
 *     docker exec <backend-container> ./backend rotate-bootstrap-password \
 *       --user sys@mail.com --requested-by "<your name>" --ticket <change/incident ref>
 *   from a source checkout (against backend/.env's database):
 *     npm run bootstrap:rotate -- --user sys@mail.com --requested-by "<name>" --ticket <ref>
 *
 * In one transaction (bootstrapCredential.service#rotateOneTimePassword): the
 * new hash, `password_one_time` + must-change + a 72 h expiry, every session
 * revoked, an audit row by `system:bootstrap` naming you and the ticket, and
 * the plaintext written to the 0600 file. Then read it:
 *     docker exec <backend-container> cat /app/.bootstrap/superadmin-password
 *
 * THE VALUE IS NEVER PRINTED — this prints where the file is, nothing more
 * (the owner's rule: stdout reaches `docker logs` and terminals' scrollback).
 * Run it in the SAME container that will serve the sign-in, or the file is in
 * the wrong one (see ADR-099, multi-replica).
 *
 * It needs the database credentials — holding those (or `docker exec` on the
 * backend) is the authority. Refuses a tenant user (403): theirs is an
 * administrator's reset.
 */
import { db } from "../config";
import { rotateOneTimePassword } from "../services/bootstrapCredential.service";

/** The value after `--name`, or "". */
const readFlag = (argv: readonly string[], name: string): string => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && at + 1 < argv.length ? (argv[at + 1] ?? "") : "";
};

/**
 * Operator report. Not `console` (A-42 keeps that to the six listed CLIs) and
 * not the logger (its files are a host-visible volume) — one line to stdout or
 * stderr, which never carries the value.
 */
const report = (stream: NodeJS.WriteStream, line: string): void => {
  stream.write(`${line}\n`);
};

/**
 * @param args - the arguments after the command name
 * @returns the process exit code
 */
const main = async (args: readonly string[]): Promise<number> => {
  const params = {
    identifier: readFlag(args, "user"),
    requestedBy: readFlag(args, "requested-by"),
    ticket: readFlag(args, "ticket"),
  };
  try {
    const { userId, file } = await rotateOneTimePassword(params);
    report(
      process.stdout,
      `One-time password issued for account ${userId}; every session revoked. ` +
        `Read it inside this container: cat ${file} — it signs in once, then must be changed.`,
    );
    return 0;
  } catch (err) {
    report(process.stderr, `Rotation refused: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    await db.close().catch(() => undefined);
  }
};

export { main, readFlag };

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- loads backend/.env first, as every CLI here does
  require("../utils/env.util");
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
