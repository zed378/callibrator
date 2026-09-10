/**
 * S3-compatible object storage driver (AWS SDK v3).
 *
 * Works against AWS S3 and any S3-compatible endpoint — MinIO, Cloudflare R2,
 * Wasabi, DigitalOcean Spaces — via `endpoint` + `forcePathStyle`.
 *
 * The reason this driver exists is cost: `signedUrl()` returns a real presigned
 * URL, so clients download straight from the bucket and the app server is out
 * of the data path entirely (no egress, no CPU, no memory held per download).
 */

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { AppError } = require("../../utils/appError.util");
const { normalizeKey } = require("./keys");
const { assertSafeUrl } = require("../../utils/ssrf.util");

/** S3 reports "missing" through several different shapes depending on the op. */
const isNotFound = (err) =>
  err.name === "NoSuchKey" ||
  err.name === "NotFound" ||
  err.$metadata?.httpStatusCode === 404;

class S3Driver {
  /**
   * @param {object} config
   * @param {string} config.bucket
   * @param {string} [config.region]
   * @param {string} [config.endpoint]        Custom S3-compatible endpoint.
   * @param {boolean} [config.forcePathStyle] Required by MinIO and most non-AWS.
   * @param {string} [config.accessKeyId]
   * @param {string} [config.secretAccessKey]
   * @param {string} [config.prefix]          Extra prefix inside the bucket.
   */
  constructor(config = {}) {
    if (!config.bucket) {
      throw new AppError(500, "S3 storage driver requires a bucket");
    }
    this.name = "s3";
    this.bucket = config.bucket;
    this.prefix = config.prefix ? `${String(config.prefix).replace(/\/$/, "")}/` : "";

    const clientConfig = {
      region: config.region || "us-east-1",
      // Compute/validate checksums only when the operation requires it.
      //
      // Since early 2025 the SDK defaults to sending a CRC32 trailer checksum
      // on requests, which MinIO, Cloudflare R2, Wasabi and other
      // S3-compatible stores reject. WHEN_REQUIRED avoids that trailer on the
      // common paths (put/get) and is a no-op against real AWS. Verified live
      // against MinIO. (The batch-delete path is handled separately in
      // deleteMany — see there.)
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    };

    if (config.endpoint) {
      // A TENANT-supplied endpoint is attacker-influenced input that the
      // server will then make requests to — exactly the SSRF shape — so it
      // goes through the same guard the webhook sender uses.
      //
      // The operator's own endpoint (from env) is trusted and deliberately
      // exempt: it is legitimately internal, e.g. a MinIO sidecar at
      // http://minio:9000 or http://127.0.0.1:9000, which the SSRF guard
      // rejects by design.
      if (!config.endpointTrusted) {
        assertSafeUrl(config.endpoint);
      }
      clientConfig.endpoint = config.endpoint;
      clientConfig.forcePathStyle = config.forcePathStyle !== false;
    }

    if (config.accessKeyId && config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
    }
    // With no explicit credentials the SDK falls back to the ambient provider
    // chain (IAM role / instance profile), which is the preferred setup for the
    // platform-owned global bucket.

    this.client = new S3Client(clientConfig);
  }

  /** Bucket-absolute key for a logical storage key. */
  _objectKey(key) {
    return `${this.prefix}${normalizeKey(key)}`;
  }

  /** Strip the configured prefix so callers only ever see logical keys. */
  _logicalKey(objectKey) {
    return this.prefix && objectKey.startsWith(this.prefix)
      ? objectKey.slice(this.prefix.length)
      : objectKey;
  }

  async healthCheck() {
    try {
      await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 }),
      );
      return { ok: true, driver: this.name, bucket: this.bucket };
    } catch (err) {
      return { ok: false, driver: this.name, bucket: this.bucket, error: err.message };
    }
  }

  async put(key, body, { contentType } = {}) {
    const objectKey = this._objectKey(key);
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: body,
        ContentType: contentType || "application/octet-stream",
      }),
    );
    return {
      key: normalizeKey(key),
      size: Buffer.isBuffer(body) ? body.length : null,
      etag: result.ETag || null,
    };
  }

  async get(key) {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this._objectKey(key) }),
      );
      return result.Body; // Readable stream
    } catch (err) {
      if (isNotFound(err)) {
        throw new AppError(410, "Stored object is no longer available");
      }
      throw err;
    }
  }

  async stat(key) {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this._objectKey(key) }),
      );
      return {
        key: normalizeKey(key),
        size: result.ContentLength ?? null,
        modifiedAt: result.LastModified || null,
        etag: result.ETag || null,
        contentType: result.ContentType || null,
      };
    } catch (err) {
      if (isNotFound(err)) {
        throw new AppError(404, "Stored object not found");
      }
      throw err;
    }
  }

  async exists(key) {
    try {
      await this.stat(key);
      return true;
    } catch (err) {
      if (err.status === 404 || err.status === 410) {return false;}
      throw err;
    }
  }

  async delete(key) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this._objectKey(key) }),
    );
    return { key: normalizeKey(key), deleted: true };
  }

  async list(prefix, { limit = 1000, cursor } = {}) {
    // An empty prefix means "everything in this bucket/prefix" — it must not
    // go through normalizeKey, which (correctly) rejects the empty string.
    const trimmed = prefix ? prefix.replace(/\/$/, "") : "";
    const result = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: trimmed ? this._objectKey(trimmed) : this.prefix,
        MaxKeys: limit,
        ContinuationToken: cursor || undefined,
      }),
    );
    return {
      keys: (result.Contents || []).map((o) => this._logicalKey(o.Key)),
      cursor: result.NextContinuationToken || null,
      truncated: Boolean(result.IsTruncated),
    };
  }

  async deleteMany(prefix) {
    let deleted = 0;
    let cursor;
    // Delete per-object rather than via the batch DeleteObjects operation.
    // DeleteObjects requires a body checksum, and S3-compatible stores (MinIO,
    // R2, Wasabi) reject the CRC32 trailer the SDK now sends — MinIO fails it
    // with "Missing required header for this request: Content-Md5". A single
    // DeleteObject carries no body and works on every provider (verified live
    // against MinIO). Tenant offboarding is rare and not latency-critical, so
    // the extra requests buy universal compatibility cheaply.
    for (;;) {
      const page = await this.list(prefix, { limit: 1000, cursor });
      for (const key of page.keys) {
        await this.delete(key);
        deleted += 1;
      }
      cursor = page.cursor;
      if (!cursor) {
        break;
      }
    }
    return { deleted };
  }

  /**
   * Presigned GET — the client fetches straight from the bucket, so download
   * traffic never touches the app server.
   */
  async signedUrl(key, { ttlSec = 300, disposition } = {}) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: this._objectKey(key),
      ResponseContentDisposition: disposition || undefined,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn: ttlSec });
    return {
      url,
      expiresAt: new Date(Date.now() + ttlSec * 1000),
      direct: true,
    };
  }
}

module.exports = S3Driver;
