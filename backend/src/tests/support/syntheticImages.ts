/**
 * SYNTHETIC image files for the rsync image import's tests (and its live check's SSH server):
 * structurally valid JPEG / PNG / HEIC containers built byte by byte, with optional location
 * metadata (EXIF GPS, XMP, IPTC, PNG text chunks). No real photo, no real place: the GPS values
 * are fixed synthetic numbers. Nothing here is decodable as a picture (the scan data is filler),
 * which is all the import needs — it never decodes pixels (08-FILE-POLICY § 4.1: no image library).
 */
import zlib from "zlib";

/** Synthetic GPS: 1°2'3" S, 4°5'6" E — no particular place. */
export const SYNTHETIC_GPS_RATIONALS = [1, 2, 3, 4, 5, 6];

/** A 16-bit / 32-bit writer in the given byte order. */
const writer = (le: boolean) => ({
  u16: (n: number): Buffer => {
    const b = Buffer.alloc(2);
    if (le) {
      b.writeUInt16LE(n);
    } else {
      b.writeUInt16BE(n);
    }
    return b;
  },
  u32: (n: number): Buffer => {
    const b = Buffer.alloc(4);
    if (le) {
      b.writeUInt32LE(n);
    } else {
      b.writeUInt32BE(n);
    }
    return b;
  },
});

/**
 * An EXIF APP1 payload ("Exif\0\0" + TIFF): IFD0 holds Orientation = 6 and, when `gps`, a GPSInfo
 * pointer to a GPS IFD with a latitude reference ("S") and a latitude of three RATIONALs.
 */
export const exifPayload = (options: { gps: boolean; bigEndian?: boolean }): Buffer => {
  const le = options.bigEndian !== true;
  const w = writer(le);
  const header = Buffer.concat([Buffer.from(le ? "II" : "MM", "latin1"), w.u16(42), w.u32(8)]);
  const ifd0Count = options.gps ? 2 : 1;
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  const gpsOffset = 8 + ifd0Size;
  const orientation = Buffer.concat([w.u16(0x0112), w.u16(3), w.u32(1), w.u16(6), w.u16(0)]);
  const gpsPointer = Buffer.concat([w.u16(0x8825), w.u16(4), w.u32(1), w.u32(gpsOffset)]);
  const ifd0 = Buffer.concat([w.u16(ifd0Count), orientation, ...(options.gps ? [gpsPointer] : []), w.u32(0)]);
  if (!options.gps) {
    return Buffer.concat([Buffer.from("Exif\0\0", "latin1"), header, ifd0]);
  }
  const gpsCount = 2;
  const valuesOffset = gpsOffset + 2 + gpsCount * 12 + 4;
  const latRef = Buffer.concat([w.u16(0x0001), w.u16(2), w.u32(2), Buffer.from("S\0\0\0", "latin1")]);
  const lat = Buffer.concat([w.u16(0x0002), w.u16(5), w.u32(3), w.u32(valuesOffset)]);
  const gpsIfd = Buffer.concat([w.u16(gpsCount), latRef, lat, w.u32(0)]);
  const rationals = Buffer.concat(SYNTHETIC_GPS_RATIONALS.slice(0, 3).flatMap((n) => [w.u32(n), w.u32(1)]));
  return Buffer.concat([Buffer.from("Exif\0\0", "latin1"), header, ifd0, gpsIfd, rationals]);
};

const segment = (marker: number, payload: Buffer): Buffer => {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), length, payload]);
};

/** Options for a synthetic JPEG. */
export interface JpegOptions {
  width?: number;
  height?: number;
  gps?: boolean;
  exif?: boolean;
  bigEndianExif?: boolean;
  xmp?: boolean;
  iptc?: boolean;
  comment?: boolean;
  /** Filler scan bytes (makes the file big enough to pass the 1 KB floor). */
  scanBytes?: number;
  /** Bytes after EOI (some phones append a trailer). */
  trailer?: Buffer;
  /** Distinguishes otherwise identical files. */
  seed?: number;
}

/** A synthetic baseline JPEG: SOI, APP0, optional metadata, DQT, SOF0, SOS, filler, EOI. */
export const syntheticJpeg = (options: JpegOptions = {}): Buffer => {
  const width = options.width ?? 640;
  const height = options.height ?? 480;
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  parts.push(segment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")));
  if (options.exif !== false) {
    parts.push(segment(0xe1, exifPayload({ gps: options.gps === true, bigEndian: options.bigEndianExif === true })));
  }
  if (options.xmp) {
    parts.push(segment(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta exif:GPSLatitude="1,2,3S"/>', "latin1")));
  }
  if (options.iptc) {
    parts.push(segment(0xed, Buffer.concat([Buffer.from("Photoshop 3.0", "latin1"), Buffer.from([0]), Buffer.from("8BIM synthetic-location", "latin1")])));
  }
  if (options.comment) {
    parts.push(segment(0xfe, Buffer.from("synthetic comment", "latin1")));
  }
  parts.push(segment(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])));
  const sof = Buffer.alloc(15);
  sof.writeUInt8(8, 0);
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  sof.writeUInt8(3, 5);
  parts.push(segment(0xc0, sof));
  parts.push(segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])));
  // Entropy-coded filler: no 0xFF byte, so no marker is formed inside it.
  const filler = Buffer.alloc(options.scanBytes ?? 2048, 0x2a);
  filler.writeUInt32BE(options.seed ?? 0, 0);
  parts.push(filler, Buffer.from([0xff, 0xd9]));
  if (options.trailer) {
    parts.push(options.trailer);
  }
  return Buffer.concat(parts);
};

const pngChunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
};

/** Options for a synthetic PNG. */
export interface PngOptions {
  width?: number;
  height?: number;
  exif?: boolean;
  text?: boolean;
  dataBytes?: number;
  seed?: number;
}

/** A synthetic PNG: IHDR, optional eXIf / tEXt / iTXt, IDAT filler, IEND — every CRC valid. */
export const syntheticPng = (options: PngOptions = {}): Buffer => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(options.width ?? 320, 0);
  ihdr.writeUInt32BE(options.height ?? 240, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(2, 9);
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", ihdr)];
  if (options.exif) {
    parts.push(pngChunk("eXIf", exifPayload({ gps: true }).subarray(6)));
  }
  if (options.text) {
    parts.push(pngChunk("tEXt", Buffer.from("Comment\0synthetic", "latin1")));
    parts.push(pngChunk("iTXt", Buffer.from("XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>", "latin1")));
  }
  const data = Buffer.alloc(options.dataBytes ?? 2048, 7);
  data.writeUInt32BE(options.seed ?? 0, 0);
  parts.push(pngChunk("IDAT", data), pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
};

/** A synthetic HEIC container head: an `ftyp` box with the `heic` major brand, then filler. */
export const syntheticHeic = (bytes = 2048): Buffer => {
  const ftyp = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypheic", "latin1"), Buffer.alloc(4), Buffer.from("mif1heic", "latin1")]);
  ftyp.writeUInt32BE(ftyp.length, 0);
  return Buffer.concat([ftyp, Buffer.alloc(Math.max(0, bytes - ftyp.length), 3)]);
};

/** The shell script and text file of 08 § 10, as synthetic stand-ins. */
export const syntheticShellScript = (): Buffer => Buffer.from(`#!/bin/sh\n# synthetic stand-in\n${"echo moved\n".repeat(120)}`, "latin1");
export const syntheticTextFile = (): Buffer => Buffer.from("synthetic notes\n".repeat(100), "latin1");
