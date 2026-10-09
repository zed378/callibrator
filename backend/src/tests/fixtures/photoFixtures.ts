/**
 * P21-02b — synthetic photos for the device photo tests: JPEGs and PNGs encoded here (pure JS,
 * the same libraries the pipeline uses), with an EXIF block carrying an orientation and a GPS
 * position, a PNG text chunk, a HEIC `ftyp` header. No real photo is used.
 */
import zlib from "zlib";
import { encode as encodeJpeg } from "jpeg-js";
import { PNG } from "pngjs";

/** The GPS latitude the EXIF block carries: a distinctive byte run a test can look for. */
export const GPS_MARKER = Buffer.from([0x13, 0x57, 0x9b, 0xdf, 0x24, 0x68, 0xac, 0xe0]);

/** An RGBA raster with a gradient (so the encoder has something to encode) and an alpha channel. */
export const raster = (width: number, height: number, alpha = 255): Buffer => {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      data[o] = (x * 7) % 256;
      data[o + 1] = (y * 5) % 256;
      data[o + 2] = ((x + y) * 3) % 256;
      data[o + 3] = alpha;
    }
  }
  return data;
};

/**
 * An APP1 EXIF segment (little- or big-endian TIFF): IFD0 with the orientation and a pointer to
 * a GPS IFD holding GPSLatitudeRef and GPSLatitude (three RATIONALs = GPS_MARKER + 16 bytes).
 */
export const exifSegment = ({ orientation = 1, gps = true, bigEndian = false }: { orientation?: number; gps?: boolean; bigEndian?: boolean } = {}): Buffer => {
  const tiff = Buffer.alloc(256);
  const u16 = (at: number, v: number): void => {
    if (bigEndian) {
      tiff.writeUInt16BE(v, at);
    } else {
      tiff.writeUInt16LE(v, at);
    }
  };
  const u32 = (at: number, v: number): void => {
    if (bigEndian) {
      tiff.writeUInt32BE(v, at);
    } else {
      tiff.writeUInt32LE(v, at);
    }
  };
  tiff.write(bigEndian ? "MM" : "II", 0, "latin1");
  u16(2, 42);
  u32(4, 8);
  const entries = gps ? 2 : 1;
  u16(8, entries);
  // Orientation: SHORT, 1, value in the first two bytes of the value field.
  u16(10, 0x0112);
  u16(12, 3);
  u32(14, 1);
  u16(18, orientation);
  const gpsIfd = 10 + entries * 12 + 4;
  if (gps) {
    u16(22, 0x8825);
    u16(24, 4);
    u32(26, 1);
    u32(30, gpsIfd);
  }
  u32(10 + entries * 12, 0);
  if (gps) {
    u16(gpsIfd, 2);
    // GPSLatitudeRef: ASCII, 2, "S\0" inline.
    u16(gpsIfd + 2, 0x0001);
    u16(gpsIfd + 4, 2);
    u32(gpsIfd + 6, 2);
    tiff.write("S\0", gpsIfd + 10, "latin1");
    // GPSLatitude: RATIONAL, 3 → 24 bytes at an offset.
    const values = gpsIfd + 2 + 2 * 12 + 4;
    u16(gpsIfd + 14, 0x0002);
    u16(gpsIfd + 16, 5);
    u32(gpsIfd + 18, 3);
    u32(gpsIfd + 22, values);
    u32(gpsIfd + 26, 0);
    GPS_MARKER.copy(tiff, values);
  }
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
};

/** A 1,200-byte comment segment: keeps a tiny synthetic JPEG above the 1 KB floor (08 § 3). */
const PADDING = ((): Buffer => {
  const body = Buffer.alloc(1200, 0x20);
  const head = Buffer.from([0xff, 0xfe, 0, 0]);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
})();

/** A baseline JPEG of `width` × `height`, with `segments` (and a comment) spliced in after SOI. */
export const jpeg = (width: number, height: number, segments: readonly Buffer[] = []): Buffer => {
  const encoded = encodeJpeg({ width, height, data: raster(width, height) }, 90).data;
  return Buffer.concat([encoded.subarray(0, 2), ...segments, PADDING, encoded.subarray(2)]);
};

/** A PNG chunk with its CRC. */
const chunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body), 0);
  return Buffer.concat([length, body, crc]);
};

/** A PNG of `width` × `height` (half-transparent with `alpha`), optionally with a tEXt chunk after IHDR. */
export const png = (width: number, height: number, { text = false, alpha = 255 }: { text?: boolean; alpha?: number } = {}): Buffer => {
  const image = new PNG({ width, height });
  raster(width, height, alpha).copy(image.data);
  const encoded = PNG.sync.write(image);
  // Signature (8) + IHDR chunk (25); a private ancillary chunk pads it above the 1 KB floor.
  const pad = chunk("prVt", Buffer.alloc(1100, 0x20));
  const extra = text ? [chunk("tEXt", Buffer.from("Comment\0taken at the synthetic lab", "latin1")), pad] : [pad];
  return Buffer.concat([encoded.subarray(0, 33), ...extra, encoded.subarray(33)]);
};

/** A HEIC file's header (an ISO-BMFF `ftyp` box, brand `heic`), padded past the size floor. */
export const heic = (): Buffer => {
  const box = Buffer.alloc(24);
  box.writeUInt32BE(24, 0);
  box.write("ftypheic", 4, "latin1");
  box.write("mif1heic", 16, "latin1");
  return Buffer.concat([box, Buffer.alloc(2048, 7)]);
};
