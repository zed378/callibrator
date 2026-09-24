/**
 * P6-10 / S-08 — re-wrap every stored secret under the current KMS master key.
 *
 *   npm run keys:rotate -- --dry-run      # count what would change; write nothing
 *   npm run keys:rotate                   # re-wrap; resumable; exit 1 on any failure
 *   npm run keys:rotate -- --batch=500 --table=webhooks
 *
 * Run it with the SAME environment as the backend — KMS_MASTER_KEY (the new
 * key), KMS_MASTER_KEY_PREVIOUS (the old one) and, while any pre-0058 signing
 * key remains, ENCRYPT_KEY — against the database in backend/.env. The full
 * procedure, including when the previous key may be dropped, is
 * docs/SECURITY/13-KEY-ROTATION.md. Prints key IDs (fingerprints), never keys.
 */
require("../utils/env.util");
const { db } = require("../config");
const { rewrapAll } = require("../services/keyRotation.service");

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const valueOf = (name) => {
  const hit = flag(name);
  return hit && hit.includes("=") ? hit.split("=")[1] : undefined;
};

(async () => {
  let exitCode = 1;
  try {
    const dryRun = Boolean(flag("dry-run"));
    const batchSize = Number(valueOf("batch")) || undefined;
    const table = valueOf("table");
    const result = await rewrapAll({ sequelize: db, dryRun, batchSize, tables: table ? [table] : undefined });
    console.log(
      `KMS current key ${result.keyInfo.currentKeyId}; previous: ${result.keyInfo.previousKeyIds.join(", ") || "none"}` +
        (dryRun ? " — DRY RUN, nothing written" : ""),
    );
    for (const r of result.reports) {
      console.log(
        `${r.table}: scanned ${r.scanned}, re-wrapped ${r.rewrapped}, converted from legacy ${r.converted}, ` +
          `skipped (changed meanwhile) ${r.skipped}, failed ${r.failed.length}`,
      );
      for (const f of r.failed) {
        console.error(`  FAILED ${r.table} ${f.id}: ${f.error}`);
      }
    }
    const pending = result.reports.reduce((n, r) => n + r.skipped, 0);
    if (result.failed === 0 && pending === 0) {
      console.log(
        dryRun
          ? "Dry run complete."
          : "Every stored secret is under the current key. The previous key may now be removed (see the runbook).",
      );
      exitCode = 0;
    } else {
      console.error("NOT complete: keep KMS_MASTER_KEY_PREVIOUS configured, fix the failures, run again.");
    }
  } catch (err) {
    console.error(`Key rotation could not run: ${err.message}`);
  } finally {
    await db.close();
  }
  process.exit(exitCode);
})();
