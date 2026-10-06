/**
 * S3-compatible object storage driver (AWS SDK v3).
 *
 * Works against AWS S3 and any S3-compatible endpoint — MinIO, Cloudflare R2,
 * Wasabi, DigitalOcean Spaces — via `endpoint` + `forcePathStyle`.
 *
 * The reason this driver exists is cost: `signedUrl()` returns a real presigned
 * URL, so clients download straight from the bucket and the app server is out
 * of the data path entirely (no egress, no CPU, no memory held per download).
 *
 * P9-18 (ADR-087, Stage C): converted from s3.driver.js with no behaviour
 * change, under the four isolation gates. `export =` keeps the class
 * `require()` returned. The AWS SDK classes and `getSignedUrl` are named
 * imports (both packages ship their own types). `AppError`, `normalizeKey`
 * and the SSRF guards are captured at load, as the `.js` destructured them.
 * The A-176 rule is unchanged: a tenant-supplied endpoint passes
 * `assertSafeUrl` and gets the pinned-lookup agents; only an operator endpoint
 * (`endpointTrusted`) is exempt.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import type { S3ClientConfig } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "stream";
import { AppError as LoadedAppError } from "../../utils/appError.util";
import keys from "./keys";
import { assertSafeUrl as loadedAssertSafeUrl, ssrfSafeAgents as loadedSsrfSafeAgents } from "../../utils/ssrf.util";

const AppError = LoadedAppError;
const { normalizeKey } = keys;
const assertSafeUrl = loadedAssertSafeUrl;
const ssrfSafeAgents = loadedSsrfSafeAgents;

/** The driver's configuration (as `storage/index` resolves it). */
interface S3DriverConfig {
  bucket?: string;
  region?: string;
  /** Custom S3-compatible endpoint. */
  endpoint?: string;
  /** The operator's own endpoint (from env): exempt from the SSRF guard. */
  endpointTrusted?: boolean;
  /** Required by MinIO and most non-AWS. */
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Extra prefix inside the bucket. */
  prefix?: string;
  /** A-348: the bound on healthCheck(), in ms (default HEALTH_CHECK_TIMEOUT_MS). */
  healthCheckTimeoutMs?: number;
}

/**
 * A-348 (2026-10-02): the longest a connection test may take. The SDK's
 * default HTTP handler sets no connect or request timeout and retries, so a
 * test against an endpoint that never answers (a black-holed address, a slow
 * resolver) waited for the operating system's TCP timeout — longer than any
 * client waits for `PUT /storage/settings`. Bounded, the test answers "no
 * answer within 5000 ms" and the save is the 422 it should be. Applies to
 * healthCheck() only: uploads and downloads keep the SDK's behaviour.
 */
const HEALTH_CHECK_TIMEOUT_MS = 5000;

/**
 * U-09 (2026-10-05): the most keys one ListObjectsV2 page returns on S3 (and
 * on every S3-compatible server checked live). A larger MaxKeys buys nothing,
 * and one above 2^31-1 is refused with InvalidArgument.
 */
const S3_MAX_KEYS = 1000;

/** An SDK error, read as the `.js` read it. */
interface SdkError { name?: string; message?: string; status?: number; $metadata?: { httpStatusCode?: number } }

/** S3 reports "missing" through several different shapes depending on the op. */
const isNotFound = (err: unknown): boolean => {
  const e = err as SdkError;
  return e.name === "NoSuchKey" ||
    e.name === "NotFound" ||
    e.$metadata?.httpStatusCode === 404;
};

class S3Driver {
  name: string;
  bucket: string;
  prefix: string;
  client: S3Client;
  healthCheckTimeoutMs: number;

  constructor(config: S3DriverConfig = {}) {
    if (!config.bucket) {
      throw new AppError(500, "S3 storage driver requires a bucket");
    }
    this.name = "s3";
    this.bucket = config.bucket;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: String() of the configured prefix
    this.prefix = config.prefix ? `${String(config.prefix).replace(/\/$/, "")}/` : "";
    this.healthCheckTimeoutMs = config.healthCheckTimeoutMs ?? HEALTH_CHECK_TIMEOUT_MS;

    const clientConfig: S3ClientConfig = {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty region also falls back
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
        // A-176: assertSafeUrl checks the URL's text only. A hostname that
        // RESOLVES internally (or rebinds after the check) is refused at
        // connect time by the pinned lookup of these agents.
        clientConfig.requestHandler = ssrfSafeAgents();
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
  _objectKey(key: unknown): string {
    return `${this.prefix}${normalizeKey(key)}`;
  }

  /** Strip the configured prefix so callers only ever see logical keys. */
  _logicalKey(objectKey: string): string {
    return this.prefix && objectKey.startsWith(this.prefix)
      ? objectKey.slice(this.prefix.length)
      : objectKey;
  }

  async healthCheck(): Promise<{ ok: boolean; driver: string; bucket: string; error?: string | undefined }> {
    // A-348: one signal bounds the whole test, retries included.
    const abortSignal = AbortSignal.timeout(this.healthCheckTimeoutMs);
    try {
      await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 }),
        { abortSignal },
      );
      return { ok: true, driver: this.name, bucket: this.bucket };
    } catch (err) {
      const error = abortSignal.aborted
        ? `no answer within ${String(this.healthCheckTimeoutMs)} ms`
        : (err as SdkError).message;
      return { ok: false, driver: this.name, bucket: this.bucket, error };
    }
  }

  async put(
    key: unknown,
    body: Buffer | Readable,
    { contentType }: { contentType?: string | null } = {},
  ): Promise<{ key: string; size: number | null; etag: string | null }> {
    const objectKey = this._objectKey(key);
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: body,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty type also falls back
        ContentType: contentType || "application/octet-stream",
      }),
    );
    return {
      key: normalizeKey(key),
      size: Buffer.isBuffer(body) ? body.length : null,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty ETag reads as none
      etag: result.ETag || null,
    };
  }

  /**
   * @param key
   * @param range - inclusive byte range
   */
  async get(key: unknown, range?: { start: number; end: number } | null): Promise<unknown> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this._objectKey(key),
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: numbers interpolated as their decimal strings
          ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
        }),
      );
      return result.Body; // Readable stream
    } catch (err) {
      if (isNotFound(err)) {
        throw new AppError(410, "Stored object is no longer available");
      }
      throw err;
    }
  }

  async stat(key: unknown): Promise<{
    key: string;
    size: number | null;
    modifiedAt: Date | null;
    etag: string | null;
    contentType: string | null;
  }> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this._objectKey(key) }),
      );
      return {
        key: normalizeKey(key),
        size: result.ContentLength ?? null,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
        modifiedAt: result.LastModified || null,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty ETag reads as none
        etag: result.ETag || null,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty type reads as none
        contentType: result.ContentType || null,
      };
    } catch (err) {
      if (isNotFound(err)) {
        throw new AppError(404, "Stored object not found");
      }
      throw err;
    }
  }

  async exists(key: unknown): Promise<boolean> {
    try {
      await this.stat(key);
      return true;
    } catch (err) {
      const { status } = err as SdkError;
      if (status === 404 || status === 410) {return false;}
      throw err;
    }
  }

  async delete(key: unknown): Promise<{ key: string; deleted: true }> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this._objectKey(key) }),
    );
    return { key: normalizeKey(key), deleted: true };
  }

  async list(
    prefix?: string | null,
    { limit = 1000, cursor }: { limit?: number; cursor?: string | null | undefined } = {},
  ): Promise<{ keys: string[]; cursor: string | null; truncated: boolean }> {
    // An empty prefix means "everything in this bucket/prefix" — it must not
    // go through normalizeKey, which (correctly) rejects the empty string.
    const trimmed = prefix ? prefix.replace(/\/$/, "") : "";
    const result = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: trimmed ? this._objectKey(trimmed) : this.prefix,
        // U-09: S3 answers at most 1000 keys a page, and refuses a MaxKeys
        // above 2^31-1 outright (a caller asking for "everything" passed
        // Number.MAX_SAFE_INTEGER). Larger asks page through the cursor.
        MaxKeys: Math.min(limit, S3_MAX_KEYS),
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty cursor reads as none
        ContinuationToken: cursor || undefined,
      }),
    );
    return {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
      keys: (result.Contents || []).map((o) => this._logicalKey(o.Key as string)),
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty token reads as none
      cursor: result.NextContinuationToken || null,
      truncated: Boolean(result.IsTruncated),
    };
  }

  async deleteMany(prefix?: string | null): Promise<{ deleted: number }> {
    let deleted = 0;
    let cursor: string | null | undefined;
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
  async signedUrl(
    key: unknown,
    { ttlSec = 300, disposition }: { ttlSec?: number; disposition?: string | null } = {},
  ): Promise<{ url: string; expiresAt: Date; direct: true }> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: this._objectKey(key),
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty disposition reads as none
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

export = S3Driver;
