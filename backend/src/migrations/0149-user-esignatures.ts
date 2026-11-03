/**
 * Migration 0149 — personal e-signatures and their applications (P21-15; ADR-140; spec
 * MEMORY/specs/P21-15-operator-esignature.md v2 § 2).
 *
 * WHAT THIS DOES, in ONE transaction
 *
 *  1. The two tables, unless they exist — db.sync() runs BEFORE the migrations at boot and creates
 *     them from the models on a database that has never seen them. `created_at` defaults to `now()`.
 *     - `user_esignatures`: a user's e-signature — the specimen (sanitised SVG), the RSA public key,
 *       the private key as a KMS envelope, the key's fingerprint, a version and a lifecycle;
 *     - `esignature_applications`: one application of an e-signature to one document, signed with
 *       the personal key, with its own capability token.
 *  2. CHECKs (sync never creates one) — the value lists of @callibrator/contracts/esignatures, the
 *     hash and token shapes, a lifecycle whose columns agree with its status, a document id exactly
 *     when the type names a row, and each type's own content scheme.
 *  3. Indexes, every one here and none on the models (ADR-100 Am. 3): ONE active e-signature per user
 *     (partial UNIQUE), one version number per user; the token UNIQUE, **global** — the reviewed
 *     exception ADR-138 § 2 made for a random capability (the public verification has no tenant);
 *     one application per (document, signer, meaning); a leading index on each foreign key (D-20).
 *  4. Triggers, ENABLE ALWAYS (they fire under `session_replication_role = replica` too), 42501:
 *     - `user_esignatures_append_mostly` (+ `_no_truncate`): DELETE and TRUNCATE refused — a key or a
 *       specimen is never deleted; an active row may become `superseded` or `revoked`, once, with its
 *       own columns; nothing else ever changes;
 *     - `user_esignatures_same_tenant` (BEFORE INSERT): the user is the row's tenant's;
 *     - `esignature_applications_append_only` (+ `_no_truncate`): UPDATE, DELETE, TRUNCATE refused;
 *     - `esignature_applications_signable` (BEFORE INSERT): the e-signature is the signer's own,
 *       ACTIVE, of the row's tenant; a calibration record is the tenant's, effective, a full record,
 *       `performed` by its performer and `reviewed` by anyone else; a certificate is the tenant's.
 *  5. Grants of the application role: `user_esignatures` SELECT, INSERT and UPDATE of the lifecycle
 *     columns only; `esignature_applications` SELECT and INSERT only (0057's default privileges gave
 *     UPDATE and DELETE on a new table; they are taken away here).
 *
 * Throws, never skips, when a prerequisite is absent (PR-5). No try/catch. Verify with psql, not the log:
 *   SELECT tgrelid::regclass, tgname, tgenabled FROM pg_trigger
 *    WHERE tgrelid IN ('user_esignatures'::regclass, 'esignature_applications'::regclass) AND NOT tgisinternal;
 *
 * `down` REFUSES while either table holds a row (an application is a Part 11 record and a key is what
 * verifies it); otherwise drops both tables and their functions.
 */
import { DataTypes, type ModelAttributeColumnOptions, type QueryInterface } from "sequelize";
import {
  CALREC_DATA_SCHEME,
  CERT_DATA_SCHEME,
  ESIG_AUTH_METHODS,
  ESIG_CONTENT_SCHEMES,
  ESIG_DOCUMENT_TYPES,
  ESIG_MEANINGS,
  ESIG_STATUSES,
  FILE_SHA256_SCHEME,
} from "@callibrator/contracts/esignatures";
import {
  LOCK_TIMEOUT,
  appRoleName,
  constraintNames,
  createAlwaysTrigger,
  requireTables,
  roleExists,
  rows,
  run,
  sqlList,
  tableExists,
} from "./facilityMigration.shared";

const ESIGNATURES = "user_esignatures";
const APPLICATIONS = "esignature_applications";

/** The tables `up` needs before it starts. */
const PREREQUISITES = Object.freeze(["tenants", "users", "calibration_records", "certificates"]);

const fk = (table: string, allowNull = false): ModelAttributeColumnOptions => ({
  type: DataTypes.UUID,
  allowNull,
  references: { model: table, key: "id" },
  onDelete: "RESTRICT",
  onUpdate: "CASCADE",
});

/** `user_esignatures` as the model declares it (tests/migrations/0149 holds them equal). */
const ESIGNATURE_COLUMNS: Readonly<Record<string, ModelAttributeColumnOptions>> = Object.freeze({
  id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
  tenant_id: fk("tenants"),
  user_id: fk("users"),
  version: { type: DataTypes.INTEGER, allowNull: false },
  specimen_svg: { type: DataTypes.TEXT, allowNull: false },
  public_key_pem: { type: DataTypes.TEXT, allowNull: false },
  private_key_enc: { type: DataTypes.TEXT, allowNull: false },
  key_fingerprint: { type: DataTypes.CHAR(64), allowNull: false },
  status: { type: DataTypes.STRING(12), allowNull: false },
  created_at: { type: DataTypes.DATE, allowNull: false },
  superseded_at: { type: DataTypes.DATE, allowNull: true },
  revoked_at: { type: DataTypes.DATE, allowNull: true },
  revoked_reason: { type: DataTypes.STRING(500), allowNull: true },
});

/** `esignature_applications` as the model declares it. */
const APPLICATION_COLUMNS: Readonly<Record<string, ModelAttributeColumnOptions>> = Object.freeze({
  id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
  tenant_id: fk("tenants"),
  esignature_id: fk(ESIGNATURES),
  signer_user_id: fk("users"),
  signer_snapshot: { type: DataTypes.JSONB, allowNull: false },
  document_type: { type: DataTypes.STRING(40), allowNull: false },
  document_id: { type: DataTypes.UUID, allowNull: true },
  document_title: { type: DataTypes.STRING(255), allowNull: false },
  meaning: { type: DataTypes.STRING(40), allowNull: false },
  content_hash: { type: DataTypes.CHAR(64), allowNull: false },
  content_scheme: { type: DataTypes.STRING(40), allowNull: false },
  auth_method: { type: DataTypes.STRING(10), allowNull: false },
  signature_value: { type: DataTypes.TEXT, allowNull: false },
  signed_at: { type: DataTypes.DATE, allowNull: false },
  verification_token: { type: DataTypes.STRING(64), allowNull: false },
  ip_address: { type: DataTypes.STRING(45), allowNull: true },
  user_agent: { type: DataTypes.STRING(500), allowNull: true },
  created_at: { type: DataTypes.DATE, allowNull: false },
});

/** [table, CHECK name, predicate]. */
const CHECKS: readonly (readonly [table: string, name: string, predicate: string])[] = Object.freeze([
  [ESIGNATURES, "user_esignatures_status", `status IN (${sqlList(ESIG_STATUSES)})`],
  [ESIGNATURES, "user_esignatures_version", "version >= 1"],
  [ESIGNATURES, "user_esignatures_fingerprint_shape", "key_fingerprint ~ '^[0-9a-f]{64}$'"],
  [
    ESIGNATURES,
    "user_esignatures_lifecycle",
    "(status = 'active' AND superseded_at IS NULL AND revoked_at IS NULL AND revoked_reason IS NULL) OR " +
      "(status = 'superseded' AND superseded_at IS NOT NULL AND revoked_at IS NULL AND revoked_reason IS NULL) OR " +
      "(status = 'revoked' AND superseded_at IS NULL AND revoked_at IS NOT NULL AND revoked_reason IS NOT NULL)",
  ],
  [APPLICATIONS, "esignature_applications_document_type", `document_type IN (${sqlList(ESIG_DOCUMENT_TYPES)})`],
  [APPLICATIONS, "esignature_applications_meaning", `meaning IN (${sqlList(ESIG_MEANINGS)})`],
  [APPLICATIONS, "esignature_applications_content_scheme", `content_scheme IN (${sqlList(ESIG_CONTENT_SCHEMES)})`],
  [APPLICATIONS, "esignature_applications_auth_method", `auth_method IN (${sqlList(ESIG_AUTH_METHODS)})`],
  [APPLICATIONS, "esignature_applications_hash_shape", "content_hash ~ '^[0-9a-f]{64}$'"],
  [APPLICATIONS, "esignature_applications_token_shape", "verification_token ~ '^[A-Za-z0-9_-]{32}$'"],
  [APPLICATIONS, "esignature_applications_document_id", "(document_type = 'document') = (document_id IS NULL)"],
  [
    APPLICATIONS,
    "esignature_applications_type_scheme",
    `(document_type = 'calibration_record' AND content_scheme = '${CALREC_DATA_SCHEME}') OR ` +
      `(document_type = 'certificate' AND content_scheme = '${CERT_DATA_SCHEME}') OR ` +
      `(document_type = 'document' AND content_scheme = '${FILE_SHA256_SCHEME}')`,
  ],
]);

/** The index names, in creation order. */
const INDEX_NAMES = Object.freeze([
  "user_esignatures_one_active_per_user",
  "user_esignatures_user_version_unique",
  "user_esignatures_tenant_id",
  "esignature_applications_token_unique",
  "esignature_applications_once_per_meaning",
  "esignature_applications_tenant_id",
  "esignature_applications_esignature_id",
  "esignature_applications_signer_user_id",
  "esignature_applications_document",
]);

const INDEX_SQL = Object.freeze([
  `CREATE UNIQUE INDEX IF NOT EXISTS user_esignatures_one_active_per_user ON ${ESIGNATURES} (user_id) WHERE status = 'active'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS user_esignatures_user_version_unique ON ${ESIGNATURES} (user_id, version)`,
  `CREATE INDEX IF NOT EXISTS user_esignatures_tenant_id ON ${ESIGNATURES} (tenant_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS esignature_applications_token_unique ON ${APPLICATIONS} (verification_token)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS esignature_applications_once_per_meaning ON ${APPLICATIONS} (document_type, document_id, signer_user_id, meaning) WHERE document_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS esignature_applications_tenant_id ON ${APPLICATIONS} (tenant_id)`,
  `CREATE INDEX IF NOT EXISTS esignature_applications_esignature_id ON ${APPLICATIONS} (esignature_id)`,
  `CREATE INDEX IF NOT EXISTS esignature_applications_signer_user_id ON ${APPLICATIONS} (signer_user_id)`,
  `CREATE INDEX IF NOT EXISTS esignature_applications_document ON ${APPLICATIONS} (document_type, document_id)`,
]);

/** The trigger functions, by name. */
const FUNCTIONS: readonly (readonly [name: string, sql: string])[] = Object.freeze([
  [
    "user_esignatures_append_mostly",
    `
CREATE OR REPLACE FUNCTION user_esignatures_append_mostly() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'user_esignatures is append-mostly: TRUNCATE is refused'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'user_esignatures is append-mostly: e-signature % cannot be deleted', OLD.id
      USING ERRCODE = '42501',
            HINT = 'A key or a specimen is never deleted: it verifies the applications it made (ADR-140). Revoke it instead.';
  END IF;
  IF OLD.status <> 'active' THEN
    RAISE EXCEPTION 'user_esignatures: e-signature % is % and never changes again', OLD.id, OLD.status
      USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'superseded_at' - 'revoked_at' - 'revoked_reason')
     IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'superseded_at' - 'revoked_at' - 'revoked_reason') THEN
    RAISE EXCEPTION 'user_esignatures: only the lifecycle of e-signature % may change', OLD.id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$`,
  ],
  [
    "user_esignatures_same_tenant",
    `
CREATE OR REPLACE FUNCTION user_esignatures_same_tenant() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'user_esignatures: user % is not of tenant %', NEW.user_id, NEW.tenant_id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$`,
  ],
  [
    "esignature_applications_append_only",
    `
CREATE OR REPLACE FUNCTION esignature_applications_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'esignature_applications is append-only: TRUNCATE is refused'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'esignature_applications is append-only: application % cannot be deleted', OLD.id
      USING ERRCODE = '42501';
  END IF;
  RAISE EXCEPTION 'esignature_applications is append-only: application % cannot be changed', OLD.id
    USING ERRCODE = '42501';
END;
$fn$`,
  ],
  [
    "esignature_applications_signable",
    `
CREATE OR REPLACE FUNCTION esignature_applications_signable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_performer uuid;
  v_deleted boolean;
  v_superseded uuid;
  v_kind text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_esignatures e
                  WHERE e.id = NEW.esignature_id AND e.tenant_id = NEW.tenant_id
                    AND e.user_id = NEW.signer_user_id AND e.status = 'active') THEN
    RAISE EXCEPTION 'esignature_applications: e-signature % is not the active e-signature of signer % in tenant %',
      NEW.esignature_id, NEW.signer_user_id, NEW.tenant_id
      USING ERRCODE = '42501';
  END IF;
  IF NEW.document_type = 'calibration_record' THEN
    SELECT r.performed_by, r.is_deleted, r.superseded_by_id, r.entry_kind::text
      INTO v_performer, v_deleted, v_superseded, v_kind
      FROM calibration_records r
     WHERE r.id = NEW.document_id AND r.tenant_id = NEW.tenant_id
       FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'esignature_applications: record % is not of tenant %', NEW.document_id, NEW.tenant_id
        USING ERRCODE = '42501';
    END IF;
    IF v_deleted OR v_superseded IS NOT NULL OR v_kind IS DISTINCT FROM 'full_record' OR v_performer IS NULL THEN
      RAISE EXCEPTION 'esignature_applications: only an effective full record is signed (record %)', NEW.document_id
        USING ERRCODE = '42501';
    END IF;
    IF (NEW.meaning = 'performed' AND NEW.signer_user_id IS DISTINCT FROM v_performer)
       OR (NEW.meaning = 'reviewed' AND NEW.signer_user_id = v_performer)
       OR NEW.meaning NOT IN ('performed', 'reviewed') THEN
      RAISE EXCEPTION 'esignature_applications: % is not the meaning signer % may give record %', NEW.meaning, NEW.signer_user_id, NEW.document_id
        USING ERRCODE = '42501',
              HINT = 'performed: the record''s performer only; reviewed: anyone else (ADR-140).';
    END IF;
  ELSIF NEW.document_type = 'certificate' THEN
    IF NOT EXISTS (SELECT 1 FROM certificates c WHERE c.id = NEW.document_id AND c.tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'esignature_applications: certificate % is not of tenant %', NEW.document_id, NEW.tenant_id
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$`,
  ],
]);

/** [table, trigger name, definition after CREATE]. */
const TRIGGERS: readonly (readonly [table: string, name: string, definition: string])[] = Object.freeze([
  [ESIGNATURES, "user_esignatures_append_mostly", `TRIGGER user_esignatures_append_mostly BEFORE UPDATE OR DELETE ON ${ESIGNATURES} FOR EACH ROW EXECUTE FUNCTION user_esignatures_append_mostly()`],
  [ESIGNATURES, "user_esignatures_no_truncate", `TRIGGER user_esignatures_no_truncate BEFORE TRUNCATE ON ${ESIGNATURES} FOR EACH STATEMENT EXECUTE FUNCTION user_esignatures_append_mostly()`],
  [ESIGNATURES, "user_esignatures_same_tenant", `TRIGGER user_esignatures_same_tenant BEFORE INSERT ON ${ESIGNATURES} FOR EACH ROW EXECUTE FUNCTION user_esignatures_same_tenant()`],
  [APPLICATIONS, "esignature_applications_append_only", `TRIGGER esignature_applications_append_only BEFORE UPDATE OR DELETE ON ${APPLICATIONS} FOR EACH ROW EXECUTE FUNCTION esignature_applications_append_only()`],
  [APPLICATIONS, "esignature_applications_no_truncate", `TRIGGER esignature_applications_no_truncate BEFORE TRUNCATE ON ${APPLICATIONS} FOR EACH STATEMENT EXECUTE FUNCTION esignature_applications_append_only()`],
  [APPLICATIONS, "esignature_applications_signable", `TRIGGER esignature_applications_signable BEFORE INSERT ON ${APPLICATIONS} FOR EACH ROW EXECUTE FUNCTION esignature_applications_signable()`],
]);

/** The application role's privileges, per table: [table, granted, revoked]. */
const GRANTS: readonly (readonly [table: string, granted: string, revoked: string])[] = Object.freeze([
  [ESIGNATURES, "SELECT, INSERT, UPDATE (status, superseded_at, revoked_at, revoked_reason)", "DELETE, TRUNCATE"],
  [APPLICATIONS, "SELECT, INSERT", "UPDATE, DELETE, TRUNCATE"],
]);

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  const role = appRoleName("0149");
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await requireTables(sequelize, transaction, "0149", PREREQUISITES);
    if (!(await roleExists(sequelize, transaction, role))) {
      throw new Error(
        `0149: the application role "${role}" does not exist. Migration 0057 creates it; ` +
          "run the migrations in order, or create it as an administrator (see 0057).",
      );
    }

    // 1. The tables (sync() made them on a database that never had them), in dependency order.
    for (const [table, columns] of [[ESIGNATURES, ESIGNATURE_COLUMNS], [APPLICATIONS, APPLICATION_COLUMNS]] as const) {
      if (!(await tableExists(sequelize, transaction, table))) {
        await context.createTable(table, { ...columns }, { transaction });
      }
      await run(sequelize, transaction, `ALTER TABLE ${table} ALTER COLUMN created_at SET DEFAULT now()`);
    }

    // 2. CHECKs.
    for (const [table, name, predicate] of CHECKS) {
      if (!(await constraintNames(sequelize, transaction, table)).has(name)) {
        await run(sequelize, transaction, `ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${predicate})`);
      }
    }

    // 3. Indexes.
    for (const statement of INDEX_SQL) {
      await run(sequelize, transaction, statement);
    }

    // 4. Functions, then the triggers.
    for (const [, statement] of FUNCTIONS) {
      await run(sequelize, transaction, statement);
    }
    for (const [table, name, definition] of TRIGGERS) {
      await createAlwaysTrigger(sequelize, transaction, table, name, definition);
    }

    // 5. Grants (a column-level UPDATE: first take away any table-level one).
    for (const [table, granted, revoked] of GRANTS) {
      await run(sequelize, transaction, `REVOKE UPDATE ON ${table} FROM ${role}`);
      await run(sequelize, transaction, `GRANT ${granted} ON ${table} TO ${role}`);
      await run(sequelize, transaction, `REVOKE ${revoked} ON ${table} FROM ${role}`);
    }
  });
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    for (const table of [APPLICATIONS, ESIGNATURES]) {
      if (await tableExists(sequelize, transaction, table)) {
        const [row] = await rows(sequelize, transaction, `SELECT count(*)::int AS n FROM ${table}`);
        const n = Number(row?.["n"]);
        if (n > 0) {
          throw new Error(
            `0149 down: ${table} holds ${String(n)} row(s). An application is a Part 11 record and a key is what verifies it; ` +
              "restore the pre-upgrade backup instead (ADR-116). Nothing was changed.",
          );
        }
      }
    }
    await run(sequelize, transaction, `DROP TABLE IF EXISTS ${APPLICATIONS}`);
    await run(sequelize, transaction, `DROP TABLE IF EXISTS ${ESIGNATURES}`);
    for (const [name] of FUNCTIONS) {
      await run(sequelize, transaction, `DROP FUNCTION IF EXISTS ${name}()`);
    }
  });
};

export = {
  ESIGNATURES,
  APPLICATIONS,
  ESIGNATURE_COLUMNS,
  APPLICATION_COLUMNS,
  CHECKS,
  INDEX_NAMES,
  INDEX_SQL,
  FUNCTIONS,
  TRIGGERS,
  GRANTS,
  up,
  down,
};
