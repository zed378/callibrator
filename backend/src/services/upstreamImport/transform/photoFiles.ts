/**
 * What step 9 (the device photos, P24-03; ADR-129 Am. 10) knows of the FILES: the photo catalogue
 * read from the manifests of the rsync image imports (P24-07, ADR-130), and the storage it moves
 * them in.
 *
 * THE CATALOGUE. Every completed image import into the provider tenant left a manifest
 * (`<storage root>/.upstream-import/manifests/<import>.jsonl`, one line per file: ingested, skipped
 * as already present, or quarantined with its reason — 08 § 11). Read oldest first, the LATEST line
 * of a source path decides it:
 *  - `ingested` → the object under the tenant's own scope (`t/<tenant>/attachments/<uuid>.<ext>`),
 *    its stored SHA-256 and its type;
 *  - `skipped_present` → the earlier ingest of the same path and the same source hash (that object);
 *  - `quarantined` → the ingest's reason (`heic_converter_unavailable`, `virus_found`, …).
 * A HEIC file the ETL converted outside the application (ADR-132 Am. 3) is re-imported under the
 * SAME source path with JPEG bytes; the newer line wins, so the conversion needs no mapping table.
 * A torn line (a crash mid-write) is skipped — that file reads as missing, never as something else.
 *
 * THE STORAGE. The step puts each photo under its device's facility (ADR-124 § 9) and its two
 * derivatives beside it, inside the transform's transaction — but an object store is not
 * transactional, so the files object records what it wrote (`created`, removed when the transform
 * rolls back) and the tenant-scope originals it replaced (`superseded`, removed after the commit).
 */
import type { QuarantineReason } from "../../../constants/upstreamFileImport";
import type { ManifestEntry } from "../../upstreamFileImport/ingest";

/** A source path's decision, as the manifests give it. */
export type PhotoSource =
  | {
      readonly outcome: "ingested";
      readonly storageKey: string;
      readonly storedSha256: string;
      readonly type: "jpeg" | "png";
      /** ADR-130 Am. 1: the ingest stored the two derivatives beside the object (an older manifest did not). */
      readonly derivatives: boolean;
    }
  | { readonly outcome: "quarantined"; readonly reason: QuarantineReason };

/** The storage step 9 writes through, bound to the provider tenant. */
export interface TransformFiles {
  /** source path (`foto_depan/<name>`) → its decision; a path absent here is `file_missing`. */
  readonly catalogue: ReadonlyMap<string, PhotoSource>;
  /** The key of `name` under the facility's attachments (`t/<tenant>/f/<facility>/attachments/<name>`). */
  buildKey(name: string, clientFacilityId: string | null): string;
  readObject(key: string): Promise<Buffer>;
  putObject(key: string, bytes: Buffer, contentType: string): Promise<void>;
  removeObject(key: string): Promise<void>;
  newId(): string;
  /** Keys this transform wrote: removed if it rolls back. */
  readonly created: string[];
  /** Tenant-scope originals re-keyed by this transform: removed after it commits. */
  readonly superseded: string[];
}

const isImage = (type: unknown): type is "jpeg" | "png" => type === "jpeg" || type === "png";

/** One manifest line, or null when it is torn or not a manifest line. */
const parseLine = (line: string): ManifestEntry | null => {
  try {
    const entry = JSON.parse(line) as Partial<ManifestEntry> | null;
    return entry !== null && typeof entry === "object" && typeof entry.sourcePath === "string" && typeof entry.outcome === "string"
      ? (entry as ManifestEntry)
      : null;
  } catch {
    return null;
  }
};

/**
 * The catalogue of the manifests' texts, OLDEST FIRST.
 * @returns source path → decision
 */
export const catalogueOf = (manifests: readonly string[]): Map<string, PhotoSource> => {
  const catalogue = new Map<string, PhotoSource>();
  /** source path → source SHA-256 → the ingested object (for a later `skipped_present`). */
  const ingested = new Map<string, Map<string, PhotoSource>>();
  for (const text of manifests) {
    for (const line of text.split("\n")) {
      const entry = line.trim() === "" ? null : parseLine(line);
      if (entry === null) {
        continue;
      }
      if (entry.outcome === "ingested" && entry.storageKey && entry.storedSha256 && entry.sourceSha256 && isImage(entry.detectedType)) {
        const source: PhotoSource = {
          outcome: "ingested",
          storageKey: entry.storageKey,
          storedSha256: entry.storedSha256,
          type: entry.detectedType,
          derivatives: entry.derivatives === true,
        };
        const byHash = ingested.get(entry.sourcePath) ?? new Map<string, PhotoSource>();
        byHash.set(entry.sourceSha256, source);
        ingested.set(entry.sourcePath, byHash);
        catalogue.set(entry.sourcePath, source);
      } else if (entry.outcome === "skipped_present" && entry.sourceSha256) {
        const earlier = ingested.get(entry.sourcePath)?.get(entry.sourceSha256);
        if (earlier) {
          catalogue.set(entry.sourcePath, earlier);
        } else {
          catalogue.delete(entry.sourcePath); // its earlier manifest is gone: the file reads as missing
        }
      } else if (entry.outcome === "quarantined" && entry.reason) {
        catalogue.set(entry.sourcePath, { outcome: "quarantined", reason: entry.reason });
      }
    }
  }
  return catalogue;
};
