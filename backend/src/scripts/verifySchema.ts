/**
 * P6-05 — verify the database backend/.env points at against the models.
 *
 *   tsx src/scripts/verifySchema.ts          # exit 1 on any mismatch
 *   npm run migrate:verify
 *   ./backend verify-schema                  # in the compiled image (U-05)
 *
 * The same check runs at every backend boot, after db.sync() and the
 * migrator (index.js); a mismatch refuses the boot. This entry point is for a
 * HOST checkout — the compiled image has no Node — e.g. after
 * `make migrate-host`, or against a restored copy of production before a
 * deploy. It does NOT run db.sync() or any migration: it only reads.
 *
 * P9-21 (ADR-087): converted from verifySchema.js with no behaviour change —
 * the same modules load in the same order, and the report and exit code are
 * unchanged (proved by running both against PostgreSQL 18).
 *
 * U-05 (ADR-116): the check is `main`, so the compiled image can run it too —
 * `./backend verify-schema` (scripts/cliDispatch.ts). The backup verifier runs
 * it against every dump it restores into a throwaway PostgreSQL 18. Run
 * directly (tsx), it behaves exactly as before.
 */
// A-42 console-allowed: a CLI run by hand in a terminal; its console output is the operator's report, not application logging (backend/src/tests/guards/noConsole.a42.test.js).
import "../utils/env.util";
import { db } from "../config";
import "../models";
import { verifySchema, TAG } from "../utils/schemaVerify.util";

/**
 * Run the check once and report it.
 * It reads no arguments: the database is the one the environment names.
 * @returns the process exit code: 0 when the schema matches, 1 otherwise
 */
const main = async (): Promise<number> => {
  let failed = true;
  try {
    const result = await verifySchema(db as unknown as Parameters<typeof verifySchema>[0]);
    for (const note of result.notes) {
      console.log(`${TAG} note: ${note}`);
    }
    for (const problem of result.problems) {
      console.error(`${TAG} MISMATCH: ${problem}`);
    }
    failed = result.problems.length > 0;
    console.log(
      failed
        ? `${TAG} FAILED: ${String(result.problems.length)} mismatch(es)`
        : `${TAG} OK: ${String(result.tables)} tables, ${String(result.columns)} columns and ${String(result.objects)} control objects match the models`,
    );
  } catch (err) {
    console.error(`${TAG} could not run: ${String((err as { message?: unknown }).message)}`);
  } finally {
    await db.close();
  }
  return failed ? 1 : 0;
};

export { main };

if (require.main === module) {
  void main().then((code) => process.exit(code));
}
