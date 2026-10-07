/**
 * The ingest of staged upstream photos (services/upstreamFileImport/ingest.ts) — docs/UPSTREAM/
 * 08-FILE-POLICY.md § 2's pipeline over SYNTHETIC files on a real temporary directory: what is
 * ingested (and stripped of GPS), what is quarantined and why, what is skipped as already
 * present, and the manifest the Phase 24 ETL reads. Storage and the scanner are doubles that
 * record what reached them.
 */
import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { ingestStaged, listFiles, type IngestDeps, type ManifestEntry } from "../../../services/upstreamFileImport/ingest";
import {
  syntheticHeic,
  syntheticJpeg,
  syntheticPng,
  syntheticShellScript,
  syntheticTextFile,
} from "../../support/syntheticImages";

const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

let root: string;
let staging: string;
let refused: string;
let manifestPath: string;
let objects: Map<string, Buffer>;
let scanned: string[];
let ids: number;

const deps = (over: Partial<IngestDeps> = {}): IngestDeps => ({
  scanFile: (abs) => {
    scanned.push(path.basename(abs));
    if (abs.includes("eicar")) {
      return Promise.resolve({ clean: false, reason: "Win.Test.EICAR_HDB-1" });
    }
    if (abs.includes("scanerr")) {
      return Promise.resolve({ clean: false, reason: "scan-error: clamd unreachable" });
    }
    return Promise.resolve({ clean: true });
  },
  buildKey: (name) => `t/11111111-1111-4111-8111-111111111111/attachments/${name}`,
  putObject: (key, bytes) => {
    objects.set(key, Buffer.from(bytes));
    return Promise.resolve();
  },
  readObject: (key) => Promise.resolve(objects.get(key) ?? Buffer.alloc(0)),
  removeObject: (key) => {
    objects.delete(key);
    return Promise.resolve();
  },
  newId: () => {
    ids += 1;
    return `00000000-0000-4000-8000-${String(ids).padStart(12, "0")}`;
  },
  ...over,
});

const put = (rel: string, bytes: Buffer): void => {
  const file = path.join(staging, ...rel.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
};

const manifest = (): ManifestEntry[] =>
  fs
    .readFileSync(manifestPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as ManifestEntry);

const CLASSES = [
  { name: "front" as const, folder: "foto_depan" },
  { name: "serial" as const, folder: "foto_sn" },
];

const run = (over: Partial<Parameters<typeof ingestStaged>[0]> = {}, d: IngestDeps = deps()) =>
  ingestStaged(
    {
      stagingRoot: staging,
      classes: CLASSES,
      refusedRoot: refused,
      manifestPath,
      previouslyIngested: new Map(),
      shouldStop: () => false,
      onProgress: () => undefined,
      ...over,
    },
    d,
  );

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "rsync-ingest-"));
  staging = path.join(root, "staging");
  refused = path.join(root, "refused");
  manifestPath = path.join(root, "manifests", "import.jsonl");
  objects = new Map();
  scanned = [];
  ids = 0;
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("ingestStaged — 08-FILE-POLICY § 2 over synthetic files", () => {
  it("ingests JPEG and PNG (GPS removed), quarantines everything else by reason, and writes the manifest", async () => {
    const gpsJpeg = syntheticJpeg({ gps: true, seed: 1 });
    const png = syntheticPng({ exif: true, seed: 2 });
    put("foto_depan/a/front-1.jpg", gpsJpeg);
    put("foto_depan/front-2.png", png);
    put("foto_depan/photo.heic", syntheticHeic());
    put("foto_depan/upload.sh", syntheticShellScript());
    put("foto_depan/notes.txt", syntheticTextFile());
    put("foto_depan/tiny.jpg", syntheticJpeg({ scanBytes: 10 }).subarray(0, 600));
    put("foto_depan/huge.jpg", syntheticJpeg({ scanBytes: 10 * 1024 * 1024 + 10 }));
    put("foto_depan/bomb.jpg", syntheticJpeg({ width: 12_001, height: 100 }));
    put("foto_depan/broken.jpg", Buffer.concat([syntheticJpeg().subarray(0, 900), Buffer.alloc(400, 0x2a)]));
    put("foto_sn/eicar.jpg", syntheticJpeg({ seed: 3 }));
    put("foto_sn/scanerr.jpg", syntheticJpeg({ seed: 4 }));
    put("foto_sn/.rsync-partial/half.jpg", syntheticJpeg({ seed: 5 }));
    const progress: number[] = [];

    const counts = await run({ onProgress: (processed, total) => progress.push(processed * 100 + total) });

    expect(counts).toMatchObject({
      ingested: 2,
      skippedPresent: 0,
      metadataStripped: 2,
      quarantined: 9,
      failed: 0,
      processed: 11,
      stopped: false,
      quarantinedByReason: {
        heic_converter_unavailable: 1,
        file_type_refused: 2,
        file_truncated: 1,
        file_too_large: 1,
        image_too_large: 1,
        image_undecodable: 1,
        virus_found: 1,
        scan_failed: 1,
      },
    });
    expect(progress.at(-1)).toBe(11 * 100 + 11);

    // Storage holds exactly the two ingested images, with their GPS gone, under UUID keys.
    expect([...objects.keys()].sort()).toEqual([
      "t/11111111-1111-4111-8111-111111111111/attachments/00000000-0000-4000-8000-000000000001.jpg",
      "t/11111111-1111-4111-8111-111111111111/attachments/00000000-0000-4000-8000-000000000002.png",
    ]);
    for (const bytes of objects.values()) {
      expect(bytes.includes(Buffer.from("S\0\0\0", "latin1"))).toBe(false);
    }
    // No original name, no folder name in any key (08 § 7).
    expect([...objects.keys()].join(" ")).not.toMatch(/front|foto|\.sh|notes/);

    // The scanner saw only allow-listed images (never the script, never a refused type).
    expect(scanned).not.toContain("upload.sh");
    expect(scanned).not.toContain("photo.heic");

    // The manifest: one line per file, the ingested ones with both hashes and the key.
    const lines = manifest();
    expect(lines).toHaveLength(11);
    const front = lines.find((l) => l.sourcePath === "foto_depan/a/front-1.jpg");
    expect(front).toMatchObject({
      class: "front",
      outcome: "ingested",
      detectedType: "jpeg",
      sourceSha256: sha(gpsJpeg),
      metadataStripped: true,
      size: gpsJpeg.length,
    });
    expect(front?.storedSha256).toBe(sha(objects.get(front?.storageKey ?? "") ?? Buffer.alloc(0)));
    expect(front?.storedSha256).not.toBe(front?.sourceSha256);
    expect(lines.find((l) => l.sourcePath === "foto_depan/upload.sh")).toMatchObject({ outcome: "quarantined", reason: "file_type_refused" });
    if (process.platform !== "win32") {
      expect(fs.statSync(manifestPath).mode & 0o777).toBe(0o600);
    }

    // Refused files are MOVED to refused/<reason>/<source path>; ingested ones are gone from staging.
    expect(fs.existsSync(path.join(refused, "file_type_refused", "foto_depan", "upload.sh"))).toBe(true);
    expect(fs.existsSync(path.join(refused, "virus_found", "foto_sn", "eicar.jpg"))).toBe(true);
    expect(await listFiles(staging)).toEqual([]);
    // rsync's partial directory is never ingested.
    expect(fs.existsSync(path.join(staging, "foto_sn", ".rsync-partial", "half.jpg"))).toBe(true);
  });

  it("skips a file whose path and hash an earlier import already ingested; counts identical content at two paths", async () => {
    const same = syntheticJpeg({ seed: 9 });
    put("foto_depan/x.jpg", same);
    put("foto_sn/x-copy.jpg", same);
    put("foto_sn/y.jpg", syntheticJpeg({ seed: 10 }));
    const counts = await run({ previouslyIngested: new Map([["foto_depan/x.jpg", sha(same)], ["foto_sn/y.jpg", "stale-hash"]]) });
    expect(counts).toMatchObject({ ingested: 2, skippedPresent: 1, duplicateContent: 0 });
    expect(manifest().find((l) => l.sourcePath === "foto_depan/x.jpg")).toMatchObject({ outcome: "skipped_present", sourceSha256: sha(same) });

    put("foto_depan/p.jpg", same);
    put("foto_sn/q.jpg", same);
    const second = await run();
    expect(second).toMatchObject({ ingested: 2, duplicateContent: 1 });
  });

  it("a put that throws leaves no object and quarantines ingest_failed", async () => {
    put("foto_depan/a.jpg", syntheticJpeg());
    const counts = await run({}, deps({ putObject: () => Promise.reject(new Error("disk full")) }));
    expect(counts.quarantinedByReason).toEqual({ ingest_failed: 1 });
    expect(objects.size).toBe(0);
  });

  it("a read-back that does not hash as written deletes the object: storage_verify_failed", async () => {
    put("foto_depan/a.jpg", syntheticJpeg());
    const counts = await run({}, deps({ readObject: () => Promise.resolve(Buffer.from("corrupted")) }));
    expect(counts.quarantinedByReason).toEqual({ storage_verify_failed: 1 });
    expect(objects.size).toBe(0);
  });

  it("a failing delete after a failed put is tolerated", async () => {
    put("foto_depan/a.jpg", syntheticJpeg());
    const counts = await run(
      {},
      deps({ readObject: () => Promise.resolve(Buffer.alloc(0)), removeObject: () => Promise.reject(new Error("gone")) }),
    );
    expect(counts.quarantinedByReason).toEqual({ storage_verify_failed: 1 });
    put("foto_depan/b.jpg", syntheticJpeg({ seed: 2 }));
    const failing = await run({}, deps({ putObject: () => Promise.reject(new Error("x")), removeObject: () => Promise.reject(new Error("y")) }));
    expect(failing.quarantinedByReason).toEqual({ ingest_failed: 1 });
  });

  it("a file that cannot be read is counted failed and left in place", async () => {
    put("foto_depan/a.jpg", syntheticJpeg());
    const spy = jest.spyOn(fs.promises, "lstat").mockRejectedValueOnce(Object.assign(new Error("EACCES"), { code: "EACCES" }));
    const counts = await run();
    spy.mockRestore();
    expect(counts).toMatchObject({ failed: 1, processed: 1, ingested: 0 });
    expect(await listFiles(staging)).toEqual(["foto_depan/a.jpg"]);
  });

  it("stops between files when cancelled; the rest stays for a later run", async () => {
    put("foto_depan/a.jpg", syntheticJpeg({ seed: 1 }));
    put("foto_depan/b.jpg", syntheticJpeg({ seed: 2 }));
    let calls = 0;
    const counts = await run({
      shouldStop: () => {
        calls += 1;
        return calls > 1;
      },
    });
    expect(counts).toMatchObject({ ingested: 1, processed: 1, stopped: true });
    expect(await listFiles(staging)).toEqual(["foto_depan/b.jpg"]);
  });

  it("a class folder that does not exist is simply empty", async () => {
    fs.mkdirSync(staging, { recursive: true });
    expect(await run({ classes: [{ name: "front", folder: "foto_depan" }] })).toMatchObject({ processed: 0 });
  });
});

describe("listFiles", () => {
  it("lists regular files only, sorted, with forward slashes; links are not followed", async () => {
    put("b/2.jpg", Buffer.from("x"));
    put("a.jpg", Buffer.from("x"));
    try {
      fs.symlinkSync(path.join(staging, "a.jpg"), path.join(staging, "link.jpg"));
    } catch {
      // Windows without the symlink privilege: the link case is proven on Linux (CI, the image).
    }
    expect(await listFiles(staging)).toEqual(["a.jpg", "b/2.jpg"]);
    expect(await listFiles(path.join(root, "missing"))).toEqual([]);
  });

  it("skips an entry that is neither a file nor a directory (a socket, a link)", async () => {
    fs.mkdirSync(staging, { recursive: true });
    jest.spyOn(fs.promises, "readdir").mockResolvedValueOnce([
      { name: "sock", isDirectory: () => false, isFile: () => false },
      { name: "a.jpg", isDirectory: () => false, isFile: () => true },
    ] as never);
    expect(await listFiles(staging)).toEqual(["a.jpg"]);
  });
});
