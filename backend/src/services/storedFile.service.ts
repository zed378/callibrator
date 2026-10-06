// src/services/storedFile.service.ts
//
// P8-01 (ADR-086 Amendment 1) — the bridge between the services that keep
// files (attachments, certificate PDFs, the public image class, tenant
// backups, GDPR exports) and the pluggable storage layer (services/storage).
//
// Every file the application keeps now lives under a storage KEY —
// `t/<tenantId>/<domain>/<name>` for a tenant's, `global/<domain>/<name>` for
// the platform's — on whichever driver the owner resolves to: the local
// driver's root (the default, `/app/storage`), an NFS mount, or an S3 bucket.
// A file that is only being PROCESSED stays on this host's disk for the length
// of one request: the upload quarantine (multer writes there, the magic-byte
// check and ClamAV read it by path), a GDPR export's working directory, a
// CSV import. Those are scratch, never served, and never read by another
// replica.
//
// Rows written before the cut-over still name a file on the legacy disk path.
// Each caller keeps that path as a FALLBACK for such a row, and
// `npm run migrate:storage` copies those files into storage (verified) so the
// fallback can be retired.

import fs from "fs";
import type { Readable } from "stream";
import storage from "./storage";
import type { StorageObject } from "../utils/fileResponse.util";

/** The storage-bound object the callers hold (ScopedStorage). */
type Scoped = InstanceType<typeof storage.ScopedStorage>;

/** An error a driver raises for an object that is not there (stat 404, get 410). */
const isMissing = (err: unknown): boolean => {
  const { status } = err as { status?: unknown };
  return status === 404 || status === 410;
};

/**
 * Whether a stored reference is a storage key rather than a legacy location.
 * A key's first segment names its owner (`t/` or `global/`); no legacy value
 * starts that way (backups stored an absolute host path, certificates
 * `certificates/<file>`, avatars and logos a bare file name).
 */
const isStorageKey = (ref: unknown): ref is string =>
  typeof ref === "string" && (ref.startsWith("t/") || ref.startsWith("global/"));

/** The storage of an owner: a tenant's, or the platform's for none. */
const storageFor = (tenantId: string | null | undefined): Promise<Scoped> =>
  tenantId ? storage.getTenantStorage(tenantId) : storage.getGlobalStorage();

/**
 * Copy a file on this host's disk into storage under `key`, then remove the
 * local copy. The local copy is removed only after the put succeeded: on a
 * failed put the caller still holds it (to discard it, or to retry).
 */
const putLocalFile = async (
  scoped: Scoped,
  key: string,
  absPath: string,
  contentType: string | null | undefined,
): Promise<void> => {
  const body = fs.createReadStream(absPath);
  try {
    await scoped.put(key, body, { contentType: contentType ?? null });
  } catch (err) {
    // A put refused before (or while) it read the stream must not leave the
    // file handle open behind it.
    body.destroy();
    throw err;
  }
  await fs.promises.unlink(absPath).catch(() => undefined);
};

/**
 * Open a stored object for sending: its metadata now (a missing object
 * rejects here, before a header is written), its bytes on demand.
 */
const openObject = async (scoped: Scoped, key: string): Promise<StorageObject> => {
  const meta = await scoped.stat(key);
  return { meta, open: (range) => scoped.get(key, range) };
};

/** A whole object, read into memory (a backup ZIP, a JSON manifest). */
const readObject = async (scoped: Scoped, key: string): Promise<Buffer> => {
  const stream = (await scoped.get(key)) as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
};

/**
 * Delete an object, treating "already gone" as done. Rejects on any other
 * failure, for the caller to log or retry.
 */
const removeObject = async (scoped: Scoped, key: string): Promise<void> => {
  try {
    await scoped.delete(key);
  } catch (err) {
    if (!isMissing(err)) {throw err;}
  }
};

export = { isMissing, isStorageKey, storageFor, putLocalFile, openObject, readObject, removeObject };
