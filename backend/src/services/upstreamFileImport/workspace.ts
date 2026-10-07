/**
 * The rsync image import's directories and its short-lived secret files.
 *
 *   <root>/staging/<source key>/<class folder>/…   rsync's target: the QUARANTINE. Not served by
 *                                                  any route, not a storage key (the root starts
 *                                                  with a dot, keys cannot), not tenant storage.
 *                                                  Keyed by the SOURCE (tenant, host, port, path),
 *                                                  so a re-run resumes what an interrupted one
 *                                                  copied (`--partial`).
 *   <root>/refused/<import id>/<reason>/…          files the ingest refused, kept for the
 *                                                  operator's review, never ingested
 *   <root>/manifests/<import id>.jsonl             source path → storage key + hashes, for the
 *                                                  Phase 24 ETL (it holds upstream file names:
 *                                                  0600, never served, never in an API answer)
 *   <root>/runs/<random>/                          one run's scratch: HOME for ssh, the pinned
 *                                                  known_hosts, the private key file; removed
 *                                                  (secrets overwritten first) when the run ends
 *
 * Every directory is created 0700 and every file 0600.
 */
import { createHash, randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { upstreamImportDir } from "../../config/upstream";

/** A source's identity, as the staging directory's name: no host or path appears on disk. */
export const sourceKey = (targetTenantId: string, host: string, port: number, remotePath: string): string =>
  createHash("sha256").update(`${targetTenantId}\n${host.toLowerCase()}\n${String(port)}\n${remotePath}`).digest("hex").slice(0, 32);

/** The import's directories. */
export interface ImportPaths {
  root: string;
  staging: string;
  refused: string;
  manifest: string;
}

/** The directories of one import (nothing is created). */
export const importPaths = (importId: string, stagingKey: string): ImportPaths => {
  const root = upstreamImportDir();
  return {
    root,
    staging: path.join(root, "staging", stagingKey),
    refused: path.join(root, "refused", importId),
    manifest: path.join(root, "manifests", `${importId}.jsonl`),
  };
};

/** `mkdir -p` with 0700 on every level it creates. */
export const ensureDir = async (dir: string): Promise<void> => {
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
};

/** One run's private scratch directory. */
export interface RunScratch {
  dir: string;
  /** Write a 0600 file in the scratch directory and answer its path. */
  writeSecret: (name: string, content: string) => Promise<string>;
  /** Overwrite every file with zeros, then remove the directory. Never throws. */
  dispose: () => Promise<void>;
}

/** Overwrite a file's bytes with zeros, then unlink it. Never throws. */
export const wipeFile = async (file: string): Promise<void> => {
  try {
    const { size } = await fs.promises.stat(file);
    const handle = await fs.promises.open(file, "r+");
    try {
      await handle.write(Buffer.alloc(size), 0, size, 0);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Gone already, or unreadable: the unlink below still runs.
  }
  await fs.promises.unlink(file).catch(() => undefined);
};

/** Create a run's scratch directory under `<root>/runs/`. */
export const createRunScratch = async (): Promise<RunScratch> => {
  const runs = path.join(upstreamImportDir(), "runs");
  await ensureDir(runs);
  const dir = path.join(runs, randomBytes(12).toString("hex"));
  await fs.promises.mkdir(dir, { mode: 0o700 });
  const written: string[] = [];
  return {
    dir,
    writeSecret: async (name, content) => {
      const file = path.join(dir, name);
      await fs.promises.writeFile(file, content, { mode: 0o600, flag: "wx" });
      written.push(file);
      return file;
    },
    dispose: async () => {
      for (const file of written) {
        await wipeFile(file);
      }
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
};
