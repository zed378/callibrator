/**
 * The upstream adoption's runtime switches (Phases 12 … 31, docs/UPSTREAM/), read in one place.
 *
 * `UPSTREAM_REAL_DATA_ALLOWED` is the DPIA gate (docs/UPSTREAM/06-DPIA.md § 5: no copy of real
 * upstream data is made while R-01, R-03 or R-17 is above the threshold). It is SHARED by every
 * module that pulls data from the upstream application — the rsync image import (this file's
 * first user) and the SQL-dump import — so it is defined here once and nowhere else. Default
 * OFF: only a source the operator marks as synthetic, on a host this deployment allow-lists,
 * may be used while it is off.
 *
 * Every read happens at call time (config/env.ts), so a changed variable applies on the next
 * request without a rebuilt module.
 */
import path from "path";
import { env } from "./env";
import storagePath from "../utils/storagePath.util";

/** Whether real upstream data may be copied (the DPIA gates are met and recorded). */
export const upstreamRealDataAllowed = (): boolean => env("UPSTREAM_REAL_DATA_ALLOWED") === "true";

/**
 * Hosts an rsync import may reach although they are internal (a test SSH server on the
 * deployment's own network): `RSYNC_ALLOWED_HOSTS`, comma-separated host names or literal
 * addresses, compared lower-cased. Unlike `SSRF_DEV_ALLOW_HOSTS` it applies in production too:
 * it is the operator's explicit, per-deployment statement, and while the DPIA gate is off it is
 * also the ONLY set of hosts an import may reach at all.
 */
export const rsyncAllowedHosts = (): string[] =>
  (env("RSYNC_ALLOWED_HOSTS") ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h !== "");

/**
 * The working directory of the rsync import: the transfer staging (the import's QUARANTINE —
 * not web-served, not tenant storage), the refused files, the manifests and the per-run
 * scratch. Default `<storage root>/.upstream-import`, on the storage volume (the photos are
 * ~91 GB, 08-FILE-POLICY § 1). A leading dot keeps it outside every storage key: a key segment
 * must start with a letter or digit (services/storage/keys.ts).
 */
export const upstreamImportDir = (): string => {
  const configured = env("UPSTREAM_FILE_IMPORT_DIR")?.trim();
  return configured !== undefined && configured !== "" ? path.resolve(configured) : storagePath("storage", ".upstream-import");
};

/** A positive integer variable, or its default when unset, empty or not a positive integer. */
const positiveInt = (name: string, fallback: number): number => {
  const value = Number(env(name));
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

/** How long one SSH step of "check connection" may take (key scan, authenticated listing). */
export const rsyncCheckTimeoutMs = (): number => positiveInt("RSYNC_CHECK_TIMEOUT_MS", 120_000);

/** rsync's own I/O timeout during the transfer, in seconds (`--timeout`). */
export const rsyncIoTimeoutSec = (): number => positiveInt("RSYNC_IO_TIMEOUT_SEC", 300);
