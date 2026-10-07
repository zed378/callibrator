/**
 * The ingest of a staged class folder into a tenant's storage — docs/UPSTREAM/08-FILE-POLICY.md
 * § 2's pipeline, per file, for the files rsync copied into the quarantine:
 *
 *   size bounds (1 KB … 10 MB)          ── refused → file_truncated / file_too_large
 *   type by magic bytes                 ── refused → file_type_refused (the .sh and .txt, SVG, AVIF …)
 *   HEIC                                ── heic_converter_unavailable (allow-listed, but no converter yet)
 *   ClamAV, fail-closed                 ── virus_found / scan_failed
 *   SHA-256 of the source bytes         ── same path and hash as an earlier import → skipped (already present)
 *   structure + dimensions              ── image_undecodable / image_too_large
 *   location metadata removed (lossless)
 *   put t/<tenant>/attachments/<uuid>.<ext>, read back, SHA-256 again
 *                                       ── mismatch → object deleted, storage_verify_failed
 *   manifest line; the quarantine copy deleted
 *
 * A refused file is MOVED to `refused/<import>/<reason>/` and stays there for the operator; it is
 * never ingested. Every file — ingested, skipped or refused — gets a manifest line (08 § 9:
 * counts per folder must reconcile). No deduplication of content (08 § 7: each row its own
 * object); identical content at two paths is counted as `duplicateContent`, nothing more.
 *
 * The faskes segment of 08 § 7 (`t/<tenant>/f/<faskes>/…`) needs the facility of each device,
 * which only the ETL knows (P24-03): files land under the tenant's own scope now, and the
 * manifest's source path is what the ETL joins on (and re-keys from).
 */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import {
  MAX_FILE_BYTES,
  MIN_FILE_BYTES,
  type QuarantineReason,
  type UpstreamFileClass,
} from "../../constants/upstreamFileImport";
import { detectImageType, extensionOf, inspectJpeg, inspectPng, mimeOf, type ImageType } from "./imageInspect";
import { ensureDir } from "./workspace";

/** What the pipeline needs from the outside world (storage, scanner, ids). */
export interface IngestDeps {
  scanFile: (absPath: string) => Promise<{ clean: boolean; reason?: unknown }>;
  buildKey: (name: string) => string;
  putObject: (key: string, bytes: Buffer, contentType: string) => Promise<void>;
  readObject: (key: string) => Promise<Buffer>;
  removeObject: (key: string) => Promise<void>;
  newId: () => string;
}

/** One class folder to ingest. */
export interface StagedClass {
  name: UpstreamFileClass;
  folder: string;
}

/** The pipeline's input. */
export interface IngestInput {
  stagingRoot: string;
  classes: readonly StagedClass[];
  refusedRoot: string;
  manifestPath: string;
  /** source path → source SHA-256 of what earlier imports of the same source already ingested. */
  previouslyIngested: ReadonlyMap<string, string>;
  shouldStop: () => boolean;
  onProgress: (processed: number, total: number) => void;
}

/** The counts the summary reports. */
export interface IngestCounts {
  ingested: number;
  bytesIngested: number;
  skippedPresent: number;
  duplicateContent: number;
  metadataStripped: number;
  quarantined: number;
  quarantinedByReason: Partial<Record<QuarantineReason, number>>;
  failed: number;
  processed: number;
  stopped: boolean;
}

/** One manifest line (JSON Lines). */
export interface ManifestEntry {
  sourcePath: string;
  class: UpstreamFileClass;
  size: number;
  outcome: "ingested" | "skipped_present" | "quarantined";
  reason?: QuarantineReason;
  detectedType?: ImageType;
  sourceSha256?: string;
  storedSha256?: string;
  storageKey?: string;
  metadataStripped?: boolean;
}

/** The directory rsync keeps partial files in (sshArgs#buildRsyncArgs): never ingested. */
const PARTIAL_DIR = ".rsync-partial";

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** Every regular file under `dir`, as paths relative to it (forward slashes). Links and specials are skipped. */
export const listFiles = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  const walk = async (current: string, prefix: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      return; // a class folder that was never created (nothing to copy)
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === PARTIAL_DIR) {
        continue;
      }
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(path.join(current, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  };
  await walk(dir, "");
  return out;
};

/** The empty counts. */
export const emptyCounts = (): IngestCounts => ({
  ingested: 0,
  bytesIngested: 0,
  skippedPresent: 0,
  duplicateContent: 0,
  metadataStripped: 0,
  quarantined: 0,
  quarantinedByReason: {},
  failed: 0,
  processed: 0,
  stopped: false,
});

/** Answer a scanner reason as a quarantine reason: a scanner error is `scan_failed` (fail-closed). */
const scanReason = (reason: unknown): QuarantineReason =>
  typeof reason === "string" && reason.startsWith("scan-error") ? "scan_failed" : "virus_found";

/**
 * Ingest every staged file of `input.classes`. Stops between files when `shouldStop()` says so
 * (cancel), leaving the rest in the quarantine for a later run.
 */
export const ingestStaged = async (input: IngestInput, deps: IngestDeps): Promise<IngestCounts> => {
  const counts = emptyCounts();
  const work: { cls: StagedClass; rel: string }[] = [];
  for (const cls of input.classes) {
    for (const rel of await listFiles(path.join(input.stagingRoot, cls.folder))) {
      work.push({ cls, rel });
    }
  }
  await ensureDir(path.dirname(input.manifestPath));
  const manifest = await fs.promises.open(input.manifestPath, "a", 0o600);
  const seenContent = new Set<string>();

  const record = async (entry: ManifestEntry): Promise<void> => {
    await manifest.appendFile(`${JSON.stringify(entry)}\n`, "utf8");
  };

  const quarantine = async (abs: string, sourcePath: string, reason: QuarantineReason): Promise<void> => {
    const target = path.join(input.refusedRoot, reason, ...sourcePath.split("/"));
    await ensureDir(path.dirname(target));
    await fs.promises.rename(abs, target);
    counts.quarantined += 1;
    counts.quarantinedByReason[reason] = (counts.quarantinedByReason[reason] ?? 0) + 1;
  };

  /** One file through the pipeline. Throws only when the file cannot be read or moved at all. */
  const processOne = async (cls: StagedClass, rel: string): Promise<void> => {
    const abs = path.join(input.stagingRoot, cls.folder, ...rel.split("/"));
    const sourcePath = `${cls.folder}/${rel}`;
    const base = { sourcePath, class: cls.name };
    const stat = await fs.promises.lstat(abs);
    const refuse = async (reason: QuarantineReason, extra: Partial<ManifestEntry> = {}): Promise<void> => {
      await quarantine(abs, sourcePath, reason);
      await record({ ...base, size: stat.size, outcome: "quarantined", reason, ...extra });
    };
    if (stat.size < MIN_FILE_BYTES) {
      return refuse("file_truncated");
    }
    if (stat.size > MAX_FILE_BYTES) {
      return refuse("file_too_large");
    }
    const bytes = await fs.promises.readFile(abs);
    const type = detectImageType(bytes);
    if (type === null) {
      return refuse("file_type_refused");
    }
    if (type === "heic") {
      return refuse("heic_converter_unavailable", { detectedType: type });
    }
    const scan = await deps.scanFile(abs);
    if (!scan.clean) {
      return refuse(scanReason(scan.reason), { detectedType: type });
    }
    const sourceSha256 = sha256(bytes);
    if (input.previouslyIngested.get(sourcePath) === sourceSha256) {
      counts.skippedPresent += 1;
      await record({ ...base, size: stat.size, outcome: "skipped_present", detectedType: type, sourceSha256 });
      await fs.promises.unlink(abs);
      return undefined;
    }
    const inspected = type === "jpeg" ? inspectJpeg(bytes) : inspectPng(bytes);
    if (!inspected.ok) {
      return refuse(inspected.reason, { detectedType: type, sourceSha256 });
    }
    if (seenContent.has(sourceSha256)) {
      counts.duplicateContent += 1;
    }
    seenContent.add(sourceSha256);
    const storedSha256 = sha256(inspected.bytes);
    const storageKey = deps.buildKey(`${deps.newId()}.${extensionOf(type)}`);
    let verified: boolean;
    try {
      await deps.putObject(storageKey, inspected.bytes, mimeOf(type));
      verified = sha256(await deps.readObject(storageKey)) === storedSha256;
    } catch {
      await deps.removeObject(storageKey).catch(() => undefined);
      return refuse("ingest_failed", { detectedType: type, sourceSha256 });
    }
    if (!verified) {
      await deps.removeObject(storageKey).catch(() => undefined);
      return refuse("storage_verify_failed", { detectedType: type, sourceSha256 });
    }
    counts.ingested += 1;
    counts.bytesIngested += inspected.bytes.length;
    if (inspected.stripped) {
      counts.metadataStripped += 1;
    }
    await record({
      ...base,
      size: stat.size,
      outcome: "ingested",
      detectedType: type,
      sourceSha256,
      storedSha256,
      storageKey,
      metadataStripped: inspected.stripped,
    });
    await fs.promises.unlink(abs);
    return undefined;
  };

  try {
    for (const { cls, rel } of work) {
      if (input.shouldStop()) {
        counts.stopped = true;
        break;
      }
      try {
        await processOne(cls, rel);
      } catch {
        // The file could not even be read or moved: counted, left in the quarantine for the next run.
        counts.failed += 1;
      }
      counts.processed += 1;
      input.onProgress(counts.processed, work.length);
    }
  } finally {
    await manifest.close();
  }
  return counts;
};
