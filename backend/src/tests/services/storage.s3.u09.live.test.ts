/**
 * U-09 (2026-10-05) — the REAL S3 driver against a REAL S3-compatible server.
 *
 * Until this suite, `storage/s3.driver.ts` had been proved only with doubles
 * (storage.s3.test.js, storage.s3Keys.p918, storage.s3HealthTimeout.a348).
 * Here nothing is mocked: the AWS SDK v3, its Node HTTP handler, the SigV4
 * signer, the presigner and the SSRF guard's pinned lookup all talk to a
 * running server over TCP. It was run against SeaweedFS and Versity S3
 * Gateway (MinIO could not be pulled on the host — MEMORY/records/
 * 2026-10-05-u09-s3-live.md).
 *
 * What it proves, through the driver and the ScopedStorage façade:
 *  - health check: ok against a real bucket; a missing bucket and wrong
 *    credentials answer ok:false with the server's reason (the 422 the
 *    settings route turns it into); an endpoint that never answers is cut at
 *    the A-348 bound;
 *  - put / get / stat / exists / delete round-trips, a byte range, a missing
 *    object mapped to the app's 410 (get) and 404 (stat), list paging, and
 *    deleteMany (per-object DeleteObject — no batch checksum);
 *  - a large object (16 MiB) streamed from a file, as the migration tool does,
 *    read back byte-identical;
 *  - a presigned GET fetched with plain HTTP: bytes match, the disposition is
 *    honoured, a tampered signature and an expired URL are refused;
 *  - tenant isolation through the façade: tenant B's storage refuses A's key
 *    before the driver is called (403), and lists, usage and deleteMany of B
 *    never see or touch A's objects;
 *  - the SSRF guard with a legitimate internal endpoint: a TENANT-supplied
 *    loopback endpoint is refused (400); a tenant hostname that resolves to a
 *    private address is refused at connect time (ESSRFBLOCKED) unless it is on
 *    SSRF_DEV_ALLOW_HOSTS, the documented development allow-list — then the
 *    same driver works.
 *
 * NEEDS S3_LIVE_ENDPOINT, S3_LIVE_ACCESS_KEY, S3_LIVE_SECRET_KEY and
 * S3_LIVE_DEV_HOST; it fails, never skips, without them (`npm run test:live --
 * --with=s3`). The bucket is created by
 * the suite (a fresh name per run) and emptied and removed in afterAll.
 *
 *   S3_LIVE_ENDPOINT=http://127.0.0.1:18333 S3_LIVE_ACCESS_KEY=... \
 *     S3_LIVE_SECRET_KEY=... [S3_LIVE_DEV_HOST=host.docker.internal] \
 *     npm run test:live:jest -- src/tests/services/storage.s3.u09.live
 *
 * S3_LIVE_DEV_HOST names a host that reaches the same server but RESOLVES to
 * a private address, and is not `localhost` or an IP literal: `localtest.me`
 * (public DNS, 127.0.0.1) for a server bound to 127.0.0.1, an /etc/hosts alias
 * of 127.0.0.1 in CI, or host.docker.internal for a server Docker Desktop
 * publishes on the LAN address.
 */
import crypto from "crypto";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import type { Readable } from "stream";
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
} from "@aws-sdk/client-s3";
import { env, environment } from "../../config/env";
import S3Driver from "../../services/storage/s3.driver";
import storage from "../../services/storage";

const ENDPOINT = env("S3_LIVE_ENDPOINT") ?? "";
const ACCESS = env("S3_LIVE_ACCESS_KEY") ?? "";
const SECRET = env("S3_LIVE_SECRET_KEY") ?? "";
const REGION = env("S3_LIVE_REGION") ?? "us-east-1";
const DEV_HOST = env("S3_LIVE_DEV_HOST") ?? "";

// No skip (2026-10-10): every case runs, and the suite fails at once, naming what is missing.
const MISSING = Object.entries({ S3_LIVE_ENDPOINT: ENDPOINT, S3_LIVE_ACCESS_KEY: ACCESS, S3_LIVE_SECRET_KEY: SECRET, S3_LIVE_DEV_HOST: DEV_HOST })
  .filter(([, value]) => value === "")
  .map(([name]) => name);
if (MISSING.length > 0) {
  throw new Error(`storage.s3.u09.live needs ${MISSING.join(", ")} (see the header; npm run test:live -- --with=s3)`);
}

const BUCKET = `u09-${crypto.randomBytes(4).toString("hex")}`;
const TENANT_A = "a0900000-0000-4000-8000-0000000000a1";
const TENANT_B = "a0900000-0000-4000-8000-0000000000b2";

/** The operator's endpoint: trusted, exactly as config.service builds it from env. */
const operatorDriver = (overrides: Partial<ConstructorParameters<typeof S3Driver>[0]> = {}): S3Driver =>
  new S3Driver({
    bucket: BUCKET,
    region: REGION,
    endpoint: ENDPOINT,
    endpointTrusted: true,
    forcePathStyle: true,
    accessKeyId: ACCESS,
    secretAccessKey: SECRET,
    ...overrides,
  });

const readAll = async (body: unknown): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of body as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
};

const sha256 = (buf: Buffer): string => crypto.createHash("sha256").update(buf).digest("hex");

/** The rejection's `status` (an AppError) or `code` (a socket error), whichever it carries. */
const rejectionOf = async (promise: Promise<unknown>): Promise<{ status?: number; code?: string; name?: string; message: string }> => {
  try {
    await promise;
  } catch (err) {
    return err as { status?: number; code?: string; name?: string; message: string };
  }
  throw new Error("expected a rejection");
};

describe("U-09 — S3 driver against a live S3-compatible server", () => {
  let driver: S3Driver;
  let admin: S3Client;
  let tmpDir: string;

  beforeAll(async () => {
    admin = new S3Client({
      region: REGION,
      endpoint: ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: ACCESS, secretAccessKey: SECRET },
    });
    await admin.send(new CreateBucketCommand({ Bucket: BUCKET }));
    driver = operatorDriver();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "u09-s3-"));
  }, 30000);

  afterAll(async () => {
    await driver.deleteMany(null);
    await admin.send(new DeleteBucketCommand({ Bucket: BUCKET }));
    admin.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }, 30000);

  describe("health check", () => {
    it("is ok against the real bucket", async () => {
      await expect(driver.healthCheck()).resolves.toEqual({ ok: true, driver: "s3", bucket: BUCKET });
    });

    it("a missing bucket is ok:false with the server's reason", async () => {
      const result = await operatorDriver({ bucket: `${BUCKET}-absent` }).healthCheck();
      expect(result.ok).toBe(false);
      expect(result.error).toEqual(expect.any(String));
      expect(result.error).not.toBe("");
    });

    it("wrong credentials are ok:false, and a put rejects", async () => {
      const bad = operatorDriver({ secretAccessKey: `${SECRET}-wrong` });
      const result = await bad.healthCheck();
      expect(result.ok).toBe(false);
      expect(result.error).toEqual(expect.any(String));
      const err = await rejectionOf(bad.put("t/x/attachments/denied.txt", Buffer.from("no")));
      // The SDK's own error (not an AppError): the server refused the signature.
      expect(err.status).toBeUndefined();
      expect(err.name).toMatch(/SignatureDoesNotMatch|InvalidAccessKeyId|AccessDenied|Forbidden/);
    });

    it("an endpoint that accepts and never answers is cut at the A-348 bound", async () => {
      const sockets = new Set<net.Socket>();
      const silent = net.createServer((socket) => {
        sockets.add(socket);
        socket.on("error", () => undefined);
      });
      const port = await new Promise<number>((resolve) => {
        silent.listen(0, "127.0.0.1", () => { resolve((silent.address() as AddressInfo).port); });
      });
      try {
        const started = Date.now();
        const result = await operatorDriver({
          endpoint: `http://127.0.0.1:${String(port)}`,
          healthCheckTimeoutMs: 1500,
        }).healthCheck();
        const elapsed = Date.now() - started;
        expect(result).toEqual({ ok: false, driver: "s3", bucket: BUCKET, error: "no answer within 1500 ms" });
        expect(elapsed).toBeLessThan(4000);
      } finally {
        for (const s of sockets) {s.destroy();}
        await new Promise<void>((resolve) => { silent.close(() => { resolve(); }); });
      }
    });
  });

  describe("objects", () => {
    const key = `t/${TENANT_A}/attachments/round-trip.txt`;
    const body = Buffer.from("U-09 round trip — calibration certificate bytes\n");

    it("put → stat → get → range → exists → delete", async () => {
      const put = await driver.put(key, body, { contentType: "text/plain" });
      expect(put.key).toBe(key);
      expect(put.size).toBe(body.length);
      expect(put.etag).toEqual(expect.any(String));

      const stat = await driver.stat(key);
      expect(stat.size).toBe(body.length);
      expect(stat.contentType).toBe("text/plain");
      expect(stat.modifiedAt).toBeInstanceOf(Date);

      expect((await readAll(await driver.get(key))).equals(body)).toBe(true);
      expect((await readAll(await driver.get(key, { start: 0, end: 4 }))).toString()).toBe("U-09 ");

      await expect(driver.exists(key)).resolves.toBe(true);
      await expect(driver.delete(key)).resolves.toEqual({ key, deleted: true });
      await expect(driver.exists(key)).resolves.toBe(false);
    });

    it("a missing object is the app's 410 on get and 404 on stat", async () => {
      const missing = `t/${TENANT_A}/attachments/never-written.bin`;
      expect((await rejectionOf(driver.get(missing))).status).toBe(410);
      expect((await rejectionOf(driver.stat(missing))).status).toBe(404);
    });

    it("a 16 MiB object streamed from a file (the migration tool's shape) reads back identical", async () => {
      const big = crypto.randomBytes(16 * 1024 * 1024);
      const file = path.join(tmpDir, "big.bin");
      fs.writeFileSync(file, big);
      const bigKey = `t/${TENANT_A}/attachments/big.bin`;
      await driver.put(bigKey, fs.createReadStream(file), { contentType: "application/octet-stream" });
      expect((await driver.stat(bigKey)).size).toBe(big.length);
      expect(sha256(await readAll(await driver.get(bigKey)))).toBe(sha256(big));
      await driver.delete(bigKey);
    }, 60000);

    it("list pages with a cursor and deleteMany removes only its prefix", async () => {
      const prefix = `t/${TENANT_A}/exports`;
      for (const n of [1, 2, 3, 4, 5]) {
        await driver.put(`${prefix}/page-${String(n)}.csv`, Buffer.from(`row ${String(n)}`));
      }
      const keep = `t/${TENANT_A}/backups/keep.bin`;
      await driver.put(keep, Buffer.from("keep"));

      const first = await driver.list(prefix, { limit: 2 });
      expect(first.keys).toHaveLength(2);
      expect(first.truncated).toBe(true);
      expect(first.cursor).toEqual(expect.any(String));
      const seen = [...first.keys];
      let cursor = first.cursor;
      while (cursor) {
        const page = await driver.list(prefix, { limit: 2, cursor });
        seen.push(...page.keys);
        cursor = page.cursor;
      }
      expect(seen.sort()).toEqual([1, 2, 3, 4, 5].map((n) => `${prefix}/page-${String(n)}.csv`));

      await expect(driver.deleteMany(prefix)).resolves.toEqual({ deleted: 5 });
      expect((await driver.list(prefix)).keys).toEqual([]);
      await expect(driver.exists(keep)).resolves.toBe(true);
      await driver.delete(keep);
    });

    it("a configured prefix is applied in the bucket and stripped from what callers see", async () => {
      const prefixed = operatorDriver({ prefix: "tenant-root/" });
      const k = `t/${TENANT_A}/temp/prefixed.txt`;
      await prefixed.put(k, Buffer.from("p"));
      await expect(driver.exists(`tenant-root/${k}`)).resolves.toBe(true);
      expect((await prefixed.list(`t/${TENANT_A}/temp`)).keys).toEqual([k]);
      await prefixed.delete(k);
    });
  });

  describe("presigned URLs", () => {
    const key = `t/${TENANT_A}/certificates/cert-u09.pdf`;
    const body = Buffer.from("%PDF-1.7 U-09 presigned\n");

    beforeAll(async () => {
      await driver.put(key, body, { contentType: "application/pdf" });
    });

    afterAll(async () => {
      await driver.delete(key);
    });

    it("a presigned GET downloads the bytes directly from the bucket, with the disposition", async () => {
      const signed = await driver.signedUrl(key, { ttlSec: 60, disposition: 'attachment; filename="cert.pdf"' });
      expect(signed.direct).toBe(true);
      expect(signed.url.startsWith(ENDPOINT)).toBe(true);
      const res = await fetch(signed.url);
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).equals(body)).toBe(true);
      expect(res.headers.get("content-disposition")).toBe('attachment; filename="cert.pdf"');
    });

    it("a tampered signature is refused", async () => {
      const { url } = await driver.signedUrl(key, { ttlSec: 60 });
      const tampered = new URL(url);
      const sig = tampered.searchParams.get("X-Amz-Signature") ?? "";
      tampered.searchParams.set("X-Amz-Signature", `${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}`);
      expect((await fetch(tampered)).status).toBe(403);
    });

    it("an expired URL is refused", async () => {
      const { url } = await driver.signedUrl(key, { ttlSec: 1 });
      await new Promise((resolve) => setTimeout(resolve, 2500));
      expect((await fetch(url)).status).toBe(403);
    }, 15000);
  });

  describe("tenant isolation through the façade", () => {
    it("tenant B can neither read, delete, list nor count tenant A's objects", async () => {
      const scopedA = new storage.ScopedStorage(driver, TENANT_A);
      const scopedB = new storage.ScopedStorage(driver, TENANT_B);
      const keyA = scopedA.buildKey({ domain: "attachments", name: "only-a.txt" });
      const keyB = scopedB.buildKey({ domain: "attachments", name: "only-b.txt" });
      await scopedA.put(keyA, Buffer.from("tenant A secret"));
      await scopedB.put(keyB, Buffer.from("b"));

      const send = jest.spyOn(driver.client, "send");
      // The guard throws synchronously, before a promise exists; an async
      // caller sees it as a rejection, which is how each attempt runs here.
      for (const attempt of [
        () => scopedB.get(keyA),
        () => scopedB.stat(keyA),
        () => scopedB.exists(keyA),
        () => scopedB.delete(keyA),
        () => scopedB.signedUrl(keyA),
        () => scopedB.put(keyA, Buffer.from("overwrite")),
      ]) {
        expect((await rejectionOf(Promise.resolve().then(attempt))).status).toBe(403);
      }
      // Refused before the driver: not one request reached the server.
      expect(send).not.toHaveBeenCalled();
      send.mockRestore();

      expect((await scopedB.list()).keys).toEqual([keyB]);
      await expect(scopedB.usage()).resolves.toEqual({ bytes: 1, objects: 1 });
      await scopedB.deleteMany();
      expect((await readAll(await scopedA.get(keyA))).toString()).toBe("tenant A secret");
      await expect(scopedA.usage()).resolves.toEqual({ bytes: 15, objects: 1 });
      await scopedA.deleteMany();
    });
  });

  describe("SSRF guard with a legitimate internal endpoint", () => {
    const tenantDriver = (endpoint: string): S3Driver =>
      new S3Driver({ bucket: BUCKET, region: REGION, endpoint, accessKeyId: ACCESS, secretAccessKey: SECRET });

    it("a tenant-supplied loopback endpoint is refused before any request (400)", () => {
      const loopback = new URL(ENDPOINT);
      loopback.hostname = "127.0.0.1";
      expect(() => tenantDriver(loopback.toString())).toThrow(expect.objectContaining({ status: 400 }) as Error);
      loopback.hostname = "localhost";
      expect(() => tenantDriver(loopback.toString())).toThrow(expect.objectContaining({ status: 400 }) as Error);
    });

    it("a hostname resolving to a private address is refused at connect, and works once on SSRF_DEV_ALLOW_HOSTS", async () => {
      const viaDevHost = new URL(ENDPOINT);
      viaDevHost.hostname = DEV_HOST;
      const vars = environment();
      const before = vars["SSRF_DEV_ALLOW_HOSTS"];
      try {
        delete vars["SSRF_DEV_ALLOW_HOSTS"];
        const refused = tenantDriver(viaDevHost.toString());
        const err = await rejectionOf(refused.put(`t/${TENANT_A}/temp/ssrf.txt`, Buffer.from("x")));
        expect(err.code).toBe("ESSRFBLOCKED");
        expect((await refused.healthCheck()).ok).toBe(false);

        vars["SSRF_DEV_ALLOW_HOSTS"] = DEV_HOST;
        const allowed = tenantDriver(viaDevHost.toString());
        await expect(allowed.healthCheck()).resolves.toEqual({ ok: true, driver: "s3", bucket: BUCKET });
        const k = `t/${TENANT_A}/temp/ssrf.txt`;
        await allowed.put(k, Buffer.from("dev-allowed"));
        expect((await readAll(await allowed.get(k))).toString()).toBe("dev-allowed");
        await allowed.delete(k);
      } finally {
        if (before === undefined) {delete vars["SSRF_DEV_ALLOW_HOSTS"];}
        else {vars["SSRF_DEV_ALLOW_HOSTS"] = before;}
      }
    }, 30000);
  });
});
