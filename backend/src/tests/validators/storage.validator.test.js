const {
  updateStorageSettingsSchema,
} = require("../../validators/storage.validator");
const { checkInput } = require("../../validators/input");

// P9-11: the schema is Zod; checkInput is the app's own entry point (unknown
// keys stripped, every issue reported), as the old options here were.
const check = (body) => checkInput(body, updateStorageSettingsSchema);

describe("updateStorageSettingsSchema", () => {
  it("accepts a full s3 configuration", () => {
    const result = check({
      provider: "s3",
      bucket: "b",
      region: "eu-west-1",
      endpoint: "https://s3.example.com",
      forcePathStyle: true,
      prefix: "prod",
      accessKeyId: "AK",
      secretAccessKey: "SK",
    });
    expect(result.ok).toBe(true);
    expect(result.value.bucket).toBe("b");
  });

  it("accepts a minimal s3 configuration (ambient credentials)", () => {
    expect(check({ provider: "s3", bucket: "b" }).ok).toBe(true);
  });

  it("converts \"true\"/\"false\" and trims text, as the old conversion did", () => {
    const result = check({ provider: "s3", bucket: "  b  ", forcePathStyle: "true" });
    expect(result).toEqual({ ok: true, value: { provider: "s3", bucket: "b", forcePathStyle: true } });
    expect(check({ provider: "nfs", root: " /mnt ", fsync: "false" }).value).toEqual({
      provider: "nfs",
      root: "/mnt",
      fsync: false,
    });
  });

  it("requires a bucket for s3", () => {
    expect(check({ provider: "s3" })).toEqual({
      ok: false,
      errors: [{ field: "bucket", message: "Invalid input: expected string, received undefined" }],
    });
  });

  it("refuses an empty bucket", () => {
    expect(check({ provider: "s3", bucket: "   " }).ok).toBe(false);
  });

  it("accepts an nfs configuration", () => {
    expect(check({ provider: "nfs", root: "/mnt/t1", fsync: false }).ok).toBe(true);
  });

  it("requires a root for nfs", () => {
    expect(check({ provider: "nfs" })).toEqual({
      ok: false,
      errors: [{ field: "root", message: "Invalid input: expected string, received undefined" }],
    });
  });

  it("rejects the local provider (platform default only)", () => {
    // Letting a tenant configure the local driver would be a filesystem
    // read/write primitive on the app server.
    expect(check({ provider: "local", root: "/etc" })).toEqual({
      ok: false,
      errors: [{ field: "provider", message: "Invalid discriminator value. Expected 's3' | 'nfs'" }],
    });
  });

  it("rejects an unknown provider", () => {
    expect(check({ provider: "gdrive" }).ok).toBe(false);
  });

  it("requires a provider", () => {
    expect(check({ bucket: "b" }).errors).toEqual([
      { field: "provider", message: "Invalid discriminator value. Expected 's3' | 'nfs'" },
    ]);
  });

  it("forbids s3 fields on an nfs configuration", () => {
    expect(check({ provider: "nfs", root: "/mnt", bucket: "b" })).toEqual({
      ok: false,
      errors: [{ field: "bucket", message: "Not allowed for this provider" }],
    });
  });

  it("forbids nfs fields on an s3 configuration", () => {
    expect(check({ provider: "s3", bucket: "b", root: "/mnt" })).toEqual({
      ok: false,
      errors: [{ field: "root", message: "Not allowed for this provider" }],
    });
  });

  it("forbids an s3 field even when null on nfs", () => {
    expect(check({ provider: "nfs", root: "/mnt", endpoint: null }).ok).toBe(false);
  });

  it("rejects a non-URI endpoint", () => {
    expect(check({ provider: "s3", bucket: "b", endpoint: "not a url" })).toEqual({
      ok: false,
      errors: [{ field: "endpoint", message: "Invalid URL" }],
    });
  });

  it("allows a null/empty endpoint, prefix and credentials", () => {
    const result = check({
      provider: "s3",
      bucket: "b",
      endpoint: "",
      prefix: null,
      accessKeyId: "",
      secretAccessKey: null,
    });
    expect(result.ok).toBe(true);
  });

  it("strips unknown fields (e.g. an attempt to set endpointTrusted)", () => {
    const result = check({ provider: "s3", bucket: "b", endpointTrusted: true });
    expect(result.ok).toBe(true);
    expect(result.value.endpointTrusted).toBeUndefined();
  });
});
