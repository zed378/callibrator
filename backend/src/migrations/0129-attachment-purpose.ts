/**
 * Migration 0129 — `attachments.purpose` and the IPM attachment type (P20-08; ADR-132 § 6,
 * ADR-126 Am. 1; specs MEMORY/specs/P19-03-device-extensions.md § 7.1 and
 * MEMORY/specs/P19-02-ipm-session-aggregate.md § 12; AM-7).
 *
 * WHAT THIS DOES, in ONE transaction
 *
 *  1. `attachments.purpose` VARCHAR(32) NULL (db.sync() builds it on a fresh database), with the
 *     CHECKs `attachments_purpose_values` (one of the contract's ATTACHMENT_PURPOSES) and
 *     `attachments_purpose_resource` (a device_* purpose only on a device, `ipm_evidence` only on
 *     an IPM session), and the partial UNIQUE `attachments_one_live_device_photo`: one live front
 *     and one live serial-plate photo per device. No `folder` value is involved (G-D4).
 *  2. `inspectionsession` becomes a facility-scoped attachment type:
 *       - 0123's CHECK `attachments_facility_kind` is replaced with the widened list;
 *       - 0117's `facility_resource_device()` / `facility_resource_facility()` gain an
 *         `inspectionsession` branch (the session's device / facility, soft-deleted rows included);
 *       - 0126's `facility_insert_default()` and 0123's `attachments_facility_matches_resource()`
 *         read the widened list.
 *     Every other byte of each function is its previous migration's text — tests/migrations/0129
 *     proves it by removing the branch or narrowing the list again.
 *  3. `inspection_sessions_attachments_follow_facility` — AM-7's second trigger on the new resource
 *     table (a DEFERRED constraint trigger, ENABLE ALWAYS): a session whose facility changed (a
 *     device move's cascade) leaves no photo behind at commit.
 *
 * FACILITY_ATTACHMENT_TYPES (facilityMigration.shared) is NOT changed: it is frozen with 0117 –
 * 0123, and what they re-run must stay what they ran. The widened list is this migration's own.
 *
 * Throws, never skips, when a prerequisite is absent (PR-5); no try/catch.
 *
 * `down` REFUSES while any attachment has a purpose or is linked to an IPM session; otherwise it
 * drops what `up` made and restores the four functions and the CHECK exactly as 0117 / 0123 / 0126
 * left them.
 */
import { ATTACHMENT_PURPOSES, SINGLE_DEVICE_PHOTO_PURPOSES } from "@callibrator/contracts/deviceValues";
import type { QueryInterface, Sequelize, Transaction } from "sequelize";
import {
  FACILITY_ATTACHMENT_TYPES,
  LOCK_TIMEOUT,
  columnExists,
  constraintNames,
  createAlwaysTrigger,
  requireFacilityFoundation,
  requireTables,
  rows,
  run,
  sqlList,
} from "./facilityMigration.shared";
import m0117 from "./0117-client-facilities";
import m0123 from "./0123-facility-nullable";
import m0126 from "./0126-ipm-sessions";

const ATTACHMENTS = "attachments";
const SESSIONS = "inspection_sessions";

/** The attachment type of an IPM session (lower-cased, as every list here). */
const IPM_TYPE = "inspectionsession";

/** 0117 – 0123's facility-scoped attachment types, and this migration's: the same plus the IPM session. */
const OLD_TYPES = sqlList(FACILITY_ATTACHMENT_TYPES);
const NEW_TYPES = sqlList([...FACILITY_ATTACHMENT_TYPES, IPM_TYPE]);

/** 0123's CHECK, and the widened one (the same predicate over the widened list). */
const FACILITY_KIND = "attachments_facility_kind";
const facilityKindPredicate = (types: string): string =>
  `(client_facility_id IS NOT NULL) = (resource_id IS NOT NULL AND lower(resource_type) IN (${types}))`;

/** The purposes of a device photo (spec § 7.1: `device_%`), from the contract's list. */
const DEVICE_PURPOSES = Object.freeze(ATTACHMENT_PURPOSES.filter((p) => p.startsWith("device_")));

/** CHECK name -> predicate, on attachments. */
const CHECKS: Readonly<Record<string, string>> = Object.freeze({
  attachments_purpose_values: `purpose IS NULL OR purpose IN (${sqlList(ATTACHMENT_PURPOSES)})`,
  attachments_purpose_resource:
    `purpose IS NULL OR (purpose IN (${sqlList(DEVICE_PURPOSES)}) AND lower(resource_type) IN ('device', 'calibrationdevice')) ` +
    `OR (purpose = 'ipm_evidence' AND lower(resource_type) = '${IPM_TYPE}')`,
});

const INDEX_SQL = Object.freeze([
  `CREATE UNIQUE INDEX IF NOT EXISTS attachments_one_live_device_photo ON ${ATTACHMENTS} (tenant_id, resource_id, purpose) ` +
    `WHERE purpose IN (${sqlList(SINGLE_DEVICE_PHOTO_PURPOSES)}) AND is_deleted = false`,
]);
const INDEX_NAMES = Object.freeze(["attachments_one_live_device_photo"]);

/** A function's text as an earlier migration defined it. */
const earlier = (functions: readonly (readonly string[])[], name: string, tag: string): string => {
  const found = functions.find((f) => f[0] === name);
  if (!found) {
    throw new Error(`0129: migration ${tag} defines no function ${name}`);
  }
  return found[found.length - 1] ?? "";
};

/** Insert `branch` before `anchor` in `text`, which must hold the anchor exactly once. */
const withBranch = (name: string, text: string, anchor: string, branch: string): string => {
  const at = text.indexOf(anchor);
  if (at < 0 || text.includes(anchor, at + 1)) {
    throw new Error(`0129: ${name}() does not hold its anchor exactly once`);
  }
  return text.slice(0, at) + branch + text.slice(at);
};

/** Replace the one occurrence of the old type list in `text` with the widened one. */
const widened = (name: string, text: string): string => {
  const list = `IN (${OLD_TYPES})`;
  const at = text.indexOf(list);
  if (at < 0 || text.includes(list, at + 1)) {
    throw new Error(`0129: ${name}() does not hold the attachment type list exactly once`);
  }
  return text.slice(0, at) + `IN (${NEW_TYPES})` + text.slice(at + list.length);
};

/** The CASE fall-through of both resource functions: the new branch goes before it. */
const RESOURCE_ANCHOR = "    ELSE\n      v := NULL;\n";

const RESOURCE_DEVICE_BRANCH = `    WHEN '${IPM_TYPE}' THEN
      -- P20-08 (P19-02 § 12): an IPM photo's device is its session's.
      SELECT s.device_id INTO v FROM ${SESSIONS} s WHERE s.id = p_id AND s.tenant_id = p_tenant;
`;
const RESOURCE_FACILITY_BRANCH = `    WHEN '${IPM_TYPE}' THEN
      -- P20-08 (P19-02 § 12): an IPM photo's facility is its session's.
      SELECT s.client_facility_id INTO v FROM ${SESSIONS} s WHERE s.id = p_id AND s.tenant_id = p_tenant;
`;

/** The four functions as their previous migration left them (name -> SQL): what `down` restores. */
const PREVIOUS: Readonly<Record<string, string>> = Object.freeze({
  facility_resource_device: earlier(m0117.FUNCTIONS, "facility_resource_device", "0117"),
  facility_resource_facility: earlier(m0117.FUNCTIONS, "facility_resource_facility", "0117"),
  facility_insert_default: earlier(m0126.FUNCTIONS, "facility_insert_default", "0126"),
  attachments_facility_matches_resource: earlier(m0123.FUNCTIONS, "attachments_facility_matches_resource", "0123"),
});

const previous = (name: string): string => PREVIOUS[name] ?? "";

/** The four functions as this migration defines them. */
const FUNCTIONS: readonly (readonly [name: string, sql: string])[] = Object.freeze([
  [
    "facility_resource_device",
    withBranch("facility_resource_device", previous("facility_resource_device"), RESOURCE_ANCHOR, RESOURCE_DEVICE_BRANCH),
  ],
  [
    "facility_resource_facility",
    withBranch("facility_resource_facility", previous("facility_resource_facility"), RESOURCE_ANCHOR, RESOURCE_FACILITY_BRANCH),
  ],
  ["facility_insert_default", widened("facility_insert_default", previous("facility_insert_default"))],
  ["attachments_facility_matches_resource", widened("attachments_facility_matches_resource", previous("attachments_facility_matches_resource"))],
]);

/** AM-7's second trigger on the IPM session table. */
const FOLLOW_TRIGGER = `${SESSIONS}_attachments_follow_facility`;
const FOLLOW_TRIGGER_SQL =
  `CONSTRAINT TRIGGER ${FOLLOW_TRIGGER} AFTER UPDATE OF client_facility_id ON ${SESSIONS} ` +
  `DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION facility_attachments_follow('${IPM_TYPE}')`;

const replaceFacilityKind = async (sequelize: Sequelize, transaction: Transaction, types: string): Promise<void> => {
  await run(sequelize, transaction, `ALTER TABLE ${ATTACHMENTS} DROP CONSTRAINT IF EXISTS ${FACILITY_KIND}`);
  await run(sequelize, transaction, `ALTER TABLE ${ATTACHMENTS} ADD CONSTRAINT ${FACILITY_KIND} CHECK (${facilityKindPredicate(types)})`);
};

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await requireTables(sequelize, transaction, "0129", [ATTACHMENTS, SESSIONS]);
    await requireFacilityFoundation(sequelize, transaction, "0129");
    if (!(await columnExists(sequelize, transaction, ATTACHMENTS, "client_facility_id"))) {
      throw new Error("0129: attachments.client_facility_id does not exist — migration 0123 must run first.");
    }
    if (!(await columnExists(sequelize, transaction, SESSIONS, "client_facility_id"))) {
      throw new Error("0129: inspection_sessions.client_facility_id does not exist — migration 0126 must run first.");
    }

    // 1. The purpose.
    if (!(await columnExists(sequelize, transaction, ATTACHMENTS, "purpose"))) {
      await run(sequelize, transaction, `ALTER TABLE ${ATTACHMENTS} ADD COLUMN purpose VARCHAR(32)`);
    }
    const own = await constraintNames(sequelize, transaction, ATTACHMENTS);
    for (const [name, predicate] of Object.entries(CHECKS)) {
      if (!own.has(name)) {
        await run(sequelize, transaction, `ALTER TABLE ${ATTACHMENTS} ADD CONSTRAINT ${name} CHECK (${predicate})`);
      }
    }
    for (const statement of INDEX_SQL) {
      await run(sequelize, transaction, statement);
    }

    // 2. The IPM type: the functions first (the CHECK's rows are filled by them), then the CHECK.
    for (const [, statement] of FUNCTIONS) {
      await run(sequelize, transaction, statement);
    }
    await replaceFacilityKind(sequelize, transaction, NEW_TYPES);

    // 3. AM-7 on the session table.
    await createAlwaysTrigger(sequelize, transaction, SESSIONS, FOLLOW_TRIGGER, FOLLOW_TRIGGER_SQL);
  });
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    if (await columnExists(sequelize, transaction, ATTACHMENTS, "purpose")) {
      const [row] = await rows(
        sequelize,
        transaction,
        `SELECT count(*)::int AS n FROM ${ATTACHMENTS} WHERE purpose IS NOT NULL OR lower(resource_type) = '${IPM_TYPE}'`,
      );
      const n = Number(row?.["n"]);
      if (n > 0) {
        throw new Error(
          `0129 down: the database holds ${String(n)} attachment(s) with a purpose or linked to an IPM session. ` +
            "Reverting would destroy what they are; restore the pre-upgrade backup instead (ADR-116). Nothing was changed.",
        );
      }
    }
    await run(sequelize, transaction, `DROP TRIGGER IF EXISTS ${FOLLOW_TRIGGER} ON ${SESSIONS}`);
    await replaceFacilityKind(sequelize, transaction, OLD_TYPES);
    for (const [name] of FUNCTIONS) {
      await run(sequelize, transaction, previous(name));
    }
    for (const name of INDEX_NAMES) {
      await run(sequelize, transaction, `DROP INDEX IF EXISTS ${name}`);
    }
    // The purpose CHECKs go with the column.
    await run(sequelize, transaction, `ALTER TABLE ${ATTACHMENTS} DROP COLUMN IF EXISTS purpose`);
  });
};

export = {
  IPM_TYPE,
  DEVICE_PURPOSES,
  OLD_TYPES,
  NEW_TYPES,
  FACILITY_KIND,
  facilityKindPredicate,
  CHECKS,
  INDEX_SQL,
  INDEX_NAMES,
  PREVIOUS,
  FUNCTIONS,
  RESOURCE_DEVICE_BRANCH,
  RESOURCE_FACILITY_BRANCH,
  FOLLOW_TRIGGER,
  FOLLOW_TRIGGER_SQL,
  up,
  down,
};
