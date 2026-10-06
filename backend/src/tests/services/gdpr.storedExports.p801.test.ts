/**
 * P8-01 (ADR-086 Amendment 1) — a GDPR export kept in its tenant's storage:
 * the subject's download (A-360) and the retention sweep (W-15) read it there.
 *
 * The storage double keeps the REAL key rules (fixtures/fakeStorage), so the
 * caller's tenant is the only storage looked in. The legacy directory's rules
 * are pinned by gdpr.exportDownload.a360 and gdpr.exportSweep.w15; this pins
 * the same rules for the stored archive, and the sweep's walk over tenants.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FakeStorageModule } from "../fixtures/fakeStorage";
import type * as GdprService from "../../services/gdpr.service";
import type { TenantId, UserId } from "../../types/ids";

const mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p801-gdpr-"));
const mockTenants: { id: string }[] = [];
jest.mock("../../services/storage", () =>
  jest.requireActual<{ createFakeStorage: () => unknown }>("../fixtures/fakeStorage").createFakeStorage(),
);
jest.mock("../../utils/storagePath.util", () =>
  (...parts: string[]): string => jest.requireActual<typeof path>("path").join(mockRoot, ...parts),
);
jest.mock("../../config", () => ({
  db: { transaction: jest.fn((cb: (t: object) => unknown) => Promise.resolve(cb({ id: "TX" }))) },
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({ id: "a" }) }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../models", () => ({
  Tenant: {
    findAll: jest.fn(({ where, limit }: { where?: { id: Record<symbol, string> }; limit: number }) => {
      const op = where ? Object.getOwnPropertySymbols(where.id)[0] : undefined;
      const after = where && op ? where.id[op] : null;
      return Promise.resolve(mockTenants.filter((t) => after === null || after === undefined || t.id > after).slice(0, limit));
    }),
  },
}));

const gdpr = jest.requireActual<typeof GdprService>("../../services/gdpr.service");
const storage = jest.requireMock<FakeStorageModule>("../../services/storage");
const logAction = jest.requireMock<{ logAction: jest.Mock }>("../../services/audit.service").logAction;
const { logger } = jest.requireMock<{ logger: { error: jest.Mock; info: jest.Mock } }>("../../middlewares/activityLog.middleware");

const TENANT = "11111111-1111-4111-8111-111111111111" as TenantId;
const OTHER = "22222222-2222-4222-8222-222222222222" as TenantId;
const USER = "33333333-3333-4333-8333-333333333333" as UserId;
const T0 = Date.parse("2026-09-01T00:00:00.000Z");
const HOUR = 3600000;
const NOW = new Date(T0 + HOUR);

const put = (tenant: string, name: string, body: string): void => {
  storage.__objects.set(`t/${tenant}/exports/${name}`, { body: Buffer.from(body), contentType: null, modifiedAt: new Date() });
};
const manifest = (id: string, over: Record<string, unknown> = {}): string =>
  JSON.stringify({ exportId: id, tenantId: TENANT, userId: USER, createdAt: new Date(T0).toISOString(), expiresAt: new Date(T0 + 168 * HOUR).toISOString(), ...over });
/** A tenant's fake storage with some of its methods replaced. */
const scopedWith = async (tenant: string, over: Record<string, unknown>): Promise<never> => {
  const real = storage.getTenantStorage.getMockImplementation() as unknown as (t: string) => Promise<Record<string, unknown>>;
  const merged: Record<string, unknown> = { ...(await real(tenant)), ...over };
  return merged as never;
};
const has = (tenant: string, name: string): boolean => storage.__objects.has(`t/${tenant}/exports/${name}`);

beforeEach(() => {
  jest.clearAllMocks();
  storage.__reset();
  mockTenants.length = 0;
  fs.rmSync(path.join(mockRoot, "exports"), { recursive: true, force: true });
});
afterAll(() => {
  fs.rmSync(mockRoot, { recursive: true, force: true });
});

describe("P8-01 — the subject's download of a stored export", () => {
  const ID = `export-${String(T0)}-0a1b2c3d`;

  it("hands back the stored archive as an object, after the EXPORT row", async () => {
    put(TENANT, `${ID}.json`, manifest(ID));
    put(TENANT, `${ID}.zip`, "PK 12345");
    const result = await gdpr.getExportDownload(TENANT, USER, ID, null, { now: NOW });
    expect(result).toMatchObject({ filename: `${ID}.zip`, fileSize: 8 });
    expect(result.object?.meta.size).toBe(8);
    expect(result).not.toHaveProperty("filePath");
    expect(logAction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["another subject's", { userId: "44444444-4444-4444-8444-444444444444" }],
    ["expired", { expiresAt: new Date(T0).toISOString() }],
  ])("%s stored export is the same 404, and nothing is written", async (_label, over) => {
    put(TENANT, `${ID}.json`, manifest(ID, over));
    put(TENANT, `${ID}.zip`, "PK");
    await expect(gdpr.getExportDownload(TENANT, USER, ID, null, { now: NOW })).rejects.toMatchObject({ status: 404 });
    expect(logAction).not.toHaveBeenCalled();
  });

  it("another TENANT's export is never looked for outside the caller's storage: 404", async () => {
    put(OTHER, `${ID}.json`, manifest(ID, { tenantId: OTHER }));
    put(OTHER, `${ID}.zip`, "PK");
    await expect(gdpr.getExportDownload(TENANT, USER, ID, null, { now: NOW })).rejects.toMatchObject({ status: 404 });
  });

  it("a stored manifest whose archive is gone, or that is not JSON, is the same 404", async () => {
    put(TENANT, `${ID}.json`, manifest(ID));
    await expect(gdpr.getExportDownload(TENANT, USER, ID, null, { now: NOW })).rejects.toMatchObject({ status: 404 });
    put(TENANT, `${ID}.json`, "{not json");
    await expect(gdpr.getExportDownload(TENANT, USER, ID, null, { now: NOW })).rejects.toMatchObject({ status: 404 });
  });

  it("a storage failure that is not 'absent' propagates (it is not a 404)", async () => {
    storage.getTenantStorage.mockImplementationOnce((t) => scopedWith(t as string, { get: jest.fn().mockRejectedValue(new Error("bucket unreachable")) }));
    await expect(gdpr.getExportDownload(TENANT, USER, ID, null, { now: NOW })).rejects.toThrow("bucket unreachable");

    put(TENANT, `${ID}.json`, manifest(ID));
    storage.getTenantStorage.mockImplementationOnce((t) => scopedWith(t as string, { stat: jest.fn().mockRejectedValue(new Error("bucket unreachable")) }));
    await expect(gdpr.getExportDownload(TENANT, USER, ID, null, { now: NOW })).rejects.toThrow("bucket unreachable");
  });
});

describe("P8-01 — W-15's sweep over the exports in tenants' storage", () => {
  it("deletes an expired stored export with one audit row in its tenant, the manifest last; keeps a live one", async () => {
    mockTenants.push({ id: TENANT });
    const expired = `export-${String(T0)}-11111111`;
    const live = `export-${String(T0)}-22222222`;
    put(TENANT, `${expired}.json`, manifest(expired, { expiresAt: new Date(T0).toISOString() }));
    put(TENANT, `${expired}.zip`, "PK");
    put(TENANT, `${live}.json`, manifest(live));
    put(TENANT, `${live}.zip`, "PK");
    put(TENANT, "not-an-export.txt", "x");

    expect(await gdpr.purgeExpiredExports({ now: NOW })).toEqual({ deleted: 1, errors: 0 });
    expect([has(TENANT, `${expired}.zip`), has(TENANT, `${expired}.json`)]).toEqual([false, false]);
    expect([has(TENANT, `${live}.zip`), has(TENANT, `${live}.json`), has(TENANT, "not-an-export.txt")]).toEqual([true, true, true]);
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT,
      systemActor: "system:retention-purge",
      resourceId: expired,
      changes: expect.objectContaining({ operation: "GDPR_EXPORT_EXPIRED", subjectUserId: USER }) as unknown,
    }));
  });

  it("an archive with no manifest expires by the time in its id, and is logged, not audited", async () => {
    mockTenants.push({ id: TENANT });
    const orphan = `export-${String(T0)}-33333333`;
    put(TENANT, `${orphan}.zip`, "PK");
    expect(await gdpr.purgeExpiredExports({ now: new Date(T0 + 167 * HOUR) })).toEqual({ deleted: 0, errors: 0 });
    expect(await gdpr.purgeExpiredExports({ now: new Date(T0 + 168 * HOUR) })).toEqual({ deleted: 1, errors: 0 });
    expect(logAction).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("no manifest"));
  });

  it("a failed audit row keeps the manifest for the next sweep; an unreadable tenant is an error, not an abort", async () => {
    mockTenants.push({ id: OTHER }, { id: TENANT });
    const id = `export-${String(T0)}-44444444`;
    put(TENANT, `${id}.json`, manifest(id, { expiresAt: "not a date" }));
    logAction.mockRejectedValueOnce(new Error("audit insert failed"));
    storage.getTenantStorage.mockImplementationOnce(() => Promise.reject(new Error("tenant bucket refused")));

    expect(await gdpr.purgeExpiredExports({ now: NOW })).toEqual({ deleted: 0, errors: 2 });
    expect(has(TENANT, `${id}.json`)).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("could not read tenant"));
  });

  it("follows a listing cursor, and walks the tenants a page (500) at a time", async () => {
    for (let i = 0; i < 501; i += 1) {mockTenants.push({ id: `t${String(i).padStart(4, "0")}` });}
    const list = jest.fn()
      .mockResolvedValueOnce({ keys: [], cursor: "page-2" })
      .mockResolvedValueOnce({ keys: [] });
    storage.getTenantStorage.mockImplementationOnce((t) => scopedWith(t as string, { list }));
    expect(await gdpr.purgeExpiredExports({ now: NOW })).toEqual({ deleted: 0, errors: 0 });
    expect(list).toHaveBeenNthCalledWith(2, "exports", { limit: 1000, cursor: "page-2" });
    expect(storage.getTenantStorage).toHaveBeenCalledTimes(501);
  });
});
