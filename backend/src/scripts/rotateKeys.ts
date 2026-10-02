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
 *
 * P9-21 (ADR-087): converted from rotateKeys.js with no behaviour change — the
 * same modules load in the same order, and the report and exit code are
 * unchanged (proved by running both against PostgreSQL 18).
 */
// A-42 console-allowed: a CLI run by hand in a terminal; its console output is the operator's report, not application logging (backend/src/tests/guards/noConsole.a42.test.js).
import "../utils/env.util";
import { db } from "../config";
import keyRotation from "../services/keyRotation.service";

const { rewrapAll } = keyRotation;

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const valueOf = (name: string): string | undefined => {
  const hit = flag(name);
  return hit?.includes("=") ? hit.split("=")[1] : undefined;
};

void (async (): Promise<void> => {
  let exitCode = 1;
  try {
    const dryRun = Boolean(flag("dry-run"));
    // As built: NaN and 0 are no batch size, so `||`, not `??`.
    const batchSize = Number(valueOf("batch")) || undefined;
    const table = valueOf("table");
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- as built: the .js passed `batchSize: undefined` and `tables: undefined` explicitly; the object is passed as written, not reshaped (ADR-087 identity)
    const result = await rewrapAll({
      sequelize: db as unknown as NonNullable<Parameters<typeof rewrapAll>[0]>["sequelize"],
      dryRun,
      batchSize,
      tables: table ? [table] : undefined,
    } as NonNullable<Parameters<typeof rewrapAll>[0]>);
    console.log(
      // As built: an empty list reads "none", so `||`, not `??`.
      `KMS current key ${result.keyInfo.currentKeyId}; previous: ${result.keyInfo.previousKeyIds.join(", ") || "none"}` +
        (dryRun ? " — DRY RUN, nothing written" : ""),
    );
    for (const r of result.reports) {
      console.log(
        `${r.table}.${r.column}: scanned ${String(r.scanned)}, re-wrapped ${String(r.rewrapped)}, converted from legacy ${String(r.converted)}, ` +
          `skipped (changed meanwhile) ${String(r.skipped)}, failed ${String(r.failed.length)}`,
      );
      for (const f of r.failed) {
        console.error(`  FAILED ${r.table}.${r.column} ${f.id}: ${f.error}`);
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
    console.error(`Key rotation could not run: ${String((err as { message?: unknown }).message)}`);
  } finally {
    await db.close();
  }
  process.exit(exitCode);
})();
