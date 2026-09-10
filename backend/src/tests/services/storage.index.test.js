/**
 * Storage façade tests.
 *
 * The property under test is the one the rest of the codebase relies on: a
 * ScopedStorage bound to tenant A cannot be made to touch tenant B's object,
 * no matter what key a caller hands it.
 */

jest.mock("../../services/storage/config.service", () => ({
  getTenantConfig: jest.fn(),
  getGlobalConfig: jest.fn(),
  validateTenantConfig: jest.fn((c) => ({ ...c })),
}));

const mockLocalInstances = [];
const mockS3Instances = [];

jest.mock("../../services/storage/local.driver", () =>
  jest.fn(function LocalDriver(config) {
    this.name = config.name || "local";
    this.config = config;
    this.put = jest.fn().mockResolvedValue({ key: "k" });
    this.get = jest.fn().mockResolvedValue("stream");
    this.stat = jest.fn().mockResolvedValue({ size: 10 });
    this.exists = jest.fn().mockResolvedValue(true);
    this.delete = jest.fn().mockResolvedValue({ deleted: true });
    this.list = jest.fn().mockResolvedValue({ keys: [] });
    this.deleteMany = jest.fn().mockResolvedValue({ deleted: 0 });
    this.signedUrl = jest.fn().mockReturnValue({ url: "signed", direct: false });
    this.healthCheck = jest.fn().mockResolvedValue({ ok: true });
    require("../../services/storage/local.driver").instances.push(this);
  }),
);
jest.mock("../../services/storage/s3.driver", () =>
  jest.fn(function S3Driver(config) {
    this.name = "s3";
    this.config = config;
    this.put = jest.fn().mockResolvedValue({ key: "k" });
    this.list = jest.fn().mockResolvedValue({ keys: [] });
    this.stat = jest.fn().mockResolvedValue({ size: 1 });
    this.signedUrl = jest.fn().mockResolvedValue({ url: "presigned", direct: true });
    require("../../services/storage/s3.driver").instances.push(this);
  }),
);

const LocalDriver = require("../../services/storage/local.driver");
const S3Driver = require("../../services/storage/s3.driver");
LocalDriver.instances = mockLocalInstances;
S3Driver.instances = mockS3Instances;

const config = require("../../services/storage/config.service");
const storage = require("../../services/storage");
const signing = require("../../services/storage/signing");

// The façade captures this at load time; sign test tokens with the same value.
const SIGN_SECRET =
  process.env.ATTACHMENT_URL_SECRET || process.env.CERT_SIGNING_SECRET;

const TENANT_KEY = "t/tenant-1/attachments/report.pdf";

beforeEach(() => {
  jest.clearAllMocks();
  mockLocalInstances.length = 0;
  mockS3Instances.length = 0;
  storage.invalidateAll();
  config.getTenantConfig.mockResolvedValue(null);
  config.getGlobalConfig.mockReturnValue({ provider: "local", root: "/srv" });
  // clearAllMocks() resets call history but NOT implementations, so a
  // mockReturnValue from a previous test would otherwise leak into this one.
  config.validateTenantConfig.mockImplementation((c) => ({ ...c }));
});

describe("storage façade — provider resolution", () => {
  it("falls back to the platform default when the tenant has no override", async () => {
    const scoped = await storage.getTenantStorage("tenant-1");
    expect(scoped.provider).toBe("local");
    expect(mockLocalInstances[0].config.root).toBe("/srv");
  });

  it("prefers the tenant's own provider — the cost lever", async () => {
    config.getTenantConfig.mockResolvedValue({
      provider: "s3",
      bucket: "tenant-bucket",
      accessKeyId: "AK",
      secretAccessKey: "SK",
    });

    const scoped = await storage.getTenantStorage("tenant-1");

    expect(scoped.provider).toBe("s3");
    expect(mockS3Instances[0].config).toMatchObject({
      bucket: "tenant-bucket",
      accessKeyId: "AK",
      secretAccessKey: "SK",
    });
    expect(config.getGlobalConfig).not.toHaveBeenCalled();
  });

  it("re-validates a stored configuration on read", async () => {
    config.getTenantConfig.mockResolvedValue({ provider: "nfs", root: "/mnt" });
    await storage.getTenantStorage("tenant-1");
    expect(config.validateTenantConfig).toHaveBeenCalledWith({
      provider: "nfs",
      root: "/mnt",
    });
  });

  it("re-attaches credentials that validation strips", async () => {
    config.validateTenantConfig.mockReturnValue({ provider: "s3", bucket: "b" });
    config.getTenantConfig.mockResolvedValue({
      provider: "s3",
      bucket: "b",
      accessKeyId: "AK",
      secretAccessKey: "SK",
    });
    await storage.getTenantStorage("tenant-1");
    expect(mockS3Instances[0].config).toMatchObject({
      accessKeyId: "AK",
      secretAccessKey: "SK",
    });
  });

  it("nulls absent credentials rather than passing undefined through", async () => {
    config.getTenantConfig.mockResolvedValue({ provider: "nfs", root: "/mnt" });
    await storage.getTenantStorage("tenant-1");
    expect(mockLocalInstances[0].config).toMatchObject({
      accessKeyId: null,
      secretAccessKey: null,
      name: "nfs",
    });
  });

  it("builds an nfs driver as a named local driver", async () => {
    config.getGlobalConfig.mockReturnValue({
      provider: "nfs",
      root: "/mnt",
      fsync: true,
    });
    const scoped = await storage.getGlobalStorage();
    expect(scoped.provider).toBe("nfs");
    expect(mockLocalInstances[0].config).toMatchObject({ fsync: true });
  });

  it("requires a tenant id", async () => {
    await expect(storage.getTenantStorage(null)).rejects.toThrow(
      "requires a tenantId",
    );
  });
});

describe("storage façade — probe driver", () => {
  it("builds a driver without caching it", async () => {
    config.getGlobalConfig.mockReturnValue({ provider: "local", root: "/srv" });
    const probe = storage.buildProbeDriver({ provider: "nfs", root: "/mnt" });
    expect(probe.name).toBe("nfs");
    // The probe must not have displaced or populated the tenant cache.
    await storage.getTenantStorage("tenant-1");
    expect(mockLocalInstances).toHaveLength(2); // probe + real, no cache hit
  });

  it("builds an s3 probe driver", () => {
    const probe = storage.buildProbeDriver({ provider: "s3", bucket: "b" });
    expect(probe.name).toBe("s3");
  });
});

describe("storage façade — signed object resolution", () => {
  it("streams a tenant object for a valid token", async () => {
    config.getGlobalConfig.mockReturnValue({ provider: "local", root: "/srv" });
    const { token } = signing.sign(TENANT_KEY, 300, SIGN_SECRET);

    const result = await storage.openSignedObject(TENANT_KEY, token);
    expect(result).toEqual({ stream: "stream", meta: { size: 10 } });
    // Resolved through the tenant derived from the key, not from any request.
    expect(mockLocalInstances[0].config.root).toBe("/srv");
  });

  it("streams a global object for a valid token", async () => {
    config.getGlobalConfig.mockReturnValue({ provider: "local", root: "/srv" });
    const globalKey = "global/branding/logo.png";
    const { token } = signing.sign(globalKey, 300, SIGN_SECRET);

    await expect(storage.openSignedObject(globalKey, token)).resolves.toEqual({
      stream: "stream",
      meta: { size: 10 },
    });
  });

  it("refuses an invalid token before touching storage", async () => {
    await expect(
      storage.openSignedObject(TENANT_KEY, "9999999999.bad"),
    ).rejects.toMatchObject({ status: 403 });
    expect(mockLocalInstances).toHaveLength(0);
  });

  it("refuses a token whose key was tampered with", async () => {
    const { token } = signing.sign(TENANT_KEY, 300, SIGN_SECRET);
    await expect(
      storage.openSignedObject("t/tenant-2/attachments/report.pdf", token),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a malformed key", async () => {
    await expect(
      storage.openSignedObject("../../etc/passwd", "x.y"),
    ).rejects.toThrow();
  });
});

describe("storage façade — driver caching", () => {
  it("reuses one driver across calls for the same tenant", async () => {
    await storage.getTenantStorage("tenant-1");
    await storage.getTenantStorage("tenant-1");
    expect(mockLocalInstances).toHaveLength(1);
  });

  it("keeps tenants on separate driver instances", async () => {
    await storage.getTenantStorage("tenant-1");
    await storage.getTenantStorage("tenant-2");
    expect(mockLocalInstances).toHaveLength(2);
  });

  it("rebuilds after a configuration change is invalidated", async () => {
    await storage.getTenantStorage("tenant-1");
    storage.invalidate("tenant-1");
    await storage.getTenantStorage("tenant-1");
    expect(mockLocalInstances).toHaveLength(2);
  });

  it("invalidates the global driver too", async () => {
    await storage.getGlobalStorage();
    storage.invalidate(null);
    await storage.getGlobalStorage();
    expect(mockLocalInstances).toHaveLength(2);
  });
});

describe("storage façade — tenant binding", () => {
  let scoped;

  beforeEach(async () => {
    scoped = await storage.getTenantStorage("tenant-1");
  });

  it("builds keys inside its own namespace", () => {
    expect(scoped.buildKey({ domain: "attachments", name: "a.pdf" })).toBe(
      "t/tenant-1/attachments/a.pdf",
    );
  });

  it.each([
    ["put", (s) => s.put("t/tenant-2/attachments/a.pdf", Buffer.from("x"))],
    ["get", (s) => s.get("t/tenant-2/attachments/a.pdf")],
    ["stat", (s) => s.stat("t/tenant-2/attachments/a.pdf")],
    ["exists", (s) => s.exists("t/tenant-2/attachments/a.pdf")],
    ["delete", (s) => s.delete("t/tenant-2/attachments/a.pdf")],
    ["signedUrl", (s) => s.signedUrl("t/tenant-2/attachments/a.pdf")],
  ])("refuses %s against another tenant's key", async (_name, call) => {
    await expect(async () => call(scoped)).rejects.toThrow(
      "does not belong to this tenant",
    );
    expect(scoped.driver.put).not.toHaveBeenCalled();
  });

  it("refuses a global key from a tenant-bound store", async () => {
    await expect(async () => scoped.get("global/branding/logo.png")).rejects.toThrow(
      "does not belong to this tenant",
    );
  });

  it("passes an owned key through to the driver", async () => {
    await scoped.put(TENANT_KEY, Buffer.from("x"), { contentType: "application/pdf" });
    expect(scoped.driver.put).toHaveBeenCalledWith(TENANT_KEY, expect.any(Buffer), {
      contentType: "application/pdf",
    });
  });

  it("forwards get/stat/exists/delete for an owned key", async () => {
    await expect(scoped.get(TENANT_KEY)).resolves.toBe("stream");
    await expect(scoped.stat(TENANT_KEY)).resolves.toEqual({ size: 10 });
    await expect(scoped.exists(TENANT_KEY)).resolves.toBe(true);
    await expect(scoped.delete(TENANT_KEY)).resolves.toEqual({ deleted: true });
  });

  it("scopes list and deleteMany to its own prefix", async () => {
    await scoped.list();
    expect(scoped.driver.list).toHaveBeenCalledWith("t/tenant-1/", undefined);

    await scoped.list("certificates");
    expect(scoped.driver.list).toHaveBeenLastCalledWith(
      "t/tenant-1/certificates/",
      undefined,
    );

    await scoped.deleteMany("attachments");
    expect(scoped.driver.deleteMany).toHaveBeenCalledWith("t/tenant-1/attachments/");

    await scoped.deleteMany();
    expect(scoped.driver.deleteMany).toHaveBeenLastCalledWith("t/tenant-1/");
  });

  it("forwards the health check", async () => {
    await expect(scoped.healthCheck()).resolves.toEqual({ ok: true });
  });

  it("binds the global store to global/ only", async () => {
    const global = await storage.getGlobalStorage();
    expect(global.buildKey({ domain: "branding", name: "logo.png" })).toBe(
      "global/branding/logo.png",
    );
    await expect(async () => global.get(TENANT_KEY)).rejects.toThrow(
      "does not belong to this tenant",
    );
  });
});

describe("storage façade — signed URLs", () => {
  it("supplies the HMAC secret and base URL for local/NFS", async () => {
    process.env.PUBLIC_BASE_URL = "https://app.example.com";
    const scoped = await storage.getTenantStorage("tenant-1");
    await scoped.signedUrl(TENANT_KEY, { ttlSec: 60 });

    expect(scoped.driver.signedUrl).toHaveBeenCalledWith(TENANT_KEY, {
      ttlSec: 60,
      baseUrl: "https://app.example.com",
      secret: expect.any(String),
    });
    delete process.env.PUBLIC_BASE_URL;
  });

  it("lets an explicit base URL win", async () => {
    const scoped = await storage.getTenantStorage("tenant-1");
    await scoped.signedUrl(TENANT_KEY, { baseUrl: "https://custom" });
    expect(scoped.driver.signedUrl.mock.calls[0][1].baseUrl).toBe("https://custom");
  });

  it("falls back to an empty base URL when none is configured", async () => {
    const previous = process.env.PUBLIC_BASE_URL;
    delete process.env.PUBLIC_BASE_URL;
    const scoped = await storage.getTenantStorage("tenant-1");
    await scoped.signedUrl(TENANT_KEY);
    expect(scoped.driver.signedUrl.mock.calls[0][1].baseUrl).toBe("");
    if (previous !== undefined) process.env.PUBLIC_BASE_URL = previous;
  });

  it("leaves S3 to presign on its own — no HMAC secret involved", async () => {
    config.getTenantConfig.mockResolvedValue({ provider: "s3", bucket: "b" });
    const scoped = await storage.getTenantStorage("tenant-1");
    await expect(scoped.signedUrl(TENANT_KEY, { ttlSec: 30 })).resolves.toMatchObject({
      direct: true,
    });
    expect(scoped.driver.signedUrl).toHaveBeenCalledWith(TENANT_KEY, { ttlSec: 30 });
  });
});

describe("storage façade — usage accounting", () => {
  it("sums the size of every object a tenant stores", async () => {
    const scoped = await storage.getTenantStorage("tenant-1");
    scoped.driver.list.mockResolvedValue({ keys: ["a", "b", "c"] });
    scoped.driver.stat
      .mockResolvedValueOnce({ size: 100 })
      .mockResolvedValueOnce({ size: 250 })
      .mockResolvedValueOnce({ size: 0 });

    await expect(scoped.usage()).resolves.toEqual({ bytes: 350, objects: 3 });
  });

  it("skips an object deleted mid-enumeration instead of failing the total", async () => {
    const scoped = await storage.getTenantStorage("tenant-1");
    scoped.driver.list.mockResolvedValue({ keys: ["a", "b"] });
    scoped.driver.stat
      .mockResolvedValueOnce({ size: 100 })
      .mockRejectedValueOnce(Object.assign(new Error("gone"), { status: 404 }));

    await expect(scoped.usage()).resolves.toEqual({ bytes: 100, objects: 2 });
  });

  it("propagates a real storage failure", async () => {
    const scoped = await storage.getTenantStorage("tenant-1");
    scoped.driver.list.mockResolvedValue({ keys: ["a"] });
    scoped.driver.stat.mockRejectedValue(
      Object.assign(new Error("EACCES"), { status: 500 }),
    );
    await expect(scoped.usage()).rejects.toThrow("EACCES");
  });

  it("counts a single domain when asked", async () => {
    const scoped = await storage.getTenantStorage("tenant-1");
    scoped.driver.list.mockResolvedValue({ keys: [] });
    await scoped.usage("certificates");
    expect(scoped.driver.list).toHaveBeenCalledWith("t/tenant-1/certificates/", {
      limit: Number.MAX_SAFE_INTEGER,
    });
  });

  it("tolerates a stat with no size", async () => {
    const scoped = await storage.getTenantStorage("tenant-1");
    scoped.driver.list.mockResolvedValue({ keys: ["a"] });
    scoped.driver.stat.mockResolvedValue({});
    await expect(scoped.usage()).resolves.toEqual({ bytes: 0, objects: 1 });
  });
});
