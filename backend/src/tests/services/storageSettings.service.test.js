jest.mock("../../services/storage", () => ({
  buildProbeDriver: jest.fn(),
  getTenantStorage: jest.fn(),
  invalidate: jest.fn(),
}));
jest.mock("../../services/storage/config.service", () => ({
  getTenantConfig: jest.fn(),
  setTenantConfig: jest.fn(),
  clearTenantConfig: jest.fn(),
  validateTenantConfig: jest.fn(),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const storage = require("../../services/storage");
const storageConfig = require("../../services/storage/config.service");
const service = require("../../services/storageSettings.service");

const TENANT = "tenant-1";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("storageSettings — getSettings", () => {
  it("requires a tenant", async () => {
    await expect(service.getSettings(null)).rejects.toThrow("A tenant is required");
  });

  it("reports the platform default when there is no override", async () => {
    storageConfig.getTenantConfig.mockResolvedValue(null);
    await expect(service.getSettings(TENANT)).resolves.toEqual({
      provider: "default",
      usingPlatformDefault: true,
    });
  });

  it("returns an s3 view WITHOUT the secret", async () => {
    storageConfig.getTenantConfig.mockResolvedValue({
      provider: "s3",
      bucket: "b",
      region: "eu-west-1",
      endpoint: "https://s3.example.com",
      forcePathStyle: true,
      prefix: "p",
      accessKeyId: "AK",
      secretAccessKey: "SK",
    });
    const view = await service.getSettings(TENANT);
    expect(view).toEqual({
      provider: "s3",
      usingPlatformDefault: false,
      hasCredentials: true,
      bucket: "b",
      region: "eu-west-1",
      endpoint: "https://s3.example.com",
      forcePathStyle: true,
      prefix: "p",
    });
    expect(JSON.stringify(view)).not.toContain("SK");
    expect(JSON.stringify(view)).not.toContain("AK");
  });

  it("reports hasCredentials false when only one half is present", async () => {
    storageConfig.getTenantConfig.mockResolvedValue({
      provider: "s3",
      bucket: "b",
      accessKeyId: "AK",
    });
    expect((await service.getSettings(TENANT)).hasCredentials).toBe(false);
  });

  it("returns an nfs view", async () => {
    storageConfig.getTenantConfig.mockResolvedValue({
      provider: "nfs",
      root: "/mnt/t1",
      fsync: true,
    });
    expect(await service.getSettings(TENANT)).toMatchObject({
      provider: "nfs",
      root: "/mnt/t1",
      fsync: true,
    });
  });

  it("degrades gracefully for a config whose provider is neither s3 nor nfs", async () => {
    // Defensive: a stored `local`/unknown provider yields only the generic
    // fields, never s3/nfs-specific ones.
    storageConfig.getTenantConfig.mockResolvedValue({ provider: "local" });
    expect(await service.getSettings(TENANT)).toEqual({
      provider: "local",
      usingPlatformDefault: false,
      hasCredentials: false,
    });
  });

  it("nulls an absent endpoint/prefix", async () => {
    storageConfig.getTenantConfig.mockResolvedValue({
      provider: "s3",
      bucket: "b",
    });
    expect(await service.getSettings(TENANT)).toMatchObject({
      endpoint: null,
      prefix: null,
    });
  });
});

describe("storageSettings — updateSettings", () => {
  const s3Input = { provider: "s3", bucket: "b", accessKeyId: "AK", secretAccessKey: "SK" };

  beforeEach(() => {
    storageConfig.validateTenantConfig.mockReturnValue({ provider: "s3", bucket: "b" });
    storageConfig.getTenantConfig.mockResolvedValue({ provider: "s3", bucket: "b" });
  });

  it("requires a tenant", async () => {
    await expect(service.updateSettings(null, s3Input)).rejects.toThrow(
      "A tenant is required",
    );
  });

  it("health-checks with the CANDIDATE config, then saves and invalidates", async () => {
    storage.buildProbeDriver.mockReturnValue({
      healthCheck: jest.fn().mockResolvedValue({ ok: true }),
    });

    await service.updateSettings(TENANT, s3Input);

    // The probe is built from the candidate config + its credentials — never
    // from the cache.
    expect(storage.buildProbeDriver).toHaveBeenCalledWith({
      provider: "s3",
      bucket: "b",
      accessKeyId: "AK",
      secretAccessKey: "SK",
    });
    expect(storageConfig.setTenantConfig).toHaveBeenCalledWith(TENANT, s3Input);
    // Order matters: the stale cached driver must be dropped after the save.
    expect(storage.invalidate).toHaveBeenCalledWith(TENANT);
  });

  it("refuses to save when the connection test fails", async () => {
    storage.buildProbeDriver.mockReturnValue({
      healthCheck: jest.fn().mockResolvedValue({ ok: false, error: "Access Denied" }),
    });

    await expect(service.updateSettings(TENANT, s3Input)).rejects.toThrow(
      "Storage connection test failed: Access Denied",
    );
    // A typo'd bucket must never become the live config.
    expect(storageConfig.setTenantConfig).not.toHaveBeenCalled();
    expect(storage.invalidate).not.toHaveBeenCalled();
  });

  it("reports a generic reason when the health check gives none", async () => {
    storage.buildProbeDriver.mockReturnValue({
      healthCheck: jest.fn().mockResolvedValue({ ok: false }),
    });
    await expect(service.updateSettings(TENANT, s3Input)).rejects.toThrow(
      "unreachable",
    );
  });

  it("nulls absent credentials passed to the probe", async () => {
    storageConfig.validateTenantConfig.mockReturnValue({ provider: "nfs", root: "/mnt" });
    storage.buildProbeDriver.mockReturnValue({
      healthCheck: jest.fn().mockResolvedValue({ ok: true }),
    });
    await service.updateSettings(TENANT, { provider: "nfs", root: "/mnt" });
    expect(storage.buildProbeDriver).toHaveBeenCalledWith({
      provider: "nfs",
      root: "/mnt",
      accessKeyId: null,
      secretAccessKey: null,
    });
  });

  it("surfaces a validation failure before any I/O", async () => {
    storageConfig.validateTenantConfig.mockImplementation(() => {
      throw new Error("requires a bucket");
    });
    await expect(service.updateSettings(TENANT, { provider: "s3" })).rejects.toThrow(
      "requires a bucket",
    );
    expect(storage.buildProbeDriver).not.toHaveBeenCalled();
  });
});

describe("storageSettings — clearSettings", () => {
  it("requires a tenant", async () => {
    await expect(service.clearSettings(null)).rejects.toThrow("A tenant is required");
  });

  it("clears the override and drops the cached driver", async () => {
    storageConfig.getTenantConfig.mockResolvedValue(null);
    const result = await service.clearSettings(TENANT);
    expect(storageConfig.clearTenantConfig).toHaveBeenCalledWith(TENANT);
    expect(storage.invalidate).toHaveBeenCalledWith(TENANT);
    expect(result).toEqual({ provider: "default", usingPlatformDefault: true });
  });
});

describe("storageSettings — testConnection", () => {
  it("requires a tenant", async () => {
    await expect(service.testConnection(null)).rejects.toThrow("A tenant is required");
  });

  it("health-checks the ACTIVE storage", async () => {
    storage.getTenantStorage.mockResolvedValue({
      healthCheck: jest.fn().mockResolvedValue({ ok: true, driver: "s3" }),
    });
    await expect(service.testConnection(TENANT)).resolves.toEqual({
      ok: true,
      driver: "s3",
    });
  });
});

describe("storageSettings — getUsage", () => {
  it("requires a tenant", async () => {
    await expect(service.getUsage(null)).rejects.toThrow("A tenant is required");
  });

  it("reports bytes, objects, megabytes and provider", async () => {
    storage.getTenantStorage.mockResolvedValue({
      provider: "s3",
      usage: jest.fn().mockResolvedValue({ bytes: 5 * 1024 * 1024, objects: 3 }),
    });
    await expect(service.getUsage(TENANT)).resolves.toEqual({
      bytes: 5 * 1024 * 1024,
      objects: 3,
      megabytes: 5,
      provider: "s3",
    });
  });

  it("rounds megabytes to two decimals", async () => {
    storage.getTenantStorage.mockResolvedValue({
      provider: "local",
      usage: jest.fn().mockResolvedValue({ bytes: 1_572_864, objects: 1 }), // 1.5 MiB
    });
    expect((await service.getUsage(TENANT)).megabytes).toBe(1.5);
  });
});
