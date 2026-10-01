/**
 * Encrypt webhook signing secrets at rest (A-51).
 *
 * Until this migration `webhooks.secret` held each webhook's HMAC key in
 * plaintext, VARCHAR(128): a database read or a backup yielded every tenant's
 * signing key. From now on webhook.service.js writes a kms.service envelope
 * (`v1:...`, tenant id as AAD) and decrypts it only to sign. This migration
 * brings the existing rows into that shape:
 *
 *   1. widen `secret` to TEXT — an envelope is ~200 characters, longer than 128;
 *   2. encrypt every row whose value is not already a `v1:` envelope, each under
 *      its OWN tenant id — including soft-deleted rows, which are still secrets;
 *   3. re-count, and throw if any plaintext row remains.
 *
 * The secret VALUE does not change, so receivers keep verifying with the key
 * they already have. Rotating a key that may have leaked is a separate act:
 * `POST /api/v1/webhooks/:id/rotate-secret`.
 *
 * Raw SQL, deliberately across all tenants: this is a maintenance pass over
 * the whole table, and the tenant hooks do not apply to `sequelize.query`.
 * Every UPDATE still carries `tenant_id` explicitly, plus the previous value,
 * so a row changed concurrently is not overwritten — it is counted as a
 * failure instead.
 *
 * Needs the SAME `KMS_MASTER_KEY` as the running application: rows encrypted
 * under one key cannot be decrypted under another, and `down` needs it too.
 *
 * No blanket try/catch: a migration that swallows its own errors is recorded
 * as applied while having done nothing (CLAUDE.md). Verify with
 *   SELECT count(*) FILTER (WHERE secret NOT LIKE 'v1:%') AS plaintext,
 *          count(*) AS total FROM webhooks;
 * — `plaintext` must be 0. The migration log is not evidence.
 */
import { DataTypes, QueryTypes } from "sequelize";
import type { ColumnDescription, QueryInterface } from "sequelize";

/**
 * The QueryInterface Umzug passes. `context.queryInterface || context` below is
 * the reviewed fallback frozen by D-29 (ADR-083): a real QueryInterface has no
 * `.queryInterface`, so it always takes `context`. It is kept as written.
 */
type Context = QueryInterface & { queryInterface?: QueryInterface };

/** A webhook row as the rewrite selects it. */
interface WebhookRow {
  id: string;
  tenant_id: string;
  secret: string;
}

/** The UPDATE result's metadata: PostgreSQL's row count. */
type UpdateMeta = { rowCount?: number } | null | undefined;

const NAME = "0022-encrypt-webhook-secrets";

/**
 * Whether the webhooks table exists. On a database where it does not, there is
 * nothing to encrypt, and `db.sync()` will create it from the model — which
 * already declares `secret` as TEXT.
 * @param {import("sequelize").QueryInterface} queryInterface - query interface
 * @returns {Promise<boolean>} true if `webhooks` exists
 */
async function hasWebhooksTable(queryInterface: QueryInterface): Promise<boolean> {
  // showAllTables is typed string[]; a dialect may return { tableName } objects.
  const tables = ((await queryInterface.showAllTables()) as (string | { tableName: string })[]).map((t) =>
    (typeof t === "object" ? t.tableName : t).toLowerCase(),
  );
  return tables.includes("webhooks");
}

/**
 * Rewrite each selected row's secret through `transform`, in one transaction,
 * and throw if any row was not updated.
 * @param {import("sequelize").QueryInterface} queryInterface - query interface
 * @param {string} selectSql - selects `id, tenant_id, secret` for the rows to rewrite
 * @param {(tenantId: string, secret: string) => string} transform - new value
 * @returns {Promise<void>} resolves when every row is rewritten
 */
async function rewriteSecrets(
  queryInterface: QueryInterface,
  selectSql: string,
  transform: (tenantId: string, secret: string) => string,
): Promise<void> {
  const { sequelize } = queryInterface;
  await sequelize.transaction(async (transaction) => {
    const rows: WebhookRow[] = await sequelize.query(selectSql, {
      type: QueryTypes.SELECT,
      transaction,
    });
    const failed: string[] = [];
    for (const row of rows) {
      const [, meta] = (await sequelize.query(
        `UPDATE webhooks
            SET secret = :secret
          WHERE id = :id AND tenant_id = :tenantId AND secret = :previous`,
        {
          replacements: {
            secret: transform(row.tenant_id, row.secret),
            id: row.id,
            tenantId: row.tenant_id,
            previous: row.secret,
          },
          transaction,
        },
      )) as [unknown, UpdateMeta];
      // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built
      if (!meta || meta.rowCount !== 1) {
        failed.push(row.id);
      }
    }
    if (failed.length) {
      // Throwing rolls the transaction back and leaves the migration pending.
      throw new Error(`${NAME}: ${String(failed.length)} webhook row(s) not rewritten: ${failed.join(", ")}`);
    }
  });
}

/**
 * Count rows matching `whereSql` (a `secret LIKE` predicate).
 * @param {import("sequelize").QueryInterface} queryInterface - query interface
 * @param {string} whereSql - predicate on `secret`
 * @returns {Promise<number>} the count
 */
async function countWhere(queryInterface: QueryInterface, whereSql: string): Promise<number> {
  const { sequelize } = queryInterface;
  const [row] = (await sequelize.query(`SELECT COUNT(*) AS n FROM webhooks WHERE ${whereSql}`, {
    type: QueryTypes.SELECT,
  })) as [{ n: string | number }];
  return Number(row.n);
}

export = {
  async up({ context }: { context: Context }): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- the frozen D-29 fallback, kept as written
    const queryInterface = context.queryInterface || context;
    if (!(await hasWebhooksTable(queryInterface))) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: a lazy require of kms.service, which is JavaScript until Stage C converts it
    const { encryptData } = require("../services/kms.service") as { encryptData: (tenantId: string, plaintext: string) => string };

    const table = await queryInterface.describeTable("webhooks");
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: String() kept
    if (String((table["secret"] as ColumnDescription).type).toUpperCase() !== "TEXT") {
      await queryInterface.changeColumn("webhooks", "secret", {
        type: DataTypes.TEXT,
        allowNull: false,
      });
    }

    await rewriteSecrets(
      queryInterface,
      // P6-10: an envelope is `v1:` (no key id) or `v2:<keyId>:`. Matching v1
      // alone would take a v2 envelope for plaintext and wrap it twice.
      "SELECT id, tenant_id, secret FROM webhooks WHERE secret NOT LIKE 'v1:%' AND secret NOT LIKE 'v2:%'",
      (tenantId, secret) => encryptData(tenantId, secret),
    );

    const remaining = await countWhere(queryInterface, "secret NOT LIKE 'v1:%' AND secret NOT LIKE 'v2:%'");
    if (remaining !== 0) {
      throw new Error(`${NAME}: ${String(remaining)} plaintext webhook secret(s) remain after encryption`);
    }
  },

  async down({ context }: { context: Context }): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- the frozen D-29 fallback, kept as written
    const queryInterface = context.queryInterface || context;
    if (!(await hasWebhooksTable(queryInterface))) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: a lazy require of kms.service, which is JavaScript until Stage C converts it
    const { decryptData } = require("../services/kms.service") as { decryptData: (tenantId: string, payload: string) => string };

    // Restore plaintext first — the envelopes do not fit in VARCHAR(128).
    // decryptData throws on a wrong KMS_MASTER_KEY or a tampered envelope,
    // which aborts the transaction: down never half-completes.
    await rewriteSecrets(
      queryInterface,
      "SELECT id, tenant_id, secret FROM webhooks WHERE secret LIKE 'v1:%' OR secret LIKE 'v2:%'",
      (tenantId, secret) => decryptData(tenantId, secret),
    );

    const remaining = await countWhere(queryInterface, "secret LIKE 'v1:%' OR secret LIKE 'v2:%'");
    if (remaining !== 0) {
      throw new Error(`${NAME}: ${String(remaining)} encrypted webhook secret(s) remain after decryption`);
    }

    await queryInterface.changeColumn("webhooks", "secret", {
      type: DataTypes.STRING(128),
      allowNull: false,
    });
  },
};
