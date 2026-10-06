/**
 * P9-18 (storageMigration, four gates): each row is copied into ITS OWN
 * tenant's storage.
 *
 * Found by a planted defect during the conversion. A plant that resolved the
 * storage of a fixed tenant, not the row's, left the migration suite green.
 * That suite's storage double answers the same object whatever tenant is
 * asked for. Moving tenant A's attachment into tenant B's store is a
 * cross-tenant disclosure, so this test pins the tenant each row resolves.
 */
import { Readable } from "stream";
import crypto from "crypto";

const mockGetTenantStorage = jest.fn();
const mockFindAll = jest.fn();

jest.mock("../../models", () => ({ Attachment: { findAll: mockFindAll } }));
// P8-01 (ADR-086 Amendment 1): a key backfill commits with its audit row.
jest.mock("../../config", () => ({ db: { transaction: jest.fn((cb: (t: object) => unknown) => Promise.resolve(cb({}))) } }));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({ id: "audit-1" }) }));
jest.mock("../../services/storage", () => ({ getTenantStorage: mockGetTenantStorage }));
jest.mock("../../utils/storagePath.util", () =>
  jest.fn((...parts: string[]) => ["/srv/root", ...parts].join("/")),
);
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("fs", () => ({
  existsSync: (): boolean => true,
  createReadStream: (): Readable => Readable.from([Buffer.from("bytes")]),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const service = require("../../services/storageMigration.service") as {
  migrateAll: (opts?: { dryRun?: boolean }) => Promise<{ results: { id: string; status: string; key?: string }[] }>;
};

const SUM = crypto.createHash("sha256").update(Buffer.from("bytes")).digest("hex");
const TENANT_A = "5ea5c400-0000-4000-8000-0000000000a1";
const TENANT_B = "5ea5c400-0000-4000-8000-0000000000b2";

const scopedFor = (tenantId: string): Record<string, jest.Mock> => ({
  buildKey: jest.fn(({ domain, name }: { domain: string; name: string }) => `t/${tenantId}/${domain}/${name}`),
  put: jest.fn().mockResolvedValue({}),
  get: jest.fn(() => Promise.resolve(Readable.from([Buffer.from("bytes")]))),
  delete: jest.fn().mockResolvedValue({}),
});

const row = (id: string, tenantId: string): Record<string, unknown> => ({
  id,
  tenantId,
  folder: "uploads/attachments",
  fileName: `${id}.pdf`,
  checksum: SUM,
  mimeType: "application/pdf",
  storageKey: null,
  save: jest.fn().mockResolvedValue(true),
});

describe("storageMigration — a row moves into its own tenant's storage", () => {
  it.each([false, true])("dryRun=%s resolves each row's own tenant and keys it there", async (dryRun) => {
    mockGetTenantStorage.mockReset().mockImplementation((tenantId: string) => Promise.resolve(scopedFor(tenantId)));
    const rows = [row("a1", TENANT_A), row("b1", TENANT_B)];
    mockFindAll.mockResolvedValue(rows);

    const summary = await service.migrateAll({ dryRun });

    expect(mockGetTenantStorage.mock.calls.map((c: unknown[]) => c[0])).toEqual([TENANT_A, TENANT_B]);
    expect(summary.results.map((r) => r.key)).toEqual([
      `t/${TENANT_A}/attachments/a1.pdf`,
      `t/${TENANT_B}/attachments/b1.pdf`,
    ]);
  });
});
