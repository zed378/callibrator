/**
 * P6-05 — verify the database backend/.env points at against the models.
 *
 *   node src/scripts/verifySchema.js          # exit 1 on any mismatch
 *   npm run migrate:verify
 *
 * The same check runs at every backend boot, after db.sync() and the
 * migrator (index.js); a mismatch refuses the boot. This entry point is for a
 * HOST checkout — the compiled image has no Node — e.g. after
 * `make migrate-host`, or against a restored copy of production before a
 * deploy. It does NOT run db.sync() or any migration: it only reads.
 */
require("../utils/env.util");
const { db } = require("../config");
require("../models");
const { verifySchema, TAG } = require("../utils/schemaVerify.util");

(async () => {
  let failed = true;
  try {
    const result = await verifySchema(db);
    for (const note of result.notes) {
      console.log(`${TAG} note: ${note}`);
    }
    for (const problem of result.problems) {
      console.error(`${TAG} MISMATCH: ${problem}`);
    }
    failed = result.problems.length > 0;
    console.log(
      failed
        ? `${TAG} FAILED: ${result.problems.length} mismatch(es)`
        : `${TAG} OK: ${result.tables} tables, ${result.columns} columns and ${result.objects} control objects match the models`,
    );
  } catch (err) {
    console.error(`${TAG} could not run: ${err.message}`);
  } finally {
    await db.close();
  }
  process.exit(failed ? 1 : 0);
})();
