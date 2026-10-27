/**
 * P24-03 (ADR-129 Am. 10) — the WHOLE transform, end to end, on a REAL PostgreSQL 18 and real local
 * storage, through the service (request → inline batch job → the transform role's connection):
 *
 *  - migration 0145: down / up / up rebuilds the same grants and reasons; the transform role can
 *    neither delete an attachment nor change its key, checksum or facility;
 *  - the image imports' manifests made by the REAL ingest (P24-07's `ingestStaged`, local storage):
 *    a JPEG, a PNG, a HEIC refused, then the ETL's conversion of that HEIC re-imported under the same
 *    path (ADR-132 Am. 3);
 *  - a synthetic dump touching every step: the request is no longer refused 409 TRANSFORM_NOT_AVAILABLE;
 *    all 13 steps run in 05 § 3.1 order in ONE transaction and every staged row ends mapped or
 *    quarantined (the runner's proof), the photo folders accounted the same way;
 *  - the photos: device-photo rows under the DEVICE's facility key with both derivatives, the
 *    tenant-scope originals re-keyed away, the certificate index archive-only, a missing file, a
 *    device that was not imported, the audit rows;
 *  - a re-run of the same dump writes no photo; a changed upstream photo replaces the import's own
 *    earlier one (soft delete + new row); a photo the operator set is never replaced.
 *
 * Synthetic values and generated images only; nothing from upstream.
 *
 *   docker run -d --name s1-p2403-pg18 -e POSTGRES_PASSWORD=p2403pass -p 127.0.0.1:56281:5432 pgvector/pgvector:pg18
 *   DB_HOST=127.0.0.1 DB_PORT=56281 DB_USER=postgres DB_PASS=p2403pass npm run test:live -- --only=p2403
 *   docker rm -f s1-p2403-pg18
 */
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type { Transaction } from "sequelize";
import { env, environment } from "../../config/env";
import type * as ServiceModule from "../../services/upstreamSqlTransform.service";
import type * as IngestModule from "../../services/upstreamFileImport/ingest";
import type * as WorkspaceModule from "../../services/upstreamFileImport/workspace";
import type * as M0145 from "../../migrations/0145-upstream-transform-attachments";
import type * as ReconciliationModule from "../../services/upstreamReconciliation.service";
import { heic, jpeg, png } from "../fixtures/photoFixtures";

const IMPORT_ROLE = "callibrator_import";
const TRANSFORM_ROLE = "callibrator_transform";
const PROVIDER = "a2403000-0000-4000-8000-0000000000c7";
const SELF = "a2403000-0000-4000-8000-0000000000c8";
const OPERATOR = "a2403000-0000-4000-8000-0000000000d1";
const RUN_1 = "a2403000-0000-4000-8000-0000000000f1";
const RUN_2 = "a2403000-0000-4000-8000-0000000000f2";
const RUN_3 = "a2403000-0000-4000-8000-0000000000f3";
const FILE_IMPORTS = ["a2403000-0000-4000-8000-000000000101", "a2403000-0000-4000-8000-000000000102", "a2403000-0000-4000-8000-000000000103"];
const ORDER = [
  "client_facilities", "users", "device_types", "inspection_item_definitions", "inspection_templates", "vendors", "warehouses",
  "calibration_devices", "attachments", "calibration_records", "inspection_sessions", "inspection_results", "audit_logs",
];

const penv = environment();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "p2403-live-"));
penv["STORAGE_DRIVER"] = "local";
penv["STORAGE_LOCAL_ROOT"] = path.join(TMP, "storage");
penv["UPSTREAM_FILE_IMPORT_DIR"] = path.join(TMP, "upstream-import");
penv["BATCH_JOBS_INLINE"] = "true";

type Row = Record<string, unknown>;
type Cell = string | number | null;
interface LiveDb {
  options: { logging: unknown };
  query(sql: string, options?: object): Promise<[Row[], unknown]>;
  transaction(): Promise<Transaction>;
  getQueryInterface(): unknown;
  close(): Promise<void>;
}
interface Scoped {
  buildKey(input: { domain: string; name: string }): string;
  put(key: string, body: Buffer, options: { contentType: string }): Promise<unknown>;
}

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

/* eslint-disable @typescript-eslint/no-require-imports -- the graph is loaded after the environment is set; typed by the members used */
const load = () => ({
  db: (require("../../config") as { db: LiveDb }).db,
  migrator: (require("../../config/migrator") as { migrator: { pending(): Promise<unknown[]> } }).migrator,
  migrationLock: require("../../utils/migrationLock.util") as { runSchemaSetup(options: object): Promise<unknown> },
  service: require("../../services/upstreamSqlTransform.service") as typeof ServiceModule,
  ingest: require("../../services/upstreamFileImport/ingest") as typeof IngestModule,
  workspace: require("../../services/upstreamFileImport/workspace") as typeof WorkspaceModule,
  storage: require("../../services/storage") as { getTenantStorage(tenantId: string): Promise<Scoped> },
  storedFile: require("../../services/storedFile.service") as { readObject(s: Scoped, k: string): Promise<Buffer>; removeObject(s: Scoped, k: string): Promise<void> },
  tenantStorage: (require("../../middlewares/tenantContext.middleware") as { tenantStorage: { run<T>(ctx: object, fn: () => T): T } }).tenantStorage,
  m0145: require("../../migrations/0145-upstream-transform-attachments") as typeof M0145,
  reconciliation: require("../../services/upstreamReconciliation.service") as typeof ReconciliationModule,
});
/* eslint-enable @typescript-eslint/no-require-imports */

const IPM = "id_client integer, id_user integer, id_alat integer, no_qrcode varchar(45), description varchar(255), status varchar(10), created_at timestamp, updated_at timestamp";

/** The synthetic dump. `variant` changes it for the re-runs. */
const world = (variant: "first" | "changed"): Record<string, { columns: string; rows: readonly (readonly Cell[])[] }> => ({
  stg_mst_faskes: { columns: "id, name_faskes", rows: [[1, "RS Sintetis Satu"], [2, "Klinik Sintetis Dua"]] },
  stg_auth_groups: { columns: "id, name, description", rows: [[1, "admin", null]] },
  stg_users: {
    columns: "id, email, username, fullname, active, created_at, updated_at",
    rows: [[7, "teknisi.p2403@example.test", "teknisip", "Teknisi Sintetis", 1, "2023-06-01 09:00:00", null]],
  },
  stg_auth_groups_users: { columns: "group_id, user_id", rows: [[1, 7]] },
  stg_mst_alat: { columns: "id, nama_alat", rows: [[1, "Pompa Infus"]] },
  stg_mst_pemeriksaan_fungsi_alat: { columns: "id, description, status", rows: [[1, "Fungsi sintetis", "0,1,-1"]] },
  stg_mapping_fugsi_alat: { columns: "id, id_alat, id_pemeriksaan_fungsi_alat", rows: [[10, 1, 1]] },
  stg_mst_pemeriksaan_keamanan_listrik: { columns: "id, description, status, symbol, nilai_acuan, flag", rows: [[1, "Arus bocor sintetis", "1,-1", "I", "≤ 100 µA", 1]] },
  stg_mst_kondisi_lingkungan: { columns: "id, description, status", rows: [[1, "Suhu sintetis", null]] },
  stg_trx_inventory: {
    columns: "id, id_client, id_alat, id_user, no_qrcode, nama_alat, nama_ruangan, lantai, foto_depan, foto_sn",
    rows: [
      [101, 1, 1, 7, "QR-P101", "Pompa Sintetis", "ICU", "2", "https://old.example.test/uploads/foto_depan/a1.jpg", "a1sn.png"],
      [102, 2, 1, null, "QR-P102", "Monitor Sintetis", null, null, "b2.heic", variant === "changed" ? "b2sn.jpg" : "https://old.example.test/uploads/foto_sn/missing.jpg"],
      [103, 99, 1, 7, "QR-P103", "Alat Tanpa Faskes", null, null, "c3.jpg", null],
    ],
  },
  stg_trx_inventory_file: { columns: "id, id_inventory, nama_file", rows: [[1, 101, "cert-a.pdf"], [2, 102, "cert-b.pdf"]] },
  stg_trx_kalibrasi: {
    columns: "id, id_inventory, id_user, nama_ruangan, tanggal_kalibrasi, created_at",
    rows: [[1, 101, 7, "ICU", "2025-04-01", "2025-04-02 10:00:00"], [4, 999, 7, null, "2025-06-02", null]],
  },
  stg_trx_hasil_pemeriksaan: { columns: "id, id_client, id_user, no_qrcode, status, created_at", rows: [[1, 1, 7, "QR-P101", "1", "2025-05-10 09:00:00"], [3, 1, 7, "QR-P999", "1", "2025-05-11 09:00:00"]] },
  stg_trx_catatan: { columns: "id, id_client, id_user, no_qrcode, description, created_at", rows: [[1, 1, 7, "QR-P101", "Catatan sintetis", "2025-05-10 09:00:00"]] },
  stg_trx_keamanan_listrik: {
    columns: "id, id_client, id_user, no_qrcode, id_keamanan_listrik, description, status, value, symbol, created_at",
    rows: [[1, 1, 7, "QR-P101", 1, "Arus bocor sintetis", "1", "50", "I", "2025-05-10 09:00:00"]],
  },
  stg_trx_kondisi_lingkungan: {
    columns: "id, id_client, id_user, no_qrcode, id_kondisi_lingkungan, description, value, visit, created_at",
    rows: [[1, 1, 7, "QR-P101", 1, "Suhu sintetis", "25,5", 1, "2025-05-10 09:00:00"]],
  },
});

describe("P24-03 — the whole transform on live PostgreSQL 18 and local storage, through the service", () => {
  jest.setTimeout(600_000);
  let g: ReturnType<typeof load>;
  let scoped: Scoped;

  const rows = async (sql: string): Promise<Row[]> => (await g.db.query(sql))[0];

  const errorAs = async (role: string, sql: string): Promise<string | null> => {
    const t = await g.db.transaction();
    try {
      await g.db.query(`SET LOCAL ROLE ${role}`, { transaction: t });
      await g.db.query(sql, { transaction: t });
      return null;
    } catch (err) {
      const e = err as { parent?: { code?: string; message?: string } };
      return `${e.parent?.code ?? "?"} ${e.parent?.message ?? String(err)}`;
    } finally {
      await t.rollback();
    }
  };

  const asImport = async (...statements: string[]): Promise<void> => {
    const t = await g.db.transaction();
    await g.db.query(`SET LOCAL ROLE ${IMPORT_ROLE}`, { transaction: t });
    for (const statement of statements) {
      await g.db.query(statement, { transaction: t });
    }
    await t.commit();
  };

  const lit = (value: Cell): string => (value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value.replace(/'/g, "''")}'`);
  const values = (run: string, list: readonly (readonly Cell[])[]): string => list.map((r, i) => `('${run}', ${String(i + 1)}, ${r.map(lit).join(", ")})`).join(", ");

  /** A loaded run with its staged dump. */
  const stage = async (run: string, variant: "first" | "changed"): Promise<void> => {
    await g.db.query(
      `INSERT INTO upstream_sql_imports (id, status, data_class, compression, size_bytes, sha256, transform_status, bytes_read, uncompressed_bytes,
                                         rows_loaded, rows_rejected, rows_not_extracted, attempt, notify_tenant_id, created_at, updated_at)
       VALUES ('${run}', 'loaded', 'synthetic', 'none', 0, '${"0".repeat(64)}', 'not_available', 0, 0, 0, 0, 0, 1, '${PROVIDER}', now(), now())`,
    ).catch((err: unknown) => {
      throw new Error(`stage ${run}: ${String((err as { parent?: { message?: string } }).parent?.message ?? err)}`);
    });
    await asImport(
      ...Object.entries(world(variant)).map(
        ([table, { columns, rows: list }]) => `INSERT INTO upstream_import.${table} (import_run_id, source_row_number, ${columns}) VALUES ${values(run, list)}`,
      ),
    );
  };

  /** One completed image import: the REAL ingest of `files` (folder/name → bytes) into the provider's storage. */
  const imageImport = async (id: string, files: Record<string, Buffer>): Promise<void> => {
    const paths = g.workspace.importPaths(id, id);
    for (const [rel, bytes] of Object.entries(files)) {
      const target = path.join(paths.staging, ...rel.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    }
    await g.ingest.ingestStaged(
      {
        stagingRoot: paths.staging,
        classes: [
          { name: "front", folder: "foto_depan" },
          { name: "serial", folder: "foto_sn" },
        ],
        refusedRoot: paths.refused,
        manifestPath: paths.manifest,
        previouslyIngested: new Map(),
        shouldStop: () => false,
        onProgress: () => undefined,
      },
      {
        scanFile: () => Promise.resolve({ clean: true }),
        buildKey: (name) => scoped.buildKey({ domain: "attachments", name }),
        putObject: async (key, bytes, contentType) => {
          await scoped.put(key, bytes, { contentType });
        },
        readObject: (key) => g.storedFile.readObject(scoped, key),
        removeObject: (key) => g.storedFile.removeObject(scoped, key),
        newId: () => randomUUID(),
      },
    );
    await g.db.query(
      `INSERT INTO upstream_file_imports (id, target_tenant_id, status, host, port, username, remote_path, include_front, include_serial, auth_method,
                                          host_key_type, host_key, host_key_fingerprint, synthetic_source, created_at, updated_at)
       VALUES ('${id}', '${PROVIDER}', 'completed', 'upstream.example.test', 22, 'etl', '/srv/upload', true, true, 'password',
               'ssh-ed25519', 'AAAA', 'SHA256:synthetic', true, now() + interval '${String(FILE_IMPORTS.indexOf(id))} second', now())`,
    );
  };

  /** Request the transform as the super admin and wait for the inline job's outcome. */
  const transform = async (run: string): Promise<Row> => {
    await g.tenantStorage.run({ tenantId: null, isSuperAdmin: true, isSystemTask: false }, () =>
      g.service.requestTransform(run, { providerTenantId: PROVIDER }, { userId: OPERATOR, ipAddress: null, userAgent: "p2403" }),
    );
    for (let i = 0; i < 600; i += 1) {
      const [state] = await rows(`SELECT transform_status AS status, transform_error_code AS code, transform_summary AS summary FROM upstream_sql_imports WHERE id = '${run}'`);
      if (state && (state["status"] === "transformed" || state["status"] === "transform_failed")) {
        return state;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`run ${run}: the transform did not finish`);
  };

  interface Source {
    table: string;
    staged: number;
    mapped: number;
    unchanged: number;
    quarantined: Record<string, number>;
  }
  const sourcesOf = (state: Row, step: string): Source[] =>
    ((state["summary"] as { steps: { step: string; sources: Source[] }[] }).steps.find((s) => s.step === step)?.sources ?? []);

  const photos = (): Promise<Row[]> =>
    rows(
      `SELECT a.id, a.resource_id AS device, a.purpose, a.client_facility_id AS facility, a.storage_key AS key, a.checksum, a.mime_type AS mime,
              a.original_name AS name, a.is_deleted AS deleted, d.qr_code AS qr, d.client_facility_id AS "deviceFacility"
         FROM attachments a JOIN calibration_devices d ON d.id = a.resource_id
        WHERE a.tenant_id = '${PROVIDER}' ORDER BY d.qr_code, a.purpose, a.created_at`,
    );
  const objectExists = (key: string): boolean => fs.existsSync(path.join(TMP, "storage", ...key.split("/")));

  beforeAll(async () => {
    const name = env("DB_NAME") ?? "";
    if (!name.includes("scratch")) {
      throw new Error(`Refusing to build a schema in DB_NAME="${name}": use a scratch database (see the header)`);
    }
    g = load();
    g.db.options.logging = false;
    await g.migrationLock.runSchemaSetup({ sequelize: g.db, migrator: g.migrator, logger });
    expect(await g.migrator.pending()).toEqual([]);
    await g.db.query(`INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES ('${PROVIDER}', 'Penyedia Sintetis P', 'p2403', 'p@example.test', now(), now())`);
    await g.db.query(`INSERT INTO client_facilities (id, tenant_id, name, code, is_self, created_at, updated_at) VALUES ('${SELF}', '${PROVIDER}', 'Penyedia Sintetis P', 'SELF', true, now(), now())`);
    await g.db.query(
      `INSERT INTO roles (id, name, created_at, updated_at)
       SELECT gen_random_uuid(), n, now(), now()
         FROM unnest(ARRAY['CALIBRATOR ADMIN', 'TECHNICIAN', 'ROOM USER', 'HEALTHCARE TECHNICIAN', 'HEALTHCARE ADMIN']) AS n
        WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.name = n)`,
    );
    await g.db.query(
      `INSERT INTO users (id, tenant_id, role_id, username, email, password, first_name, last_name, created_at, updated_at)
       SELECT '${OPERATOR}', '${PROVIDER}', r.id, 'op2403', 'op2403@example.test', 'x', 'Op', 'Sintetis', now(), now() FROM roles r WHERE r.name = 'CALIBRATOR ADMIN'`,
    );
    const common = "import_run_id uuid NOT NULL, source_row_number bigint NOT NULL";
    const pk = "PRIMARY KEY (import_run_id, source_row_number)";
    const ddl: Record<string, string> = {
      stg_mst_faskes: "id integer, name_faskes varchar(255), phone varchar(50), address varchar(255), created_at timestamp, updated_at timestamp",
      stg_auth_groups: "id integer, name varchar(255), description varchar(255)",
      stg_users: "id integer, email varchar(255), username varchar(30), fullname varchar(50), active smallint, created_at timestamp, updated_at timestamp",
      stg_auth_groups_users: "group_id integer, user_id integer",
      stg_mst_alat: "id integer, nama_alat varchar(255)",
      stg_mst_pemeriksaan_fungsi_alat: "id integer, description varchar(255), status varchar(50)",
      stg_mapping_fugsi_alat: "id integer, id_alat integer, id_pemeriksaan_fungsi_alat integer",
      stg_mst_pemeriksaan_keamanan_listrik: "id integer, description varchar(255), status varchar(50), symbol varchar(50), nilai_acuan varchar(50), flag smallint",
      stg_mst_kondisi_lingkungan: "id integer, description varchar(255), status varchar(50)",
      stg_trx_inventory: `id integer, id_client integer, id_alat integer, id_user integer, no_qrcode varchar(255), nama_alat varchar(255),
         nama_ruangan varchar(255), lantai varchar(255), foto_depan varchar(255), foto_sn varchar(255)`,
      stg_trx_inventory_file: "id integer, id_inventory integer, nama_file varchar(255), created_at timestamp, updated_at timestamp",
      stg_trx_kalibrasi: "id integer, id_inventory integer, id_user integer, nama_ruangan varchar(255), tanggal_kalibrasi date, created_at timestamp, updated_at timestamp",
      stg_trx_hasil_pemeriksaan: `id integer, ${IPM}`,
      stg_trx_catatan: `id integer, ${IPM}`,
      stg_trx_keamanan_listrik: `id integer, ${IPM}, id_keamanan_listrik integer, value varchar(50), symbol varchar(50)`,
      stg_trx_kondisi_lingkungan: `id integer, ${IPM}, id_kondisi_lingkungan integer, value varchar(50), visit integer`,
    };
    await asImport(...Object.entries(ddl).map(([table, columns]) => `CREATE TABLE IF NOT EXISTS upstream_import.${table} (${common}, ${columns}, ${pk})`));
    scoped = await g.storage.getTenantStorage(PROVIDER);
  });

  afterAll(async () => {
    await g.db.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("0145: down / up / up rebuilds the same grants and reasons; the transform role cannot delete a photo or move its key", async () => {
    const objects = (): Promise<Row[]> =>
      rows(
        `SELECT table_name || '.' || column_name || ':' || privilege_type AS o FROM information_schema.column_privileges
          WHERE grantee = '${TRANSFORM_ROLE}' AND table_name = 'attachments'
         UNION ALL SELECT 'c:' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'quarantine_reason_vocabulary'
         ORDER BY 1`,
      );
    const before = await objects();
    const list = before.map((r) => String(r["o"]));
    expect(list.filter((o) => o.endsWith(":UPDATE"))).toEqual(["attachments.is_deleted:UPDATE", "attachments.updated_at:UPDATE"]);
    expect(list.find((o) => o.startsWith("c:"))).toEqual(expect.stringContaining("'certificate_archived_offline'"));
    expect(list.find((o) => o.startsWith("c:"))).toEqual(expect.stringContaining("'photo_operator_managed'"));
    await g.m0145.down({ context: g.db.getQueryInterface() as never });
    await g.m0145.up({ context: g.db.getQueryInterface() as never });
    await g.m0145.up({ context: g.db.getQueryInterface() as never });
    expect(await objects()).toEqual(before);
    expect(await errorAs(TRANSFORM_ROLE, "DELETE FROM attachments WHERE false")).toMatch(/^42501/);
    expect(await errorAs(TRANSFORM_ROLE, "UPDATE attachments SET storage_key = 'x' WHERE false")).toMatch(/^42501/);
    expect(await errorAs(TRANSFORM_ROLE, "UPDATE attachments SET client_facility_id = NULL WHERE false")).toMatch(/^42501/);
    expect(await errorAs(TRANSFORM_ROLE, "UPDATE attachments SET checksum = 'x' WHERE false")).toMatch(/^42501/);
  });

  it("runs ALL 13 steps in order through the service; every staged row and every named photo is mapped or quarantined", async () => {
    await imageImport(FILE_IMPORTS[0] as string, {
      "foto_depan/a1.jpg": jpeg(64, 48),
      "foto_sn/a1sn.png": png(40, 30),
      "foto_depan/b2.heic": heic(),
      "foto_depan/c3.jpg": jpeg(20, 20),
    });
    // The ETL's conversion of the refused HEIC (ADR-132 Am. 3), re-imported under the SAME path with JPEG bytes.
    await imageImport(FILE_IMPORTS[1] as string, { "foto_depan/b2.heic": jpeg(30, 40) });
    await stage(RUN_1, "first");

    const state = await transform(RUN_1);
    expect(state["code"]).toBeNull();
    expect(state["status"]).toBe("transformed");
    const summary = state["summary"] as { steps: { step: string; sources: Source[] }[] };
    expect(summary.steps.map((s) => s.step)).toEqual(ORDER);
    // The runner refuses an unaccounted row (TRANSFORM_INCOMPLETE): a transformed run is the proof. Each count adds up too.
    for (const { sources } of summary.steps) {
      for (const s of sources) {
        const quarantined = Object.values(s.quarantined).reduce((a, b) => a + b, 0);
        expect(s.mapped + s.unchanged + quarantined).toBeGreaterThanOrEqual(s.staged);
      }
    }
    const staged = summary.steps.flatMap((s) => s.sources).filter((s) => s.staged > 0).map((s) => s.table).sort();
    expect(staged).toEqual(
      [
        "auth_groups", "auth_groups_users", "foto_depan", "foto_sn", "mapping_fugsi_alat", "mst_alat", "mst_faskes", "mst_kondisi_lingkungan",
        "mst_pemeriksaan_fungsi_alat", "mst_pemeriksaan_keamanan_listrik", "trx_catatan", "trx_hasil_pemeriksaan", "trx_inventory",
        "trx_inventory_file", "trx_kalibrasi", "trx_keamanan_listrik", "trx_kondisi_lingkungan", "users",
      ].sort(),
    );
    expect(sourcesOf(state, "attachments")).toEqual([
      { table: "trx_inventory_file", staged: 2, mapped: 0, unchanged: 0, quarantined: { certificate_archived_offline: 2 } },
      { table: "foto_depan", staged: 3, mapped: 2, unchanged: 0, quarantined: { no_device: 1 } },
      { table: "foto_sn", staged: 2, mapped: 1, unchanged: 0, quarantined: { file_missing: 1 } },
    ]);

    const list = await photos();
    expect(list.map((p) => [p["qr"], p["purpose"], p["name"], p["mime"], p["deleted"]])).toEqual([
      ["QR-P101", "device_front", "device_front.jpg", "image/jpeg", false],
      ["QR-P101", "device_serial_plate", "device_serial_plate.png", "image/png", false],
      ["QR-P102", "device_front", "device_front.jpg", "image/jpeg", false],
    ]);
    for (const p of list) {
      expect(p["facility"]).toBe(p["deviceFacility"]);
      const key = String(p["key"]);
      expect(key).toBe(`t/${PROVIDER}/f/${String(p["facility"])}/attachments/${String(p["id"])}.${key.endsWith(".png") ? "png" : "jpg"}`);
      for (const k of [key, key.replace(/\.(jpg|png)$/, ".display.jpg"), key.replace(/\.(jpg|png)$/, ".thumb.jpg")]) {
        expect(objectExists(k)).toBe(true);
      }
    }
    // The re-keyed tenant-scope originals are gone; the one of the device that was not imported stays for a later run.
    const manifest = fs.readFileSync(g.workspace.importPaths(FILE_IMPORTS[0] as string, "").manifest, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { sourcePath: string; storageKey?: string });
    const keyOf = (p: string): string => manifest.find((m) => m.sourcePath === p)?.storageKey as string;
    expect(objectExists(keyOf("foto_depan/a1.jpg"))).toBe(false);
    expect(objectExists(keyOf("foto_sn/a1sn.png"))).toBe(false);
    expect(objectExists(keyOf("foto_depan/c3.jpg"))).toBe(true);

    const audits = await rows(
      `SELECT action::text AS action, count(*)::int AS n, bool_and(client_facility_id IS NOT NULL) AS facility,
              bool_and(changes ->> 'operation' = 'UPSTREAM_IMPORT') AS operation
         FROM audit_logs WHERE actor_name = 'system:upstream-transform' AND resource_type = 'Attachment' GROUP BY 1 ORDER BY 1`,
    );
    expect(audits).toEqual([{ action: "CREATE", n: 3, facility: true, operation: true }]);
    expect(await rows("SELECT count(*)::int AS n FROM upstream_import.id_map WHERE source_table IN ('foto_depan', 'foto_sn')")).toEqual([{ n: 3 }]);

    // P25-01 R-8 (2026-10-27): five referenced names = three mapped + two quarantined; the three mapped photos landed,
    // each in its device's facility. A soft-deleted imported photo fails its facility's R-8, then is restored.
    const reconcile = () =>
      g.tenantStorage.run({ tenantId: null, isSuperAdmin: true, isSystemTask: false }, () => g.reconciliation.reconcileRun(RUN_1));
    const answer = await reconcile();
    expect(answer.runChecks.find((c) => c.check === "R-8")).toMatchObject({ status: "pass", expected: 5, actual: 5, quarantined: 2 });
    const r8 = (a: typeof answer) => a.facilities.flatMap((f) => f.checks).filter((c) => c.check === "R-8");
    expect(r8(answer).every((c) => c.status === "pass")).toBe(true);
    expect(r8(answer).reduce((n, c) => n + c.actual, 0)).toBe(3);
    const [front] = list.filter((p) => p["qr"] === "QR-P102");
    const setDeleted = (deleted: boolean): Promise<unknown> =>
      g.db.query(`UPDATE attachments SET is_deleted = ${String(deleted)} WHERE id = '${String(front?.["id"])}'`);
    await setDeleted(true);
    try {
      const broken = r8(await reconcile()).filter((c) => c.status === "fail");
      expect(broken.map((c) => [c.expected, c.actual])).toEqual([[1, 0]]);
    } finally {
      await setDeleted(false);
    }
  });

  it("a re-run of the same dump writes no photo; a changed upstream photo replaces the import's own; the operator's photo is never replaced", async () => {
    await stage(RUN_2, "first");
    const second = await transform(RUN_2);
    expect(second["status"]).toBe("transformed");
    expect(sourcesOf(second, "attachments").slice(1)).toEqual([
      { table: "foto_depan", staged: 3, mapped: 0, unchanged: 2, quarantined: { no_device: 1 } },
      { table: "foto_sn", staged: 2, mapped: 0, unchanged: 1, quarantined: { file_missing: 1 } },
    ]);
    expect(await photos()).toHaveLength(3);

    // The operator sets device 102's serial photo in the application; upstream later names one too.
    const [device102] = await rows("SELECT id, client_facility_id AS facility FROM calibration_devices WHERE qr_code = 'QR-P102'");
    await g.db.query(
      `INSERT INTO attachments (id, tenant_id, resource_type, resource_id, client_facility_id, purpose, file_name, original_name, folder, storage_key,
                                mime_type, size, checksum, is_deleted, rekey_pending, created_at, updated_at)
       VALUES ('a2403000-0000-4000-8000-0000000000e9', '${PROVIDER}', 'device', '${String(device102?.["id"])}', '${String(device102?.["facility"])}',
               'device_serial_plate', 'op.jpg', 'device_serial_plate.jpg', 'uploads/attachments', 't/${PROVIDER}/f/${String(device102?.["facility"])}/attachments/op.jpg',
               'image/jpeg', 1, '${"e".repeat(64)}', false, false, now(), now())`,
    );
    await imageImport(FILE_IMPORTS[2] as string, { "foto_depan/a1.jpg": jpeg(32, 32), "foto_sn/b2sn.jpg": jpeg(24, 24) });
    await stage(RUN_3, "changed");
    const third = await transform(RUN_3);
    expect(third["status"]).toBe("transformed");
    expect(sourcesOf(third, "attachments").slice(1)).toEqual([
      { table: "foto_depan", staged: 3, mapped: 1, unchanged: 1, quarantined: { no_device: 1 } },
      { table: "foto_sn", staged: 2, mapped: 0, unchanged: 1, quarantined: { photo_operator_managed: 1 } },
    ]);
    const list = await photos();
    expect(list.map((p) => [p["qr"], p["purpose"], p["deleted"]])).toEqual([
      ["QR-P101", "device_front", true],
      ["QR-P101", "device_front", false],
      ["QR-P101", "device_serial_plate", false],
      ["QR-P102", "device_front", false],
      ["QR-P102", "device_serial_plate", false],
    ]);
    expect(list.find((p) => p["qr"] === "QR-P102" && p["purpose"] === "device_serial_plate")?.["id"]).toBe("a2403000-0000-4000-8000-0000000000e9");
    const audits = await rows(
      `SELECT action::text AS action, count(*)::int AS n FROM audit_logs
        WHERE actor_name = 'system:upstream-transform' AND resource_type = 'Attachment' GROUP BY 1 ORDER BY 1`,
    );
    expect(audits).toEqual([
      { action: "CREATE", n: 4 },
      { action: "DELETE", n: 1 },
    ]);
  });
});
