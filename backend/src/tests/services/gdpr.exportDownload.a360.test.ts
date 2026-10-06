/**
 * A-360 (ADR-114) — gdpr.service#getExportDownload, every way to be refused.
 *
 * The route test (routes/gdpr.exportDownload.a360.test.ts) drives the real
 * router over memoryDb; this pins the service's rule on real files in a
 * temporary exports directory: the archive is the caller's only when its
 * manifest names their tenant AND user id and has not expired; every refusal
 * is the same 404 and writes nothing; a failure that is not "absent"
 * propagates; and the EXPORT audit row is written, in a transaction, before
 * the path is handed back — a failed row serves nothing.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "a360-svc-"));
const mockTx = { id: "tx-a360" };
// P8-01 (ADR-086 Amendment 1): an export's archive and manifest are kept in
// the tenant's storage; the double keeps the real key rules
// (fixtures/fakeStorage) and holds the bytes in memory.
jest.mock("../../services/storage", () => jest.requireActual<{ createFakeStorage: () => unknown }>("../fixtures/fakeStorage").createFakeStorage());
jest.mock("../../utils/storagePath.util", () =>
  (...parts: string[]): string => jest.requireActual<typeof path>("path").join(mockRoot, ...parts),
);
jest.mock("../../config", () => ({
  db: { transaction: jest.fn(async (cb: (t: object) => Promise<unknown>) => cb(mockTx)) },
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));

import type * as AuditService from "../../services/audit.service";
import type * as GdprService from "../../services/gdpr.service";
import type { TenantId, UserId } from "../../types/ids";

const gdpr = jest.requireActual<typeof GdprService>("../../services/gdpr.service");
const logAction = jest.requireMock<typeof AuditService>("../../services/audit.service").logAction as jest.Mock;
const DIR = path.join(mockRoot, "exports");
const TENANT = "11111111-1111-4111-8111-111111111111" as TenantId;
const USER = "22222222-2222-4222-8222-222222222222" as UserId;
const ID = "export-1790000000000-0a1b2c3d";
const NOW = new Date("2026-10-02T00:00:00.000Z");
const LATER = "2026-10-09T00:00:00.000Z";

const writeManifest = (id: string, manifest: unknown): void => {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, `${id}.json`), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
};
const writeZip = (id: string, bytes = "PK data"): void => {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, `${id}.zip`), bytes);
};
const owned = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  exportId: ID,
  tenantId: TENANT,
  userId: USER,
  createdAt: "2026-10-01T00:00:00.000Z",
  expiresAt: LATER,
  ...over,
});

const refused = async (promise: Promise<unknown>): Promise<void> => {
  await expect(promise).rejects.toMatchObject({ status: 404, message: "Export not found" });
  expect(logAction).not.toHaveBeenCalled();
};

beforeEach(() => {
  jest.clearAllMocks();
  fs.rmSync(DIR, { recursive: true, force: true });
});
afterEach(() => {
  jest.restoreAllMocks();
});
afterAll(() => {
  fs.rmSync(mockRoot, { recursive: true, force: true });
});

describe("A-360: getExportDownload", () => {
  it("hands the subject their archive, after one EXPORT row in a transaction", async () => {
    writeManifest(ID, owned());
    writeZip(ID, "PK 12345");
    const actor = { userId: USER, impersonatorId: "99999999-9999-4999-8999-999999999999" };

    const result = await gdpr.getExportDownload(TENANT, USER, ID, actor, { now: NOW });

    expect(result).toEqual({ filePath: path.join(DIR, `${ID}.zip`), filename: `${ID}.zip`, fileSize: 8 });
    expect(logAction).toHaveBeenCalledTimes(1);
    const [entry, options] = logAction.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(options).toEqual({ transaction: mockTx });
    expect(entry).toMatchObject({
      tenantId: TENANT,
      action: "EXPORT",
      resourceType: "DataExport",
      resourceId: ID,
      changes: expect.objectContaining({
        operation: "GDPR_EXPORT_DOWNLOAD",
        fileSize: 8,
        expiresAt: LATER,
        subjectId: USER,
      }) as unknown,
    });
  });

  it("with no actor and no clock given, the subject is the actor and the clock is now", async () => {
    writeManifest(ID, owned({ expiresAt: new Date(Date.now() + 60_000).toISOString() }));
    writeZip(ID);

    await expect(gdpr.getExportDownload(TENANT, USER, ID)).resolves.toMatchObject({ filename: `${ID}.zip` });
    expect((logAction.mock.calls[0] as [{ userId: unknown }])[0].userId).toBe(USER);
  });

  it.each([
    ["no tenant", null, USER, ID],
    ["no user", TENANT, null, ID],
    ["an id that is not a string", TENANT, USER, 42],
    ["a path in place of an id", TENANT, USER, "../../package"],
    ["an id with a suffix", TENANT, USER, `${ID}.zip`],
  ])("refuses %s with the 404, before reading anything", async (_case, tenantId, userId, exportId) => {
    writeManifest(ID, owned());
    writeZip(ID);
    const read = jest.spyOn(fs.promises, "readFile");

    await refused(gdpr.getExportDownload(tenantId as TenantId, userId as UserId, exportId as string, null, { now: NOW }));
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ["another user's export", owned({ userId: "33333333-3333-4333-8333-333333333333" })],
    ["another tenant's export", owned({ tenantId: "44444444-4444-4444-8444-444444444444" })],
    ["an expired export", owned({ expiresAt: "2026-10-01T23:59:59.999Z" })],
    ["an export whose expiry is exactly now", owned({ expiresAt: NOW.toISOString() })],
    ["an expiry that does not parse", owned({ expiresAt: "soon" })],
    ["no expiry", owned({ expiresAt: undefined })],
    ["a manifest that is null", "null"],
    ["a manifest that is not an object", "5"],
    ["a manifest that is not JSON", "{ not json"],
  ])("refuses %s with the same 404, writing nothing", async (_case, manifest) => {
    writeManifest(ID, manifest);
    writeZip(ID);
    await refused(gdpr.getExportDownload(TENANT, USER, ID, null, { now: NOW }));
  });

  it("refuses an unknown export, and one whose archive is gone, with the same 404", async () => {
    await refused(gdpr.getExportDownload(TENANT, USER, ID, null, { now: NOW }));
    writeManifest(ID, owned());
    await refused(gdpr.getExportDownload(TENANT, USER, ID, null, { now: NOW }));
  });

  it("a manifest that cannot be read for another reason propagates (not a 404)", async () => {
    // A DIRECTORY where the manifest should be: readFile fails with EISDIR.
    fs.mkdirSync(path.join(DIR, `${ID}.json`), { recursive: true });
    await expect(gdpr.getExportDownload(TENANT, USER, ID, null, { now: NOW })).rejects.toMatchObject({ code: "EISDIR" });
    expect(logAction).not.toHaveBeenCalled();
  });

  it("an archive that cannot be read for another reason propagates (not a 404)", async () => {
    writeManifest(ID, owned());
    writeZip(ID);
    jest.spyOn(fs.promises, "stat").mockRejectedValueOnce(Object.assign(new Error("permission denied"), { code: "EACCES" }));
    await expect(gdpr.getExportDownload(TENANT, USER, ID, null, { now: NOW })).rejects.toThrow("permission denied");
    expect(logAction).not.toHaveBeenCalled();
  });

  it("serves nothing when the audit row cannot be written", async () => {
    writeManifest(ID, owned());
    writeZip(ID);
    logAction.mockRejectedValueOnce(new Error("audit_logs unavailable"));
    await expect(gdpr.getExportDownload(TENANT, USER, ID, null, { now: NOW })).rejects.toThrow("audit_logs unavailable");
  });
});
