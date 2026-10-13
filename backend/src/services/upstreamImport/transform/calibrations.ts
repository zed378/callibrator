/**
 * Step 10 of the transform (P24-02f; ADR-129 Am. 8; P19-05 spec § 9.1, § 9.2; ADR-133 Am. 4; 04 § 4.7;
 * 05 § 3.1 step 10): `trx_kalibrasi` → `calibration_records`, each an `external_date` record of its
 * device in the provider tenant.
 *
 *  - the device from `id_inventory` (step 8); none → `no_device`; the record's facility is the
 *    device's;
 *  - `calibration_date` = `tanggal_kalibrasi` at 00:00 in the source zone (UD-7); not a real day →
 *    `value_out_of_range`; after today in that zone → `future_calibration_date` (an append-only row
 *    cannot be fixed by an UPDATE);
 *  - the actor (0105: exactly one): `performed_by` = the imported user the upstream `id_user` maps to,
 *    with their snapshot; a mapping that names nobody of the tenant any more → `performer_not_found`
 *    (ADR-133 Am. 4: never the key in their place); a departed user → the tenant's import key
 *    (`api_key_id`) with "Former upstream user #<n>" (numbered once, people.ts); no `id_user` → the key
 *    with "Upstream import" (`role: import`, the tenant's name). Every snapshot says
 *    `source: "upstream-import"`, which is what admits an `external_date` row without a laboratory
 *    (CHECK `calibration_records_external_has_lab`): no laboratory is inferred;
 *  - `nama_ruangan` → `room_snapshot`; no result, standard, uncertainty, certificate or due date.
 * A row that needs the key while the tenant has no usable one fails the transform
 * `IMPORT_KEY_MISSING`: the operator provisions it before loading calibration dates (§ 9.2).
 *
 * RE-RUNS. `calibration_records` is append-only (0057): an unchanged row is skipped; a changed one
 * is CORRECTED — a new record `supersedes_id` the old one (with a correction reason) and the old one
 * gets `superseded_by_id` / `superseded_at`, the only change the trigger allows. A record the
 * operator already voided or corrected is left alone. This step writes its own audit rows
 * (`STEP_AUDITED`): CREATE per new record and, for a correction, UPDATE of the record it supersedes —
 * never a legacy id or a value (07 § 3).
 */
import { randomUUID } from "crypto";
import { sql } from "../../../utils/sql.util";
import { IMPORT_KEY_NAME } from "../../../constants/upstreamImportKey";
import { NULL_USER_PERFORMER, usableImportKey } from "../importKey";
import { RESOURCE_TYPES } from "./auditRows";
import { cleanText } from "./catalogue";
import { textOf } from "./inventory";
import { classifiedSql, quarantineRows, recordMappings, stagedTable, stagedTableExists, type Mapping, type QuarantineEntry } from "./ledger";
import { formerSnapshot, formerUsersOf, mappedTargets, numberFormerUsers, peopleOf, recordFormerUsers, type PersonSnapshotValue } from "./people";
import { TransformFailure } from "./failure";
import type { StepContext, TransformSource } from "./steps";

type Decision = "new" | "unchanged" | "changed";

/** `trx_kalibrasi`, keyed by its id. */
export const CALIBRATION_SOURCE: TransformSource = Object.freeze({ table: "trx_kalibrasi", legacyId: 's."id"::text' });

/** Why an imported record corrects the one it supersedes (0057: a correction names a reason). */
export const IMPORT_CORRECTION_REASON = "The upstream calibration date changed; re-imported (ADR-129).";

const ROOM_MAX = 255;

/** A staged calibration row: its classification, its columns, and its earlier record. */
export interface StagedCalibrationRow {
  sourceRowNumber: string;
  legacyId: string;
  rowHash: string;
  targetId: string | null;
  decision: Decision;
  targetPresent: boolean;
  /** The earlier record was voided or corrected (by the operator, or an earlier run). */
  targetClosed: boolean;
  row: Readonly<Record<string, unknown>>;
}

/** A snapshot of an imported record's performer (jsonShape `calibrationPerformerSnapshot`). */
export type CalibrationSnapshot = PersonSnapshotValue & { source: "upstream-import" };

/** What the calibration plan reads. */
export interface CalibrationInput {
  rows: readonly StagedCalibrationRow[];
  tenantId: string;
  tenantName: string | null;
  /** Today in the source zone (`YYYY-MM-DD`). */
  today: string;
  /** `trx_inventory` legacy id → the device and its facility. */
  devices: ReadonlyMap<string, { id: string; facilityId: string }>;
  /** `users` legacy id → the imported user and their snapshot. */
  users: ReadonlyMap<string, { id: string; snapshot: PersonSnapshotValue }>;
  /** `users` legacy ids whose mapping names nobody of the tenant any more. */
  unmatched: ReadonlySet<string>;
  formerUsers: ReadonlyMap<string, number>;
  /** The tenant's usable import key, if any. */
  keyId: string | null;
  newId: () => string;
}

/** One record the step writes. */
export interface RecordValues {
  id: string;
  sourceRowNumber: string;
  deviceId: string;
  facilityId: string;
  calibrationDate: string;
  performedBy: string | null;
  apiKeyId: string | null;
  roomSnapshot: string | null;
  performerSnapshot: CalibrationSnapshot;
  /** The record this one corrects (a changed upstream row), else null. */
  supersedesId: string | null;
}

/** What the calibration plan writes. */
export interface CalibrationPlan {
  insert: RecordValues[];
  formerUsers: { legacyId: string; number: number }[];
  mappings: Mapping[];
  quarantine: QuarantineEntry[];
  /** Rows that need the import key while the tenant has none (the transform fails). */
  needsKey: number;
}

/** A real calendar day `YYYY-MM-DD` (a timestamp keeps its day), else null. */
export const calendarDayOf = (raw: string | null): string | null => {
  const day = (raw ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return null;
  }
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day ? day : null;
};

const byLegacyId = (a: StagedCalibrationRow, b: StagedCalibrationRow): number => Number(a.legacyId) - Number(b.legacyId) || a.legacyId.localeCompare(b.legacyId);

/**
 * Decide every staged calibration row. Pure.
 */
export const planCalibrations = (input: CalibrationInput): CalibrationPlan => {
  const plan: CalibrationPlan = { insert: [], formerUsers: [], mappings: [], quarantine: [], needsKey: 0 };
  const rows = [...input.rows].sort(byLegacyId);
  const quarantine = (row: StagedCalibrationRow, reason: QuarantineEntry["reason"]): void => {
    plan.quarantine.push({ sourceTable: CALIBRATION_SOURCE.table, sourceRowNumber: row.sourceRowNumber, legacyId: row.legacyId, reason });
  };
  const { numbers: former, added } = numberFormerUsers(
    input.formerUsers,
    rows.map((r) => textOf(r.row, "id_user")).filter((id): id is string => id !== null && !input.users.has(id) && !input.unmatched.has(id)),
  );
  plan.formerUsers.push(...added);

  for (const row of rows) {
    const device = input.devices.get(textOf(row.row, "id_inventory") ?? "");
    if (device === undefined) {
      quarantine(row, "no_device");
      continue;
    }
    const day = calendarDayOf(textOf(row.row, "tanggal_kalibrasi"));
    if (day === null) {
      quarantine(row, "value_out_of_range");
      continue;
    }
    if (day > input.today) {
      quarantine(row, "future_calibration_date");
      continue;
    }
    const userLegacy = textOf(row.row, "id_user");
    if (userLegacy !== null && input.unmatched.has(userLegacy)) {
      quarantine(row, "performer_not_found");
      continue;
    }
    if (row.targetPresent && (row.decision === "unchanged" || row.targetClosed)) {
      // Unchanged; or a record the operator voided or corrected — the import does not reopen it.
      continue;
    }
    const user = userLegacy === null ? undefined : input.users.get(userLegacy);
    let person: PersonSnapshotValue;
    if (user !== undefined) {
      person = user.snapshot;
    } else {
      if (input.keyId === null) {
        plan.needsKey += 1;
        continue;
      }
      person = userLegacy === null ? { name: NULL_USER_PERFORMER, role: "import", organisation: input.tenantName } : formerSnapshot(former.get(userLegacy) as number);
    }
    const values: RecordValues = {
      id: input.newId(),
      sourceRowNumber: row.sourceRowNumber,
      deviceId: device.id,
      facilityId: device.facilityId,
      calibrationDate: day,
      performedBy: user === undefined ? null : user.id,
      apiKeyId: user === undefined ? input.keyId : null,
      roomSnapshot: ((): string | null => {
        const room = cleanText(textOf(row.row, "nama_ruangan"), ROOM_MAX);
        return room === "" ? null : room;
      })(),
      performerSnapshot: { ...person, source: "upstream-import" },
      supersedesId: row.targetPresent ? row.targetId : null,
    };
    plan.insert.push(values);
    plan.mappings.push({
      sourceTable: CALIBRATION_SOURCE.table,
      legacyId: row.legacyId,
      targetTable: "calibration_records",
      targetId: values.id,
      tenantId: input.tenantId,
      clientFacilityId: device.facilityId,
      rowHash: row.rowHash,
      sourceValues: null,
    });
  }
  return plan;
};

const keysOf = (rows: readonly StagedCalibrationRow[], key: string): string[] =>
  [...new Set(rows.map((r) => textOf(r.row, key)).filter((k): k is string => k !== null))];

/** Step 10's `run`: the calibration dates. */
export const runCalibrations = async (context: StepContext): Promise<void> => {
  const { runner, transaction, runId, tenantId, sourceZone } = context;
  if (!(await stagedTableExists(context, CALIBRATION_SOURCE.table))) {
    return;
  }
  const rows = await sql<StagedCalibrationRow>(
    runner,
    `SELECT c."sourceRowNumber", c."legacyId", c."rowHash", c."targetId", c.decision, (t.id IS NOT NULL) AS "targetPresent",
            (t.superseded_by_id IS NOT NULL OR coalesce(t.is_deleted, false)) AS "targetClosed",
            to_jsonb(s) - 'import_run_id' - 'source_row_number' AS row
       FROM (${classifiedSql(CALIBRATION_SOURCE)}) c
       JOIN ${stagedTable(CALIBRATION_SOURCE.table)} s ON s.import_run_id = $1 AND s.source_row_number = c."sourceRowNumber"::bigint
       LEFT JOIN calibration_records t ON t.id = c."targetId" AND t.tenant_id = $2`,
    [runId, tenantId],
    { transaction },
  );
  const deviceIds = await mappedTargets(context, "trx_inventory", keysOf(rows, "id_inventory"));
  const present = new Map(
    (
      await sql<{ id: string; facilityId: string }>(
        runner,
        "SELECT id, client_facility_id AS \"facilityId\" FROM calibration_devices WHERE tenant_id = $1 AND id = ANY($2::uuid[])",
        [tenantId, [...new Set(deviceIds.values())]],
        { transaction },
      )
    ).map((d) => [d.id, d.facilityId]),
  );
  const devices = new Map(
    [...deviceIds].flatMap(([legacy, id]) => {
      const facilityId = present.get(id);
      return facilityId === undefined ? [] : [[legacy, { id, facilityId }] as const];
    }),
  );
  const { users, unmatched } = await peopleOf(context, keysOf(rows, "id_user"));
  const keys = await sql<{ id: string; isActive: boolean; expiresAt: string | null; scopes: string[] }>(
    runner,
    `SELECT id, is_active AS "isActive", expires_at AS "expiresAt", scopes FROM api_keys
      WHERE tenant_id = $1 AND name = $2 AND is_active = true AND is_deleted = false ORDER BY created_at DESC, id DESC`,
    [tenantId, IMPORT_KEY_NAME],
    { transaction },
  );
  const key = keys.find((k) => usableImportKey(k, Date.now()));
  const [tenant] = await sql<{ name: string | null; today: string }>(
    runner,
    "SELECT t.name, (now() AT TIME ZONE $2)::date::text AS today FROM tenants t WHERE t.id = $1",
    [tenantId, sourceZone],
    { transaction },
  );
  const plan = planCalibrations({
    rows,
    tenantId,
    tenantName: tenant?.name ?? null,
    today: tenant?.today ?? "",
    devices,
    users,
    unmatched,
    formerUsers: await formerUsersOf(context),
    keyId: key?.id ?? null,
    newId: randomUUID,
  });
  if (plan.needsKey > 0) {
    throw new TransformFailure(
      "IMPORT_KEY_MISSING",
      `${String(plan.needsKey)} calibration date(s) have no resolvable person and the tenant has no usable import key; provision it before loading calibration dates.`,
    );
  }
  await recordFormerUsers(context, plan.formerUsers);
  await writeRecords(context, plan.insert);
  await quarantineRows(context, plan.quarantine);
  await recordMappings(context, plan.mappings);
};

/** The records, the superseded ones closed, and the audit rows — one statement each. */
const writeRecords = async (context: StepContext, records: readonly RecordValues[]): Promise<void> => {
  const { runner, transaction, runId, tenantId, sourceZone } = context;
  if (records.length === 0) {
    return;
  }
  await sql(
    runner,
    `INSERT INTO calibration_records (id, tenant_id, device_id, client_facility_id, performed_by, api_key_id, calibration_date, entry_kind,
                                      room_snapshot, performer_snapshot, supersedes_id, correction_reason, is_deleted, created_at, updated_at)
     SELECT v.id, $2, v.device, v.facility, v.performer, v.key, v.day::date::timestamp AT TIME ZONE $13, 'external_date', v.room,
            v.snapshot::jsonb, v.supersedes, CASE WHEN v.supersedes IS NULL THEN NULL ELSE $14 END, false,
            coalesce((to_jsonb(s) ->> 'created_at')::timestamp AT TIME ZONE $13, v.day::date::timestamp AT TIME ZONE $13),
            coalesce((to_jsonb(s) ->> 'updated_at')::timestamp AT TIME ZONE $13, (to_jsonb(s) ->> 'created_at')::timestamp AT TIME ZONE $13,
                     v.day::date::timestamp AT TIME ZONE $13)
       FROM unnest($3::uuid[], $4::bigint[], $5::uuid[], $6::uuid[], $7::uuid[], $8::uuid[], $9::text[], $10::text[], $11::text[], $12::uuid[])
            AS v(id, srn, device, facility, performer, key, day, room, snapshot, supersedes)
       JOIN ${stagedTable(CALIBRATION_SOURCE.table)} s ON s.import_run_id = $1 AND s.source_row_number = v.srn`,
    [
      runId,
      tenantId,
      records.map((r) => r.id),
      records.map((r) => r.sourceRowNumber),
      records.map((r) => r.deviceId),
      records.map((r) => r.facilityId),
      records.map((r) => r.performedBy),
      records.map((r) => r.apiKeyId),
      records.map((r) => r.calibrationDate),
      records.map((r) => r.roomSnapshot),
      records.map((r) => JSON.stringify(r.performerSnapshot)),
      records.map((r) => r.supersedesId),
      sourceZone,
      IMPORT_CORRECTION_REASON,
    ],
    { transaction },
  );
  const corrections = records.filter((r) => r.supersedesId !== null);
  if (corrections.length > 0) {
    await sql(
      runner,
      `UPDATE calibration_records t SET superseded_by_id = v.id, superseded_at = now(), updated_at = now()
         FROM unnest($2::uuid[], $3::uuid[]) AS v(old, id)
        WHERE t.id = v.old AND t.tenant_id = $1 AND t.superseded_by_id IS NULL`,
      [tenantId, corrections.map((r) => r.supersedesId), corrections.map((r) => r.id)],
      { transaction },
    );
  }
  const entries = [
    ...records.map((r) => ({
      action: "CREATE",
      id: r.id,
      facility: r.facilityId,
      changes: { operation: r.supersedesId === null ? "UPSTREAM_IMPORT" : "UPSTREAM_IMPORT_CORRECTION", supersedesId: r.supersedesId },
    })),
    ...corrections.map((r) => ({ action: "UPDATE", id: r.supersedesId as string, facility: r.facilityId, changes: { operation: "UPSTREAM_IMPORT_SUPERSEDED", supersededById: r.id } })),
  ];
  await sql(
    runner,
    `INSERT INTO audit_logs (id, tenant_id, user_id, actor_type, actor_name, action, resource_type, resource_id, client_facility_id, changes, created_at)
     SELECT gen_random_uuid(), $1::uuid, NULL, 'system', $2, e.action::"enum_audit_logs_action", $3, e.id, e.facility,
            e.changes::jsonb || jsonb_build_object('source', 'skp_ipm', 'importRunId', $4::text, 'sourceTable', 'trx_kalibrasi', 'targetTable', 'calibration_records'),
            now()
       FROM unnest($5::text[], $6::text[], $7::uuid[], $8::text[]) WITH ORDINALITY AS e(action, id, facility, changes, n)
      ORDER BY e.n`,
    [
      tenantId,
      "system:upstream-transform",
      RESOURCE_TYPES["calibration_records"] as string,
      runId,
      entries.map((e) => e.action),
      entries.map((e) => e.id),
      entries.map((e) => e.facility),
      entries.map((e) => JSON.stringify(e.changes)),
    ],
    { transaction },
  );
};
