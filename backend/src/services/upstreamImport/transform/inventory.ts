/**
 * Steps 6, 7 and 8 of the transform (P24-02e; ADR-129 Am. 7; P19-03 spec § 4, § 6.5, § 10;
 * 04 § 4.2; 05 § 3.1 steps 6 – 8): the device register — `trx_inventory` → the provider tenant's
 * calibration laboratories (`vendors`), rooms (`warehouses` of kind `room`) and devices
 * (`calibration_devices`).
 *
 * VENDORS (step 6, derived — no source table): one `CalibrationLab` per distinct cleaned
 * `lab_kalibrasi` (case-insensitive) in the provider tenant; a live laboratory of the same name is
 * ADOPTED (nothing written). Approval stays the vendor default (`PENDING`).
 *
 * ROOMS (step 7, derived): one room per distinct `(facility, room, floor)` — the device's facility
 * through step 1's `mst_faskes` mapping, the room and floor cleaned (`cleanText`, ≤ 255 / ≤ 50),
 * compared case-insensitively, as `warehouses_room_name_unique` does; a live room of that key is
 * adopted; a new one gets the next `R-0001…` code of the tenant (P19-03 § 6.5). The operator's
 * merge list for obvious spelling variants is not built (the dry run, P24-05, lists the pairs).
 *
 * Both derived steps write their own CREATE audit rows (auditRows.ts `STEP_AUDITED`): an adopted
 * row is not written and not audited, so a re-run writes nothing.
 *
 * DEVICES (step 8, `trx_inventory`, keyed by its id): P19-03 § 10 —
 *  - facility from `id_client` (step 1); not imported → `facility_not_imported`;
 *  - `qr_code` from `no_qrcode` by `normaliseQrCode` with the provider tenant's settings; an
 *    invalid one → `value_out_of_range`; the same normalised code on a lower legacy id of the run →
 *    `qr_case_collision`; held by a device the import did not make → `qr_in_use` (the operator
 *    decides: the register's QR is unique per tenant over every row);
 *  - `name` from `nama_alat` (empty → `value_out_of_range`), `manufacturer` / `model` from
 *    `merk` / `type`;
 *  - `device_type_id` and `category` (the type's name) from `id_alat` (step 3); a type that was not
 *    imported leaves both NULL (the device is kept; the raw id is in `source_values`);
 *  - `serial_number` from `sn`: placeholders → NULL; a duplicate inside one facility (UD-9) keeps
 *    the serial on the lowest legacy id (the oldest registration) and NULL on the others, as does a
 *    serial another device of that facility already holds — the original in `source_values`;
 *  - `location_id` → the room of step 7; `condition` from `kondisi_alat` (§ 4.4; `Rusak` also makes
 *    the device `inactive`; `condition_source import`); `accessories_complete` from `aksesoris`;
 *    `calibration_vendor_id` → the laboratory of step 6; `inventoried_on` from `tgl_inventory`
 *    (before 1990 → NULL, the raw date kept); `tgl_kalibrasi` is not a device column (UD-8) — kept
 *    in `source_values`;
 *  - the registrant (`id_user`, 07 § 3): an imported user → `created_by` and their snapshot (name,
 *    role, organisation, as `personSnapshotOf` prints them); a user who is gone → no `created_by`,
 *    snapshot "Former upstream user #<n>", <n> a per-migration number kept in
 *    `upstream_import.former_users` (never the upstream id); no `id_user` → neither;
 *  - `created_at` / `updated_at` from upstream (read in the source zone), else `tgl_inventory`.
 * A changed row UPDATES its device (upstream is the source of truth until cutover) — never its
 * facility: another facility upstream is a device move, quarantined `facility_changed` for the
 * operator's move (P19-04 § 10); a device the operator deleted is never written again. Step 13
 * audits the devices (`id_map`).
 */
import { randomUUID } from "crypto";
import { normaliseQrCode, type QrCodeSettings, type DeviceCondition } from "@callibrator/contracts/deviceValues";
import { sql, type BindValue } from "../../../utils/sql.util";
import { STAGING_SCHEMA } from "../../../config/upstreamImport";
import { qrSettingsOf, DEVICE_SETTING_KEYS } from "../../deviceSettings.service";
import { UNNAMED_PERSON } from "../../deviceRegister.service";
import { RESOURCE_TYPES } from "./auditRows";
import { cleanText } from "./catalogue";
import { ID_MAP, classifiedSql, quarantineRows, recordMappings, stagedTable, stagedTableExists, type Mapping, type QuarantineEntry } from "./ledger";
import type { StepContext, TransformSource } from "./steps";

type Decision = "new" | "unchanged" | "changed";
type Raw = Readonly<Record<string, unknown>>;

/** `trx_inventory`, keyed by its id. */
export const DEVICE_SOURCE: TransformSource = Object.freeze({ table: "trx_inventory", legacyId: 's."id"::text' });

/** `upstream_import.former_users` (migration 0139): the per-migration numbers of departed registrants. */
export const FORMER_USERS = `${STAGING_SCHEMA}.former_users`;

const NAME_MAX = 255;
const FLOOR_MAX = 50;
const INVENTORIED_ON_MIN = "1990-01-01";
const FORMER_USER = "Former upstream user";

/** Serial placeholders (03 Q-17): never a serial. */
const SERIAL_PLACEHOLDERS: ReadonlySet<string> = new Set(["none", "null", "nil", "n/a", "na", "tidak ada", "tidak", "kosong", "unknown", "tanpa sn", "no sn"]);

/** A JSON member as text, or null. */
export const textOf = (row: Raw, key: string): string | null => {
  const value = row[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
};

/** Cleaned text, or null when empty. */
const cleanOrNull = (value: string | null, max: number): string | null => {
  const text = cleanText(value, max);
  return text === "" ? null : text;
};

/** The vendor key of a laboratory name (null when empty). */
export const vendorKeyOf = (raw: string | null): { key: string; name: string } | null => {
  const name = cleanOrNull(raw, NAME_MAX);
  return name === null ? null : { key: name.toLowerCase(), name };
};

/** The room key of `(facility, room, floor)` (null when the room is empty), as `warehouses_room_name_unique` compares. */
export const roomKeyOf = (facilityId: string, rawRoom: string | null, rawFloor: string | null): { key: string; name: string; floor: string | null } | null => {
  const name = cleanOrNull(rawRoom, NAME_MAX);
  if (name === null) {
    return null;
  }
  const floor = cleanOrNull(rawFloor, FLOOR_MAX);
  return { key: `${facilityId}|${name.toLowerCase()}|${(floor ?? "").toLowerCase()}`, name, floor };
};

/** A serial as stored: cleaned, placeholders and anything shorter than 3 characters NULL. */
export const serialOf = (raw: string | null): string | null => {
  const serial = cleanOrNull(raw, NAME_MAX);
  if (serial === null || serial.length < 3 || /^[-0.\s/]+$/.test(serial) || SERIAL_PLACEHOLDERS.has(serial.toLowerCase())) {
    return null;
  }
  return serial;
};

/** The upstream condition words (§ 4.4). A Map: a key such as "constructor" is no condition. */
const CONDITIONS: ReadonlyMap<string, DeviceCondition> = new Map([
  ["baik", "good"],
  ["laik", "good"],
  ["tidak baik", "not_good"],
  ["rusak", "broken"],
]);

/** `kondisi_alat` → condition (§ 4.4); `known` false for a value outside the four (kept raw). */
export const conditionOf = (raw: string | null): { condition: DeviceCondition | null; known: boolean } => {
  const value = cleanText(raw, 50).toLowerCase();
  if (value === "") {
    return { condition: null, known: true };
  }
  const condition = CONDITIONS.get(value);
  return condition === undefined ? { condition: null, known: false } : { condition, known: true };
};

/** `aksesoris` → accessories complete; `known` false for a value outside `Ada` / `Tidak`. */
export const accessoriesOf = (raw: string | null): { value: boolean | null; known: boolean } => {
  const value = cleanText(raw, 20).toLowerCase();
  if (value === "") {
    return { value: null, known: true };
  }
  if (value === "ada") {
    return { value: true, known: true };
  }
  return value === "tidak" ? { value: false, known: true } : { value: null, known: false };
};

/** A register date (`YYYY-MM-DD`, a real day, not before 1990), else null. */
export const inventoryDateOf = (raw: string | null): string | null => {
  const day = (raw ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < INVENTORIED_ON_MIN) {
    return null;
  }
  const date = new Date(`${day}T00:00:00Z`);
  return date.toISOString().slice(0, 10) === day ? day : null;
};

/** A person as the register prints them (jsonShape `personSnapshot`). */
export interface RegistrantSnapshot {
  name: string;
  role: string | null;
  organisation: string | null;
}

/** A staged device row: its classification, its columns, and its earlier device. */
export interface StagedDeviceRow {
  sourceRowNumber: string;
  legacyId: string;
  rowHash: string;
  targetId: string | null;
  decision: Decision;
  targetPresent: boolean;
  targetDeleted: boolean;
  /** The earlier device's facility (null when there is none). */
  targetFacilityId: string | null;
  row: Raw;
}

/** What the device plan reads. */
export interface DeviceInput {
  rows: readonly StagedDeviceRow[];
  tenantId: string;
  qr: QrCodeSettings;
  /** `mst_faskes` legacy id → facility id (imported, in the tenant). */
  facilities: ReadonlyMap<string, string>;
  /** `mst_alat` legacy id → the type. */
  types: ReadonlyMap<string, { id: string; name: string }>;
  /** `users` legacy id → the imported user and their snapshot. */
  users: ReadonlyMap<string, { id: string; snapshot: RegistrantSnapshot }>;
  /** Departed registrants already numbered (legacy id → number). */
  formerUsers: ReadonlyMap<string, number>;
  /** vendor key → vendor id. */
  vendors: ReadonlyMap<string, string>;
  /** room key → room id. */
  rooms: ReadonlyMap<string, string>;
  /** QR code → the device holding it (any row of the tenant). */
  takenQr: ReadonlyMap<string, string>;
  /** `<facility>|<serial>` → the device holding it. */
  takenSerial: ReadonlyMap<string, string>;
  newId: () => string;
}

/** One device's columns, as the step writes them. */
export interface DeviceValues {
  id: string;
  sourceRowNumber: string;
  facilityId: string;
  name: string;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  category: string | null;
  status: "active" | "inactive";
  locationId: string | null;
  deviceTypeId: string | null;
  qrCode: string;
  inventoriedOn: string | null;
  accessoriesComplete: boolean | null;
  condition: DeviceCondition | null;
  vendorId: string | null;
  createdBy: string | null;
  registrantSnapshot: RegistrantSnapshot | null;
}

/** What the device plan writes. */
export interface DevicePlan {
  insert: DeviceValues[];
  update: DeviceValues[];
  formerUsers: { legacyId: string; number: number }[];
  mappings: Mapping[];
  quarantine: QuarantineEntry[];
}

const byLegacyId = (a: StagedDeviceRow, b: StagedDeviceRow): number => Number(a.legacyId) - Number(b.legacyId) || a.legacyId.localeCompare(b.legacyId);

/**
 * Decide every staged device row. Pure.
 */
export const planDevices = (input: DeviceInput): DevicePlan => {
  const plan: DevicePlan = { insert: [], update: [], formerUsers: [], mappings: [], quarantine: [] };
  const rows = [...input.rows].sort(byLegacyId);
  const quarantine = (row: StagedDeviceRow, reason: QuarantineEntry["reason"]): void => {
    plan.quarantine.push({ sourceTable: DEVICE_SOURCE.table, sourceRowNumber: row.sourceRowNumber, legacyId: row.legacyId, reason });
  };

  // Departed registrants: numbered once, in legacy id order, after those already numbered.
  const former = new Map(input.formerUsers);
  let next = Math.max(0, ...former.values());
  const departed = [...new Set(rows.map((r) => textOf(r.row, "id_user")).filter((id): id is string => id !== null && !input.users.has(id) && !former.has(id)))]
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  for (const legacyId of departed) {
    next += 1;
    former.set(legacyId, next);
    plan.formerUsers.push({ legacyId, number: next });
  }

  const seenQr = new Set<string>();
  const seenSerial = new Set<string>();
  for (const row of rows) {
    const raw = row.row;
    const facilityId = input.facilities.get(textOf(raw, "id_client") ?? "");
    if (facilityId === undefined) {
      quarantine(row, "facility_not_imported");
      continue;
    }
    const name = cleanOrNull(textOf(raw, "nama_alat"), NAME_MAX);
    const rawQr = textOf(raw, "no_qrcode") ?? "";
    const qr = normaliseQrCode(rawQr, input.qr);
    if (name === null || !qr.ok) {
      quarantine(row, "value_out_of_range");
      continue;
    }
    if (seenQr.has(qr.value)) {
      quarantine(row, "qr_case_collision");
      continue;
    }
    seenQr.add(qr.value);
    const holder = input.takenQr.get(qr.value);
    if (holder !== undefined && holder !== row.targetId) {
      quarantine(row, "qr_in_use");
      continue;
    }
    // Unchanged and still there: nothing to write (its serial and QR are its own, in the taken maps).
    if (row.decision === "unchanged" && row.targetPresent) {
      continue;
    }

    const changed: Record<string, string> = {};
    if (rawQr !== qr.value) {
      changed["no_qrcode"] = rawQr;
    }
    const rawSerial = textOf(raw, "sn");
    let serialNumber = serialOf(rawSerial);
    if (serialNumber !== null) {
      const key = `${facilityId}|${serialNumber}`;
      const taken = input.takenSerial.get(key);
      if (seenSerial.has(key) || (taken !== undefined && taken !== row.targetId)) {
        serialNumber = null;
      }
      seenSerial.add(key);
    }
    if (serialNumber === null && rawSerial !== null && rawSerial.trim() !== "") {
      changed["sn"] = rawSerial;
    }
    const typeLegacy = textOf(raw, "id_alat");
    const type = input.types.get(typeLegacy ?? "");
    if (type === undefined && typeLegacy !== null) {
      changed["id_alat"] = typeLegacy;
    }
    const rawCondition = textOf(raw, "kondisi_alat");
    const condition = conditionOf(rawCondition);
    if (rawCondition !== null && (!condition.known || cleanText(rawCondition, 50).toLowerCase() === "laik")) {
      changed["kondisi_alat"] = rawCondition;
    }
    const rawAccessories = textOf(raw, "aksesoris");
    const accessories = accessoriesOf(rawAccessories);
    if (rawAccessories !== null && !accessories.known) {
      changed["aksesoris"] = rawAccessories;
    }
    const rawInventory = textOf(raw, "tgl_inventory");
    const inventoriedOn = inventoryDateOf(rawInventory);
    if (rawInventory !== null && inventoriedOn === null) {
      changed["tgl_inventory"] = rawInventory;
    }
    const lastCalibration = textOf(raw, "tgl_kalibrasi");
    if (lastCalibration !== null) {
      changed["tgl_kalibrasi"] = lastCalibration;
    }
    const room = roomKeyOf(facilityId, textOf(raw, "nama_ruangan"), textOf(raw, "lantai"));
    const vendor = vendorKeyOf(textOf(raw, "lab_kalibrasi"));
    const userLegacy = textOf(raw, "id_user");
    const user = userLegacy === null ? undefined : input.users.get(userLegacy);
    const formerNumber = userLegacy === null ? undefined : former.get(userLegacy);

    const update = row.targetId !== null && row.targetPresent;
    if (update && row.targetDeleted) {
      // A device the operator deleted is never written again; its mapping stays as it was.
      continue;
    }
    if (update && row.targetFacilityId !== facilityId) {
      // Another facility upstream is a device MOVE (P19-04 § 10: its records and attachments follow);
      // the import never moves a device — the operator does, and the next run maps the row.
      quarantine(row, "facility_changed");
      continue;
    }
    const values: DeviceValues = {
      id: update ? (row.targetId as string) : input.newId(),
      sourceRowNumber: row.sourceRowNumber,
      facilityId,
      name,
      serialNumber,
      manufacturer: cleanOrNull(textOf(raw, "merk"), NAME_MAX),
      model: cleanOrNull(textOf(raw, "type"), NAME_MAX),
      category: type === undefined ? null : type.name.slice(0, 100),
      status: condition.condition === "broken" ? "inactive" : "active",
      locationId: room === null ? null : (input.rooms.get(room.key) ?? null),
      deviceTypeId: type === undefined ? null : type.id,
      qrCode: qr.value,
      inventoriedOn,
      accessoriesComplete: accessories.value,
      condition: condition.condition,
      vendorId: vendor === null ? null : (input.vendors.get(vendor.key) ?? null),
      createdBy: user === undefined ? null : user.id,
      registrantSnapshot:
        user !== undefined ? user.snapshot : formerNumber === undefined ? null : { name: `${FORMER_USER} #${String(formerNumber)}`, role: null, organisation: null },
    };
    (update ? plan.update : plan.insert).push(values);
    plan.mappings.push({
      sourceTable: DEVICE_SOURCE.table,
      legacyId: row.legacyId,
      targetTable: "calibration_devices",
      targetId: values.id,
      tenantId: input.tenantId,
      clientFacilityId: facilityId,
      rowHash: row.rowHash,
      sourceValues: Object.keys(changed).length > 0 ? changed : null,
    });
  }
  return plan;
};

// ── the derived steps ───────────────────────────────────────────────────────

/** One CREATE audit row per derived row written (PLATFORM shape of auditRows.ts, the provider tenant). */
const auditCreated = async (context: StepContext, table: "vendors" | "warehouses", rows: readonly { id: string; facilityId: string | null }[]): Promise<void> => {
  if (rows.length === 0) {
    return;
  }
  await sql(
    context.runner,
    `INSERT INTO audit_logs (id, tenant_id, user_id, actor_type, actor_name, action, resource_type, resource_id, client_facility_id, changes, created_at)
     SELECT gen_random_uuid(), $1::uuid, NULL, 'system', $2, 'CREATE', $3, v.id, v.facility,
            jsonb_build_object('operation', 'UPSTREAM_IMPORT', 'source', 'skp_ipm', 'importRunId', $4::text,
                               'sourceTable', 'trx_inventory', 'targetTable', $5::text),
            now()
       FROM unnest($6::text[], $7::uuid[]) WITH ORDINALITY AS v(id, facility, n)
      ORDER BY v.n`,
    [context.tenantId, "system:upstream-transform", RESOURCE_TYPES[table] as string, context.runId, table, rows.map((r) => r.id), rows.map((r) => r.facilityId)],
    { transaction: context.transaction },
  );
};

/** The run's distinct laboratory spellings, in the order the dump first has them (the first spelling names a new laboratory). */
const stagedLaboratories = async (context: StepContext): Promise<string[]> =>
  (
    await sql<{ raw: string }>(
      context.runner,
      `SELECT to_jsonb(s) ->> 'lab_kalibrasi' AS raw FROM ${stagedTable(DEVICE_SOURCE.table)} s
        WHERE s.import_run_id = $1 AND to_jsonb(s) ->> 'lab_kalibrasi' IS NOT NULL
        GROUP BY 1 ORDER BY min(s.source_row_number)`,
      [context.runId],
      { transaction: context.transaction },
    )
  ).map((r) => r.raw);

/** The tenant's live calibration laboratories of `keys` (lower-cased name → id). */
const laboratories = async (context: StepContext, keys: readonly string[]): Promise<Map<string, string>> =>
  new Map(
    (
      await sql<{ id: string; key: string }>(
        context.runner,
        `SELECT DISTINCT ON (lower(btrim(name))) id, lower(btrim(name)) AS key FROM vendors
          WHERE tenant_id = $1 AND type = 'CalibrationLab' AND deleted_at IS NULL AND lower(btrim(name)) = ANY($2::text[])
          ORDER BY lower(btrim(name)), created_at, id`,
        [context.tenantId, [...keys]],
        { transaction: context.transaction },
      )
    ).map((r) => [r.key, r.id]),
  );

/** Step 6's `run`: the calibration laboratories. */
export const runVendors = async (context: StepContext): Promise<void> => {
  if (!(await stagedTableExists(context, DEVICE_SOURCE.table))) {
    return;
  }
  const wanted = new Map<string, string>();
  for (const raw of await stagedLaboratories(context)) {
    const vendor = vendorKeyOf(raw);
    if (vendor !== null && !wanted.has(vendor.key)) {
      wanted.set(vendor.key, vendor.name);
    }
  }
  const existing = await laboratories(context, [...wanted.keys()]);
  const created = [...wanted].filter(([key]) => !existing.has(key)).map(([, name]) => ({ id: randomUUID(), name }));
  if (created.length > 0) {
    await sql(
      context.runner,
      `INSERT INTO vendors (id, tenant_id, name, type, approval_status, status, created_at, updated_at)
       SELECT v.id, $1, v.name, 'CalibrationLab', 'PENDING', 'Active', now(), now() FROM unnest($2::uuid[], $3::text[]) AS v(id, name)`,
      [context.tenantId, created.map((c) => c.id), created.map((c) => c.name)],
      { transaction: context.transaction },
    );
  }
  await auditCreated(context, "vendors", created.map((c) => ({ id: c.id, facilityId: null })));
};

/**
 * The run's distinct `(facility, room, floor)` of devices whose facility was imported and that are not
 * an upstream move of an imported device (quarantined by step 8), in the order the dump first has
 * them (the first spelling names a new room).
 */
const stagedRooms = async (context: StepContext): Promise<{ facilityId: string; room: string | null; floor: string | null }[]> =>
  sql<{ facilityId: string; room: string | null; floor: string | null }>(
    context.runner,
    `SELECT m.target_id AS "facilityId", to_jsonb(s) ->> 'nama_ruangan' AS room, to_jsonb(s) ->> 'lantai' AS floor
       FROM ${stagedTable(DEVICE_SOURCE.table)} s
       JOIN ${ID_MAP} m ON m.source_table = 'mst_faskes' AND m.legacy_id = to_jsonb(s) ->> 'id_client' AND m.tenant_id = $2
       LEFT JOIN ${ID_MAP} dm ON dm.source_table = 'trx_inventory' AND dm.legacy_id = to_jsonb(s) ->> 'id' AND dm.tenant_id = $2
       LEFT JOIN calibration_devices d ON d.id = dm.target_id AND d.tenant_id = $2
      WHERE s.import_run_id = $1 AND (d.id IS NULL OR d.client_facility_id = m.target_id)
      GROUP BY 1, 2, 3
      ORDER BY min(s.source_row_number)`,
    [context.runId, context.tenantId],
    { transaction: context.transaction },
  );

/** The tenant's live rooms of `facilities`, by room key. */
const roomsOf = async (context: StepContext, facilities: readonly string[]): Promise<Map<string, string>> =>
  new Map(
    (
      await sql<{ id: string; facilityId: string; name: string; floor: string | null }>(
        context.runner,
        `SELECT id, client_facility_id AS "facilityId", name, floor FROM warehouses
          WHERE tenant_id = $1 AND kind = 'room' AND is_deleted = false AND client_facility_id = ANY($2::uuid[])`,
        [context.tenantId, [...facilities]],
        { transaction: context.transaction },
      )
    ).flatMap((r) => {
      const key = roomKeyOf(r.facilityId, r.name, r.floor);
      return key === null ? [] : [[key.key, r.id] as const];
    }),
  );

/** Step 7's `run`: the rooms. */
export const runRooms = async (context: StepContext): Promise<void> => {
  if (!(await stagedTableExists(context, DEVICE_SOURCE.table))) {
    return;
  }
  const wanted = new Map<string, { facilityId: string; name: string; floor: string | null }>();
  for (const staged of await stagedRooms(context)) {
    const room = roomKeyOf(staged.facilityId, staged.room, staged.floor);
    if (room !== null && !wanted.has(room.key)) {
      wanted.set(room.key, { facilityId: staged.facilityId, name: room.name, floor: room.floor });
    }
  }
  const existing = await roomsOf(context, [...new Set([...wanted.values()].map((w) => w.facilityId))]);
  const missing = [...wanted].filter(([key]) => !existing.has(key)).map(([, room]) => room);
  if (missing.length === 0) {
    return;
  }
  const [last] = await sql<{ n: number }>(
    context.runner,
    "SELECT coalesce(max(substring(code FROM '^R-([0-9]{1,9})$')::int), 0) AS n FROM warehouses WHERE tenant_id = $1 AND code ~ '^R-[0-9]{1,9}$'",
    [context.tenantId],
    { transaction: context.transaction },
  );
  const start = last?.n ?? 0;
  const created = missing.map((room, i) => ({ ...room, id: randomUUID(), code: `R-${String(start + i + 1).padStart(4, "0")}` }));
  await sql(
    context.runner,
    `INSERT INTO warehouses (id, tenant_id, client_facility_id, name, code, floor, kind, status, is_deleted, created_at, updated_at)
     SELECT v.id, $1, v.facility, v.name, v.code, v.floor, 'room', 'active', false, now(), now()
       FROM unnest($2::uuid[], $3::uuid[], $4::text[], $5::text[], $6::text[]) AS v(id, facility, name, code, floor)`,
    [context.tenantId, created.map((c) => c.id), created.map((c) => c.facilityId), created.map((c) => c.name), created.map((c) => c.code), created.map((c) => c.floor)],
    { transaction: context.transaction },
  );
  await auditCreated(context, "warehouses", created.map((c) => ({ id: c.id, facilityId: c.facilityId })));
};

// ── the devices ─────────────────────────────────────────────────────────────

const readDevices = (context: StepContext): Promise<StagedDeviceRow[]> =>
  sql<StagedDeviceRow>(
    context.runner,
    `SELECT c."sourceRowNumber", c."legacyId", c."rowHash", c."targetId", c.decision,
            (t.id IS NOT NULL) AS "targetPresent", (t.deleted_at IS NOT NULL) AS "targetDeleted", t.client_facility_id AS "targetFacilityId",
            to_jsonb(s) - 'import_run_id' - 'source_row_number' AS row
       FROM (${classifiedSql(DEVICE_SOURCE)}) c
       JOIN ${stagedTable(DEVICE_SOURCE.table)} s ON s.import_run_id = $1 AND s.source_row_number = c."sourceRowNumber"::bigint
       LEFT JOIN calibration_devices t ON t.id = c."targetId" AND t.tenant_id = $2`,
    [context.runId, context.tenantId],
    { transaction: context.transaction },
  );

/** The current mappings of `table`'s keys (legacy id → target id), in the tenant or global. */
const mapped = async (context: StepContext, table: string, keys: readonly string[]): Promise<Map<string, string>> =>
  new Map(
    (
      await sql<{ legacyId: string; targetId: string }>(
        context.runner,
        `SELECT legacy_id AS "legacyId", target_id AS "targetId" FROM ${ID_MAP}
          WHERE source_table = $1 AND legacy_id = ANY($2::text[]) AND (tenant_id = $3 OR tenant_id IS NULL)`,
        [table, [...keys], context.tenantId],
        { transaction: context.transaction },
      )
    ).map((r) => [r.legacyId, r.targetId]),
  );

const keysOf = (rows: readonly StagedDeviceRow[], key: string): string[] =>
  [...new Set(rows.map((r) => textOf(r.row, key)).filter((k): k is string => k !== null))];

/** Step 8's `run`: the devices. */
export const runDevices = async (context: StepContext): Promise<void> => {
  const { runner, transaction, tenantId } = context;
  if (!(await stagedTableExists(context, DEVICE_SOURCE.table))) {
    return;
  }
  const rows = await readDevices(context);
  const settings = new Map(
    (
      await sql<{ key: string; value: string | null }>(
        runner,
        "SELECT key, value FROM tenant_settings WHERE tenant_id = $1 AND key = ANY($2::text[])",
        [tenantId, [DEVICE_SETTING_KEYS.qrPrefix, DEVICE_SETTING_KEYS.qrDigits]],
        { transaction },
      )
    ).map((r) => [r.key, r.value ?? undefined]),
  );
  const facilityIds = await mapped(context, "mst_faskes", keysOf(rows, "id_client"));
  const present = new Set(
    (
      await sql<{ id: string }>(runner, "SELECT id FROM client_facilities WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, [...new Set(facilityIds.values())]], {
        transaction,
      })
    ).map((f) => f.id),
  );
  const facilities = new Map([...facilityIds].filter(([, id]) => present.has(id)));
  const typeIds = await mapped(context, "mst_alat", keysOf(rows, "id_alat"));
  const typeNames = new Map(
    (await sql<{ id: string; name: string }>(runner, "SELECT id, name FROM device_types WHERE id = ANY($1::uuid[])", [[...new Set(typeIds.values())]], { transaction })).map((t) => [
      t.id,
      t.name,
    ]),
  );
  const types = new Map(
    [...typeIds].flatMap(([legacy, id]) => {
      const name = typeNames.get(id);
      return name === undefined ? [] : [[legacy, { id, name }] as const];
    }),
  );
  const userIds = await mapped(context, "users", keysOf(rows, "id_user"));
  const people = await sql<{ id: string; firstName: string | null; lastName: string | null; role: string | null; organisation: string | null }>(
    runner,
    `SELECT u.id, u.first_name AS "firstName", u.last_name AS "lastName", r.name AS role, coalesce(f.name, t.name) AS organisation
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN client_facilities f ON f.id = u.client_facility_id
       LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE u.tenant_id = $1 AND u.id = ANY($2::uuid[])`,
    [tenantId, [...new Set(userIds.values())]],
    { transaction },
  );
  const personOf = new Map(
    people.map((p) => {
      const name = [p.firstName, p.lastName].filter((n): n is string => n !== null && n.trim() !== "").join(" ").trim();
      return [p.id, { name: name === "" ? UNNAMED_PERSON : name, role: p.role, organisation: p.organisation }] as const;
    }),
  );
  const users = new Map(
    [...userIds].flatMap(([legacy, id]) => {
      const snapshot = personOf.get(id);
      return snapshot === undefined ? [] : [[legacy, { id, snapshot }] as const];
    }),
  );
  const formerUsers = new Map(
    (await sql<{ legacyId: string; number: number }>(runner, `SELECT legacy_user_id AS "legacyId", number FROM ${FORMER_USERS}`, [], { transaction })).map((f) => [f.legacyId, f.number]),
  );
  const vendorKeys = [...new Set(keysOf(rows, "lab_kalibrasi").map((raw) => vendorKeyOf(raw)?.key).filter((k): k is string => k !== undefined))];
  const vendors = await laboratories(context, vendorKeys);
  const rooms = await roomsOf(context, [...new Set(facilities.values())]);
  const qr = qrSettingsOf(settings.get(DEVICE_SETTING_KEYS.qrPrefix), settings.get(DEVICE_SETTING_KEYS.qrDigits));
  const candidates = rows.map((r) => normaliseQrCode(textOf(r.row, "no_qrcode") ?? "", qr)).flatMap((n) => (n.ok ? [n.value] : []));
  const takenQr = new Map(
    (
      await sql<{ id: string; qrCode: string }>(
        runner,
        "SELECT id, qr_code AS \"qrCode\" FROM calibration_devices WHERE tenant_id = $1 AND qr_code = ANY($2::text[])",
        [tenantId, candidates],
        { transaction },
      )
    ).map((d) => [d.qrCode, d.id]),
  );
  const serials = [...new Set(rows.map((r) => serialOf(textOf(r.row, "sn"))).filter((s): s is string => s !== null))];
  const takenSerial = new Map(
    (
      await sql<{ id: string; facilityId: string; serial: string }>(
        runner,
        `SELECT id, client_facility_id AS "facilityId", serial_number AS serial FROM calibration_devices
          WHERE tenant_id = $1 AND serial_number = ANY($2::text[])`,
        [tenantId, serials],
        { transaction },
      )
    ).map((d) => [`${d.facilityId}|${d.serial}`, d.id]),
  );

  const plan = planDevices({ rows, tenantId, qr, facilities, types, users, formerUsers, vendors, rooms, takenQr, takenSerial, newId: randomUUID });
  if (plan.formerUsers.length > 0) {
    await sql(
      runner,
      `INSERT INTO ${FORMER_USERS} (legacy_user_id, number, first_import_run_id) SELECT v.legacy, v.n, $1 FROM unnest($2::text[], $3::int[]) AS v(legacy, n)`,
      [context.runId, plan.formerUsers.map((f) => f.legacyId), plan.formerUsers.map((f) => f.number)],
      { transaction },
    );
  }
  await writeDevices(context, plan);
  await quarantineRows(context, plan.quarantine);
  await recordMappings(context, plan.mappings);
};

/** The bound arrays of a device write, in `unnestFrom`'s order. */
const deviceColumns = (devices: readonly DeviceValues[]): BindValue[] => [
  devices.map((d) => d.id),
  devices.map((d) => d.sourceRowNumber),
  devices.map((d) => d.facilityId),
  devices.map((d) => d.name),
  devices.map((d) => d.serialNumber),
  devices.map((d) => d.manufacturer),
  devices.map((d) => d.model),
  devices.map((d) => d.category),
  devices.map((d) => d.status),
  devices.map((d) => d.locationId),
  devices.map((d) => d.deviceTypeId),
  devices.map((d) => d.qrCode),
  devices.map((d) => d.inventoriedOn),
  devices.map((d) => d.accessoriesComplete),
  devices.map((d) => d.condition),
  devices.map((d) => d.vendorId),
  devices.map((d) => d.createdBy),
  devices.map((d) => (d.registrantSnapshot === null ? null : JSON.stringify(d.registrantSnapshot))),
];

const UNNEST_TYPES = ["uuid", "bigint", "uuid", "text", "text", "text", "text", "text", "text", "uuid", "uuid", "text", "date", "boolean", "text", "uuid", "uuid", "text"];

/** The device arrays unnested from parameter `$first` on (deviceColumns' order). */
const unnestFrom = (first: number): string =>
  `unnest(${UNNEST_TYPES.map((type, i) => `$${String(first + i)}::${type}[]`).join(", ")})
         AS v(id, srn, facility, name, serial, manufacturer, model, category, status, location, type, qr, inventoried, accessories, condition,
              vendor, created_by, snapshot)`;

/** Inserts and updates (one statement each); timestamps from the staged row, read in the source zone. */
const writeDevices = async (context: StepContext, plan: DevicePlan): Promise<void> => {
  const { runner, transaction, runId, tenantId, sourceZone } = context;
  if (plan.insert.length > 0) {
    await sql(
      runner,
      `INSERT INTO calibration_devices (id, tenant_id, client_facility_id, name, serial_number, manufacturer, model, category, status, location_id,
                                        device_type_id, qr_code, inventoried_on, accessories_complete, "condition", condition_changed_at,
                                        condition_source, calibration_vendor_id, created_by, registrant_snapshot, iot_enabled, is_deleted,
                                        created_at, updated_at)
       SELECT v.id, $2, v.facility, v.name, v.serial, v.manufacturer, v.model, v.category, v.status::"enum_calibration_devices_status", v.location,
              v.type, v.qr, v.inventoried, v.accessories, v.condition::"enum_calibration_devices_condition",
              CASE WHEN v.condition IS NULL THEN NULL ELSE now() END,
              CASE WHEN v.condition IS NULL THEN NULL ELSE 'import' END::"enum_calibration_devices_condition_source",
              v.vendor, v.created_by, v.snapshot::jsonb, false, false,
              coalesce((to_jsonb(s) ->> 'created_at')::timestamp AT TIME ZONE $21, (to_jsonb(s) ->> 'tgl_inventory')::date::timestamp AT TIME ZONE $21, now()),
              coalesce((to_jsonb(s) ->> 'updated_at')::timestamp AT TIME ZONE $21, (to_jsonb(s) ->> 'created_at')::timestamp AT TIME ZONE $21,
                       (to_jsonb(s) ->> 'tgl_inventory')::date::timestamp AT TIME ZONE $21, now())
         FROM ${unnestFrom(3)}
         JOIN ${stagedTable(DEVICE_SOURCE.table)} s ON s.import_run_id = $1 AND s.source_row_number = v.srn`,
      [runId, tenantId, ...deviceColumns(plan.insert), sourceZone],
      { transaction },
    );
  }
  if (plan.update.length > 0) {
    await sql(
      runner,
      `UPDATE calibration_devices t
          SET name = v.name, serial_number = v.serial, manufacturer = v.manufacturer, model = v.model,
              category = v.category, status = v.status::"enum_calibration_devices_status", location_id = v.location, device_type_id = v.type,
              qr_code = v.qr, inventoried_on = v.inventoried, accessories_complete = v.accessories,
              "condition" = v.condition::"enum_calibration_devices_condition",
              condition_changed_at = CASE WHEN t."condition"::text IS NOT DISTINCT FROM v.condition THEN t.condition_changed_at
                                          WHEN v.condition IS NULL THEN NULL ELSE now() END,
              condition_source = CASE WHEN v.condition IS NULL THEN NULL
                                      WHEN t."condition"::text IS NOT DISTINCT FROM v.condition THEN t.condition_source
                                      ELSE 'import' END::"enum_calibration_devices_condition_source",
              calibration_vendor_id = v.vendor, created_by = v.created_by, registrant_snapshot = v.snapshot::jsonb, updated_at = now()
         FROM ${unnestFrom(2)}
        WHERE t.id = v.id AND t.tenant_id = $1 AND t.deleted_at IS NULL`,
      [tenantId, ...deviceColumns(plan.update)],
      { transaction },
    );
  }
};
