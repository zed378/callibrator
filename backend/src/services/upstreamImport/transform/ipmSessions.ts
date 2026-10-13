/**
 * Step 11 of the transform (P24-02g; ADR-129 Am. 9; P19-02 spec § 13, § 6; 04 § 4.8, § 5; 05 § 3.3):
 * the upstream IPM visits → `inspection_sessions` of the provider tenant, as DRAFTS that step 12
 * fills with their results and then issues (0127: a session's results are written only while it
 * is a draft; the report's hash binds them).
 *
 *  - A session is a key `<qr>|<day>` (ipm.ts). Its header row is `trx_hasil_pemeriksaan`; the
 *    maintenance result, the recommendation and the note are one row each. Two rows of one table
 *    for a key: the highest id wins, the others `duplicate_header` (03 Q-8). A key with no header
 *    (a result table's rows only) is still a session, with NULL outcomes (05 § 3.3).
 *  - The device: the staged `trx_inventory` row of the QR, through `id_map` (step 8); none →
 *    `no_device`. The session's facility is the device's.
 *  - The performer (07 § 3): the upstream `id_user` of the key's environment rows, else of its
 *    header, else of any of its rows → `performed_by` the imported user, with their snapshot; a
 *    departed user → NULL and "Former upstream user #<n>" (numbered once, people.ts); none → NULL
 *    and "Upstream import". A mapping that names nobody of the tenant any more → `performer_not_found`
 *    (ADR-133 Am. 4's rule; nobody is put in their place). `created_by`, `submitted_by` stay NULL.
 *  - `performed_at` = the header's `created_at` (else the key's earliest) in the source zone;
 *    `legacy_visit_number` = the environment's `visit`; `visit_number` recomputed per device in
 *    `performed_at` order after the device's highest (P19-02 § 6, G-S2); outcomes and the
 *    recommendation by 04 § 5 — an unknown code leaves the value NULL and quarantines the row
 *    `value_out_of_range`; `notes` ← `trx_catatan`; snapshots of the device, its facility, its room
 *    and floor; `side_effects` `{}`; no work order (UD-12).
 *  - RE-RUNS (Am. 9): a key whose session exists is never changed — its rows are mapped onto it while
 *    its header still matches (ipm.ts `sessionFingerprint`), else quarantined `session_changed_upstream`.
 *
 * The step writes no audit row: step 12 audits each session it issues (STEP_AUDITED).
 */
import { randomUUID } from "crypto";
import { sql } from "../../../utils/sql.util";
import { NULL_USER_PERFORMER } from "../importKey";
import type { IpmDeviceSnapshot, IpmFacilitySnapshot, IpmPersonSnapshot } from "../../../utils/jsonShape.util";
import type { InspectionOverallOutcome, InspectionRecommendation } from "@callibrator/contracts/inspectionValues";
import { quarantineRows, recordMappings, stagedTable, stagedTableExists, type Mapping, type QuarantineEntry } from "./ledger";
import { formerSnapshot, formerUsersOf, mappedTargets, numberFormerUsers, peopleOf, recordFormerUsers, type PersonSnapshotValue } from "./people";
import {
  ENVIRONMENT_TABLE,
  OVERALL_CODES,
  RECOMMENDATION_CODES,
  RESULT_SOURCES,
  SESSION_SOURCES,
  byLegacyId,
  codeOf,
  legacyKeyOf,
  noteOf,
  readStagedIpm,
  sessionFingerprint,
  tenantOf,
  type SessionTable,
  type StagedIpmRow,
} from "./ipm";
import { textOf } from "./inventory";
import type { StepContext } from "./steps";

/** What the plan needs of a result table's row: its key, its user and (environment) its visit. */
export interface KeyRow {
  table: string;
  legacyId: string;
  qr: string | null;
  performedAt: string | null;
  userId: string | null;
  visit: string | null;
}

/** A device the sessions point at, with what its snapshots print. */
export interface DeviceFacts {
  id: string;
  facilityId: string;
  device: IpmDeviceSnapshot;
  facility: IpmFacilitySnapshot;
  room: string | null;
  floor: string | null;
}

/** An imported session already in the tenant. */
export interface ExistingSession {
  id: string;
  facilityId: string;
  deviceId: string;
  performedAt: string;
  inspectionOutcome: string | null;
  maintenanceOutcome: string | null;
  recommendation: string | null;
  notes: string | null;
  legacyVisitNumber: number | null;
}

/** What the session plan reads. */
export interface SessionInput {
  tenantId: string;
  tenantName: string | null;
  /** The tenant's IPM zone (the key's day). */
  zone: string;
  rows: Readonly<Record<SessionTable, readonly StagedIpmRow[]>>;
  keyRows: readonly KeyRow[];
  /** QR → the imported device. */
  devices: ReadonlyMap<string, DeviceFacts>;
  /** legacy key → the session imported earlier. */
  existing: ReadonlyMap<string, ExistingSession>;
  /** device → its highest visit number so far. */
  lastVisit: ReadonlyMap<string, number>;
  users: ReadonlyMap<string, { id: string; snapshot: PersonSnapshotValue }>;
  unmatched: ReadonlySet<string>;
  formerUsers: ReadonlyMap<string, number>;
  newId: () => string;
}

/** One draft the step inserts. */
export interface SessionValues {
  id: string;
  legacyKey: string;
  deviceId: string;
  facilityId: string;
  performedAt: string;
  performedBy: string | null;
  performerSnapshot: IpmPersonSnapshot;
  deviceSnapshot: IpmDeviceSnapshot;
  facilitySnapshot: IpmFacilitySnapshot;
  room: string | null;
  floor: string | null;
  visitNumber: number;
  legacyVisitNumber: number | null;
  inspectionOutcome: InspectionOverallOutcome | null;
  maintenanceOutcome: InspectionOverallOutcome | null;
  recommendation: InspectionRecommendation | null;
  notes: string | null;
}

/** What the session plan writes. */
export interface SessionPlan {
  insert: SessionValues[];
  formerUsers: { legacyId: string; number: number }[];
  mappings: Mapping[];
  quarantine: QuarantineEntry[];
}

/** One key's rows: the winner of each per-session table, every row of them, and its result rows. */
interface KeyGroup {
  key: string;
  qr: string;
  /** The earliest instant of any of its rows (a key has at least one). */
  earliest: string;
  winners: Partial<Record<SessionTable, StagedIpmRow>>;
  sessionRows: { table: SessionTable; row: StagedIpmRow }[];
  keyRows: KeyRow[];
}

const SMALLINT_MAX = 32_767;

/** The upstream `visit` as a positive smallint, else null. */
export const visitOf = (raw: string | null): number | null => {
  const text = (raw ?? "").trim();
  return /^\d{1,5}$/.test(text) && Number(text) >= 1 && Number(text) <= SMALLINT_MAX ? Number(text) : null;
};

const TABLE_ORDER: readonly SessionTable[] = ["trx_hasil_pemeriksaan", "trx_hasil_maintenance", "trx_rekomendasi_hasil_pekerjaan", "trx_catatan"];

/**
 * Decide every staged session row and every session. Pure.
 */
export const planSessions = (input: SessionInput): SessionPlan => {
  const plan: SessionPlan = { insert: [], formerUsers: [], mappings: [], quarantine: [] };
  const quarantine = (table: string, row: StagedIpmRow, reason: QuarantineEntry["reason"]): void => {
    plan.quarantine.push({ sourceTable: table, sourceRowNumber: row.sourceRowNumber, legacyId: row.legacyId, reason });
  };
  const groups = new Map<string, KeyGroup>();
  const groupOf = (key: string, qr: string, at: string): KeyGroup => {
    let group = groups.get(key);
    if (group === undefined) {
      group = { key, qr, earliest: at, winners: {}, sessionRows: [], keyRows: [] };
      groups.set(key, group);
    }
    group.earliest = at < group.earliest ? at : group.earliest;
    return group;
  };
  for (const table of TABLE_ORDER) {
    // Highest id first: the first row of a key wins, the rest are duplicates.
    for (const row of [...input.rows[table]].sort(byLegacyId).reverse()) {
      const key = legacyKeyOf(row.qr, row.performedAt, input.zone);
      if (key === null) {
        quarantine(table, row, "value_out_of_range");
        continue;
      }
      const group = groupOf(key, row.qr as string, row.performedAt as string);
      if (group.winners[table] === undefined) {
        group.winners[table] = row;
        group.sessionRows.push({ table, row });
      } else {
        quarantine(table, row, "duplicate_header");
      }
    }
  }
  for (const keyRow of input.keyRows) {
    const key = legacyKeyOf(keyRow.qr, keyRow.performedAt, input.zone);
    if (key !== null) {
      groupOf(key, keyRow.qr as string, keyRow.performedAt as string).keyRows.push(keyRow);
    }
  }

  /** A decided key: everything but the performer's number and the visit. */
  interface Decided {
    group: KeyGroup;
    device: DeviceFacts;
    performedAt: string;
    userLegacy: string | null;
    values: Omit<SessionValues, "id" | "legacyKey" | "deviceId" | "facilityId" | "performedAt" | "performedBy" | "performerSnapshot" | "deviceSnapshot" | "facilitySnapshot" | "room" | "floor" | "visitNumber">;
  }
  const decided: Decided[] = [];
  const toMap = (group: KeyGroup, targetId: string, facilityId: string, onlyChanged: boolean): void => {
    for (const { table, row } of group.sessionRows) {
      if (onlyChanged && row.decision === "unchanged" && row.targetId === targetId) {
        continue;
      }
      plan.mappings.push({ sourceTable: table, legacyId: row.legacyId, targetTable: "inspection_sessions", targetId, tenantId: input.tenantId, clientFacilityId: facilityId, rowHash: row.rowHash, sourceValues: null });
    }
  };
  const quarantineGroup = (group: KeyGroup, reason: QuarantineEntry["reason"]): void => {
    for (const { table, row } of group.sessionRows) {
      quarantine(table, row, reason);
    }
  };

  for (const group of [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    const device = input.devices.get(group.qr);
    if (device === undefined) {
      quarantineGroup(group, "no_device");
      continue;
    }
    const environment = group.keyRows.filter((k) => k.table === ENVIRONMENT_TABLE).sort(byLegacyId);
    const userLegacy =
      environment.find((k) => k.userId !== null)?.userId ??
      TABLE_ORDER.map((t) => group.winners[t]).map((row) => (row === undefined ? null : textOf(row.row, "id_user"))).find((u) => u !== null) ??
      [...group.keyRows].sort(byLegacyId).find((k) => k.userId !== null)?.userId ??
      null;
    if (userLegacy !== null && input.unmatched.has(userLegacy)) {
      quarantineGroup(group, "performer_not_found");
      continue;
    }
    const header = group.winners.trx_hasil_pemeriksaan;
    const performedAt = header?.performedAt ?? group.earliest;
    const coded = <T>(table: SessionTable, codes: Readonly<Record<string, T>>): T | null => {
      const row = group.winners[table];
      const code = row === undefined ? null : codeOf(row.row, "status");
      if (row === undefined || code === null) {
        return null;
      }
      const value = codes[code];
      if (value === undefined) {
        quarantine(table, row, "value_out_of_range");
        group.sessionRows = group.sessionRows.filter((r) => r.row !== row);
        return null;
      }
      return value;
    };
    const values: Decided["values"] = {
      inspectionOutcome: coded("trx_hasil_pemeriksaan", OVERALL_CODES),
      maintenanceOutcome: coded("trx_hasil_maintenance", OVERALL_CODES),
      recommendation: coded("trx_rekomendasi_hasil_pekerjaan", RECOMMENDATION_CODES),
      notes: noteOf(group.winners.trx_catatan === undefined ? null : textOf(group.winners.trx_catatan.row, "description")),
      legacyVisitNumber: environment.map((k) => visitOf(k.visit)).find((v) => v !== null) ?? null,
    };
    const existing = input.existing.get(group.key);
    if (existing !== undefined) {
      const same =
        sessionFingerprint({ deviceId: device.id, performedAt, ...values }) ===
        sessionFingerprint({
          deviceId: existing.deviceId,
          performedAt: existing.performedAt,
          inspectionOutcome: existing.inspectionOutcome,
          maintenanceOutcome: existing.maintenanceOutcome,
          recommendation: existing.recommendation,
          notes: existing.notes,
          legacyVisitNumber: existing.legacyVisitNumber,
        });
      if (same) {
        toMap(group, existing.id, existing.facilityId, true);
      } else {
        quarantineGroup(group, "session_changed_upstream");
      }
      continue;
    }
    decided.push({ group, device, performedAt, userLegacy, values });
  }

  const departed = decided.map((d) => d.userLegacy).filter((u): u is string => u !== null && !input.users.has(u));
  const { numbers: former, added } = numberFormerUsers(input.formerUsers, departed);
  plan.formerUsers.push(...added);
  const visits = new Map(input.lastVisit);
  decided.sort((a, b) => a.performedAt.localeCompare(b.performedAt) || a.group.key.localeCompare(b.group.key));
  for (const d of decided) {
    const user = d.userLegacy === null ? undefined : input.users.get(d.userLegacy);
    const person: PersonSnapshotValue =
      user !== undefined
        ? user.snapshot
        : d.userLegacy === null
          ? { name: NULL_USER_PERFORMER, role: "import", organisation: input.tenantName }
          : formerSnapshot(former.get(d.userLegacy) as number);
    const visitNumber = (visits.get(d.device.id) ?? 0) + 1;
    visits.set(d.device.id, visitNumber);
    const session: SessionValues = {
      id: input.newId(),
      legacyKey: d.group.key,
      deviceId: d.device.id,
      facilityId: d.device.facilityId,
      performedAt: d.performedAt,
      performedBy: user?.id ?? null,
      performerSnapshot: { name: person.name, role: person.role, organisation: person.organisation },
      deviceSnapshot: d.device.device,
      facilitySnapshot: d.device.facility,
      room: d.device.room,
      floor: d.device.floor,
      visitNumber,
      ...d.values,
    };
    plan.insert.push(session);
    toMap(d.group, session.id, session.facilityId, false);
  }
  return plan;
};

// ------------------------------------------------------------------
// THE STEP
// ------------------------------------------------------------------

const SESSION_LIST = SESSION_SOURCES.map((s) => s.table as SessionTable);

/** Step 11's `run`: the sessions, as drafts. */
export const runIpmSessions = async (context: StepContext): Promise<void> => {
  const { runner, transaction, tenantId } = context;
  const rows: Record<SessionTable, StagedIpmRow[]> = { trx_hasil_pemeriksaan: [], trx_hasil_maintenance: [], trx_rekomendasi_hasil_pekerjaan: [], trx_catatan: [] };
  for (const source of SESSION_SOURCES) {
    if (await stagedTableExists(context, source.table)) {
      rows[source.table as SessionTable] = await readStagedIpm(context, source);
    }
  }
  const keyRows: KeyRow[] = [];
  for (const source of RESULT_SOURCES) {
    if (!(await stagedTableExists(context, source.table))) {
      continue;
    }
    const read = await sql<Omit<KeyRow, "table">>(
      runner,
      `SELECT (${source.legacyId as string}) AS "legacyId", nullif(btrim(to_jsonb(s) ->> 'no_qrcode'), '') AS qr,
              to_char(((to_jsonb(s) ->> 'created_at')::timestamp AT TIME ZONE $2) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "performedAt",
              to_jsonb(s) ->> 'id_user' AS "userId", to_jsonb(s) ->> 'visit' AS visit
         FROM ${stagedTable(source.table)} s WHERE s.import_run_id = $1`,
      [context.runId, context.sourceZone],
      { transaction },
    );
    keyRows.push(...read.map((r) => ({ ...r, table: source.table })));
  }
  if (SESSION_LIST.every((t) => rows[t].length === 0) && keyRows.length === 0) {
    return;
  }
  const tenant = await tenantOf(context);
  const devices = await devicesByQr(context);
  const userIds = [
    ...new Set(
      [...SESSION_LIST.flatMap((t) => rows[t].map((r) => textOf(r.row, "id_user"))), ...keyRows.map((k) => k.userId)].filter((u): u is string => u !== null),
    ),
  ];
  const { users, unmatched } = await peopleOf(context, userIds);
  const keys = [
    ...new Set(
      [...SESSION_LIST.flatMap((t) => rows[t]), ...keyRows].map((r) => legacyKeyOf(r.qr, r.performedAt, tenant.zone)).filter((k): k is string => k !== null),
    ),
  ];
  const existing = new Map(
    (
      await sql<ExistingSession & { legacyKey: string }>(
        runner,
        `SELECT id, legacy_key AS "legacyKey", client_facility_id AS "facilityId", device_id AS "deviceId",
                to_char(performed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "performedAt",
                inspection_outcome::text AS "inspectionOutcome", maintenance_outcome::text AS "maintenanceOutcome",
                recommendation::text AS recommendation, notes, legacy_visit_number AS "legacyVisitNumber"
           FROM inspection_sessions WHERE tenant_id = $1 AND legacy_key = ANY($2::text[])`,
        [tenantId, keys],
        { transaction },
      )
    ).map(({ legacyKey, ...session }) => [legacyKey, session]),
  );
  const lastVisit = new Map(
    (
      await sql<{ deviceId: string; visit: number }>(
        runner,
        `SELECT device_id AS "deviceId", max(visit_number)::int AS visit FROM inspection_sessions
          WHERE tenant_id = $1 AND device_id = ANY($2::uuid[]) AND supersedes_id IS NULL AND status IN ('submitted', 'voided') AND visit_number IS NOT NULL
          GROUP BY device_id`,
        [tenantId, [...new Set([...devices.values()].map((d) => d.id))]],
        { transaction },
      )
    ).map((r) => [r.deviceId, r.visit]),
  );
  const plan = planSessions({
    tenantId,
    tenantName: tenant.name,
    zone: tenant.zone,
    rows,
    keyRows,
    devices,
    existing,
    lastVisit,
    users,
    unmatched,
    formerUsers: await formerUsersOf(context),
    newId: randomUUID,
  });
  await recordFormerUsers(context, plan.formerUsers);
  await insertDrafts(context, plan.insert);
  await quarantineRows(context, plan.quarantine);
  await recordMappings(context, plan.mappings);
};

interface DeviceRow {
  qr: string;
  id: string;
  facilityId: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  qrCode: string | null;
  deviceTypeId: string | null;
  deviceTypeName: string | null;
  lastCalibrationDate: string | null;
  nextCalibrationDate: string | null;
  facilityName: string;
  facilityCode: string | null;
  facilityKind: string | null;
  facilityAddress: string | null;
  room: string | null;
  floor: string | null;
}

/** The run's upstream QRs → the imported devices (step 8) with what the snapshots print (ipmReport.service `snapshotsFor`). */
const devicesByQr = async (context: StepContext): Promise<Map<string, DeviceFacts>> => {
  const { runner, transaction, tenantId } = context;
  if (!(await stagedTableExists(context, "trx_inventory"))) {
    return new Map();
  }
  const staged = await sql<{ qr: string; legacyId: string }>(
    runner,
    `SELECT nullif(btrim(to_jsonb(s) ->> 'no_qrcode'), '') AS qr, s."id"::text AS "legacyId"
       FROM ${stagedTable("trx_inventory")} s WHERE s.import_run_id = $1 AND nullif(btrim(to_jsonb(s) ->> 'no_qrcode'), '') IS NOT NULL`,
    [context.runId],
    { transaction },
  );
  const targets = await mappedTargets(context, "trx_inventory", staged.map((s) => s.legacyId));
  const qrOf = new Map(staged.flatMap((s) => (targets.has(s.legacyId) ? [[targets.get(s.legacyId) as string, s.qr] as const] : [])));
  const found = await sql<Omit<DeviceRow, "qr">>(
    runner,
    `SELECT d.id, d.client_facility_id AS "facilityId", d.name, d.manufacturer, d.model, d.serial_number AS "serialNumber", d.qr_code AS "qrCode",
            d.device_type_id AS "deviceTypeId", t.name AS "deviceTypeName",
            (SELECT to_char(r.calibration_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') FROM calibration_records r
              WHERE r.tenant_id = $1 AND r.device_id = d.id AND r.superseded_by_id IS NULL AND r.is_deleted = false AND r.deleted_at IS NULL
              ORDER BY r.calibration_date DESC, r.created_at DESC, r.id DESC LIMIT 1) AS "lastCalibrationDate",
            to_char(d.next_calibration_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "nextCalibrationDate",
            f.name AS "facilityName", f.code AS "facilityCode", f.kind::text AS "facilityKind", f.address AS "facilityAddress",
            w.name AS room, w.floor
       FROM calibration_devices d
       JOIN client_facilities f ON f.id = d.client_facility_id AND f.tenant_id = $1
       LEFT JOIN device_types t ON t.id = d.device_type_id
       LEFT JOIN warehouses w ON w.id = d.location_id AND w.tenant_id = $1
      WHERE d.tenant_id = $1 AND d.id = ANY($2::uuid[])`,
    [tenantId, [...qrOf.keys()]],
    { transaction },
  );
  return new Map(found.map((d) => [qrOf.get(d.id) as string, deviceFactsOf(d)]));
};

/** A device row as its snapshots. */
export const deviceFactsOf = (d: Omit<DeviceRow, "qr">): DeviceFacts => ({
  id: d.id,
  facilityId: d.facilityId,
  device: {
    name: d.name,
    manufacturer: d.manufacturer,
    model: d.model,
    serialNumber: d.serialNumber,
    qrCode: d.qrCode,
    deviceTypeId: d.deviceTypeId,
    deviceTypeName: d.deviceTypeName,
    lastCalibrationDate: d.lastCalibrationDate,
    nextCalibrationDate: d.nextCalibrationDate,
  },
  facility: { id: d.facilityId, name: d.facilityName, code: d.facilityCode, kind: d.facilityKind, address: d.facilityAddress },
  room: d.room,
  floor: d.floor,
});

/** The drafts, one statement. */
const insertDrafts = async (context: StepContext, sessions: readonly SessionValues[]): Promise<void> => {
  if (sessions.length === 0) {
    return;
  }
  const col = <K extends keyof SessionValues>(key: K): SessionValues[K][] => sessions.map((s) => s[key]);
  const json = (key: "performerSnapshot" | "deviceSnapshot" | "facilitySnapshot"): string[] => sessions.map((s) => JSON.stringify(s[key]));
  await sql(
    context.runner,
    `INSERT INTO inspection_sessions (id, tenant_id, client_facility_id, device_id, status, revision, performed_at, received_at, captured_offline,
                                      performed_by, performer_snapshot, device_snapshot, facility_snapshot, room_snapshot, floor_snapshot,
                                      visit_number, legacy_visit_number, inspection_outcome, maintenance_outcome, recommendation, notes,
                                      side_effects, legacy_key, created_at, updated_at)
     SELECT v.id, $1::uuid, v.facility, v.device, 'draft', 0, v.performed::timestamptz, now(), false,
            v.performer, v.ps::jsonb, v.ds::jsonb, v.fs::jsonb, v.room, v.floor,
            v.visit, v.legacy_visit, v.io::"enum_inspection_sessions_inspection_outcome", v.mo::"enum_inspection_sessions_maintenance_outcome",
            v.rec::"enum_inspection_sessions_recommendation", v.notes, '{}'::jsonb, v.lk, now(), now()
       FROM unnest($2::uuid[], $3::uuid[], $4::uuid[], $5::text[], $6::uuid[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[],
                   $12::int[], $13::smallint[], $14::text[], $15::text[], $16::text[], $17::text[], $18::text[])
            AS v(id, facility, device, performed, performer, ps, ds, fs, room, floor, visit, legacy_visit, io, mo, rec, notes, lk)`,
    [
      context.tenantId,
      col("id"),
      col("facilityId"),
      col("deviceId"),
      col("performedAt"),
      col("performedBy"),
      json("performerSnapshot"),
      json("deviceSnapshot"),
      json("facilitySnapshot"),
      col("room"),
      col("floor"),
      col("visitNumber"),
      col("legacyVisitNumber"),
      col("inspectionOutcome"),
      col("maintenanceOutcome"),
      col("recommendation"),
      col("notes"),
      col("legacyKey"),
    ],
    { transaction: context.transaction },
  );
};
