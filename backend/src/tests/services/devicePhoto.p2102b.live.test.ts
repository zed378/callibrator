/**
 * P21-02b against a REAL PostgreSQL 18, AS `callibrator_app` (liveBoot#enterAppRole): the device
 * photo writes meet 0129's CHECKs and partial unique index, and 0117 – 0123's facility triggers,
 * which memoryDb does not have.
 *
 *  - an upload: the row with `resource_type 'device'` and a device purpose passes
 *    `attachments_purpose_resource` / `attachments_purpose_values`; its facility is the device's;
 *  - the replace: the soft delete and the insert in ONE transaction pass the partial unique index
 *    `attachments_one_live_device_photo` (one live front photo), which refuses a second live one
 *    written directly (the backstop);
 *  - the delete: soft, the row kept; the audit rows written as the app role.
 *
 *   docker run -d --name p2102b-pg18 -e POSTGRES_PASSWORD=p2102bpass \
 *     -p 127.0.0.1:55216:5432 pgvector/pgvector:pg18
 *   DB_HOST=127.0.0.1 DB_PORT=55216 DB_NAME=p2102b_scratch \
 *     DB_USER=postgres DB_PASS=p2102bpass npm run test:live:jest -- src/tests/services/devicePhoto.p2102b.live
 *   docker rm -f p2102b-pg18
 * (or `npm run test:live -- --only=p2102b`)
 *
 * Storage is the in-memory double (its key rules are the real ones); the virus scan is clean.
 * Synthetic values only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rows, seedSql, type LiveDb, type Row } from "../fixtures/ipmLive";
import type * as PhotoService from "../../services/devicePhoto.service";
import type * as TenantContext from "../../middlewares/tenantContext.middleware";
import type * as LiveBoot from "../fixtures/liveBoot";
import type { ClientFacilityId, TenantId } from "../../types/ids";
import { jpeg } from "../fixtures/photoFixtures";

jest.mock("../../services/storage", () =>
  jest.requireActual<{ createFakeStorage: () => unknown }>("../fixtures/fakeStorage").createFakeStorage(),
);
jest.mock("../../services/virusScan.service", () => ({ scanFile: jest.fn(() => Promise.resolve({ clean: true })) }));

const T = "c21b2000-0000-4000-8000-000000000001";
const ROLE = "c21b2000-0000-4000-8000-000000000002";
const U1 = "c21b2000-0000-4000-8000-0000000000a1";
const F1 = "c21b2000-0000-4000-8000-0000000000f1";
const F2 = "c21b2000-0000-4000-8000-0000000000f2";
const D1 = "c21b2000-0000-4000-8000-0000000000d1";

interface Graph {
  db: LiveDb;
  migrator: { up(options?: object): Promise<{ name: string }[]> };
  photos: typeof PhotoService;
  tenantStorage: typeof TenantContext.tenantStorage;
  boot: typeof LiveBoot;
}

/* eslint-disable @typescript-eslint/no-require-imports -- one module graph, loaded in isolation; typed by the members used */
const startProcess = (): Graph => {
  let graph: Graph | undefined;
  jest.isolateModules(() => {
    const db = (require("../../config") as { db: LiveDb }).db;
    db.options.logging = false;
    require("../../models");
    graph = {
      db,
      migrator: (require("../../config/migrator") as { migrator: Graph["migrator"] }).migrator,
      photos: require("../../services/devicePhoto.service") as typeof PhotoService,
      tenantStorage: (require("../../middlewares/tenantContext.middleware") as typeof TenantContext).tenantStorage,
      boot: require("../fixtures/liveBoot") as typeof LiveBoot,
    };
  });
  if (!graph) {
    throw new Error("the module graph did not load");
  }
  return graph;
};
/* eslint-enable @typescript-eslint/no-require-imports */

describe("P21-02b — the device photos on PostgreSQL 18, as callibrator_app", () => {
  let g: Graph;
  let tmp = "";
  const ctx = <R>(work: () => Promise<R>): Promise<R> =>
    g.tenantStorage.run({ tenantId: T as TenantId, isSuperAdmin: false, isSystemTask: false, userId: U1, clientFacilityId: null as ClientFacilityId | null, facilityBound: false }, work);
  const actor = { userId: U1, apiKeyId: null, ipAddress: "127.0.0.1", userAgent: "live" };
  const held = (): { path: string } => {
    const at = path.join(tmp, `p-${String(Math.random()).slice(2)}.jpg`);
    fs.writeFileSync(at, jpeg(32, 32));
    return { path: at };
  };
  const photos = async (): Promise<Row[]> =>
    rows(g.db, "SELECT id, purpose, resource_type, client_facility_id, is_deleted FROM attachments WHERE resource_id = :d ORDER BY created_at, id", { d: D1 });

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p2102b-live-"));
    g = startProcess();
    await g.db.sync();
    await g.migrator.up();
    for (const sql of seedSql({ tenant: T, role: ROLE, users: [U1], facilities: [[F1, "F-21B-1"], [F2, "F-21B-2"]], devices: [[D1, F1, "SN-21B-1"]], tag: "p2102b" })) {
      await g.db.query(sql);
    }
    await g.boot.enterAppRole(g.db as unknown as Parameters<typeof LiveBoot.enterAppRole>[0]);
  }, 300_000);

  afterAll(async () => {
    await g.db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("an upload: the CHECKs admit it, the facility is the device's, the audit row written", async () => {
    const photo = await ctx(() => g.photos.uploadDevicePhoto(T as TenantId, { calibrationDeviceId: D1, purpose: "device_front" }, held(), actor));
    expect(await photos()).toEqual([{ id: photo.id, purpose: "device_front", resource_type: "device", client_facility_id: F1, is_deleted: false }]);
    const audit = await rows(g.db, "SELECT action, changes->>'operation' AS op FROM audit_logs WHERE resource_id = :id", { id: photo.id });
    expect(audit).toEqual([{ action: "CREATE", op: "UPLOAD_DEVICE_PHOTO" }]);
  });

  it("the replace in one transaction passes the one-live-photo index, which refuses a second live one written directly", async () => {
    const second = await ctx(() => g.photos.uploadDevicePhoto(T as TenantId, { calibrationDeviceId: D1, purpose: "device_front" }, held(), actor));
    const now = await photos();
    expect(now.filter((r) => r["is_deleted"] === false).map((r) => r["id"])).toEqual([second.id]);
    expect(second.replacedAttachmentId).not.toBeNull();
    await expect(
      g.db.query(
        `INSERT INTO attachments (id, tenant_id, client_facility_id, resource_type, resource_id, purpose, file_name, original_name, folder, mime_type, size, is_deleted, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, :f, 'device', :d, 'device_front', 'x.jpg', 'x.jpg', 'uploads/attachments', 'image/jpeg', 3, false, now(), now())`,
        { replacements: { t: T, f: F1, d: D1 } },
      ),
    ).rejects.toMatchObject({ name: "SequelizeUniqueConstraintError", parent: { constraint: "attachments_one_live_device_photo" } });
  });

  it("device_other accumulates; the delete is soft", async () => {
    const a = await ctx(() => g.photos.uploadDevicePhoto(T as TenantId, { calibrationDeviceId: D1, purpose: "device_other" }, held(), actor));
    await ctx(() => g.photos.uploadDevicePhoto(T as TenantId, { calibrationDeviceId: D1, purpose: "device_other" }, held(), actor));
    expect(await ctx(() => g.photos.deleteDevicePhoto(T as TenantId, { calibrationDeviceId: D1, attachmentId: a.id }, actor))).toEqual({ id: a.id });
    const others = (await photos()).filter((r) => r["purpose"] === "device_other");
    expect(others.map((r) => r["is_deleted"])).toEqual([true, false]);
  });
});
