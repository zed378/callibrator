/**
 * Migration 0127 — the IPM aggregate's immutability, in the database, for every role (P20-05;
 * ADR-126 § 5 and Amendments 1 § 3, 2 § 5; spec MEMORY/specs/P19-02-ipm-session-aggregate.md
 * § 5.1 – § 5.3 and MEMORY/specs/P19-06-ipm-report-document.md § 4.2). The 0057 pattern: BEFORE
 * row triggers and a statement-level TRUNCATE trigger, ENABLE ALWAYS (they fire under
 * `session_replication_role = replica` too, the 0091 rule), ERRCODE 42501 naming the row.
 *
 *  - `inspection_sessions_append_only` (+ `_no_truncate`): DELETE and TRUNCATE refused; `id`,
 *    `tenant_id`, `device_id`, `created_by`, `supersedes_id`, `client_ref`, `legacy_key`,
 *    `received_at`, `created_at` never change; a DRAFT may change anything else and move only to
 *    `submitted` or `discarded` (a correction's submit must carry its original's visit number);
 *    after the draft ends only the lifecycle columns (`superseded_by_id`, `superseded_at`,
 *    `status`, `void_reason`, `voided_by`, `voided_at`, `updated_at`, `updated_by`) change, each
 *    once, `status` only `submitted → voided`; `voided` and `discarded` are final.
 *  - `inspection_results_draft_only` (+ `_no_truncate`): INSERT, UPDATE and DELETE refused unless
 *    the session — read FOR SHARE, so a write racing a submit waits for it and is then refused — is
 *    a draft; a result never changes session; a row with neither a template item nor `is_ad_hoc`
 *    only on imported history (the session's `legacy_key`).
 *  - `inspection_sessions_correction_same_device` (BEFORE INSERT): a correction names a session of
 *    its own tenant and device — the linear chain stays on one instrument.
 *  - `inspection_session_signatures_append_only` (+ `_no_truncate`): UPDATE, DELETE, TRUNCATE
 *    refused; INSERT only on a submitted, effective, captured session whose stored content hash
 *    the row carries; a countersignature only after the performer's and never by the submitter or
 *    the performer (P19-06 § 4.2).
 *
 * THE ONE EXCEPTION, in every one of them (ADR-124 Am. 2 § 2, P19-04 § 5.4, G-S7): a change of
 * `client_facility_id` alone, admitted by `facility_move_admits` (0117) for the row's device (a
 * result's and a signature's: its session's) — the ON UPDATE CASCADE of a device move. 0126's
 * `<table>_facility_guard` checks the same, the second layer.
 *
 * Idempotent (CREATE OR REPLACE; createAlwaysTrigger drops first). Throws when 0126's tables or
 * 0117's move check are absent (PR-5). No try/catch. `down` drops the triggers and functions —
 * it removes a guarantee, never data. Verify with psql, as the application role AND the owner:
 *   UPDATE inspection_sessions SET notes = 'x' WHERE status = 'submitted';   -- 42501
 */
import type { QueryInterface } from "sequelize";
import { LOCK_TIMEOUT, createAlwaysTrigger, functionExists, requireTables, run, tableExists } from "./facilityMigration.shared";

const SESSIONS = "inspection_sessions";
const RESULTS = "inspection_results";
const SIGNATURES = "inspection_session_signatures";

/** The columns a session's lifecycle changes after its draft ends (spec § 5.1), each once. */
const LIFECYCLE_COLUMNS = Object.freeze([
  "superseded_by_id",
  "superseded_at",
  "status",
  "void_reason",
  "voided_by",
  "voided_at",
  "updated_at",
  "updated_by",
]);

/** The columns that never change, draft or not (spec § 5.1). */
const IDENTITY_COLUMNS = Object.freeze([
  "id",
  "tenant_id",
  "device_id",
  "created_by",
  "supersedes_id",
  "client_ref",
  "legacy_key",
  "received_at",
  "created_at",
]);

const textArray = (values: readonly string[]): string => `ARRAY[${values.map((v) => `'${v}'`).join(", ")}]::text[]`;

const MOVE_HINT = "A device move (POST /calibration-devices/:id/move) carries the facility; nothing else changes it (ADR-124 Am. 2 § 2).";

/** [function name, CREATE OR REPLACE statement], in creation order. */
const FUNCTIONS: readonly (readonly [name: string, sql: string])[] = Object.freeze([
  [
    "inspection_sessions_append_only",
    `
CREATE OR REPLACE FUNCTION inspection_sessions_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  lifecycle CONSTANT text[] := ${textArray(LIFECYCLE_COLUMNS)};
  fixed CONSTANT text[] := ${textArray(IDENTITY_COLUMNS)};
  c text;
  v_original integer;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'inspection_sessions is append-only: TRUNCATE is refused'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'inspection_sessions is append-only: IPM session % cannot be deleted', OLD.id
      USING ERRCODE = '42501',
            HINT = 'Discard a draft or void a submitted IPM; nothing is deleted (ADR-126 § 3).';
  END IF;
  -- The facility column: only the cascade of a device move (P19-04 § 5.4; 0126's guard checks it too).
  IF NEW.client_facility_id IS DISTINCT FROM OLD.client_facility_id
     AND NOT facility_move_admits(NEW.tenant_id, NEW.device_id, OLD.client_facility_id, NEW.client_facility_id) THEN
    RAISE EXCEPTION 'inspection_sessions: the client facility of IPM session % is changed only by an audited device move', OLD.id
      USING ERRCODE = '42501', HINT = '${MOVE_HINT}';
  END IF;
  FOREACH c IN ARRAY fixed LOOP
    IF (to_jsonb(NEW) -> c) IS DISTINCT FROM (to_jsonb(OLD) -> c) THEN
      RAISE EXCEPTION 'inspection_sessions: % of IPM session % never changes', c, OLD.id
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  IF OLD.status::text = 'draft' THEN
    IF NEW.status::text NOT IN ('draft', 'submitted', 'discarded') THEN
      RAISE EXCEPTION 'inspection_sessions: draft % may be submitted or discarded, never %', OLD.id, NEW.status
        USING ERRCODE = '42501',
              HINT = 'Discard a draft instead of voiding it (P19-02 § 7.2).';
    END IF;
    IF NEW.status::text = 'submitted' AND NEW.supersedes_id IS NOT NULL THEN
      SELECT o.visit_number INTO v_original FROM inspection_sessions o WHERE o.id = NEW.supersedes_id;
      IF NEW.visit_number IS DISTINCT FROM v_original THEN
        RAISE EXCEPTION 'inspection_sessions: correction % must carry the visit number of the session it corrects (%), not %',
          OLD.id, v_original, NEW.visit_number
          USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status::text IN ('voided', 'discarded') THEN
    IF (to_jsonb(NEW) - 'client_facility_id') IS DISTINCT FROM (to_jsonb(OLD) - 'client_facility_id') THEN
      RAISE EXCEPTION 'inspection_sessions: IPM session % is % — final', OLD.id, OLD.status
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- submitted: only the lifecycle, each column once; status only to voided.
  IF (to_jsonb(NEW) - lifecycle - 'client_facility_id') IS DISTINCT FROM (to_jsonb(OLD) - lifecycle - 'client_facility_id') THEN
    RAISE EXCEPTION 'inspection_sessions is append-only: the content of submitted IPM session % cannot be changed', OLD.id
      USING ERRCODE = '42501',
            HINT = 'Correct it (a new draft superseding it) or void it (P19-02 § 7.2).';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text <> 'voided' THEN
    RAISE EXCEPTION 'inspection_sessions: submitted IPM session % may only be voided, not set %', OLD.id, NEW.status
      USING ERRCODE = '42501';
  END IF;
  IF (OLD.superseded_by_id IS NOT NULL AND NEW.superseded_by_id IS DISTINCT FROM OLD.superseded_by_id)
     OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at)
     OR (OLD.void_reason IS NOT NULL AND NEW.void_reason IS DISTINCT FROM OLD.void_reason)
     OR (OLD.voided_by IS NOT NULL AND NEW.voided_by IS DISTINCT FROM OLD.voided_by)
     OR (OLD.voided_at IS NOT NULL AND NEW.voided_at IS DISTINCT FROM OLD.voided_at) THEN
    RAISE EXCEPTION 'inspection_sessions: a supersession or void of IPM session % is set once and final', OLD.id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$`,
  ],
  [
    "inspection_results_draft_only",
    `
CREATE OR REPLACE FUNCTION inspection_results_draft_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_session uuid;
  v_tenant uuid;
  v_status text;
  v_device uuid;
  v_legacy text;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'inspection_results: TRUNCATE is refused'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    v_session := OLD.session_id;
    v_tenant := OLD.tenant_id;
  ELSE
    v_session := NEW.session_id;
    v_tenant := NEW.tenant_id;
  END IF;
  -- FOR SHARE: a write racing a submit waits for it, then reads 'submitted' and is refused.
  SELECT s.status::text, s.device_id, s.legacy_key INTO v_status, v_device, v_legacy
    FROM inspection_sessions s WHERE s.id = v_session AND s.tenant_id = v_tenant FOR SHARE;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.session_id IS DISTINCT FROM OLD.session_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'inspection_results: result % never changes session', OLD.id
        USING ERRCODE = '42501';
    END IF;
    -- The cascade of a device move through the session: the facility column alone.
    IF NEW.client_facility_id IS DISTINCT FROM OLD.client_facility_id
       AND (to_jsonb(NEW) - 'client_facility_id' - 'updated_at') = (to_jsonb(OLD) - 'client_facility_id' - 'updated_at')
       AND facility_move_admits(NEW.tenant_id, v_device, OLD.client_facility_id, NEW.client_facility_id) THEN
      RETURN NEW;
    END IF;
  END IF;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'inspection_results: the results of IPM session % are written only while it is a draft (it is %)',
      v_session, coalesce(v_status, 'absent')
      USING ERRCODE = '42501',
            HINT = 'Correct the IPM (a new draft with its results copied); a submitted record never changes (ADR-126 § 5).';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.template_item_id IS NULL AND NOT NEW.is_ad_hoc AND v_legacy IS NULL THEN
    RAISE EXCEPTION 'inspection_results: a result without a template item is an ad-hoc row or imported history (session %)', v_session
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$`,
  ],
  [
    "inspection_sessions_correction_same_device",
    `
CREATE OR REPLACE FUNCTION inspection_sessions_correction_same_device() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM inspection_sessions o
        WHERE o.id = NEW.supersedes_id AND o.tenant_id = NEW.tenant_id AND o.device_id = NEW.device_id) THEN
    RAISE EXCEPTION 'inspection_sessions: correction % must correct a session of its own tenant and device', NEW.id
      USING ERRCODE = '23514',
            HINT = 'A correction stays on the instrument of the visit it corrects (P19-02 § 5.3).';
  END IF;
  RETURN NEW;
END
$fn$`,
  ],
  [
    "inspection_session_signatures_append_only",
    `
CREATE OR REPLACE FUNCTION inspection_session_signatures_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_status text;
  v_superseded uuid;
  v_legacy text;
  v_hash text;
  v_submitter uuid;
  v_device uuid;
  v_performer uuid;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'inspection_session_signatures is append-only: TRUNCATE is refused'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'inspection_session_signatures is append-only: signature % cannot be deleted', OLD.id
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT x.device_id INTO v_device FROM inspection_sessions x WHERE x.id = NEW.session_id AND x.tenant_id = NEW.tenant_id;
    IF NEW.client_facility_id IS DISTINCT FROM OLD.client_facility_id
       AND (to_jsonb(NEW) - 'client_facility_id') = (to_jsonb(OLD) - 'client_facility_id')
       AND facility_move_admits(NEW.tenant_id, v_device, OLD.client_facility_id, NEW.client_facility_id) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'inspection_session_signatures is append-only: signature % cannot be changed', OLD.id
      USING ERRCODE = '42501',
            HINT = '${MOVE_HINT}';
  END IF;
  SELECT x.status::text, x.superseded_by_id, x.legacy_key, x.report_content_hash, x.submitted_by
    INTO v_status, v_superseded, v_legacy, v_hash, v_submitter
    FROM inspection_sessions x WHERE x.id = NEW.session_id AND x.tenant_id = NEW.tenant_id FOR SHARE;
  IF v_status IS DISTINCT FROM 'submitted' OR v_superseded IS NOT NULL OR v_legacy IS NOT NULL THEN
    RAISE EXCEPTION 'inspection_session_signatures: only a submitted, effective, captured IPM report is signed (session %)', NEW.session_id
      USING ERRCODE = '42501';
  END IF;
  IF NEW.document_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'inspection_session_signatures: the signed hash is not the stored content hash of session %', NEW.session_id
      USING ERRCODE = '42501',
            HINT = 'A signature binds exactly the report that was issued (P19-06 § 7.4).';
  END IF;
  IF NEW.kind::text = 'countersign' THEN
    SELECT p.signer_id INTO v_performer FROM inspection_session_signatures p
     WHERE p.session_id = NEW.session_id AND p.kind::text = 'performer';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'inspection_session_signatures: session % is countersigned only after its performer signed', NEW.session_id
        USING ERRCODE = '42501';
    END IF;
    IF NEW.signer_id = v_submitter OR NEW.signer_id = v_performer THEN
      RAISE EXCEPTION 'inspection_session_signatures: the countersigner of session % is never its submitter or performer', NEW.session_id
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$`,
  ],
]);

/** Every trigger `up` creates: [table, name, definition after CREATE]. ENABLE ALWAYS each. */
const TRIGGERS: readonly (readonly [table: string, name: string, definition: string])[] = Object.freeze([
  [
    SESSIONS,
    "inspection_sessions_append_only",
    `TRIGGER inspection_sessions_append_only BEFORE UPDATE OR DELETE ON ${SESSIONS} FOR EACH ROW EXECUTE FUNCTION inspection_sessions_append_only()`,
  ],
  [
    SESSIONS,
    "inspection_sessions_no_truncate",
    `TRIGGER inspection_sessions_no_truncate BEFORE TRUNCATE ON ${SESSIONS} FOR EACH STATEMENT EXECUTE FUNCTION inspection_sessions_append_only()`,
  ],
  [
    SESSIONS,
    "inspection_sessions_correction_same_device",
    `TRIGGER inspection_sessions_correction_same_device BEFORE INSERT ON ${SESSIONS} FOR EACH ROW EXECUTE FUNCTION inspection_sessions_correction_same_device()`,
  ],
  [
    RESULTS,
    "inspection_results_draft_only",
    `TRIGGER inspection_results_draft_only BEFORE INSERT OR UPDATE OR DELETE ON ${RESULTS} FOR EACH ROW EXECUTE FUNCTION inspection_results_draft_only()`,
  ],
  [
    RESULTS,
    "inspection_results_no_truncate",
    `TRIGGER inspection_results_no_truncate BEFORE TRUNCATE ON ${RESULTS} FOR EACH STATEMENT EXECUTE FUNCTION inspection_results_draft_only()`,
  ],
  [
    SIGNATURES,
    "inspection_session_signatures_append_only",
    `TRIGGER inspection_session_signatures_append_only BEFORE INSERT OR UPDATE OR DELETE ON ${SIGNATURES} ` +
      "FOR EACH ROW EXECUTE FUNCTION inspection_session_signatures_append_only()",
  ],
  [
    SIGNATURES,
    "inspection_session_signatures_no_truncate",
    `TRIGGER inspection_session_signatures_no_truncate BEFORE TRUNCATE ON ${SIGNATURES} ` +
      "FOR EACH STATEMENT EXECUTE FUNCTION inspection_session_signatures_append_only()",
  ],
]);

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await requireTables(sequelize, transaction, "0127", [SESSIONS, RESULTS, SIGNATURES]);
    if (!(await functionExists(sequelize, transaction, "facility_move_admits"))) {
      throw new Error("0127: function facility_move_admits() does not exist — migration 0117 must run first.");
    }
    for (const [, statement] of FUNCTIONS) {
      await run(sequelize, transaction, statement);
    }
    for (const [table, name, definition] of TRIGGERS) {
      await createAlwaysTrigger(sequelize, transaction, table, name, definition);
    }
  });
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    // The triggers first (a function with a dependent trigger cannot be dropped); a table 0126's
    // down already removed takes its triggers with it.
    for (const [table, name] of TRIGGERS) {
      if (await tableExists(sequelize, transaction, table)) {
        await run(sequelize, transaction, `DROP TRIGGER IF EXISTS ${name} ON ${table}`);
      }
    }
    for (const [name] of FUNCTIONS) {
      await run(sequelize, transaction, `DROP FUNCTION IF EXISTS ${name}()`);
    }
  });
};

export = {
  SESSIONS,
  RESULTS,
  SIGNATURES,
  LIFECYCLE_COLUMNS,
  IDENTITY_COLUMNS,
  FUNCTIONS,
  TRIGGERS,
  up,
  down,
};
