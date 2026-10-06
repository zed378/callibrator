/**
 * P8-01 (ADR-086 Amendment 1) — services/storedFile.service, the bridge every
 * file-keeping service uses to reach the storage layer. Run against the REAL
 * local driver in a temporary root (through a ScopedStorage, so the tenant
 * guard is the real one); only `getTenantStorage`/`getGlobalStorage` are
 * resolved without a database.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import storage from "../../services/storage";
import LocalDriver from "../../services/storage/local.driver";
import storedFile from "../../services/storedFile.service";

const TENANT = "11111111-1111-4111-8111-111111111111";
let root: string;
let scoped: InstanceType<typeof storage.ScopedStorage>;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "p801-stored-"));
  scoped = new storage.ScopedStorage(new LocalDriver({ root: path.join(root, "store"), name: "local" }), TENANT);
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("storedFile — the storage bridge", () => {
  it("isStorageKey: a key names its owner first; a legacy location never does", () => {
    expect(storedFile.isStorageKey(`t/${TENANT}/backups/a.zip`)).toBe(true);
    expect(storedFile.isStorageKey("global/avatars/a.png")).toBe(true);
    expect(storedFile.isStorageKey("/app/backup/tenant-backups/a.zip")).toBe(false);
    expect(storedFile.isStorageKey("certificates/a.pdf")).toBe(false);
    expect(storedFile.isStorageKey(null)).toBe(false);
  });

  it("isMissing: 404 and 410 are absent; anything else is a failure", () => {
    expect(storedFile.isMissing({ status: 404 })).toBe(true);
    expect(storedFile.isMissing({ status: 410 })).toBe(true);
    expect(storedFile.isMissing({ status: 403 })).toBe(false);
    expect(storedFile.isMissing(new Error("EIO"))).toBe(false);
  });

  it("storageFor: a tenant's storage, or the platform's for none", async () => {
    const tenant = jest.spyOn(storage, "getTenantStorage").mockResolvedValue(scoped);
    const global = jest.spyOn(storage, "getGlobalStorage").mockResolvedValue(scoped);
    await storedFile.storageFor(TENANT);
    await storedFile.storageFor(null);
    expect(tenant).toHaveBeenCalledWith(TENANT);
    expect(global).toHaveBeenCalledTimes(1);
  });

  it("putLocalFile copies the file into storage, THEN removes the local copy", async () => {
    const src = path.join(root, "q.bin");
    fs.writeFileSync(src, "evidence bytes");
    const key = scoped.buildKey({ domain: "attachments", name: "q.bin" });

    await storedFile.putLocalFile(scoped, key, src, "application/octet-stream");

    expect(fs.existsSync(src)).toBe(false);
    expect((await storedFile.readObject(scoped, key)).toString()).toBe("evidence bytes");
  });

  it("putLocalFile leaves the local copy when the put fails, for the caller to discard", async () => {
    const src = path.join(root, "q.bin");
    fs.writeFileSync(src, "x");
    // Another tenant's key: the guard refuses it before any byte moves.
    await expect(
      storedFile.putLocalFile(scoped, "t/22222222-2222-4222-8222-222222222222/attachments/q.bin", src, null),
    ).rejects.toMatchObject({ status: 403 });
    expect(fs.existsSync(src)).toBe(true);
    // The stream putLocalFile opened is destroyed, not left reading: let its
    // close settle before afterEach removes the directory under it.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it("openObject: metadata now, a byte range on demand; a missing object rejects before anything is sent", async () => {
    const key = scoped.buildKey({ domain: "exports", name: "a.zip" });
    await scoped.put(key, Buffer.from("0123456789"));

    const object = await storedFile.openObject(scoped, key);
    expect(object.meta.size).toBe(10);
    const chunks: Buffer[] = [];
    for await (const chunk of (await object.open({ start: 2, end: 4 })) as Readable) {chunks.push(chunk as Buffer);}
    expect(Buffer.concat(chunks).toString()).toBe("234");

    await expect(storedFile.openObject(scoped, scoped.buildKey({ domain: "exports", name: "gone.zip" }))).rejects.toMatchObject({
      status: 404,
    });
  });

  it("readObject accepts string chunks as well as Buffers", async () => {
    const fake = { get: jest.fn().mockResolvedValue(Readable.from(["ab", Buffer.from("cd")])) };
    expect((await storedFile.readObject(fake as never, "k")).toString()).toBe("abcd");
  });

  it("removeObject: 'already gone' is done; any other failure is the caller's", async () => {
    const key = scoped.buildKey({ domain: "backups", name: "b.zip" });
    await scoped.put(key, Buffer.from("z"));
    await storedFile.removeObject(scoped, key);
    expect(await scoped.exists(key)).toBe(false);

    const gone = { delete: jest.fn().mockRejectedValue(Object.assign(new Error("gone"), { status: 410 })) };
    await expect(storedFile.removeObject(gone as never, key)).resolves.toBeUndefined();
    const broken = { delete: jest.fn().mockRejectedValue(new Error("EACCES")) };
    await expect(storedFile.removeObject(broken as never, key)).rejects.toThrow("EACCES");
  });
});

describe("local driver — its root (P8-01)", () => {
  it("the `local` provider makes a missing root on the first write, and reads of a missing root are 'not found'", async () => {
    const missing = path.join(root, "not-yet");
    const driver = new LocalDriver({ root: missing, name: "local" });
    await expect(driver.stat("global/temp/a.txt")).rejects.toMatchObject({ status: 404 });
    await expect(driver.get("global/temp/a.txt")).rejects.toMatchObject({ status: 410 });
    await driver.put("global/temp/a.txt", Buffer.from("a"));
    expect(fs.readFileSync(path.join(missing, "global", "temp", "a.txt"), "utf8")).toBe("a");
  });

  it("the `nfs` provider does NOT: a missing NFS root is an unmounted export, an error on reads and writes", async () => {
    const unmounted = path.join(root, "mnt", "nfs");
    const driver = new LocalDriver({ root: unmounted, name: "nfs" });
    await expect(driver.put("global/temp/a.txt", Buffer.from("a"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(driver.stat("global/temp/a.txt")).rejects.toMatchObject({ code: "ENOENT" });
    expect(fs.existsSync(unmounted)).toBe(false);
  });
});
