/**
 * The rsync image import's directories and secret files (services/upstreamFileImport/
 * workspace.ts) and its configuration (config/upstream.ts).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { createRunScratch, ensureDir, importPaths, sourceKey, wipeFile } from "../../../services/upstreamFileImport/workspace";
import {
  rsyncAllowedHosts,
  rsyncCheckTimeoutMs,
  rsyncIoTimeoutSec,
  upstreamImportDir,
  upstreamRealDataAllowed,
} from "../../../config/upstream";
import storagePath from "../../../utils/storagePath.util";
import { environment } from "../../../config/env";

const penv = environment();
const VARS = ["UPSTREAM_FILE_IMPORT_DIR", "UPSTREAM_REAL_DATA_ALLOWED", "RSYNC_ALLOWED_HOSTS", "RSYNC_CHECK_TIMEOUT_MS", "RSYNC_IO_TIMEOUT_SEC"];
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "rsync-ws-"));
  for (const name of VARS) {
    Reflect.deleteProperty(penv, name);
  }
});

afterEach(() => {
  for (const name of VARS) {
    Reflect.deleteProperty(penv, name);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

describe("config/upstream", () => {
  it("defaults: gate off, no allow-listed host, the work dir on the storage volume, bounded timeouts", () => {
    expect(upstreamRealDataAllowed()).toBe(false);
    expect(rsyncAllowedHosts()).toEqual([]);
    expect(upstreamImportDir()).toBe(storagePath("storage", ".upstream-import"));
    expect(rsyncCheckTimeoutMs()).toBe(120_000);
    expect(rsyncIoTimeoutSec()).toBe(300);
  });

  it("reads each variable at call time", () => {
    penv["UPSTREAM_REAL_DATA_ALLOWED"] = "true";
    penv["RSYNC_ALLOWED_HOSTS"] = " Test-SSH ,, 10.0.0.5 ";
    penv["UPSTREAM_FILE_IMPORT_DIR"] = root;
    penv["RSYNC_CHECK_TIMEOUT_MS"] = "5000";
    penv["RSYNC_IO_TIMEOUT_SEC"] = "60";
    expect(upstreamRealDataAllowed()).toBe(true);
    expect(rsyncAllowedHosts()).toEqual(["test-ssh", "10.0.0.5"]);
    expect(upstreamImportDir()).toBe(path.resolve(root));
    expect(rsyncCheckTimeoutMs()).toBe(5000);
    expect(rsyncIoTimeoutSec()).toBe(60);
  });

  it("anything but \"true\" keeps the gate off; a bad number keeps the default; a blank dir is the default", () => {
    penv["UPSTREAM_REAL_DATA_ALLOWED"] = "yes";
    penv["RSYNC_CHECK_TIMEOUT_MS"] = "-5";
    penv["RSYNC_IO_TIMEOUT_SEC"] = "1.5";
    penv["UPSTREAM_FILE_IMPORT_DIR"] = "   ";
    expect(upstreamRealDataAllowed()).toBe(false);
    expect(rsyncCheckTimeoutMs()).toBe(120_000);
    expect(rsyncIoTimeoutSec()).toBe(300);
    expect(upstreamImportDir()).toBe(storagePath("storage", ".upstream-import"));
  });
});

describe("workspace", () => {
  it("names a source by a hash: no host or path on disk; stable; case-insensitive host", () => {
    const a = sourceKey("t1", "Upstream.Example.org", 22, "/var/www/uploads");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(sourceKey("t1", "upstream.example.org", 22, "/var/www/uploads")).toBe(a);
    expect(sourceKey("t2", "upstream.example.org", 22, "/var/www/uploads")).not.toBe(a);
  });

  it("lays out staging (by source), refused and manifests (by import) under the work dir", () => {
    penv["UPSTREAM_FILE_IMPORT_DIR"] = root;
    expect(importPaths("imp-1", "abc")).toEqual({
      root: path.resolve(root),
      staging: path.join(path.resolve(root), "staging", "abc"),
      refused: path.join(path.resolve(root), "refused", "imp-1"),
      manifest: path.join(path.resolve(root), "manifests", "imp-1.jsonl"),
    });
  });

  it("creates directories 0700", async () => {
    const dir = path.join(root, "a", "b");
    await ensureDir(dir);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
    if (process.platform !== "win32") {
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    }
  });

  it("a run's scratch: 0600 secret files, overwritten then removed on dispose; a name is never reused", async () => {
    penv["UPSTREAM_FILE_IMPORT_DIR"] = root;
    const scratch = await createRunScratch();
    const file = await scratch.writeSecret("id_source", "PRIVATE-KEY-PROBE");
    expect(fs.readFileSync(file, "utf8")).toBe("PRIVATE-KEY-PROBE");
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
    await expect(scratch.writeSecret("id_source", "again")).rejects.toThrow();
    const writes: Buffer[] = [];
    const realOpen = fs.promises.open.bind(fs.promises);
    const openSpy = jest.spyOn(fs.promises, "open").mockImplementation(async (...args: Parameters<typeof fs.promises.open>) => {
      const handle = await realOpen(...args);
      const write = handle.write.bind(handle) as (b: Buffer, ...rest: unknown[]) => Promise<unknown>;
      (handle as unknown as { write: (b: Buffer, ...rest: unknown[]) => Promise<unknown> }).write = (b: Buffer, ...rest: unknown[]) => {
        writes.push(Buffer.from(b));
        return write(b, ...rest);
      };
      return handle;
    });
    await scratch.dispose();
    openSpy.mockRestore();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.equals(Buffer.alloc("PRIVATE-KEY-PROBE".length))).toBe(true);
    expect(fs.existsSync(scratch.dir)).toBe(false);
  });

  it("wipeFile tolerates a file that is already gone", async () => {
    await expect(wipeFile(path.join(root, "nope"))).resolves.toBeUndefined();
  });

  it("dispose tolerates a directory it cannot remove", async () => {
    penv["UPSTREAM_FILE_IMPORT_DIR"] = root;
    const scratch = await createRunScratch();
    const rm = jest.spyOn(fs.promises, "rm").mockRejectedValueOnce(new Error("busy"));
    await expect(scratch.dispose()).resolves.toBeUndefined();
    rm.mockRestore();
  });
});
