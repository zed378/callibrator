/**
 * S3 driver tests.
 *
 * The AWS SDK is mocked at the command level: each assertion checks the exact
 * command input the driver builds (bucket, key, prefix, paging), because those
 * inputs are what determine whether one tenant can address another's object.
 */

const mockSend = jest.fn();
const mockGetSignedUrl = jest.fn();
const mockS3ClientCtor = jest.fn();

jest.mock("@aws-sdk/client-s3", () => {
  const command = (type) =>
    jest.fn(function Command(input) {
      this.__type = type;
      this.input = input;
    });
  return {
    S3Client: jest.fn(function S3Client(config) {
      mockS3ClientCtor(config);
      this.send = mockSend;
    }),
    PutObjectCommand: command("Put"),
    GetObjectCommand: command("Get"),
    HeadObjectCommand: command("Head"),
    DeleteObjectCommand: command("Delete"),
    DeleteObjectsCommand: command("DeleteMany"),
    ListObjectsV2Command: command("List"),
  };
});

jest.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (...args) => mockGetSignedUrl(...args),
}));

const S3Driver = require("../../services/storage/s3.driver");

const KEY = "t/tenant-1/attachments/report.pdf";
const lastInput = () => mockSend.mock.calls.at(-1)[0].input;

let driver;

beforeEach(() => {
  jest.clearAllMocks();
  driver = new S3Driver({ bucket: "cal-bucket", region: "ap-southeast-1" });
});

describe("s3 driver — construction", () => {
  it("refuses to start without a bucket", () => {
    expect(() => new S3Driver({})).toThrow("requires a bucket");
    expect(() => new S3Driver()).toThrow("requires a bucket");
  });

  it("defaults the region and omits endpoint config for plain AWS", () => {
    new S3Driver({ bucket: "b" });
    // WHEN_REQUIRED checksums keep S3-compatible stores (MinIO/R2/Wasabi)
    // happy and are a no-op on AWS.
    expect(mockS3ClientCtor).toHaveBeenLastCalledWith({
      region: "us-east-1",
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  });

  it("passes explicit credentials through", () => {
    new S3Driver({ bucket: "b", accessKeyId: "AK", secretAccessKey: "SK" });
    expect(mockS3ClientCtor).toHaveBeenLastCalledWith(
      expect.objectContaining({
        credentials: { accessKeyId: "AK", secretAccessKey: "SK" },
      }),
    );
  });

  it("falls back to the ambient credential chain when only one half is given", () => {
    new S3Driver({ bucket: "b", accessKeyId: "AK" });
    expect(mockS3ClientCtor.mock.calls.at(-1)[0].credentials).toBeUndefined();
  });

  it("enables path-style addressing for a custom endpoint (MinIO et al)", () => {
    new S3Driver({ bucket: "b", endpoint: "https://minio.example.com" });
    expect(mockS3ClientCtor).toHaveBeenLastCalledWith(
      expect.objectContaining({
        endpoint: "https://minio.example.com",
        forcePathStyle: true,
      }),
    );
  });

  it("allows virtual-host addressing when explicitly disabled", () => {
    new S3Driver({
      bucket: "b",
      endpoint: "https://r2.example.com",
      forcePathStyle: false,
    });
    expect(mockS3ClientCtor.mock.calls.at(-1)[0].forcePathStyle).toBe(false);
  });

  it("blocks a tenant endpoint pointed at an internal address (SSRF)", () => {
    expect(
      () => new S3Driver({ bucket: "b", endpoint: "http://169.254.169.254/" }),
    ).toThrow(/disallowed \(internal\) address/);
    expect(
      () => new S3Driver({ bucket: "b", endpoint: "http://localhost:9000" }),
    ).toThrow("URL host is not allowed");
  });

  it("permits an internal endpoint the operator configured themselves", () => {
    // A MinIO sidecar is legitimately internal; the SSRF guard exists for
    // tenant-supplied endpoints, not the platform's own.
    expect(
      () =>
        new S3Driver({
          bucket: "b",
          endpoint: "http://127.0.0.1:9000",
          endpointTrusted: true,
        }),
    ).not.toThrow();
  });
});

describe("s3 driver — object operations", () => {
  it("puts an object with its content type", async () => {
    mockSend.mockResolvedValue({ ETag: '"abc"' });
    const result = await driver.put(KEY, Buffer.from("hello"), {
      contentType: "application/pdf",
    });

    expect(lastInput()).toEqual({
      Bucket: "cal-bucket",
      Key: KEY,
      Body: expect.any(Buffer),
      ContentType: "application/pdf",
    });
    expect(result).toEqual({ key: KEY, size: 5, etag: '"abc"' });
  });

  it("defaults the content type and reports null size for a stream", async () => {
    mockSend.mockResolvedValue({});
    const result = await driver.put(KEY, { pipe: () => {} });
    expect(lastInput().ContentType).toBe("application/octet-stream");
    expect(result).toEqual({ key: KEY, size: null, etag: null });
  });

  it("returns the body stream on get", async () => {
    mockSend.mockResolvedValue({ Body: "stream" });
    await expect(driver.get(KEY)).resolves.toBe("stream");
  });

  it("maps a missing object to 410 on get", async () => {
    mockSend.mockRejectedValue(Object.assign(new Error("gone"), { name: "NoSuchKey" }));
    await expect(driver.get(KEY)).rejects.toMatchObject({ status: 410 });
  });

  it("propagates a non-404 failure on get", async () => {
    mockSend.mockRejectedValue(Object.assign(new Error("AccessDenied"), { name: "AccessDenied" }));
    await expect(driver.get(KEY)).rejects.toThrow("AccessDenied");
  });

  it("maps head metadata onto the common stat shape", async () => {
    const modified = new Date("2026-01-01T00:00:00Z");
    mockSend.mockResolvedValue({
      ContentLength: 42,
      LastModified: modified,
      ETag: '"e"',
      ContentType: "application/pdf",
    });
    await expect(driver.stat(KEY)).resolves.toEqual({
      key: KEY,
      size: 42,
      modifiedAt: modified,
      etag: '"e"',
      contentType: "application/pdf",
    });
  });

  it("tolerates a head response with no metadata", async () => {
    mockSend.mockResolvedValue({});
    await expect(driver.stat(KEY)).resolves.toMatchObject({
      size: null,
      modifiedAt: null,
      etag: null,
      contentType: null,
    });
  });

  it("maps a 404 status (not just NoSuchKey) to 404 on stat", async () => {
    mockSend.mockRejectedValue(
      Object.assign(new Error("nope"), { $metadata: { httpStatusCode: 404 } }),
    );
    await expect(driver.stat(KEY)).rejects.toMatchObject({ status: 404 });
  });

  it("propagates a non-404 failure on stat", async () => {
    mockSend.mockRejectedValue(new Error("network down"));
    await expect(driver.stat(KEY)).rejects.toThrow("network down");
  });

  it("answers exists from stat", async () => {
    mockSend.mockResolvedValue({ ContentLength: 1 });
    expect(await driver.exists(KEY)).toBe(true);

    mockSend.mockRejectedValue(Object.assign(new Error("x"), { name: "NotFound" }));
    expect(await driver.exists(KEY)).toBe(false);
  });

  it("propagates an unexpected failure from exists", async () => {
    mockSend.mockRejectedValue(new Error("boom"));
    await expect(driver.exists(KEY)).rejects.toThrow("boom");
  });

  it("deletes a single object", async () => {
    mockSend.mockResolvedValue({});
    await expect(driver.delete(KEY)).resolves.toEqual({ key: KEY, deleted: true });
    expect(lastInput()).toEqual({ Bucket: "cal-bucket", Key: KEY });
  });
});

describe("s3 driver — bucket prefix", () => {
  beforeEach(() => {
    driver = new S3Driver({ bucket: "shared", prefix: "callibrator/" });
  });

  it("prefixes keys on write and strips it on read-back", async () => {
    mockSend.mockResolvedValue({});
    await driver.put(KEY, Buffer.from("x"));
    expect(lastInput().Key).toBe(`callibrator/${KEY}`);

    mockSend.mockResolvedValue({
      Contents: [{ Key: `callibrator/${KEY}` }, { Key: "unprefixed/other" }],
    });
    const { keys } = await driver.list("t/tenant-1/");
    // A key outside the configured prefix is passed through untouched rather
    // than mangled by a blind slice.
    expect(keys).toEqual([KEY, "unprefixed/other"]);
  });
});

describe("s3 driver — listing", () => {
  it("lists a prefix and reports the continuation cursor", async () => {
    mockSend.mockResolvedValue({
      Contents: [{ Key: KEY }],
      IsTruncated: true,
      NextContinuationToken: "tok",
    });
    const result = await driver.list("t/tenant-1/", { limit: 10, cursor: "prev" });

    expect(lastInput()).toEqual({
      Bucket: "cal-bucket",
      Prefix: "t/tenant-1",
      MaxKeys: 10,
      ContinuationToken: "prev",
    });
    expect(result).toEqual({ keys: [KEY], cursor: "tok", truncated: true });
  });

  it("tolerates an empty bucket", async () => {
    mockSend.mockResolvedValue({});
    await expect(driver.list("")).resolves.toEqual({
      keys: [],
      cursor: null,
      truncated: false,
    });
  });
});

describe("s3 driver — bulk delete", () => {
  it("pages through the listing, deleting each object individually", async () => {
    // deleteMany uses per-object DeleteObject, not the batch DeleteObjects
    // operation, because S3-compatible stores (MinIO/R2/Wasabi) reject the
    // checksum trailer the SDK sends for batch delete. Still pages the listing
    // so a large tenant is fully cleaned.
    mockSend
      .mockResolvedValueOnce({
        Contents: [{ Key: "t/tenant-1/attachments/a" }],
        NextContinuationToken: "tok",
        IsTruncated: true,
      })
      .mockResolvedValueOnce({}) // DeleteObject a
      .mockResolvedValueOnce({
        Contents: [{ Key: "t/tenant-1/attachments/b" }],
        NextContinuationToken: null,
      })
      .mockResolvedValueOnce({}); // DeleteObject b

    await expect(driver.deleteMany("t/tenant-1/")).resolves.toEqual({ deleted: 2 });

    // Each delete is a single-object DeleteObject with the fully-qualified key.
    const deleteCalls = mockSend.mock.calls.filter(
      (c) => c[0].__type === "Delete",
    );
    expect(deleteCalls).toHaveLength(2);
    expect(deleteCalls[0][0].input).toEqual({
      Bucket: "cal-bucket",
      Key: "t/tenant-1/attachments/a",
    });
  });

  it("stops immediately when the prefix is already empty", async () => {
    mockSend.mockResolvedValue({ Contents: [] });
    await expect(driver.deleteMany("t/tenant-1/")).resolves.toEqual({ deleted: 0 });
    expect(mockSend).toHaveBeenCalledTimes(1); // list only, no delete
  });
});

describe("s3 driver — presigned URLs", () => {
  it("returns a direct URL so downloads bypass the app server", async () => {
    mockGetSignedUrl.mockResolvedValue("https://bucket.s3/presigned");
    const result = await driver.signedUrl(KEY, {
      ttlSec: 120,
      disposition: 'attachment; filename="r.pdf"',
    });

    expect(result).toMatchObject({
      url: "https://bucket.s3/presigned",
      direct: true,
    });
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const [, command, options] = mockGetSignedUrl.mock.calls.at(-1);
    expect(command.input).toMatchObject({
      Bucket: "cal-bucket",
      Key: KEY,
      ResponseContentDisposition: 'attachment; filename="r.pdf"',
    });
    expect(options).toEqual({ expiresIn: 120 });
  });

  it("defaults the TTL and omits an empty disposition", async () => {
    mockGetSignedUrl.mockResolvedValue("https://x");
    await driver.signedUrl(KEY);
    const [, command, options] = mockGetSignedUrl.mock.calls.at(-1);
    expect(command.input.ResponseContentDisposition).toBeUndefined();
    expect(options).toEqual({ expiresIn: 300 });
  });
});

describe("s3 driver — health check", () => {
  it("passes when the bucket is reachable", async () => {
    mockSend.mockResolvedValue({});
    await expect(driver.healthCheck()).resolves.toEqual({
      ok: true,
      driver: "s3",
      bucket: "cal-bucket",
    });
  });

  it("reports the failure instead of throwing", async () => {
    mockSend.mockRejectedValue(new Error("NoSuchBucket"));
    await expect(driver.healthCheck()).resolves.toMatchObject({
      ok: false,
      error: "NoSuchBucket",
    });
  });
});
