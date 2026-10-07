/**
 * The rsync image import's fixed vocabulary (docs/UPSTREAM/08-FILE-POLICY.md; ADR-130).
 *
 * Kept apart from the service so the validator, the OpenAPI contract and the tests read the same
 * lists without loading the service's dependencies.
 */

/**
 * The file classes an import may copy, and the upstream folder each one is (08 § 1). The remote
 * path the operator enters is the upstream `public/uploads` directory; a class is one folder
 * under it. Certificate PDFs (`uploads/inventory`) are NOT a class: under the owner's rule of
 * 2026-10-07 they never enter application storage (08 § 6) — the import cannot even name them.
 */
export const UPSTREAM_FILE_CLASSES = Object.freeze({
  front: "foto_depan",
  serial: "foto_sn",
} as const);

/** A file class's name. */
export type UpstreamFileClass = keyof typeof UPSTREAM_FILE_CLASSES;

/** The class names, in a fixed order. */
export const UPSTREAM_FILE_CLASS_NAMES = Object.freeze(["front", "serial"] as const satisfies readonly UpstreamFileClass[]);

/** How the import authenticates to the source host. */
export const UPSTREAM_AUTH_METHODS = Object.freeze(["password", "key"] as const);
export type UpstreamAuthMethod = (typeof UPSTREAM_AUTH_METHODS)[number];

/**
 * Why a file stayed in the quarantine instead of entering storage (08 § 2, § 3, § 5). The names
 * are 08's where 08 names one. Reported as counts per reason; a file name never leaves the server.
 */
export const QUARANTINE_REASONS = Object.freeze([
  "file_type_refused", // not JPEG / PNG / HEIC by its magic bytes (incl. the shell script and text file, 08 § 10)
  "file_truncated", // under 1 KB (08 § 3)
  "file_too_large", // over 10 MB (08 § 3)
  "image_too_large", // over 12,000 px a side or 50 megapixels (08 § 3)
  "image_undecodable", // the signature matched but the structure does not parse (polyglot guard, 08 § 3)
  "heic_converter_unavailable", // HEIC is allow-listed, but this backend has no HEIC → JPEG converter yet (P21-02)
  "virus_found", // ClamAV verdict (08 § 5)
  "scan_failed", // the scanner failed; fail-closed (08 § 5)
  "storage_verify_failed", // the object read back did not hash as written; the object was deleted (08 § 2 step 6)
  "ingest_failed", // any other error while putting the file; nothing was left in storage
] as const);
export type QuarantineReason = (typeof QUARANTINE_REASONS)[number];

/** 08 § 3: the per-file size bounds, in bytes. */
export const MIN_FILE_BYTES = 1024;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * The transfer's own guard: rsync does not copy a file larger than this (`--max-size`). It sits
 * above MAX_FILE_BYTES so a file between the two is still copied and reported `file_too_large`;
 * a file above it is never copied (no real photo comes near it: the measured maximum is 8.1 MB).
 */
export const TRANSFER_MAX_SIZE = "64m";

/** 08 § 3: the decompression-bomb guard. */
export const MAX_IMAGE_SIDE_PX = 12_000;
export const MAX_IMAGE_PIXELS = 50_000_000;

/** The batch-job type the import runs as (batchJob.service#registerHandler). */
export const UPSTREAM_FILE_IMPORT_JOB_TYPE = "upstream-file-import";

/**
 * The HostKeyAlias every import pins its host key under: the temporary known_hosts names this
 * alias, never the address dialled, so a re-resolved address still matches the confirmed key —
 * and only that key.
 */
export const HOST_KEY_ALIAS = "callibrator-upstream-source";
