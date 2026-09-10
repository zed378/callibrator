const {
  updateStorageSettingsSchema,
} = require("../../validators/storage.validator");

const check = (body) =>
  updateStorageSettingsSchema.validate(body, {
    abortEarly: false,
    stripUnknown: true,
  });

describe("updateStorageSettingsSchema", () => {
  it("accepts a full s3 configuration", () => {
    const { error, value } = check({
      provider: "s3",
      bucket: "b",
      region: "eu-west-1",
      endpoint: "https://s3.example.com",
      forcePathStyle: true,
      prefix: "prod",
      accessKeyId: "AK",
      secretAccessKey: "SK",
    });
    expect(error).toBeUndefined();
    expect(value.bucket).toBe("b");
  });

  it("accepts a minimal s3 configuration (ambient credentials)", () => {
    expect(check({ provider: "s3", bucket: "b" }).error).toBeUndefined();
  });

  it("requires a bucket for s3", () => {
    expect(check({ provider: "s3" }).error).toBeDefined();
  });

  it("accepts an nfs configuration", () => {
    expect(check({ provider: "nfs", root: "/mnt/t1", fsync: false }).error).toBeUndefined();
  });

  it("requires a root for nfs", () => {
    expect(check({ provider: "nfs" }).error).toBeDefined();
  });

  it("rejects the local provider (platform default only)", () => {
    // Letting a tenant configure the local driver would be a filesystem
    // read/write primitive on the app server.
    expect(check({ provider: "local", root: "/etc" }).error).toBeDefined();
  });

  it("rejects an unknown provider", () => {
    expect(check({ provider: "gdrive" }).error).toBeDefined();
  });

  it("requires a provider", () => {
    expect(check({ bucket: "b" }).error).toBeDefined();
  });

  it("forbids s3 fields on an nfs configuration", () => {
    expect(check({ provider: "nfs", root: "/mnt", bucket: "b" }).error).toBeDefined();
  });

  it("forbids nfs fields on an s3 configuration", () => {
    expect(check({ provider: "s3", bucket: "b", root: "/mnt" }).error).toBeDefined();
  });

  it("rejects a non-URI endpoint", () => {
    expect(check({ provider: "s3", bucket: "b", endpoint: "not a url" }).error).toBeDefined();
  });

  it("allows a null/empty endpoint, prefix and credentials", () => {
    const { error } = check({
      provider: "s3",
      bucket: "b",
      endpoint: "",
      prefix: null,
      accessKeyId: "",
      secretAccessKey: null,
    });
    expect(error).toBeUndefined();
  });

  it("strips unknown fields (e.g. an attempt to set endpointTrusted)", () => {
    const { value } = check({ provider: "s3", bucket: "b", endpointTrusted: true });
    expect(value.endpointTrusted).toBeUndefined();
  });
});
