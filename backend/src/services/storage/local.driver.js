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

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { AppError } = require("../../utils/appError.util");
const { normalizeKey } = require("./keys");
const signing = require("./signing");

class LocalDriver {
  /**
   * @param {object} config
   * @param {string} config.root      Absolute directory that holds every object.
   * @param {boolean} [config.fsync]  fsync after write (NFS durability).
   * @param {string} [config.name]    "local" | "nfs" — reporting only.
   */
  constructor(config = {}) {
    if (!config.root) {
      throw new AppError(500, "Local storage driver requires a root path");
    }
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
  _resolve(key) {
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
  async _assertNoSymlinkEscape(abs) {
    let candidate = abs;
    let real;
    for (;;) {
      try {
        real = await fsp.realpath(candidate);
        break;
      } catch (err) {
        if (err.code !== "ENOENT") {throw err;}
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
  async healthCheck() {
    try {
      await fsp.access(this.root, fs.constants.R_OK | fs.constants.W_OK);
      return { ok: true, driver: this.name, root: this.root };
    } catch (err) {
      return { ok: false, driver: this.name, root: this.root, error: err.code || err.message };
    }
  }

  async put(key, body) {
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
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(abs);
        body.pipe(out);
        out.on("finish", resolve);
        out.on("error", reject);
        body.on("error", reject);
      });
    }

    const stat = await fsp.stat(abs);
    return { key: normalizeKey(key), size: stat.size, etag: null };
  }

  async get(key) {
    const abs = this._resolve(key);
    await this._assertNoSymlinkEscape(abs);
    if (!fs.existsSync(abs)) {
      throw new AppError(410, "Stored object is no longer available");
    }
    return fs.createReadStream(abs);
  }

  async stat(key) {
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
      if (err.code === "ENOENT") {
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
    const abs = this._resolve(key);
    await this._assertNoSymlinkEscape(abs);
    // Deleting something already gone is a success, not an error — callers
    // retry deletes and must not be forced to distinguish the two.
    await fsp.rm(abs, { force: true });
    return { key: normalizeKey(key), deleted: true };
  }

  /** Recursively list keys under a prefix (relative, forward-slashed). */
  async list(prefix, { limit = 1000 } = {}) {
    const normalizedPrefix = prefix ? normalizeKey(prefix.replace(/\/$/, "")) : "";
    const base = normalizedPrefix ? this._resolve(normalizedPrefix) : this.root;
    const keys = [];

    // The limit is enforced inside the loop below, before each file is added
    // and before each recursion, so walk() is never entered over the cap.
    const walk = async (dir) => {
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if (err.code === "ENOENT") {return;} // Empty prefix, not an error.
        throw err;
      }
      for (const entry of entries) {
        if (keys.length >= limit) {return;}
        const child = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(child);
        } else if (entry.isFile()) {
          // Symlinked files are skipped rather than followed: a symlink in the
          // tree is an escape vector, and isFile() is false for them anyway
          // (readdir does not follow links).
          keys.push(path.relative(this.root, child).split(path.sep).join("/"));
        }
      }
    };

    await walk(base);
    return { keys, truncated: keys.length >= limit };
  }

  /** Delete every object under a prefix. Used for tenant offboarding. */
  async deleteMany(prefix) {
    const { keys } = await this.list(prefix, { limit: Number.MAX_SAFE_INTEGER });
    for (const key of keys) {
      await this.delete(key);
    }
    return { deleted: keys.length };
  }

  /**
   * HMAC-signed, expiring URL served by the app itself. A filesystem cannot
   * presign, so the app stays in the data path for local/NFS.
   */
  signedUrl(key, { ttlSec = 300, baseUrl, secret } = {}) {
    const normalized = normalizeKey(key);
    if (!secret) {
      throw new AppError(500, "Signed URL secret is not configured");
    }
    const { token, exp } = signing.sign(normalized, ttlSec, secret);
    const base = (baseUrl || "").replace(/\/$/, "");
    return {
      url: `${base}/api/v1/storage/object?key=${encodeURIComponent(normalized)}&token=${token}`,
      expiresAt: new Date(exp * 1000),
      // The app must stream this itself — there is no direct-to-storage path.
      direct: false,
    };
  }
}

module.exports = LocalDriver;
