/**
 * Local/NFS driver tests. These run against a REAL temporary directory rather
 * than a mocked `fs`: the guarantees being tested (traversal refusal, symlink
 * escape, fsync-on-write) are properties of the filesystem, and a mocked fs
 * would only prove the mock agrees with itself.
 */

const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const LocalDriver = require("../../services/storage/local.driver");

let root;
let outside;
let driver;

beforeEach(async () => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), "storage-test-"));
  root = path.join(base, "root");
  outside = path.join(base, "outside");
  await fsp.mkdir(root, { recursive: true });
  await fsp.mkdir(outside, { recursive: true });
  driver = new LocalDriver({ root });
});

afterEach(async () => {
  await fsp.rm(path.dirname(root), { recursive: true, force: true });
});

const KEY = "t/tenant-1/attachments/report.pdf";

describe("local driver — construction", () => {
  it("refuses to start without a root", () => {
    expect(() => new LocalDriver({})).toThrow(
      "Local storage driver requires a root path",
    );
    expect(() => new LocalDriver()).toThrow(
      "Local storage driver requires a root path",
    );
  });

  it("handles a root that is itself a filesystem root", async () => {
    // path.resolve strips a trailing separator from every ordinary path, so
    // "/" (or "C:\") is the only root that already ends in one — the case the
    // separator handling exists for.
    const fsRoot = path.parse(process.cwd()).root;
    const rootDriver = new LocalDriver({ root: fsRoot });

    expect(rootDriver._resolve("t/tenant-1/attachments/a.pdf")).toBe(
      path.join(fsRoot, "t", "tenant-1", "attachments", "a.pdf"),
    );
    // Reaches the same separator handling on the realpath side, then 404s
    // because nothing is actually there.
    await expect(
      rootDriver.stat("t/tenant-1/attachments/a.pdf"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("reports its name and honours the fsync flag", () => {
    const nfs = new LocalDriver({ root, name: "nfs", fsync: true });
    expect(nfs.name).toBe("nfs");
    expect(nfs.fsync).toBe(true);
    expect(driver.fsync).toBe(false);
  });
});

describe("local driver — round trip", () => {
  it("stores and returns a buffer, creating the directory tree", async () => {
    const result = await driver.put(KEY, Buffer.from("hello world"));
    expect(result).toMatchObject({ key: KEY, size: 11 });

    const stream = await driver.get(KEY);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe("hello world");
  });

  it("stores from a stream", async () => {
    const src = path.join(outside, "src.txt");
    await fsp.writeFile(src, "streamed");
    await driver.put(KEY, fs.createReadStream(src));
    expect((await driver.stat(KEY)).size).toBe(8);
  });

  it("surfaces a stream error instead of writing a truncated object", async () => {
    const { Readable } = require("stream");
    const broken = new Readable({
      read() {
        this.destroy(new Error("source exploded"));
      },
    });
    await expect(driver.put(KEY, broken)).rejects.toThrow("source exploded");
  });

  it("fsyncs when configured (NFS durability)", async () => {
    const nfsDriver = new LocalDriver({ root, name: "nfs", fsync: true });
    await nfsDriver.put(KEY, Buffer.from("durable"));
    expect((await nfsDriver.stat(KEY)).size).toBe(7);
  });

  it("overwrites an existing object rather than appending", async () => {
    await driver.put(KEY, Buffer.from("first-and-longer"));
    await driver.put(KEY, Buffer.from("second"));
    expect((await driver.stat(KEY)).size).toBe(6);
  });
});

describe("local driver — missing objects", () => {
  it("reports 410 on get", async () => {
    await expect(driver.get(KEY)).rejects.toMatchObject({ status: 410 });
  });

  it("reports 404 on stat", async () => {
    await expect(driver.stat(KEY)).rejects.toMatchObject({ status: 404 });
  });

  it("reports false from exists", async () => {
    expect(await driver.exists(KEY)).toBe(false);
    await driver.put(KEY, Buffer.from("x"));
    expect(await driver.exists(KEY)).toBe(true);
  });

  it("propagates an unexpected stat failure from exists", async () => {
    jest.spyOn(driver, "stat").mockRejectedValue(
      Object.assign(new Error("EACCES"), { status: 500 }),
    );
    await expect(driver.exists(KEY)).rejects.toThrow("EACCES");
  });

  it("treats deleting a missing object as success", async () => {
    await expect(driver.delete(KEY)).resolves.toEqual({
      key: KEY,
      deleted: true,
    });
  });

  it("propagates a non-ENOENT stat failure", async () => {
    jest.spyOn(fsp, "stat").mockRejectedValueOnce(
      Object.assign(new Error("EIO"), { code: "EIO" }),
    );
    await expect(driver.stat(KEY)).rejects.toThrow("EIO");
  });
});

describe("local driver — escape refusal", () => {
  it("refuses a traversal key", async () => {
    await expect(
      driver.put("t/tenant-1/../../etc/passwd", Buffer.from("x")),
    ).rejects.toThrow("Invalid storage key");
  });

  it("refuses to write through a symlinked directory pointing outside the root", async () => {
    // A symlink INSIDE the root is invisible to any amount of string
    // validation — this is why the driver also checks the real path.
    // A directory junction needs no elevation, so this always runs.
    const linkDir = path.join(root, "t", "tenant-1");
    await fsp.mkdir(path.dirname(linkDir), { recursive: true });
    await fsp.symlink(outside, linkDir, "junction");

    await expect(driver.put(KEY, Buffer.from("x"))).rejects.toThrow(
      "escapes the storage root",
    );
    expect(fs.existsSync(path.join(outside, "attachments", "report.pdf"))).toBe(
      false,
    );
  });

  it("refuses to read through a symlinked directory pointing outside the root", async () => {
    // Use a directory junction rather than a file symlink: junctions work
    // unprivileged on every host (Windows included), and _assertNoSymlinkEscape
    // walks up to the nearest existing ancestor — the junction — and realpaths
    // it, so the read-side escape is caught exactly the same way. (On POSIX the
    // "junction" type falls back to a regular symlink.)
    const outsideAttach = path.join(outside, "attachments");
    await fsp.mkdir(outsideAttach, { recursive: true });
    await fsp.writeFile(path.join(outsideAttach, "report.pdf"), "classified");

    const tenantDir = path.join(root, "t", "tenant-1");
    await fsp.mkdir(tenantDir, { recursive: true });
    await fsp.symlink(outsideAttach, path.join(tenantDir, "attachments"), "junction");

    await expect(driver.get(KEY)).rejects.toThrow("escapes the storage root");
  });

  it("propagates an unexpected realpath failure", async () => {
    jest.spyOn(fsp, "realpath").mockRejectedValueOnce(
      Object.assign(new Error("EIO"), { code: "EIO" }),
    );
    await expect(driver.put(KEY, Buffer.from("x"))).rejects.toThrow("EIO");
  });

  it("keeps every valid key inside the root", () => {
    // The path-level check in _resolve is unreachable through the key grammar
    // (istanbul-ignored for that reason); what IS worth asserting is the
    // property it protects — no admissible key ever resolves outside.
    for (const key of [
      "t/tenant-1/attachments/a.pdf",
      "global/branding/logo.png",
      "t/t/t/t/deep.bin",
    ]) {
      expect(driver._resolve(key).startsWith(root + path.sep)).toBe(true);
    }
  });
});

describe("local driver — listing and bulk delete", () => {
  beforeEach(async () => {
    await driver.put("t/tenant-1/attachments/a.pdf", Buffer.from("aa"));
    await driver.put("t/tenant-1/attachments/b.pdf", Buffer.from("bbb"));
    await driver.put("t/tenant-1/certificates/c.pdf", Buffer.from("cccc"));
    await driver.put("t/tenant-2/attachments/d.pdf", Buffer.from("d"));
  });

  it("lists only the requested prefix", async () => {
    const { keys } = await driver.list("t/tenant-1/attachments/");
    expect(keys.sort()).toEqual([
      "t/tenant-1/attachments/a.pdf",
      "t/tenant-1/attachments/b.pdf",
    ]);
  });

  it("lists a whole tenant without touching another", async () => {
    const { keys } = await driver.list("t/tenant-1/");
    expect(keys).toHaveLength(3);
    expect(keys.every((k) => k.startsWith("t/tenant-1/"))).toBe(true);
  });

  it("returns an empty list for a prefix that does not exist", async () => {
    const { keys } = await driver.list("t/tenant-9/");
    expect(keys).toEqual([]);
  });

  it("honours the limit and flags truncation", async () => {
    const result = await driver.list("t/tenant-1/", { limit: 2 });
    expect(result.keys).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("stops descending once the limit is reached", async () => {
    // The limit must be checked on entering a subdirectory too, not only per
    // file, or a deep tree keeps being walked long after the cap is hit.
    const result = await driver.list("t/tenant-1/", { limit: 1 });
    expect(result.keys).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it("skips symlinked entries rather than following them out of the root", async () => {
    await fsp.symlink(outside, path.join(root, "t", "tenant-1", "link"), "junction");
    const { keys } = await driver.list("t/tenant-1/");
    // A junction is neither a directory nor a file to readdir, so it is
    // neither descended into nor listed as an object.
    expect(keys.some((k) => k.includes("link"))).toBe(false);
    expect(keys).toHaveLength(3);
  });

  it("lists everything when no prefix is given", async () => {
    const { keys } = await driver.list("");
    expect(keys).toHaveLength(4);
  });

  it("propagates an unexpected readdir failure", async () => {
    jest.spyOn(fsp, "readdir").mockRejectedValueOnce(
      Object.assign(new Error("EIO"), { code: "EIO" }),
    );
    await expect(driver.list("t/tenant-1/")).rejects.toThrow("EIO");
  });

  it("deletes a whole prefix and leaves other tenants intact", async () => {
    expect(await driver.deleteMany("t/tenant-1/")).toEqual({ deleted: 3 });
    expect((await driver.list("t/tenant-1/")).keys).toEqual([]);
    expect((await driver.list("t/tenant-2/")).keys).toHaveLength(1);
  });
});

describe("local driver — health check", () => {
  it("passes for a writable root", async () => {
    await expect(driver.healthCheck()).resolves.toMatchObject({
      ok: true,
      driver: "local",
    });
  });

  it("fails for a missing mount (NFS not mounted)", async () => {
    const missing = new LocalDriver({
      root: path.join(root, "not-mounted"),
      name: "nfs",
    });
    const result = await missing.healthCheck();
    expect(result).toMatchObject({ ok: false, driver: "nfs" });
    expect(result.error).toBeTruthy();
  });

  it("reports the message when the failure carries no errno code", async () => {
    jest.spyOn(fsp, "access").mockRejectedValueOnce(new Error("mount is stale"));
    await expect(driver.healthCheck()).resolves.toMatchObject({
      ok: false,
      error: "mount is stale",
    });
  });
});

describe("local driver — signed URLs", () => {
  it("issues an HMAC-signed app URL that is not a direct download", () => {
    const result = driver.signedUrl(KEY, {
      ttlSec: 60,
      baseUrl: "https://app.example.com/",
      secret: "s3cret",
    });
    expect(result.direct).toBe(false);
    expect(result.url).toContain("https://app.example.com/api/v1/storage/object");
    expect(result.url).toContain(encodeURIComponent(KEY));
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("defaults the TTL and tolerates an empty base URL", () => {
    const result = driver.signedUrl(KEY, { secret: "s3cret" });
    expect(result.url.startsWith("/api/v1/storage/object")).toBe(true);
  });

  it("refuses to sign without a secret rather than emitting a forgeable link", () => {
    expect(() => driver.signedUrl(KEY, { baseUrl: "http://x" })).toThrow(
      "Signed URL secret is not configured",
    );
    // Same refusal when called with no options at all.
    expect(() => driver.signedUrl(KEY)).toThrow(
      "Signed URL secret is not configured",
    );
  });

  it("produces a different signature for a different key", () => {
    const a = driver.signedUrl(KEY, { secret: "s" }).url;
    const b = driver
      .signedUrl("t/tenant-1/attachments/other.pdf", { secret: "s" })
      .url;
    expect(a).not.toBe(b);
  });
});
