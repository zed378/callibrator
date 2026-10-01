/**
 * Add the fields a real electronic signature needs to `signature_records`.
 *
 * Before this, signing stored only `signature_hash` = SHA-256 of a payload that
 * contained `Date.now()`, and verification recomputed that same function — so
 * no genuine signature could ever verify, and the tenant RSA key pairs were
 * never used at all (ADR-040).
 *
 * The new columns are:
 *   signature_value   base64 RSA-SHA256 over the canonical payload
 *   signing_key_id    the TenantKey.key_id whose public half verifies it
 *   signature_scheme  scheme marker; NULL identifies a pre-ADR-040 record
 *   signature_reason  the meaning of the signature (21 CFR 11.50(a)(3))
 *
 * All four are nullable with no default and there is NO backfill: existing rows
 * keep NULL, which is exactly how verifySignature() tells them apart and
 * reports them as unverifiable rather than as valid or as forged. Fabricating a
 * scheme marker for them would claim a cryptographic property they do not have.
 *
 * Deliberately no blanket try/catch: a failure here must fail the migration
 * loudly rather than be recorded as applied while doing nothing. describeTable
 * throws if `signature_records` is absent, and that is the correct outcome —
 * migrations run after db.sync(), so the table exists.
 */
import { DataTypes } from "sequelize";
import type { ModelAttributeColumnOptions, QueryInterface } from "sequelize";

/**
 * The QueryInterface Umzug passes. `context.queryInterface || context` below is
 * the reviewed fallback frozen by D-29 (ADR-083): a real QueryInterface has no
 * `.queryInterface`, so it always takes `context`. It is kept as written.
 */
type Context = QueryInterface & { queryInterface?: QueryInterface };

/** One entry of showIndex's result, as the PostgreSQL dialect shapes it. */
interface IndexRow {
  name: string;
  fields?: [{ attribute: string }, ...{ attribute: string }[]];
}

const COLUMNS: [string, (dataTypes: typeof DataTypes) => ModelAttributeColumnOptions][] = [
  ["signature_value", (DataTypes) => ({ type: DataTypes.TEXT, allowNull: true, defaultValue: null })],
  ["signing_key_id", (DataTypes) => ({ type: DataTypes.STRING(100), allowNull: true, defaultValue: null })],
  ["signature_scheme", (DataTypes) => ({ type: DataTypes.STRING(30), allowNull: true, defaultValue: null })],
  ["signature_reason", (DataTypes) => ({ type: DataTypes.STRING(255), allowNull: true, defaultValue: null })],
];

export = {
  async up({ context }: { context: Context }): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- the frozen D-29 fallback, kept as written
    const queryInterface = context.queryInterface || context;

    const table = await queryInterface.describeTable("signature_records");

    for (const [name, spec] of COLUMNS) {
      if (!table[name]) {
        await queryInterface.addColumn("signature_records", name, spec(DataTypes));
      }
    }

    // Verification reads a record by its signing key; index the lookup column.
    // D-29 (ADR-083): an index is recognised by its NAME or by what it
    // indexes — a single-column index on signing_key_id made under another
    // name (Sequelize's default, or by hand) must not be created twice.
    const indexes = (await queryInterface.showIndex("signature_records")) as IndexRow[];
    const hasIndex = indexes.some(
      (i) =>
        i.name === "signature_records_signing_key_id" ||
        (Array.isArray(i.fields) &&
          i.fields.length === 1 &&
          i.fields[0].attribute === "signing_key_id"),
    );
    if (!hasIndex) {
      await queryInterface.addIndex("signature_records", ["signing_key_id"], {
        name: "signature_records_signing_key_id",
      });
    }
  },

  async down({ context }: { context: Context }): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- the frozen D-29 fallback, kept as written
    const queryInterface = context.queryInterface || context;

    const indexes = (await queryInterface.showIndex("signature_records")) as IndexRow[];
    if (indexes.some((i) => i.name === "signature_records_signing_key_id")) {
      await queryInterface.removeIndex(
        "signature_records",
        "signature_records_signing_key_id",
      );
    }

    const table = await queryInterface.describeTable("signature_records");
    for (const [name] of COLUMNS) {
      if (table[name]) {
        await queryInterface.removeColumn("signature_records", name);
      }
    }
  },
};
