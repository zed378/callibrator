/**
 * What a migrated photo is, how big it is, and its location metadata removed — without an image
 * library (the backend has none: docs/UPSTREAM/08-FILE-POLICY.md § 4.1; P21-02 adds one).
 *
 *  - TYPE by magic bytes only (08 § 3): JPEG `FF D8 FF`, PNG's 8-byte signature, HEIC/HEIF an
 *    ISO-BMFF `ftyp` box at offset 4 with a HEIF brand. The extension never decides.
 *  - STRUCTURE (the polyglot guard of 08 § 3, as far as can be checked without decoding): a JPEG's
 *    segments must chain from SOI to SOS with a frame header before the scan and an EOI after
 *    it; a PNG's chunks must chain with valid CRCs from IHDR to IEND. A file that matches a
 *    signature but not its structure is `image_undecodable`.
 *  - DIMENSIONS from the frame header (JPEG SOFn) or IHDR (PNG), against 08 § 3's limits.
 *  - LOCATION METADATA, removed LOSSLESSLY — the image data is copied byte for byte:
 *      JPEG: the EXIF GPS IFD is emptied in place (its entries and their values zeroed, its count
 *            set to 0 — the rest of EXIF, incl. orientation, is untouched); XMP (APP1
 *            `http://ns.adobe.com/…`, which can carry exif:GPS*), Photoshop/IPTC (APP13) and
 *            comments (COM) are dropped whole.
 *      PNG:  `eXIf` (EXIF, GPS included), `tEXt`, `zTXt` and `iTXt` (where XMP lives) are dropped.
 *    This is 08 § 4.2's alternative ("strip GPS only losslessly before the put, record both
 *    hashes"); both hashes go into the manifest. Maker notes are not parsed (a vendor's private
 *    format) — recorded as a known limit in the ADR.
 */
import zlib from "zlib";
import { MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE_PX } from "../../constants/upstreamFileImport";

/** A detected image type. */
export type ImageType = "jpeg" | "png" | "heic";

/** The HEIF brands 08 § 3 accepts (major or compatible). */
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The type of `buf` by its magic bytes, or null when it is none of the three. */
export const detectImageType = (buf: Buffer): ImageType | null => {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "jpeg";
  }
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "png";
  }
  if (buf.length >= 16 && buf.toString("latin1", 4, 8) === "ftyp") {
    const boxSize = buf.readUInt32BE(0);
    const end = Math.min(boxSize, buf.length);
    if (boxSize >= 16 && HEIF_BRANDS.has(buf.toString("latin1", 8, 12))) {
      return "heic";
    }
    // Compatible brands: every 4 bytes after the minor version (offset 16), inside the box.
    for (let at = 16; at + 4 <= end; at += 4) {
      if (HEIF_BRANDS.has(buf.toString("latin1", at, at + 4))) {
        return "heic";
      }
    }
  }
  return null;
};

/** The extension a stored object takes, from its DETECTED type. */
export const extensionOf = (type: ImageType): string => (type === "jpeg" ? "jpg" : type);

/** The MIME type recorded with the object, from its DETECTED type. */
export const mimeOf = (type: ImageType): string => (type === "jpeg" ? "image/jpeg" : type === "png" ? "image/png" : "image/heic");

/** What inspecting (and stripping) an image answers. */
export type InspectResult =
  | { ok: true; bytes: Buffer; width: number; height: number; stripped: boolean }
  | { ok: false; reason: "image_undecodable" | "image_too_large" };

const undecodable = { ok: false, reason: "image_undecodable" } as const;

/** 08 § 3's decompression-bomb guard. */
const tooLarge = (width: number, height: number): boolean =>
  width > MAX_IMAGE_SIDE_PX || height > MAX_IMAGE_SIDE_PX || width * height > MAX_IMAGE_PIXELS;

const finish = (bytes: Buffer, width: number, height: number, stripped: boolean): InspectResult => {
  if (width <= 0 || height <= 0) {
    return undecodable;
  }
  if (tooLarge(width, height)) {
    return { ok: false, reason: "image_too_large" };
  }
  return { ok: true, bytes, width, height, stripped };
};

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

/** SOFn markers that carry the frame's dimensions (not DHT C4, JPG C8, DAC CC). */
const isSof = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

/** Bytes per component of each TIFF field type (1 BYTE … 12 DOUBLE; 13 IFD). */
const TIFF_TYPE_SIZE: Readonly<Record<number, number>> = Object.freeze({
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4,
});

/**
 * Empty the GPS IFD of an EXIF payload IN PLACE (`exif` is a copy the caller owns).
 *
 * @returns whether there was anything to remove; null when the TIFF structure is malformed
 */
export const stripExifGps = (exif: Buffer): boolean | null => {
  // "Exif\0\0" then a TIFF header.
  const tiff = 6;
  if (exif.length < tiff + 8) {
    return null;
  }
  const order = exif.toString("latin1", tiff, tiff + 2);
  if (order !== "II" && order !== "MM") {
    return null;
  }
  const le = order === "II";
  const u16 = (at: number): number => (le ? exif.readUInt16LE(at) : exif.readUInt16BE(at));
  const u32 = (at: number): number => (le ? exif.readUInt32LE(at) : exif.readUInt32BE(at));
  const inside = (at: number, length: number): boolean => at >= tiff && at + length <= exif.length;
  if (u16(tiff + 2) !== 42) {
    return null;
  }
  const ifd0 = tiff + u32(tiff + 4);
  if (!inside(ifd0, 2)) {
    return null;
  }
  const count0 = u16(ifd0);
  if (!inside(ifd0 + 2, count0 * 12)) {
    return null;
  }
  let gpsOffset: number | null = null;
  for (let i = 0; i < count0; i += 1) {
    const entry = ifd0 + 2 + i * 12;
    if (u16(entry) === 0x8825) {
      gpsOffset = tiff + u32(entry + 8);
    }
  }
  if (gpsOffset === null) {
    return false;
  }
  if (!inside(gpsOffset, 2)) {
    return null;
  }
  const countGps = u16(gpsOffset);
  if (!inside(gpsOffset + 2, countGps * 12)) {
    return null;
  }
  for (let i = 0; i < countGps; i += 1) {
    const entry = gpsOffset + 2 + i * 12;
    const size = (TIFF_TYPE_SIZE[u16(entry + 2)] ?? 1) * u32(entry + 4);
    if (size > 4) {
      const valueAt = tiff + u32(entry + 8);
      if (inside(valueAt, size)) {
        exif.fill(0, valueAt, valueAt + size);
      }
    }
    exif.fill(0, entry, entry + 12);
  }
  // Count 0: a valid, empty IFD. The next-IFD pointer after the entries is left as it was.
  if (le) {
    exif.writeUInt16LE(0, gpsOffset);
  } else {
    exif.writeUInt16BE(0, gpsOffset);
  }
  return countGps > 0;
};

const XMP_PREFIXES = ["http://ns.adobe.com/xap/1.0/", "http://ns.adobe.com/xmp/extension/"];

/** Inspect a JPEG and remove its location metadata. */
export const inspectJpeg = (buf: Buffer): InspectResult => {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    return undecodable;
  }
  const out: Buffer[] = [buf.subarray(0, 2)];
  let at = 2;
  let width = 0;
  let height = 0;
  let stripped = false;
  for (;;) {
    if (at + 4 > buf.length || buf[at] !== 0xff) {
      return undecodable;
    }
    // Fill bytes (0xFF padding) before a marker.
    let markerAt = at + 1;
    while (markerAt < buf.length && buf[markerAt] === 0xff) {
      markerAt += 1;
    }
    const marker = buf[markerAt];
    if (marker === undefined || marker === 0xd9 || marker === 0x00) {
      return undecodable; // EOI before any scan, or a stuffed byte where a marker belongs
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      return undecodable; // a standalone marker cannot precede the first scan
    }
    if (markerAt + 3 > buf.length) {
      return undecodable;
    }
    const length = buf.readUInt16BE(markerAt + 1);
    const end = markerAt + 1 + length;
    if (length < 2 || end > buf.length) {
      return undecodable;
    }
    const segment = buf.subarray(at, end);
    const payload = buf.subarray(markerAt + 3, end);
    if (isSof(marker)) {
      if (payload.length < 5) {
        return undecodable;
      }
      height = payload.readUInt16BE(1);
      width = payload.readUInt16BE(3);
      out.push(segment);
    } else if (marker === 0xda) {
      // Start of scan: the entropy-coded data and everything after it is copied as it is.
      if (width === 0 || height === 0) {
        return undecodable;
      }
      const rest = buf.subarray(at);
      // An EOI must follow the scan (a trailer after it, as some phones write, is allowed).
      if (rest.lastIndexOf(Buffer.from([0xff, 0xd9])) <= 0) {
        return undecodable;
      }
      out.push(rest);
      return finish(Buffer.concat(out), width, height, stripped);
    } else if (marker === 0xe1 && payload.toString("latin1", 0, 6) === "Exif\0\0") {
      const copy = Buffer.from(segment);
      // The payload starts 4 bytes into the segment (FF E1 + length).
      const exif = copy.subarray(markerAt - at + 3);
      const result = stripExifGps(exif);
      if (result === null) {
        // EXIF we cannot read is EXIF we cannot vouch for: dropped whole rather than kept.
        stripped = true;
      } else {
        stripped = stripped || result;
        out.push(copy);
      }
    } else if (
      (marker === 0xe1 && XMP_PREFIXES.some((p) => payload.toString("latin1", 0, p.length) === p)) ||
      marker === 0xed ||
      marker === 0xfe
    ) {
      stripped = true; // XMP, Photoshop/IPTC, comment: dropped
    } else {
      out.push(segment);
    }
    at = end;
  }
};

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

/** The chunks that carry metadata, dropped. */
const PNG_METADATA_CHUNKS = new Set(["eXIf", "tEXt", "zTXt", "iTXt"]);

/** Inspect a PNG and remove its metadata chunks. */
export const inspectPng = (buf: Buffer): InspectResult => {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return undecodable;
  }
  const out: Buffer[] = [PNG_SIGNATURE];
  let at = 8;
  let width = 0;
  let height = 0;
  let stripped = false;
  let first = true;
  for (;;) {
    if (at + 12 > buf.length) {
      return undecodable;
    }
    const length = buf.readUInt32BE(at);
    const type = buf.toString("latin1", at + 4, at + 8);
    const end = at + 12 + length;
    if (end > buf.length || !/^[A-Za-z]{4}$/.test(type)) {
      return undecodable;
    }
    const crc = buf.readUInt32BE(at + 8 + length);
    if (zlib.crc32(buf.subarray(at + 4, at + 8 + length)) !== crc) {
      return undecodable;
    }
    if (first) {
      if (type !== "IHDR" || length !== 13) {
        return undecodable;
      }
      width = buf.readUInt32BE(at + 8);
      height = buf.readUInt32BE(at + 12);
      first = false;
    }
    if (PNG_METADATA_CHUNKS.has(type)) {
      stripped = true;
    } else {
      out.push(buf.subarray(at, end));
    }
    if (type === "IEND") {
      return finish(Buffer.concat(out), width, height, stripped);
    }
    at = end;
  }
};
