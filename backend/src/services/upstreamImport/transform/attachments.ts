/**
 * Step 9 of the transform (P24-03; ADR-129 Am. 10; docs/UPSTREAM/05 § 3.1, § 6; 08-FILE-POLICY
 * § 7, § 11; 04 § 4.6): the device photos, and the certificate index.
 *
 * THE CERTIFICATE INDEX (`trx_inventory_file`, the step's staged source). The PDFs it names are
 * archived offline and no certificate file is stored (owner rule 2026-10-07, 07 § 2.3, F-CERT):
 * every row is quarantined `certificate_archived_offline` — accounted for, never an attachment.
 *
 * THE PHOTOS (`trx_inventory.foto_depan`, `.foto_sn` — columns of the device rows step 8 mapped).
 * Each folder is accounted as its own source in the summary (`foto_depan`, `foto_sn`): a device row
 * naming a file is a photo that ends MAPPED (`id_map`, source table = the folder, legacy id = the
 * device's) or QUARANTINED (source table = the folder, the device row's number) — 05 R-8's
 * "referenced names per folder = attachments + quarantine". Per photo:
 *
 *   the value's last path segment (absolute URL or bare name, 07 § 2.3: the host is stripped)
 *   the device: step 8's mapping, live in the tenant          ── none → no_device
 *   the manifest's decision for `<folder>/<name>`             ── none → file_missing; refused → its reason
 *   same file as the current mapping (hash of path + SHA-256) ── unchanged, nothing written
 *   a live photo of that purpose the import did not write     ── photo_operator_managed (never replaced)
 *   the tenant-scope object read, its SHA-256 = the manifest's ── unreadable → file_missing; else storage_verify_failed
 *   a full decode and the two derivatives (P21-02b's pipeline) ── image_undecodable
 *   original + display + thumb put under the DEVICE's facility (`t/<tenant>/f/<facility>/attachments/`)
 *   the earlier imported photo soft-deleted (the replace), the row inserted, the mapping, the audit rows
 *
 * The rows are the application's own device-photo rows (devicePhoto.service: resource `device`,
 * purpose `device_front` / `device_serial_plate`, `<purpose>.<ext>` as the shown name, the stored
 * bytes' SHA-256, no uploader). The step audits itself (auditRows.ts STEP_AUDITED): a CREATE per new
 * row, a DELETE per replaced one. A storage failure on put fails the transform — and the objects
 * already written are removed with the rollback (photoFiles.ts `created`).
 */
import { createHash } from "crypto";
import { sql } from "../../../utils/sql.util";
import { SYSTEM_ACTORS } from "../../../constants/systemActors";
import type { UpstreamImportQuarantineReason } from "@callibrator/contracts/upstreamSqlImport";
import { UPSTREAM_IMPORT_QUARANTINE_REASONS } from "@callibrator/contracts/upstreamSqlImport";
import { UndecodableImageError, buildDerivatives } from "../../devicePhoto/imageDerivatives";
import { derivativeKeyOf } from "../../devicePhoto/derivativeKeys";
import { extensionOf, mimeOf } from "../../upstreamFileImport/imageInspect";
import { ID_MAP, QUARANTINE, quarantineRows, recordMappings, stagedTable, stagedTableExists, type Mapping, type QuarantineEntry } from "./ledger";
import { DEVICE_SOURCE } from "./inventory";
import { TransformFailure } from "./failure";
import type { PhotoSource, TransformFiles } from "./photoFiles";
import type { StepContext, TransformSource } from "./steps";

/** The step's staged source: the certificate index, archive-only. */
export const CERTIFICATE_SOURCE: TransformSource = Object.freeze({ table: "trx_inventory_file", legacyId: 's."id"::text' });

/** The two photo folders: the device column, the folder of the manifest's source paths, the photo's purpose. */
export const PHOTO_FOLDERS = Object.freeze([
  Object.freeze({ folder: "foto_depan", purpose: "device_front" }),
  Object.freeze({ folder: "foto_sn", purpose: "device_serial_plate" }),
] as const);
export type PhotoFolder = (typeof PHOTO_FOLDERS)[number]["folder"];

/** The attachment rows' resource type and legacy folder column (devicePhoto.service). */
const RESOURCE_TYPE = "device";
const ATTACH_FOLDER = "uploads/attachments";
const KNOWN_REASONS: ReadonlySet<string> = new Set(UPSTREAM_IMPORT_QUARANTINE_REASONS);

const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

/**
 * The file name a photo column names: its last path segment, without a query or fragment, URL-decoded
 * when it decodes. Null for an empty value or one with no usable name.
 */
export const photoNameOf = (value: string | null): string | null => {
  const raw = (value ?? "").trim().replace(/[?#][\s\S]*$/, "");
  const segment = raw.slice(Math.max(raw.lastIndexOf("/"), raw.lastIndexOf("\\")) + 1);
  let name = segment;
  try {
    name = decodeURIComponent(segment);
  } catch {
    // a stray % — the name as written
  }
  return name === "" || name === "." || name === ".." || name.includes("/") ? null : name;
};

/** A photo's `source_row_hash`: its source path and the stored bytes' SHA-256 — a re-run of the same file is unchanged. */
export const photoHashOf = (sourcePath: string, storedSha256: string): string => sha256(`${sourcePath}\n${storedSha256}`);

/** One staged device row with its photo columns and its device. */
export interface PhotoRow {
  sourceRowNumber: string;
  legacyId: string;
  front: string | null;
  serial: string | null;
  deviceId: string | null;
  facilityId: string | null;
}

/** A photo's current mapping. */
export interface PhotoMapping {
  folder: string;
  legacyId: string;
  targetId: string;
  rowHash: string;
}

/** A device's live photo of a purpose. */
export interface LivePhoto {
  id: string;
  deviceId: string;
  purpose: string;
  storageKey: string | null;
}

/** One photo to write. */
export interface PhotoWork {
  folder: PhotoFolder;
  purpose: string;
  sourceRowNumber: string;
  legacyId: string;
  deviceId: string;
  facilityId: string | null;
  source: Extract<PhotoSource, { outcome: "ingested" }>;
  rowHash: string;
  /** The earlier imported photo this one replaces. */
  replaces: LivePhoto | null;
}

/** The plan of the photos: what to quarantine, what to write. */
export interface PhotoPlan {
  quarantine: QuarantineEntry[];
  work: PhotoWork[];
  unchanged: number;
}

const reasonOf = (reason: string): UpstreamImportQuarantineReason =>
  (KNOWN_REASONS.has(reason) ? reason : "ingest_failed") as UpstreamImportQuarantineReason;

/**
 * Decide every photo (pure).
 * @param rows - the run's device rows
 * @param mappings - the photos' current mappings
 * @param live - the devices' live photos of the two purposes
 * @param catalogue - the manifests' decisions
 */
export const planPhotos = (
  rows: readonly PhotoRow[],
  mappings: readonly PhotoMapping[],
  live: readonly LivePhoto[],
  catalogue: ReadonlyMap<string, PhotoSource>,
): PhotoPlan => {
  const plan: PhotoPlan = { quarantine: [], work: [], unchanged: 0 };
  const mapped = new Map(mappings.map((m) => [`${m.folder}:${m.legacyId}`, m]));
  const livePhotos = new Map(live.map((p) => [`${p.deviceId}:${p.purpose}`, p]));
  for (const row of rows) {
    for (const { folder, purpose } of PHOTO_FOLDERS) {
      const value = folder === "foto_depan" ? row.front : row.serial;
      if (value === null) {
        continue;
      }
      const quarantine = (reason: UpstreamImportQuarantineReason): void => {
        plan.quarantine.push({ sourceTable: folder, sourceRowNumber: row.sourceRowNumber, legacyId: row.legacyId, reason });
      };
      const name = photoNameOf(value);
      if (row.deviceId === null) {
        quarantine("no_device");
        continue;
      }
      const source = name === null ? undefined : catalogue.get(`${folder}/${name}`);
      if (source === undefined) {
        quarantine("file_missing");
        continue;
      }
      if (source.outcome === "quarantined") {
        quarantine(reasonOf(source.reason));
        continue;
      }
      const rowHash = photoHashOf(`${folder}/${name as string}`, source.storedSha256);
      const earlier = mapped.get(`${folder}:${row.legacyId}`);
      if (earlier?.rowHash === rowHash) {
        plan.unchanged += 1;
        continue;
      }
      const current = livePhotos.get(`${row.deviceId}:${purpose}`) ?? null;
      if (current !== null && current.id !== earlier?.targetId) {
        quarantine("photo_operator_managed");
        continue;
      }
      plan.work.push({
        folder,
        purpose,
        sourceRowNumber: row.sourceRowNumber,
        legacyId: row.legacyId,
        deviceId: row.deviceId,
        facilityId: row.facilityId,
        source,
        rowHash,
        replaces: current,
      });
    }
  }
  return plan;
};

/** The run's device rows with their photo columns and their mapped, live device. */
const readPhotoRows = async (context: StepContext): Promise<PhotoRow[]> => {
  if (!(await stagedTableExists(context, DEVICE_SOURCE.table))) {
    return [];
  }
  return sql<PhotoRow>(
    context.runner,
    `SELECT s.source_row_number::text AS "sourceRowNumber", (${DEVICE_SOURCE.legacyId as string}) AS "legacyId",
            nullif(btrim(to_jsonb(s) ->> 'foto_depan'), '') AS front, nullif(btrim(to_jsonb(s) ->> 'foto_sn'), '') AS serial,
            d.id AS "deviceId", d.client_facility_id AS "facilityId"
       FROM ${stagedTable(DEVICE_SOURCE.table)} s
       LEFT JOIN ${ID_MAP} m ON m.source_table = 'trx_inventory' AND m.legacy_id = (${DEVICE_SOURCE.legacyId as string})
                            AND m.target_table = 'calibration_devices'
       LEFT JOIN calibration_devices d ON d.id = m.target_id AND d.tenant_id = $2 AND d.deleted_at IS NULL
      WHERE s.import_run_id = $1
        AND (nullif(btrim(to_jsonb(s) ->> 'foto_depan'), '') IS NOT NULL OR nullif(btrim(to_jsonb(s) ->> 'foto_sn'), '') IS NOT NULL)
      ORDER BY s.source_row_number`,
    [context.runId, context.tenantId],
    { transaction: context.transaction },
  );
};

const FOLDER_NAMES = PHOTO_FOLDERS.map((f) => f.folder);
const PURPOSES = PHOTO_FOLDERS.map((f) => f.purpose);

/** One audit row of the step, in the transform's transaction. */
const audit = (context: StepContext, action: "CREATE" | "DELETE", id: string, facilityId: string | null, changes: Record<string, unknown>): Promise<unknown> =>
  sql(
    context.runner,
    `INSERT INTO audit_logs (id, tenant_id, user_id, actor_type, actor_name, action, resource_type, resource_id, client_facility_id, changes, created_at)
     VALUES (gen_random_uuid(), $1::uuid, NULL, 'system', $2, $3::"enum_audit_logs_action", 'Attachment', $4, $5::uuid, $6::jsonb, now())`,
    [
      context.tenantId,
      SYSTEM_ACTORS.UPSTREAM_TRANSFORM,
      action,
      id,
      facilityId,
      JSON.stringify({ operation: "UPSTREAM_IMPORT", source: "skp_ipm", importRunId: context.runId, ...changes }),
    ],
    { transaction: context.transaction },
  );

/**
 * Write one planned photo: read and verify the ingested object, build the derivatives, put the three
 * objects under the device's facility, replace the earlier imported photo, insert the row.
 * @returns the mapping, or the quarantine reason when the file fails here
 */
const writePhoto = async (context: StepContext, files: TransformFiles, work: PhotoWork): Promise<Mapping | UpstreamImportQuarantineReason> => {
  let bytes: Buffer;
  try {
    bytes = await files.readObject(work.source.storageKey);
  } catch {
    return "file_missing";
  }
  if (sha256(bytes) !== work.source.storedSha256) {
    return "storage_verify_failed";
  }
  let derivatives: ReturnType<typeof buildDerivatives>;
  try {
    derivatives = buildDerivatives(work.source.type, bytes);
  } catch (err) {
    if (err instanceof UndecodableImageError) {
      return "image_undecodable";
    }
    throw err;
  }
  const id = files.newId();
  const ext = extensionOf(work.source.type);
  const mimeType = mimeOf(work.source.type);
  const key = files.buildKey(`${id}.${ext}`, work.facilityId);
  for (const object of [
    { key, bytes, contentType: mimeType },
    { key: derivativeKeyOf(key, "display"), bytes: derivatives.display, contentType: "image/jpeg" },
    { key: derivativeKeyOf(key, "thumb"), bytes: derivatives.thumb, contentType: "image/jpeg" },
  ]) {
    files.created.push(object.key);
    await files.putObject(object.key, object.bytes, object.contentType);
  }
  if (work.replaces !== null) {
    await sql(
      context.runner,
      "UPDATE attachments SET is_deleted = true, updated_at = now() WHERE id = $1 AND tenant_id = $2 AND is_deleted = false",
      [work.replaces.id, context.tenantId],
      { transaction: context.transaction },
    );
    await audit(context, "DELETE", work.replaces.id, work.facilityId, {
      sourceTable: work.folder,
      targetTable: "attachments",
      purpose: work.purpose,
      replacedBy: id,
    });
  }
  await sql(
    context.runner,
    `INSERT INTO attachments (id, tenant_id, resource_type, resource_id, client_facility_id, rekey_pending, purpose, file_name, original_name,
                              folder, storage_key, mime_type, size, checksum, uploaded_by, is_deleted, created_at, updated_at)
     VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, false, $6, $7, $8, $9, $10, $11, $12, $13, NULL, false, now(), now())`,
    [id, context.tenantId, RESOURCE_TYPE, work.deviceId, work.facilityId, work.purpose, `${id}.${ext}`, `${work.purpose}.${ext}`, ATTACH_FOLDER, key, mimeType, bytes.length, work.source.storedSha256],
    { transaction: context.transaction },
  );
  await audit(context, "CREATE", id, work.facilityId, { sourceTable: work.folder, targetTable: "attachments", purpose: work.purpose, size: bytes.length });
  files.superseded.push(work.source.storageKey);
  return {
    sourceTable: work.folder,
    legacyId: work.legacyId,
    targetTable: "attachments",
    targetId: id,
    tenantId: context.tenantId,
    clientFacilityId: work.facilityId,
    rowHash: work.rowHash,
    sourceValues: null,
  };
};

/** Step 9's `run`. */
export const runAttachments = async (context: StepContext): Promise<void> => {
  if (await stagedTableExists(context, CERTIFICATE_SOURCE.table)) {
    await sql(
      context.runner,
      `INSERT INTO ${QUARANTINE} (import_run_id, source_table, source_row_number, legacy_id, reason)
       SELECT $1::uuid, 'trx_inventory_file', s.source_row_number, (${CERTIFICATE_SOURCE.legacyId as string}), 'certificate_archived_offline'
         FROM ${stagedTable(CERTIFICATE_SOURCE.table)} s
        WHERE s.import_run_id = $1
       ON CONFLICT DO NOTHING`,
      [context.runId],
      { transaction: context.transaction },
    );
  }
  const rows = await readPhotoRows(context);
  if (rows.length === 0) {
    return;
  }
  const files = context.files;
  if (files === undefined) {
    throw new TransformFailure("TRANSFORM_FAILED", "step attachments: the run names photos and the transform was given no file storage");
  }
  const legacyIds = rows.map((r) => r.legacyId);
  const devices = [...new Set(rows.map((r) => r.deviceId).filter((d): d is string => d !== null))];
  const mappings = await sql<PhotoMapping>(
    context.runner,
    `SELECT source_table AS folder, legacy_id AS "legacyId", target_id AS "targetId", source_row_hash AS "rowHash"
       FROM ${ID_MAP} WHERE source_table = ANY($1::text[]) AND legacy_id = ANY($2::text[])`,
    [FOLDER_NAMES, legacyIds],
    { transaction: context.transaction },
  );
  const live = await sql<LivePhoto>(
    context.runner,
    `SELECT id, resource_id AS "deviceId", purpose, storage_key AS "storageKey" FROM attachments
      WHERE tenant_id = $1 AND resource_type = $2 AND resource_id = ANY($3::uuid[]) AND purpose = ANY($4::text[]) AND is_deleted = false`,
    [context.tenantId, RESOURCE_TYPE, devices, PURPOSES],
    { transaction: context.transaction },
  );
  const plan = planPhotos(rows, mappings, live, files.catalogue);
  const written: Mapping[] = [];
  for (const work of plan.work) {
    const outcome = await writePhoto(context, files, work);
    if (typeof outcome === "string") {
      plan.quarantine.push({ sourceTable: work.folder, sourceRowNumber: work.sourceRowNumber, legacyId: work.legacyId, reason: outcome });
    } else {
      written.push(outcome);
    }
  }
  await quarantineRows(context, plan.quarantine);
  await recordMappings(context, written);
};

/** A folder's counts: the summary's source shape, plus what is neither mapped nor quarantined. */
export interface FolderCounts {
  table: string;
  staged: number;
  mapped: number;
  unchanged: number;
  quarantined: Record<string, number>;
  unaccounted: number;
}

/**
 * Step 9's accounting of the photos, per folder (05 R-8): every device row of the run naming a file
 * is mapped by this run, unchanged, or quarantined — the runner fails the transform otherwise.
 */
export const accountPhotos = async (context: StepContext): Promise<FolderCounts[]> => {
  const present = await stagedTableExists(context, DEVICE_SOURCE.table);
  const out: FolderCounts[] = [];
  for (const { folder } of PHOTO_FOLDERS) {
    const counts: FolderCounts = { table: folder, staged: 0, mapped: 0, unchanged: 0, quarantined: {}, unaccounted: 0 };
    if (present) {
      const [row] = await sql<Omit<FolderCounts, "table" | "quarantined">>(
        context.runner,
        `SELECT count(*)::int AS staged,
                count(*) FILTER (WHERE m.import_run_id = $1)::int AS mapped,
                count(*) FILTER (WHERE m.legacy_id IS NOT NULL AND m.import_run_id <> $1)::int AS unchanged,
                count(*) FILTER (WHERE m.legacy_id IS NULL AND NOT EXISTS (
                  SELECT 1 FROM ${QUARANTINE} q WHERE q.import_run_id = $1 AND q.source_table = $2 AND q.source_row_number = s.source_row_number))::int AS unaccounted
           FROM ${stagedTable(DEVICE_SOURCE.table)} s
           LEFT JOIN ${ID_MAP} m ON m.source_table = $2 AND m.legacy_id = (${DEVICE_SOURCE.legacyId as string})
          WHERE s.import_run_id = $1 AND nullif(btrim(to_jsonb(s) ->> $2), '') IS NOT NULL`,
        [context.runId, folder],
        { transaction: context.transaction },
      );
      counts.staged = row?.staged ?? 0;
      counts.mapped = row?.mapped ?? 0;
      counts.unchanged = row?.unchanged ?? 0;
      counts.unaccounted = row?.unaccounted ?? 0;
    }
    const reasons = await sql<{ reason: string; n: number }>(
      context.runner,
      `SELECT reason, count(*)::int AS n FROM ${QUARANTINE} WHERE import_run_id = $1 AND source_table = $2 GROUP BY reason ORDER BY reason`,
      [context.runId, folder],
      { transaction: context.transaction },
    );
    for (const { reason, n } of reasons) {
      counts.quarantined[reason] = n;
    }
    out.push(counts);
  }
  return out;
};
