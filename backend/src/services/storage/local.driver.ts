/**
 * POSIX filesystem storage driver.
 *
 * Backs both the `local` provider (the app server's own disk — the zero-change
 * default) and the `nfs` provider (a mounted network export). They are the same
 * code: the only differences are the root path and, for NFS, a mount
 * health-check plus an fsync policy, both configured by the caller.
 *
 * Download URLs are HMAC-signed app URLs, because a filesystem has no
 * presigning. (The `s3` driver returns real presigned URLs, which is what moves
 * egress — and its cost — off the app server.)
 */

//
// P9-18 (ADR-087, Stage C): converted from local.driver.js with no behaviour
// change. `export =` keeps the class `require()` returned. `fs`, `fs/promises`
// and `path` are default imports, which bind the same module objects, so
// suites that spy on `fsp.*` still intercept every call. `normalizeKey` is
// captured at load, as the `.js` destructured it. `signing` is read at call
// time.

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import type { Readable } from "stream";
import { AppError as LoadedAppError } from "../../utils/appError.util";
import keys from "./keys";
import signing from "./signing";

const AppError = LoadedAppError;
const { normalizeKey } = keys;

/** The driver's configuration (as `storage/index` resolves it). */
interface LocalDriverConfig {
  /** Absolute directory that holds every object. */
  root?: string;
  /** fsync after write (NFS durability). */
  fsync?: boolean;
  /** "local" | "nfs" — reporting only. */
  name?: string;
}

/** The code of a caught filesystem error, read as the `.js` read `err.code`. */
const errnoCode = (err: unknown): string | undefined => (err as NodeJS.ErrnoException).code;

class LocalDriver {
  name: string;
  root: string;
  fsync: boolean;

  constructor(config: LocalDriverConfig = {}) {
    if (!config.root) {
      throw new AppError(500, "Local storage driver requires a root path");
    }
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty name also reads as "local"
    this.name = config.name || "local";
    this.root = path.resolve(config.root);
    this.fsync = config.fsync === true;
  }

  /**
   * Map a key to an absolute path, refusing anything that would land outside
   * the root.
   *
   * normalizeKey already rejects `..` and backslashes; this is the second,
   * independent check, because a symlink INSIDE the root can point outside it
   * and no amount of string validation would catch that.
   */
  _resolve(key: unknown): string {
    const normalized = normalizeKey(key);
    const abs = path.resolve(this.root, normalized);
    const rootWithSep = this.root.endsWith(path.sep)
      ? this.root
      : this.root + path.sep;
    /* istanbul ignore next -- defense in depth: normalizeKey only admits
       `[A-Za-z0-9][A-Za-z0-9._-]*` segments, so path.resolve can never leave
       the root and this branch is unreachable today. It stays because it is
       the check that would catch a future loosening of the key grammar. */
    if (!abs.startsWith(rootWithSep)) {
      throw new AppError(400, "Resolved storage path escapes the storage root");
    }
    return abs;
  }

  /**
   * Reject a path whose real location (symlinks resolved) is outside the root.
   *
   * realpath() fails on a path that does not exist yet, but the symlink may be
   * one of its ANCESTORS — and that is precisely the dangerous case, because
   * `mkdir -p` would then happily build the rest of the tree on the far side of
   * the link. So walk up to the nearest existing ancestor and check that.
   */
  async _assertNoSymlinkEscape(abs: string): Promise<void> {
    let candidate = abs;
    let real: string;
    for (;;) {
      try {
        real = await fsp.realpath(candidate);
        break;
      } catch (err) {
        if (errnoCode(err) !== "ENOENT") {throw err;}
        const parent = path.dirname(candidate);
        /* istanbul ignore next -- only reachable if the storage root itself
           has been unmounted mid-operation; the loop always terminates at the
           root, which exists. */
        if (parent === candidate) {return;}
        candidate = parent;
      }
    }

    const realRoot = await fsp.realpath(this.root);
    const rootWithSep = realRoot.endsWith(path.sep)
      ? realRoot
      : realRoot + path.sep;
    if (real !== realRoot && !real.startsWith(rootWithSep)) {
      throw new AppError(400, "Storage path escapes the storage root");
    }
  }

  /** Verify the root exists and is writable (NFS mount health-check). */
  async healthCheck(): Promise<{ ok: boolean; driver: string; root: string; error?: string }> {
    try {
      await fsp.access(this.root, fs.constants.R_OK | fs.constants.W_OK);
      return { ok: true, driver: this.name, root: this.root };
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty code also falls back to the message
      return { ok: false, driver: this.name, root: this.root, error: errnoCode(err) || (err as Error).message };
    }
  }

  async put(key: unknown, body: Buffer | Readable): Promise<{ key: string; size: number; etag: null }> {
    const abs = this._resolve(key);
    await this._assertNoSymlinkEscape(path.dirname(abs));
    await fsp.mkdir(path.dirname(abs), { recursive: true });

    const buffer = Buffer.isBuffer(body) ? body : null;
    if (buffer) {
      const handle = await fsp.open(abs, "w");
      try {
        await handle.writeFile(buffer);
        // NFS clients buffer aggressively; without this a "successful" write
        // can be lost on a server reboot.
        if (this.fsync) {await handle.sync();}
      } finally {
        await handle.close();
      }
    } else {
      // Not a Buffer, so a readable stream (the caller's contract).
      const stream = body as Readable;
      await new Promise<void>((resolve, reject) => {
        const out = fs.createWriteStream(abs);
        stream.pipe(out);
        out.on("finish", resolve);
        out.on("error", reject);
        stream.on("error", reject);
      });
    }

    const stat = await fsp.stat(abs);
    return { key: normalizeKey(key), size: stat.size, etag: null };
  }

  /**
   * @param key
   * @param range - inclusive byte range
   */
  async get(key: unknown, range?: { start: number; end: number } | null): Promise<fs.ReadStream> {
    const abs = this._resolve(key);
    await this._assertNoSymlinkEscape(abs);
    if (!fs.existsSync(abs)) {
      throw new AppError(410, "Stored object is no longer available");
    }
    return range
      ? fs.createReadStream(abs, { start: range.start, end: range.end })
      : fs.createReadStream(abs);
  }

  async stat(key: unknown): Promise<{ key: string; size: number; modifiedAt: Date; etag: null; contentType: null }> {
    const abs = this._resolve(key);
    await this._assertNoSymlinkEscape(abs);
    try {
      const s = await fsp.stat(abs);
      return {
        key: normalizeKey(key),
        size: s.size,
        modifiedAt: s.mtime,
        etag: null,
        contentType: null,
      };
    } catch (err) {
      if (errnoCode(err) === "ENOENT") {
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
      const { status } = err as { status?: unknown };
      if (status === 404 || status === 410) {return false;}
      throw err;
    }
  }

  async delete(key: unknown): Promise<{ key: string; deleted: true }> {
    const abs = this._resolve(key);
    await this._assertNoSymlinkEscape(abs);
    // Deleting something already gone is a success, not an error — callers
    // retry deletes and must not be forced to distinguish the two.
    await fsp.rm(abs, { force: true });
    return { key: normalizeKey(key), deleted: true };
  }

  /** Recursively list keys under a prefix (relative, forward-slashed). */
  async list(prefix?: string | null, { limit = 1000 }: { limit?: number } = {}): Promise<{ keys: string[]; truncated: boolean }> {
    const normalizedPrefix = prefix ? normalizeKey(prefix.replace(/\/$/, "")) : "";
    const base = normalizedPrefix ? this._resolve(normalizedPrefix) : this.root;
    const found: string[] = [];

    // The limit is enforced inside the loop below, before each file is added
    // and before each recursion, so walk() is never entered over the cap.
    const walk = async (dir: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if (errnoCode(err) === "ENOENT") {return;} // Empty prefix, not an error.
        throw err;
      }
      for (const entry of entries) {
        if (found.length >= limit) {return;}
        const child = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(child);
        } else if (entry.isFile()) {
          // Symlinked files are skipped rather than followed: a symlink in the
          // tree is an escape vector, and isFile() is false for them anyway
          // (readdir does not follow links).
          found.push(path.relative(this.root, child).split(path.sep).join("/"));
        }
      }
    };

    await walk(base);
    return { keys: found, truncated: found.length >= limit };
  }

  /** Delete every object under a prefix. Used for tenant offboarding. */
  async deleteMany(prefix?: string | null): Promise<{ deleted: number }> {
    const { keys: listed } = await this.list(prefix, { limit: Number.MAX_SAFE_INTEGER });
    for (const key of listed) {
      await this.delete(key);
    }
    return { deleted: listed.length };
  }

  /**
   * HMAC-signed, expiring URL served by the app itself. A filesystem cannot
   * presign, so the app stays in the data path for local/NFS.
   */
  signedUrl(
    key: unknown,
    { ttlSec = 300, baseUrl, secret }: { ttlSec?: number; baseUrl?: string | null; secret?: string | null } = {},
  ): { url: string; expiresAt: Date; direct: false } {
    const normalized = normalizeKey(key);
    if (!secret) {
      throw new AppError(500, "Signed URL secret is not configured");
    }
    const { token, exp } = signing.sign(normalized, ttlSec, secret);
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `(baseUrl || "")`
    const base = (baseUrl || "").replace(/\/$/, "");
    return {
      url: `${base}/api/v1/storage/object?key=${encodeURIComponent(normalized)}&token=${token}`,
      expiresAt: new Date(exp * 1000),
      // The app must stream this itself — there is no direct-to-storage path.
      direct: false,
    };
  }
}

export = LocalDriver;
