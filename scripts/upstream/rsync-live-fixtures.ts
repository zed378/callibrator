/**
 * The rsync image import's live check: the SYNTHETIC upstream `public/uploads` tree the throwaway
 * SSH server serves (scripts/upstream/rsync-live-check.sh). No real photo, name or place: every
 * file is built byte by byte by backend/src/tests/support/syntheticImages.ts.
 *
 *   node --import tsx scripts/upstream/rsync-live-fixtures.ts <out-dir>
 *
 * Writes <out-dir>/uploads/{foto_depan,foto_sn,inventory}/… and prints the expected outcome counts
 * as JSON on stdout (the app-path check compares the import's summary with them).
 */
import fs from "fs";
import path from "path";
import {
  syntheticHeic,
  syntheticJpeg,
  syntheticPng,
  syntheticShellScript,
  syntheticTextFile,
} from "../../backend/src/tests/support/syntheticImages";

const out = process.argv[2];
if (!out) {
  console.error("usage: rsync-live-fixtures.ts <out-dir>");
  process.exit(2);
}

const write = (rel: string, bytes: Buffer): void => {
  const file = path.join(out, "uploads", ...rel.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
};

// Front photos: GPS-tagged JPEGs (stripped on ingest), a PNG with text chunks, a HEIC (no
// converter: quarantined), the 08 § 10 shell script and text file, a truncated file.
write("foto_depan/d-0001.jpg", syntheticJpeg({ gps: true, seed: 1 }));
write("foto_depan/d-0002.jpg", syntheticJpeg({ gps: true, xmp: true, seed: 2 }));
write("foto_depan/2024/d-0003.png", syntheticPng({ text: true, exif: true, seed: 3 }));
write("foto_depan/d-0004.heic", syntheticHeic());
write("foto_depan/upload.sh", syntheticShellScript());
write("foto_depan/notes.txt", syntheticTextFile());
write("foto_depan/tiny.jpg", syntheticJpeg({ scanBytes: 10 }).subarray(0, 512));
// Serial-plate photos: a plain JPEG, a byte-identical copy at another path (counted, still its
// own object), and a large one (~3 MB) so a bandwidth-limited run lasts long enough to cancel.
const same = syntheticJpeg({ seed: 7 });
write("foto_sn/s-0001.jpg", same);
write("foto_sn/s-0001-copy.jpg", same);
write("foto_sn/s-0002.jpg", syntheticJpeg({ seed: 8, scanBytes: 3 * 1024 * 1024 }));
// Certificate PDFs: NEVER imported (owner rule 2026-10-07) — the import cannot even name the folder.
write("inventory/cert-0001.pdf", Buffer.from(`%PDF-1.7\n%synthetic\n${"0".repeat(4096)}\n%%EOF\n`, "latin1"));

process.stdout.write(
  JSON.stringify({
    filesCopied: 10,
    ingested: 6,
    quarantined: 4,
    quarantinedByReason: { file_type_refused: 2, heic_converter_unavailable: 1, file_truncated: 1 },
    duplicateContent: 1,
    metadataStripped: 3,
    estimate: { front: 7, serial: 3 },
  }),
);
