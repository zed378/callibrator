/**
 * P6-10 / S-08 — re-wrap every stored secret under the CURRENT KMS master key.
 *
 * Rotation (docs/SECURITY/13-KEY-ROTATION.md):
 *   1. deploy with KMS_MASTER_KEY=<new> and KMS_MASTER_KEY_PREVIOUS=<old> —
 *      every row still reads, every new row is written under <new>;
 *   2. run this (npm run keys:rotate) until it reports nothing left;
 *   3. deploy without KMS_MASTER_KEY_PREVIOUS.
 * A step-2 failure changes nothing it has not verified, and step 3 is not
 * taken until step 2 reports zero — that is the rollback: keep (or restore)
 * the previous key in the ring and every row still reads.
 *
 * RESUMABLE: it only touches rows that still need it (a v1 envelope, a v2
 * envelope naming another key, or a legacy AES-CBC signing key), so a second
 * run after an interruption picks up where the first stopped. Each row is
 * written with an optimistic predicate (`AND <column> = <what was read>`), so
 * a row the application rewrote meanwhile is skipped, not clobbered, and is
 * RE-READ after the write and decrypted to prove the new value holds the same
 * secret.
 *
 * Deliberately raw SQL across ALL tenants — an operator task, not a request:
 * every UPDATE names the row's id AND its tenant_id, and the tenant id is the
 * AAD the value is decrypted and re-encrypted under — except for a target
 * that names its own AAD (`aad`, the users' MFA seeds, S-20: sealed under the
 * user id, since a user's tenant can be null). Soft-deleted rows are
 * included: they hold ciphertext under the old key too.
 *
 * P9-18: every statement goes through the bind-only helper `sql()`
 * (utils/sql.util, P9-07): `$1…$n` bind values, never `replacements`. The
 * UPDATE reports the row it wrote with `RETURNING id` (one row back = one row
 * written) instead of the driver's `rowCount`. The statements span tenants on
 * purpose; D-05 lists this file in its reviewed CROSS_TENANT entries.
 *
 * P9-18 (ADR-087, Stage C; converted under the four isolation gates, after the
 * sql() move above as its own change): from keyRotation.service.js with no
 * behaviour change. `export =` keeps the exact object `require()` returned
 * (the same keys, in the same order). `kms`, `signingKeyWrap` and `mfaService`
 * are the module objects; `sql` is captured at load, as the `.js`
 * destructured it. TARGETS still captures the converters at load.
 */
import kms from "./kms.service";
import { sql as loadedSql, type SqlRunner } from "../utils/sql.util";
import signingKeyWrap from "./signingKeyWrap.service";
import mfaService from "./mfa.service";

const sql = loadedSql;

/** A converter for a non-envelope value that must become one. */
interface LegacyConverter {
  readonly isLegacy: (stored: unknown) => boolean;
  readonly unwrap: (aad: string, stored: string) => string;
}

/** Where envelopes live (see TARGETS). */
interface RewrapTargetSpec {
  readonly table: string;
  readonly column: string;
  readonly legacy?: LegacyConverter;
  readonly aad?: (rowId: string) => string;
}

/** One row as the page SELECT returns it. */
interface EnvelopeRow {
  id: string;
  tenant_id: string | null;
  value: unknown;
}

/** One target's outcome. */
interface TargetReport {
  table: string;
  column: string;
  scanned: number;
  rewrapped: number;
  converted: number;
  skipped: number;
  failed: { id: string; error: string }[];
}

/** The pre-0058 AES-CBC signing key, as a `legacy` converter. */
const LEGACY_SIGNING_KEY: LegacyConverter = Object.freeze({
  isLegacy: signingKeyWrap.isLegacy,
  unwrap: signingKeyWrap.unwrapPrivateKey,
});

/**
 * Where envelopes live. `legacy` names a converter for a non-envelope value
 * that must become one (the pre-0058 signing keys, the pre-0086 TOTP seeds);
 * without it a non-envelope value (plaintext of a non-secret setting) is left
 * alone. `aad` derives the AAD from the row id; without it the AAD is the
 * row's tenant id.
 */
const TARGETS: readonly RewrapTargetSpec[] = Object.freeze([
  Object.freeze({ table: "tenant_settings", column: "value" }),
  Object.freeze({ table: "webhooks", column: "secret" }),
  Object.freeze({ table: "tenant_keys", column: "private_key", legacy: LEGACY_SIGNING_KEY }),
  // S-20, migration 0086.
  Object.freeze({
    table: "users",
    column: "mfa_secret",
    legacy: mfaService.LEGACY_PLAINTEXT_SEED,
    aad: mfaService.secretAad,
  }),
  Object.freeze({
    table: "users",
    column: "mfa_pending_secret",
    legacy: mfaService.LEGACY_PLAINTEXT_SEED,
    aad: mfaService.secretAad,
  }),
]);

const DEFAULT_BATCH = 200;

/**
 * @param target - a TARGETS entry
 * @param value - the stored value
 * @returns what the row needs
 */
const workFor = (target: RewrapTargetSpec, value: unknown): "rewrap" | "convert" | null => {
  if (typeof value !== "string" || value === "") {
    return null;
  }
  if (kms.needsRewrap(value)) {
    return "rewrap";
  }
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `target.legacy && target.legacy.isLegacy(value)`
  if (target.legacy && target.legacy.isLegacy(value)) {
    return "convert";
  }
  return null;
};

/**
 * @param target - a TARGETS entry
 * @param row - the row's id and tenant
 * @returns the AAD the row's value is sealed under
 */
const aadOf = (target: RewrapTargetSpec, row: { id: string; tenant_id: string | null }): string | null =>
  target.aad ? target.aad(row.id) : row.tenant_id;

/**
 * @param target - a TARGETS entry
 * @param aad - the AAD
 * @param value - the stored value
 * @returns the plaintext the stored value holds
 */
const plaintextOf = (target: RewrapTargetSpec, aad: string, value: string): string =>
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built
  target.legacy && target.legacy.isLegacy(value)
    ? target.legacy.unwrap(aad, value)
    : kms.decryptData(aad, value);

/**
 * Re-wrap one target's rows.
 *
 * @param options - `sequelize`; `target`, a TARGETS entry; `dryRun`, count
 *   only and write nothing; `batchSize`
 */
const rewrapTarget = async ({
  sequelize,
  target,
  dryRun = false,
  batchSize = DEFAULT_BATCH,
}: {
  sequelize: SqlRunner;
  target: RewrapTargetSpec;
  dryRun?: boolean;
  batchSize?: number;
}): Promise<TargetReport> => {
  const { table, column } = target;
  const report: TargetReport = { table, column, scanned: 0, rewrapped: 0, converted: 0, skipped: 0, failed: [] };
  let cursor: string | null = null;

  for (;;) {
    const rows: EnvelopeRow[] = await sql<EnvelopeRow>(
      sequelize,
      `SELECT id::text AS id, tenant_id::text AS tenant_id, ${column} AS value FROM ${table}
        ${cursor === null ? "" : "WHERE id::text > $2"}
        ORDER BY id::text LIMIT $1`,
      cursor === null ? [batchSize] : [batchSize, cursor],
    );
    if (rows.length === 0) {
      break;
    }
    // rows is not empty here.
    cursor = (rows[rows.length - 1] as EnvelopeRow).id;

    for (const row of rows) {
      report.scanned += 1;
      const work = workFor(target, row.value);
      if (work === null) {
        continue;
      }
      try {
        // As built: the AAD is the row's tenant id (or the target's own); a NULL one fails inside this try.
        const aad = aadOf(target, row) as string;
        // workFor returned work, so the value is a non-empty string.
        const plaintext = plaintextOf(target, aad, row.value as string);
        if (dryRun) {
          report[work === "rewrap" ? "rewrapped" : "converted"] += 1;
          continue;
        }
        const next = kms.encryptData(aad, plaintext) as string;
        // IS NOT DISTINCT FROM: a user's tenant_id can be NULL (S-20).
        const written = await sql(
          sequelize,
          `UPDATE ${table} SET ${column} = $1
            WHERE id::text = $2 AND tenant_id IS NOT DISTINCT FROM CAST($3 AS uuid)
              AND ${column} = $4
            RETURNING id`,
          [next, row.id, row.tenant_id, row.value as string],
        );
        if (written.length !== 1) {
          report.skipped += 1; // rewritten by the application meanwhile — the next run revisits it
          continue;
        }
        const [reread] = await sql<{ value: string }>(
          sequelize,
          `SELECT ${column} AS value FROM ${table}
            WHERE id::text = $1 AND tenant_id IS NOT DISTINCT FROM CAST($2 AS uuid)`,
          [row.id, row.tenant_id],
        );
        // As built: a missing re-read row throws here, inside the try, and is reported as failed.
        if (kms.decryptData(aad, (reread as { value: string }).value) !== plaintext) {
          throw new Error("the re-read value does not decrypt to the original secret");
        }
        report[work === "rewrap" ? "rewrapped" : "converted"] += 1;
      } catch (err) {
        report.failed.push({ id: row.id, error: (err as Error).message });
      }
    }
  }
  return report;
};

/**
 * Re-wrap every target.
 *
 * @param options - `sequelize`, `dryRun`, `batchSize`, and `tables` to limit
 *   the run to those tables
 */
const rewrapAll = async ({
  sequelize,
  dryRun = false,
  batchSize = DEFAULT_BATCH,
  tables,
}: { sequelize?: SqlRunner; dryRun?: boolean; batchSize?: number; tables?: readonly string[] } = {}): Promise<{
  keyInfo: ReturnType<typeof kms.keyInfo>;
  reports: TargetReport[];
  failed: number;
}> => {
  const reports: TargetReport[] = [];
  for (const target of TARGETS) {
    if (tables && !tables.includes(target.table)) {
      continue;
    }
    // As built: without a database the first query throws (a TypeError), never a report.
    reports.push(await rewrapTarget({ sequelize: sequelize as SqlRunner, target, dryRun, batchSize }));
  }
  return {
    keyInfo: kms.keyInfo(),
    reports,
    failed: reports.reduce((n, r) => n + r.failed.length, 0),
  };
};

export = { rewrapAll, rewrapTarget, TARGETS, workFor, aadOf };
