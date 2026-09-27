/**
 * Q-06 (ADR-084) — a tenant on its own storage bucket still counts against
 * `limitStorageMb`, because the platform still holds its bytes.
 *
 * The quota bounds what the PLATFORM stores. The attachment upload path was
 * never cut over to services/storage (docs/STORAGE/04): every upload lands on
 * platform storage whatever the tenant configured, and the migration tool
 * copies without deleting the legacy file. So the rule "own bucket is exempt"
 * would, today, hand a tenant unbounded platform disk.
 *
 * What these tests pin, through the real enforceStorageQuota → quota.service
 * chain over model doubles:
 *  - a tenant with its own bucket is refused (413) at its limit, like any other;
 *  - the refusal says why, so the tenant that configured the bucket is not left
 *    reading it as a defect;
 *  - the usage sum is every attachment of the tenant — no predicate on where the
 *    bytes are;
 *  - an unreadable storage configuration explains nothing and still refuses
 *    with a 413, never a 500.
 */

jest.mock("../../models", () => ({
  Tenant: { findByPk: jest.fn() },
  User: { count: jest.fn() },
  Attachment: { sum: jest.fn() },
}));

jest.mock("../../services/storage/config.service", () => ({
  getTenantConfig: jest.fn(),
}));

const { Tenant, Attachment } = require("../../models");
const storageConfig = require("../../services/storage/config.service");
const quota = require("../../services/quota.service");
const { enforceStorageQuota } = require("../../middlewares/enforceQuota.middleware");

const MB = 1024 * 1024;
const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWN_BUCKET = { provider: "s3", bucket: "hospital-a-evidence", accessKeyId: "k", secretAccessKey: "s" };

const upload = async (incomingMb) => {
  const req = {
    user: { tenantId: TENANT_ID, role: { name: "HEALTHCARE ADMIN" } },
    headers: { "content-length": String(incomingMb * MB) },
  };
  const next = jest.fn();
  await enforceStorageQuota()(req, {}, next);
  return next.mock.calls[0][0];
};

describe("Q-06 (ADR-084): an own bucket does not lift limitStorageMb while the platform holds the bytes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Tenant.findByPk.mockResolvedValue({ id: TENANT_ID, limitStorageMb: 100 });
    Attachment.sum.mockResolvedValue(90 * MB);
  });

  it("refuses an upload past the limit for a tenant with its own bucket, and says why", async () => {
    storageConfig.getTenantConfig.mockResolvedValue(OWN_BUCKET);

    const err = await upload(20);

    expect(err.status).toBe(413);
    expect(err.message).toMatch(/Storage limit reached \(90MB of 100MB used\)/);
    expect(err.message).toMatch(
      /configured its own storage, but uploads are still written to platform storage, so they count against this limit/,
    );
  });

  it("a tenant on the platform bucket gets the plain refusal", async () => {
    storageConfig.getTenantConfig.mockResolvedValue(null);

    const err = await upload(20);

    expect(err.status).toBe(413);
    expect(err.message).not.toMatch(/own storage/);
  });

  it("counts every attachment of the tenant — nothing is excluded for where it is stored", async () => {
    storageConfig.getTenantConfig.mockResolvedValue(OWN_BUCKET);

    const status = await quota.checkStorageQuota(TENANT_ID, 20 * MB);

    expect(Attachment.sum).toHaveBeenCalledWith("size", { where: { tenantId: TENANT_ID } });
    expect(status).toMatchObject({ allowed: false, usedMb: 90, limitMb: 100, ownStorage: true });
  });

  it("an upload within the limit passes and never reads the storage configuration", async () => {
    storageConfig.getTenantConfig.mockResolvedValue(OWN_BUCKET);

    const status = await quota.checkStorageQuota(TENANT_ID, 5 * MB);

    expect(status.allowed).toBe(true);
    expect(status).not.toHaveProperty("ownStorage");
    expect(storageConfig.getTenantConfig).not.toHaveBeenCalled();
    expect(await upload(5)).toBeUndefined();
  });

  it("an unreadable storage configuration still refuses with 413, not 500", async () => {
    storageConfig.getTenantConfig.mockRejectedValue(new Error("Stored storage configuration is corrupt"));

    const status = await quota.checkStorageQuota(TENANT_ID, 20 * MB);
    const err = await upload(20);

    expect(status.ownStorage).toBe(false);
    expect(err.status).toBe(413);
    expect(err.message).not.toMatch(/own storage/);
  });
});
