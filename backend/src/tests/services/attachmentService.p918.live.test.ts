/**
 * P9-18 — the converted attachment.service against a REAL PostgreSQL 18, AS
 * callibrator_app (never the owner — CLAUDE.md, Evidence), with two tenants
 * and real files under the storage root.
 *
 * What it proves, through the service itself:
 *  - an upload in tenant A is scanned, moved out of quarantine, recorded with
 *    its CREATE audit row, and linked only to A's own device (A-97: B's device
 *    is the same 404 as none);
 *  - tenant B cannot see, download or delete A's attachment: 404, the same as
 *    an id that does not exist (CLAUDE.md, cross-tenant is 404);
 *  - listOrphans — the statements now run through `sql()` with BOUND
 *    parameters ($1…$3) instead of named replacements — answers A's orphan to
 *    A and nothing to B, as the application role;
 *  - a parent's cascade soft-delete and its restore (D-22, A-133) run in the
 *    caller's transaction and are audited;
 *  - a signed link downloads without a tenant, and stops working after the
 *    delete; the delete removes the file after the commit.
 *
 * OPT-IN — an EMPTY or already-built SCRATCH database (the name must contain
 * "scratch"); it leaves audit rows (append-only). Files it writes under
 * uploads/ are removed in afterAll.
 *
 *   P918_ATT_PG_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=55919 \
 *     DB_NAME=callibrator_scratch_p918att DB_USER=postgres DB_PASS=... \
 *     CERT_SIGNING_SECRET=... npm test -- src/tests/services/attachmentService.p918.live --coverage=false
 */
import fs from "fs";
import path from "path";
import { env } from "../../config/env";

const live = env("P918_ATT_PG_LIVE_TEST") === "1" ? describe : describe.skip;

const APP_ROLE = "callibrator_app";
const TENANT_A = "a9180000-0000-4000-8000-0000000000a1";
const TENANT_B = "a9180000-0000-4000-8000-0000000000b2";
const DEVICE_A = "a9180000-0000-4000-8000-00000000dea1";
const DEVICE_A2 = "a9180000-0000-4000-8000-00000000dea2";
const DEVICE_B = "a9180000-0000-4000-8000-00000000deb1";

type Row = Record<string, unknown>;
interface LiveTx {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
interface LiveDb {
  options: { logging: unknown };
  query(sql: string, options?: object): Promise<[Row[], unknown]>;
  transaction(): Promise<LiveTx>;
  close(): Promise<void>;
}
interface AttachmentService {
  createAttachment(tenantId: string, file: unknown, meta?: object): Promise<Row>;
  getAttachment(tenantId: string, id: string): Promise<Row>;
  getDownload(tenantId: string, id: string): Promise<{ absPath: string }>;
  deleteAttachment(tenantId: string, id: string, actor?: object): Promise<{ id: string }>;
  listOrphans(tenantId: string, query?: object): Promise<{ rows: Row[]; meta: Row }>;
  softDeleteForResource(tenantId: string, modelName: string, resourceId: string, options: object): Promise<string[]>;
  restoreForResource(tenantId: string, modelName: string, resourceId: string, options: object): Promise<string[]>;
  generateSignedUrl(tenantId: string, id: string, options?: object): Promise<{ token: string }>;
  getSignedDownload(id: string, token: unknown): Promise<{ absPath: string }>;
}
interface Graph {
  db: LiveDb;
  migrator: { pending(): Promise<unknown[]> };
  migrationLock: { runSchemaSetup(options: object): Promise<unknown> };
  dbRole: { enterApplicationRole(options: object): Promise<unknown> };
  tenantStorage: { run(context: object, fn: () => void): void };
  quarantinePath: (...parts: string[]) => string;
  attachments: AttachmentService;
}

/* eslint-disable @typescript-eslint/no-require-imports -- the graph is loaded per "process" with jest.isolateModules; typed by the members used */
const startProcess = (): Graph => {
  let graph: Graph | undefined;
  jest.isolateModules(() => {
    const db = (require("../../config") as { db: LiveDb }).db;
    db.options.logging = false;
    require("../../models");
    graph = {
      db,
      migrator: (require("../../config/migrator") as { migrator: Graph["migrator"] }).migrator,
      migrationLock: require("../../utils/migrationLock.util") as Graph["migrationLock"],
      dbRole: require("../../utils/dbRole.util") as Graph["dbRole"],
      tenantStorage: (require("../../middlewares/tenantContext.middleware") as { tenantStorage: Graph["tenantStorage"] }).tenantStorage,
      quarantinePath: (require("../../utils/upload.util") as { quarantinePath: Graph["quarantinePath"] }).quarantinePath,
      attachments: require("../../services/attachment.service") as AttachmentService,
    };
  });
  if (!graph) {
    throw new Error("the module graph did not load");
  }
  return graph;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

live("P9-18 — attachment.service on live PostgreSQL 18 as callibrator_app", () => {
  jest.setTimeout(240000);
  let owner: Graph;
  let app: Graph;
  let userA = "";
  const written: string[] = [];

  const rows = async (sql: string, replacements: object = {}): Promise<Row[]> => (await owner.db.query(sql, { replacements }))[0];

  const inTenant = <T>(tenantId: string, work: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      app.tenantStorage.run({ tenantId, isSuperAdmin: false, isSystemTask: false }, () => {
        work().then(resolve, reject);
      });
    });

  /** A file as multer leaves it: in the quarantine directory. */
  const quarantined = (name: string, body: string): { path: string; filename: string; originalname: string; mimetype: string; size: number } => {
    const filename = `p918-${String(Date.now())}-${name}`;
    const full = app.quarantinePath(filename);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
    written.push(full);
    return { path: full, filename, originalname: name, mimetype: "text/plain", size: Buffer.byteLength(body) };
  };

  const expect404 = async (work: Promise<unknown>): Promise<void> => {
    await expect(work).rejects.toMatchObject({ status: 404 });
  };

  beforeAll(async () => {
    const name = env("DB_NAME") ?? "";
    if (!name.includes("scratch")) {
      throw new Error(`Refusing to build a schema in DB_NAME="${name}": use a scratch database (see the header)`);
    }
    owner = startProcess();
    await owner.migrationLock.runSchemaSetup({ sequelize: owner.db, migrator: owner.migrator, logger });
    expect(await owner.migrator.pending()).toEqual([]);

    for (const [id, sub] of [[TENANT_A, "p918a"], [TENANT_B, "p918b"]] as const) {
      await owner.db.query(
        `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at)
         VALUES (:id, :n, :s, :e, now(), now()) ON CONFLICT (id) DO NOTHING`,
        { replacements: { id, n: `P918 ${sub}`, s: sub, e: `${sub}@live.test` } },
      );
    }
    for (const [id, tenant, serial] of [[DEVICE_A, TENANT_A, "P918-A1"], [DEVICE_A2, TENANT_A, "P918-A2"], [DEVICE_B, TENANT_B, "P918-B1"]] as const) {
      await owner.db.query(
        `INSERT INTO calibration_devices (id, tenant_id, name, serial_number, status, is_deleted, created_at, updated_at)
         VALUES (:id, :t, :n, :s, 'active', false, now(), now()) ON CONFLICT (id) DO NOTHING`,
        { replacements: { id, t: tenant, n: `Device ${serial}`, s: serial } },
      );
    }
    const [made] = await rows(
      `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, avatar_url,
                          status, must_change_password, is_deleted, created_at, updated_at)
       VALUES (gen_random_uuid(), :t, :h, :e, 'x', 'P918', 'A', 'default.svg', 'ACTIVE', false, false, now(), now())
       RETURNING id`,
      { t: TENANT_A, h: `p918-att-${String(Date.now())}`, e: `p918-att-${String(Date.now())}@live.test` },
    );
    userA = String(made?.["id"]);

    app = startProcess();
    await app.dbRole.enterApplicationRole({ sequelize: app.db, logger, env: { DB_APP_ROLE: APP_ROLE } });
    const [who] = (await app.db.query("SELECT current_user AS u, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS s"))[0];
    expect(who).toEqual({ u: APP_ROLE, s: false });
  });

  afterAll(async () => {
    for (const file of written) {
      fs.rmSync(file, { force: true });
    }
    await app.db.close();
    await owner.db.close();
  });

  let attId = "";
  let storedPath = "";

  it("an upload in tenant A is moved out of quarantine, recorded and audited, linked to A's device", async () => {
    const file = quarantined("evidence.txt", "p918 evidence");
    // promoteFromQuarantine moves the file and updates `file.path` to where it went.
    const inQuarantine = file.path;
    const created = await inTenant(TENANT_A, () =>
      app.attachments.createAttachment(TENANT_A, file, { resourceType: "device", resourceId: DEVICE_A, uploadedBy: userA, ipAddress: "203.0.113.9" }),
    );
    attId = String(created["id"]);
    expect(created).toMatchObject({ tenantId: TENANT_A, resourceType: "device", resourceId: DEVICE_A, size: 13 });
    expect(fs.existsSync(inQuarantine)).toBe(false);
    storedPath = (await inTenant(TENANT_A, () => app.attachments.getDownload(TENANT_A, attId))).absPath;
    written.push(storedPath);
    expect(fs.readFileSync(storedPath, "utf8")).toBe("p918 evidence");
    const [audit] = await rows(
      "SELECT action::text AS action, user_id, ip_address, changes->>'checksum' AS checksum FROM audit_logs WHERE resource_id = :id",
      { id: attId },
    );
    expect(audit).toMatchObject({ action: "CREATE", user_id: userA, ip_address: "203.0.113.9" });
    expect(String(audit?.["checksum"])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("A-97: a link to tenant B's device is the same 404 as none, and the quarantined file is removed", async () => {
    const file = quarantined("cross.txt", "x");
    await expect404(inTenant(TENANT_A, () => app.attachments.createAttachment(TENANT_A, file, { resourceType: "device", resourceId: DEVICE_B, uploadedBy: userA })));
    expect(fs.existsSync(file.path)).toBe(false);
  });

  it("tenant B cannot see, download or delete A's attachment: 404, like an id that does not exist", async () => {
    const missing = "a9180000-0000-4000-8000-00000000ffff";
    for (const id of [attId, missing]) {
      await expect404(inTenant(TENANT_B, () => app.attachments.getAttachment(TENANT_B, id)));
      await expect404(inTenant(TENANT_B, () => app.attachments.getDownload(TENANT_B, id)));
      await expect404(inTenant(TENANT_B, () => app.attachments.deleteAttachment(TENANT_B, id, { userId: userA })));
    }
    expect(fs.existsSync(storedPath)).toBe(true);
  });

  it("listOrphans (bound parameters) answers A's orphan to A and nothing to B, as the application role", async () => {
    const file = quarantined("orphan.txt", "orphan");
    const orphan = await inTenant(TENANT_A, () =>
      app.attachments.createAttachment(TENANT_A, file, { resourceType: "device", resourceId: DEVICE_A2, uploadedBy: userA }),
    );
    written.push((await inTenant(TENANT_A, () => app.attachments.getDownload(TENANT_A, String(orphan["id"])))).absPath);
    await owner.db.query("UPDATE calibration_devices SET is_deleted = true WHERE id = :id", { replacements: { id: DEVICE_A2 } });

    const forA = await inTenant(TENANT_A, () => app.attachments.listOrphans(TENANT_A, { page: 1, limit: 10 }));
    expect(forA.rows.map((row) => row["id"])).toEqual([orphan["id"]]);
    expect(forA.rows[0]).toMatchObject({ reason: "parent_missing_or_deleted", size: 6 });
    expect(forA.meta).toEqual({ total: 1, page: 1, limit: 10, totalPages: 1 });
    const forB = await inTenant(TENANT_B, () => app.attachments.listOrphans(TENANT_B));
    expect(forB.rows).toEqual([]);
    expect(forB.meta["total"]).toBe(0);
  });

  it("a parent's cascade soft-delete and its restore run in the caller's transaction, audited", async () => {
    const t = await app.db.transaction();
    const deleted = await inTenant(TENANT_A, () =>
      app.attachments.softDeleteForResource(TENANT_A, "CalibrationDevice", DEVICE_A, { transaction: t, actor: { userId: userA } }),
    );
    await t.commit();
    expect(deleted).toEqual([attId]);
    await expect404(inTenant(TENANT_A, () => app.attachments.getAttachment(TENANT_A, attId)));

    const t2 = await app.db.transaction();
    const restored = await inTenant(TENANT_A, () =>
      app.attachments.restoreForResource(TENANT_A, "CalibrationDevice", DEVICE_A, { transaction: t2, actor: { userId: userA } }),
    );
    await t2.commit();
    expect(restored).toEqual([attId]);
    expect((await inTenant(TENANT_A, () => app.attachments.getAttachment(TENANT_A, attId)))["id"]).toBe(attId);
    const ops = await rows("SELECT changes->>'operation' AS op FROM audit_logs WHERE resource_id = :id ORDER BY created_at", { id: attId });
    expect(ops.map((row) => row["op"])).toEqual([null, "cascade-soft-delete", "cascade-restore"]);
  });

  it("a signed link downloads without a tenant; the delete removes the row's access and, after the commit, the file", async () => {
    const { token } = await inTenant(TENANT_A, () => app.attachments.generateSignedUrl(TENANT_A, attId, { expiresInSec: 60 }));
    expect((await app.attachments.getSignedDownload(attId, token)).absPath).toBe(storedPath);
    await expect(app.attachments.getSignedDownload(attId, `${token}0`)).rejects.toMatchObject({ status: 403 });

    await inTenant(TENANT_A, () => app.attachments.deleteAttachment(TENANT_A, attId, { userId: userA }));
    expect(fs.existsSync(storedPath)).toBe(false);
    await expect404(inTenant(TENANT_A, () => app.attachments.getAttachment(TENANT_A, attId)));
    await expect(app.attachments.getSignedDownload(attId, token)).rejects.toMatchObject({ status: 404 });
    const [row] = await rows("SELECT is_deleted FROM attachments WHERE id = :id", { id: attId });
    expect(row?.["is_deleted"]).toBe(true);
  });
});
