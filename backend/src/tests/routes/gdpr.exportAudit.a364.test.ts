/**
 * A-364 — `POST /gdpr/export` writes the audit row its contract promises.
 *
 * `gdpr.openapi.ts` publishes the operation `audited: true`, and an Article 15
 * export assembles a ZIP of the subject's personal data — yet
 * `gdpr.service#exportUserData` wrote no audit row: the export left a manifest
 * and an archive on disk and nothing in `audit_logs`. The download (A-360,
 * ADR-114) was audited; the request that created what it downloads was not.
 * The P6-11 coverage guard passed it because a "mutation" was a database
 * write, and the export writes files only (auditCoverage.p611.test.ts now
 * counts a file write).
 *
 * This drives the REAL gdpr router, controller and service, the REAL
 * audit.service, models and tenant hooks (fixtures/memoryDb), with the
 * exports directory in a temporary folder:
 *
 *  - one EXPORT row commits, in a transaction, naming the caller (and the
 *    request's user agent), the export id the answer hands out, its size and
 *    expiry — and no personal data;
 *  - the row is written BEFORE the id is handed out: a failed row answers 500,
 *    hands out nothing, and leaves neither the archive nor its manifest;
 *  - an export that fails (no such subject) writes no row;
 *  - export then download: two rows for the same export id, in that order.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as RouteModule from "../../routes/api/gdpr.route";
import type * as AuditServiceModule from "../../services/audit.service";

const mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "a364-exports-"));
jest.mock("../../utils/storagePath.util", () =>
  (...parts: string[]): string => jest.requireActual<typeof path>("path").join(mockRoot, ...parts),
);
jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/gdpr.route");
const auditService = jest.requireActual<typeof AuditServiceModule>("../../services/audit.service");

const DIR = path.join(mockRoot, "exports");
const HASH = `$2b$10$${"b".repeat(53)}`;
const AGENT = "a364-browser/1.0";

interface Answer {
  exportId: string;
  downloadUrl: string;
  expiresAt: string;
  fileSize: number;
}

let subject: Principal;
let stranger: Principal;

beforeEach(() => {
  mdb.reset();
  jest.restoreAllMocks();
  fs.rmSync(DIR, { recursive: true, force: true });
  const fx = twoTenants();
  subject = fx.principal(fx.tenantA, "USER");
  // A principal with no `users` row: the export finds no subject (404).
  // (fx.principal caches one principal per tenant and role, so another role.)
  stranger = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, []);
  mdb.seed("User", {
    id: subject.id,
    tenantId: subject.tenantId,
    username: subject.username,
    email: `${subject.username}@a364.test`,
    password: HASH,
    mfaSecret: "envelope:a364-secret",
    phone: "+62 811 364 364",
    roleId: subject.role.id,
    status: "ACTIVE",
    isActive: true,
  });
});

afterAll(() => {
  fs.rmSync(mockRoot, { recursive: true, force: true });
});

const postExport = () => call(router, "POST", "/export", { headers: { "user-agent": AGENT } });
const auditWrites = () => mdb.committed().filter((w) => w.model === "AuditLog");
const filesOnDisk = (): string[] => (fs.existsSync(DIR) ? fs.readdirSync(DIR).sort() : []);

describe("A-364: POST /gdpr/export is audited", () => {
  it("commits ONE EXPORT row in a transaction: the caller, the export id it hands out, size and expiry — no personal data", async () => {
    as(subject);
    const res = await postExport();

    expect(res.status).toBe(200);
    const answer = (res.body as { data: Answer }).data;
    expect(answer.exportId).toMatch(/^export-\d+-[0-9a-f]{8}$/);

    const writes = auditWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.tx).not.toBeNull();
    expect(mdb.rows("AuditLog")).toEqual([
      expect.objectContaining({
        tenantId: subject.tenantId,
        userId: subject.id,
        action: "EXPORT",
        resourceType: "DataExport",
        resourceId: answer.exportId,
        userAgent: AGENT,
        changes: {
          operation: "GDPR_EXPORT_CREATE",
          fileSize: answer.fileSize,
          expiresAt: answer.expiresAt,
          subjectId: subject.id,
        },
      }),
    ]);
    expect(answer.fileSize).toBeGreaterThan(0);

    // The record says THAT an export was made, never what is in it.
    const recorded = JSON.stringify(mdb.rows("AuditLog"));
    for (const personal of [`${subject.username}@a364.test`, HASH, "envelope:a364-secret", "+62 811 364 364"]) {
      expect(recorded).not.toContain(personal);
    }
  });

  it("the row comes before the id: a failed audit write answers 500, hands out no export, and leaves no archive or manifest", async () => {
    jest.spyOn(auditService, "logAction").mockRejectedValueOnce(new Error("audit insert failed"));
    as(subject);
    const res = await postExport();

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/export-\d+-[0-9a-f]{8}/);
    expect(auditWrites()).toEqual([]);
    expect(filesOnDisk()).toEqual([]);
  });

  it("an export that fails before it exists (no such subject) writes no row", async () => {
    as(stranger);
    const res = await postExport();

    expect(res.status).toBe(404);
    expect(auditWrites()).toEqual([]);
    expect(filesOnDisk()).toEqual([]);
  });

  it("export then download: two EXPORT rows for the same export id — the creation, then the disclosure", async () => {
    as(subject);
    const created = await postExport();
    const { exportId, downloadUrl } = (created.body as { data: Answer }).data;
    const res = await call(router, "GET", downloadUrl.replace("/api/v1/gdpr", ""));

    expect(res.status).toBe(200);
    const rows = mdb.rows("AuditLog") as { resourceId: unknown; changes: { operation: unknown } }[];
    expect(rows.map((r) => [r.resourceId, r.changes.operation])).toEqual([
      [exportId, "GDPR_EXPORT_CREATE"],
      [exportId, "GDPR_EXPORT_DOWNLOAD"],
    ]);
  });
});
