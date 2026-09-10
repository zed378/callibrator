jest.mock("../../models", () => ({
  TenantSettings: {
    findAll: jest.fn(),
    upsert: jest.fn(),
    findOrBuild: jest.fn(),
    destroy: jest.fn(),
  },
}));

const { TenantSettings } = require("../../models");
const config = require("../../services/storage/config.service");

const ORIGINAL_ENV = { ...process.env };

const clearStorageEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("STORAGE_")) delete process.env[key];
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  clearStorageEnv();
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("storage config — platform default", () => {
  it("defaults to the local disk when nothing is configured", () => {
    const result = config.getGlobalConfig();
    expect(result.provider).toBe("local");
    expect(result.root).toBeTruthy();
    expect(result.fsync).toBe(false);
  });

  it("honours an explicit local root", () => {
    process.env.STORAGE_DRIVER = "local";
    process.env.STORAGE_LOCAL_ROOT = "/srv/files";
    expect(config.getGlobalConfig()).toMatchObject({
      provider: "local",
      root: "/srv/files",
    });
  });

  it("rejects an unknown driver at startup rather than silently falling back", () => {
    process.env.STORAGE_DRIVER = "ftp";
    expect(() => config.getGlobalConfig()).toThrow('Invalid STORAGE_DRIVER "ftp"');
  });

  describe("s3", () => {
    beforeEach(() => {
      process.env.STORAGE_DRIVER = "s3";
    });

    it("requires a bucket", () => {
      expect(() => config.getGlobalConfig()).toThrow("requires STORAGE_S3_BUCKET");
    });

    it("reads the full configuration", () => {
      process.env.STORAGE_S3_BUCKET = "cal";
      process.env.STORAGE_S3_REGION = "ap-southeast-1";
      process.env.STORAGE_S3_ENDPOINT = "http://minio:9000";
      process.env.STORAGE_S3_PREFIX = "prod";
      process.env.STORAGE_S3_ACCESS_KEY_ID = "AK";
      process.env.STORAGE_S3_SECRET_ACCESS_KEY = "SK";

      expect(config.getGlobalConfig()).toEqual({
        provider: "s3",
        bucket: "cal",
        region: "ap-southeast-1",
        endpoint: "http://minio:9000",
        // Operator-supplied endpoints skip the SSRF guard by design.
        endpointTrusted: true,
        forcePathStyle: true,
        prefix: "prod",
        accessKeyId: "AK",
        secretAccessKey: "SK",
      });
    });

    it("defaults region/credentials and allows virtual-host addressing", () => {
      process.env.STORAGE_S3_BUCKET = "cal";
      process.env.STORAGE_S3_FORCE_PATH_STYLE = "false";
      expect(config.getGlobalConfig()).toMatchObject({
        region: "us-east-1",
        forcePathStyle: false,
        endpoint: null,
        prefix: null,
        accessKeyId: null,
        secretAccessKey: null,
      });
    });
  });

  describe("nfs", () => {
    beforeEach(() => {
      process.env.STORAGE_DRIVER = "nfs";
    });

    it("requires a mount root", () => {
      expect(() => config.getGlobalConfig()).toThrow("requires STORAGE_NFS_ROOT");
    });

    it("defaults fsync ON so an acknowledged write is really durable", () => {
      process.env.STORAGE_NFS_ROOT = "/mnt/cal";
      expect(config.getGlobalConfig()).toEqual({
        provider: "nfs",
        root: "/mnt/cal",
        fsync: true,
      });
    });

    it("allows fsync to be turned off explicitly", () => {
      process.env.STORAGE_NFS_ROOT = "/mnt/cal";
      process.env.STORAGE_NFS_FSYNC = "false";
      expect(config.getGlobalConfig().fsync).toBe(false);
    });
  });
});

describe("storage config — tenant override validation", () => {
  it("rejects a missing or non-object configuration", () => {
    expect(() => config.validateTenantConfig(null)).toThrow("is required");
    expect(() => config.validateTenantConfig("s3")).toThrow("is required");
  });

  it("rejects an unknown or missing provider", () => {
    expect(() => config.validateTenantConfig({ provider: "gdrive" })).toThrow(
      'Invalid storage provider "gdrive"',
    );
    expect(() => config.validateTenantConfig({})).toThrow(
      "Invalid storage provider",
    );
  });

  it("refuses to let a tenant point the local driver at a server path", () => {
    // Otherwise a tenant would have an arbitrary read/write primitive on the
    // application server's own filesystem.
    expect(() =>
      config.validateTenantConfig({ provider: "local", root: "/etc" }),
    ).toThrow("cannot be configured per tenant");
  });

  it("requires a bucket for s3 and normalizes the rest", () => {
    expect(() => config.validateTenantConfig({ provider: "s3" })).toThrow(
      "requires a bucket",
    );
    expect(
      config.validateTenantConfig({ provider: "S3", bucket: "tenant-bucket" }),
    ).toEqual({
      provider: "s3",
      bucket: "tenant-bucket",
      region: "us-east-1",
      endpoint: null,
      forcePathStyle: true,
      prefix: null,
    });
  });

  it("keeps an explicit region, endpoint and prefix", () => {
    expect(
      config.validateTenantConfig({
        provider: "s3",
        bucket: "b",
        region: "eu-central-1",
        endpoint: "https://s3.example.com",
        prefix: "tenant-1",
        forcePathStyle: false,
      }),
    ).toEqual({
      provider: "s3",
      bucket: "b",
      region: "eu-central-1",
      endpoint: "https://s3.example.com",
      forcePathStyle: false,
      prefix: "tenant-1",
    });
  });

  it("never carries endpointTrusted out of a tenant configuration", () => {
    // A tenant that could set this flag would bypass the SSRF guard.
    const result = config.validateTenantConfig({
      provider: "s3",
      bucket: "b",
      endpoint: "http://169.254.169.254",
      endpointTrusted: true,
    });
    expect(result.endpointTrusted).toBeUndefined();
  });

  it("requires a root for nfs", () => {
    expect(() => config.validateTenantConfig({ provider: "nfs" })).toThrow(
      "requires a mount root",
    );
    expect(
      config.validateTenantConfig({ provider: "nfs", root: "/mnt/t1", fsync: false }),
    ).toEqual({ provider: "nfs", root: "/mnt/t1", fsync: false });
  });
});

describe("storage config — reading a tenant override", () => {
  it("returns null with no tenant", async () => {
    await expect(config.getTenantConfig(null)).resolves.toBeNull();
    expect(TenantSettings.findAll).not.toHaveBeenCalled();
  });

  it("returns null when the tenant has no override", async () => {
    TenantSettings.findAll.mockResolvedValue([]);
    await expect(config.getTenantConfig("t1")).resolves.toBeNull();
  });

  it("returns null when the stored value is empty", async () => {
    TenantSettings.findAll.mockResolvedValue([
      { key: "storage_config", value: "" },
    ]);
    await expect(config.getTenantConfig("t1")).resolves.toBeNull();
  });

  it("merges the decrypted credentials into the configuration", async () => {
    TenantSettings.findAll.mockResolvedValue([
      {
        key: "storage_config",
        value: JSON.stringify({ provider: "s3", bucket: "tenant-bucket" }),
      },
      {
        key: "storage_credentials",
        value: JSON.stringify({ accessKeyId: "AK", secretAccessKey: "SK" }),
      },
    ]);
    await expect(config.getTenantConfig("t1")).resolves.toEqual({
      provider: "s3",
      bucket: "tenant-bucket",
      accessKeyId: "AK",
      secretAccessKey: "SK",
    });
  });

  it("works when credentials are absent (IAM role / NFS)", async () => {
    TenantSettings.findAll.mockResolvedValue([
      { key: "storage_config", value: JSON.stringify({ provider: "nfs", root: "/m" }) },
      { key: "storage_credentials", value: null },
    ]);
    await expect(config.getTenantConfig("t1")).resolves.toEqual({
      provider: "nfs",
      root: "/m",
    });
  });

  it("fails loudly on a corrupt configuration rather than guessing", async () => {
    TenantSettings.findAll.mockResolvedValue([
      { key: "storage_config", value: "{not json" },
    ]);
    await expect(config.getTenantConfig("t1")).rejects.toThrow("configuration is corrupt");
  });

  it("fails loudly on corrupt credentials", async () => {
    TenantSettings.findAll.mockResolvedValue([
      { key: "storage_config", value: JSON.stringify({ provider: "s3", bucket: "b" }) },
      { key: "storage_credentials", value: "{nope" },
    ]);
    await expect(config.getTenantConfig("t1")).rejects.toThrow("credentials are corrupt");
  });
});

describe("storage config — writing a tenant override", () => {
  it("requires a tenant", async () => {
    await expect(config.setTenantConfig(null, { provider: "s3" })).rejects.toThrow(
      "A tenant is required",
    );
  });

  it("rejects a call with no configuration at all", async () => {
    await expect(config.setTenantConfig("t1")).rejects.toThrow(
      "Invalid storage provider",
    );
  });

  it("stores credentials through the model instance so they get encrypted", async () => {
    const row = { save: jest.fn() };
    TenantSettings.findOrBuild.mockResolvedValue([row]);

    await config.setTenantConfig("t1", {
      provider: "s3",
      bucket: "b",
      accessKeyId: "AK",
      secretAccessKey: "SK",
    });

    // The non-secret half goes through upsert...
    expect(TenantSettings.upsert).toHaveBeenCalledWith({
      tenantId: "t1",
      key: "storage_config",
      value: expect.not.stringContaining("SK"),
    });
    // ...and the secret half through save(), because upsert() bypasses the
    // beforeSave hook that performs the envelope encryption.
    expect(row.value).toBe(JSON.stringify({ accessKeyId: "AK", secretAccessKey: "SK" }));
    expect(row.save).toHaveBeenCalled();
  });

  it("does not write a credentials row when none were supplied", async () => {
    await config.setTenantConfig("t1", { provider: "nfs", root: "/mnt/t1" });
    expect(TenantSettings.findOrBuild).not.toHaveBeenCalled();
  });

  it("stores a partial credential set", async () => {
    const row = { save: jest.fn() };
    TenantSettings.findOrBuild.mockResolvedValue([row]);
    await config.setTenantConfig("t1", {
      provider: "s3",
      bucket: "b",
      secretAccessKey: "SK",
    });
    expect(row.value).toBe(JSON.stringify({ secretAccessKey: "SK" }));
  });

  it("rejects an invalid configuration before touching the database", async () => {
    await expect(config.setTenantConfig("t1", { provider: "s3" })).rejects.toThrow(
      "requires a bucket",
    );
    expect(TenantSettings.upsert).not.toHaveBeenCalled();
  });
});

describe("storage config — clearing a tenant override", () => {
  it("requires a tenant", async () => {
    await expect(config.clearTenantConfig(null)).rejects.toThrow(
      "A tenant is required",
    );
  });

  it("removes both rows so the tenant falls back to the platform default", async () => {
    TenantSettings.destroy.mockResolvedValue(2);
    await expect(config.clearTenantConfig("t1")).resolves.toEqual({ cleared: 2 });
    expect(TenantSettings.destroy).toHaveBeenCalledWith({
      where: { tenantId: "t1", key: ["storage_config", "storage_credentials"] },
    });
  });
});
