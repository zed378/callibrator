/**
 * P21-02b (ADR-132 Am. 3; docs/UPSTREAM/08-FILE-POLICY.md § 3, § 4.1): a device photo's display
 * and thumbnail derivatives, decoded and re-encoded in PURE JavaScript (`jpeg-js`, `pngjs`) — no
 * native module, so the `pkg` binary of the ADR-123 image carries them like any other source.
 *
 *  - FULL DECODE is the polyglot guard of 08 § 3: a file whose signature matched but whose pixels
 *    do not decode (strictly — `tolerantDecoding: false`) is refused. The caller has already
 *    checked the type by magic bytes and the dimensions against 08 § 3's limits from the header
 *    (`imageInspect`), so no decoder is asked to allocate for a decompression bomb; the decoder's
 *    own resolution and memory caps are a second fence.
 *  - ORIENTATION: a JPEG's EXIF orientation (IFD0 tag 0x0112) is applied to the pixels, then
 *    dropped with the rest of the metadata.
 *  - NO METADATA in a derivative, by construction: `jpeg-js` writes a JFIF header and the scan,
 *    nothing else (no EXIF, GPS, XMP, IPTC or ICC). Transparency is flattened onto white.
 *  - Downscale by area averaging (no upscale): the display from the decoded image, the thumbnail
 *    from the display.
 *
 * Synchronous on purpose (one decode at a time per process; its memory is released before the next
 * request's). The cost — the event loop is held for the decode, about two seconds for a 12-megapixel
 * JPEG — is ADR-132 Am. 3's recorded "bad"; clients downscale before upload (P22-02).
 *
 * Named exports only.
 */
import { decode as decodeJpeg, encode as encodeJpeg } from "jpeg-js";
import { PNG } from "pngjs";
import { MAX_IMAGE_PIXELS } from "../../constants/upstreamFileImport";
import { DEVICE_PHOTO_DISPLAY_PX, DEVICE_PHOTO_THUMB_PX } from "@callibrator/contracts/deviceValues";

/** An RGBA raster. */
export interface Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** The two derivatives, JPEG-encoded and metadata-free. */
export interface Derivatives {
  readonly display: Buffer;
  readonly thumb: Buffer;
  readonly width: number;
  readonly height: number;
}

/** JPEG qualities (08 § 4.1: q ≈ 80 for the display). */
const DISPLAY_QUALITY = 80;
const THUMB_QUALITY = 75;
/** The decoder's own memory fence, above what a 50-megapixel RGBA raster and its components need. */
const DECODER_MEMORY_MB = 700;

/** A channel value; every index read here is inside the raster (checked by its dimensions). */
const px = (data: Uint8Array, index: number): number => data[index] as number;

/** Thrown when the pixels do not decode: the caller answers PHOTO_UNDECODABLE. */
export class UndecodableImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndecodableImageError";
  }
}

/**
 * The EXIF orientation (1 – 8) of a JPEG, or 1 when it carries none or it cannot be read.
 *
 * @param buf - the JPEG's bytes
 */
export const jpegOrientation = (buf: Buffer): number => {
  let at = 2;
  while (at + 4 <= buf.length && buf[at] === 0xff) {
    const marker = buf[at + 1];
    if (marker === 0xda || marker === 0xd9) {
      return 1;
    }
    const length = buf.readUInt16BE(at + 2);
    const payload = at + 4;
    if (marker === 0xe1 && buf.toString("latin1", payload, payload + 6) === "Exif\0\0") {
      const tiff = payload + 6;
      if (tiff + 8 > buf.length) {
        return 1;
      }
      const le = buf.toString("latin1", tiff, tiff + 2) === "II";
      const u16 = (p: number): number => (le ? buf.readUInt16LE(p) : buf.readUInt16BE(p));
      const u32 = (p: number): number => (le ? buf.readUInt32LE(p) : buf.readUInt32BE(p));
      const ifd0 = tiff + u32(tiff + 4);
      if (ifd0 + 2 > buf.length) {
        return 1;
      }
      const count = u16(ifd0);
      for (let i = 0; i < count; i += 1) {
        const entry = ifd0 + 2 + i * 12;
        if (entry + 12 > buf.length) {
          return 1;
        }
        if (u16(entry) === 0x0112) {
          const value = u16(entry + 8);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    at += 2 + length;
  }
  return 1;
};

/** Decode a JPEG or a PNG to RGBA; refuse anything that does not decode strictly. */
export const decodeImage = (type: "jpeg" | "png", buf: Buffer): Raster => {
  try {
    if (type === "jpeg") {
      const decoded = decodeJpeg(buf, {
        useTArray: true,
        formatAsRGBA: true,
        tolerantDecoding: false,
        maxResolutionInMP: MAX_IMAGE_PIXELS / 1_000_000,
        maxMemoryUsageInMB: DECODER_MEMORY_MB,
      });
      return { width: decoded.width, height: decoded.height, data: decoded.data };
    }
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  } catch (err) {
    throw new UndecodableImageError(String(err));
  }
};

/**
 * Downscale by area averaging so the longest side is at most `max` (never upscaled), flattening
 * transparency onto white.
 */
export const fitWithin = (src: Raster, max: number): Raster => {
  const scale = Math.min(1, max / Math.max(src.width, src.height));
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(src.height * scale));
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor((y * src.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * src.height) / height));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor((x * src.width) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * src.width) / width));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        let p = (sy * src.width + x0) * 4;
        for (let sx = x0; sx < x1; sx += 1) {
          const a = px(src.data, p + 3) / 255;
          r += px(src.data, p) * a + 255 * (1 - a);
          g += px(src.data, p + 1) * a + 255 * (1 - a);
          b += px(src.data, p + 2) * a + 255 * (1 - a);
          n += 1;
          p += 4;
        }
      }
      const o = (y * width + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = 255;
    }
  }
  return { width, height, data: out };
};

/**
 * Apply an EXIF orientation (1 – 8) to a raster: the result is upright and needs no tag.
 *
 * For each destination pixel, the source pixel it shows (orientations 5 – 8 swap the sides).
 */
export const applyOrientation = (src: Raster, orientation: number): Raster => {
  if (orientation <= 1 || orientation > 8) {
    return src;
  }
  const swap = orientation >= 5;
  const width = swap ? src.height : src.width;
  const height = swap ? src.width : src.height;
  const out = new Uint8Array(width * height * 4);
  const w = src.width;
  const h = src.height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sx: number;
      let sy: number;
      switch (orientation) {
        case 2: sx = w - 1 - x; sy = y; break;
        case 3: sx = w - 1 - x; sy = h - 1 - y; break;
        case 4: sx = x; sy = h - 1 - y; break;
        case 5: sx = y; sy = x; break;
        case 6: sx = y; sy = h - 1 - x; break;
        case 7: sx = w - 1 - y; sy = h - 1 - x; break;
        default: sx = w - 1 - y; sy = x; break; // 8
      }
      const s = (sy * w + sx) * 4;
      const o = (y * width + x) * 4;
      out[o] = px(src.data, s);
      out[o + 1] = px(src.data, s + 1);
      out[o + 2] = px(src.data, s + 2);
      out[o + 3] = px(src.data, s + 3);
    }
  }
  return { width, height, data: out };
};

const toJpeg = (raster: Raster, quality: number): Buffer =>
  encodeJpeg({ width: raster.width, height: raster.height, data: raster.data }, quality).data;

/**
 * The display (longest side 1,600 px) and thumbnail (320 px) derivatives of a JPEG or PNG.
 *
 * @throws {UndecodableImageError} when the pixels do not decode
 */
export const buildDerivatives = (type: "jpeg" | "png", buf: Buffer): Derivatives => {
  const decoded = decodeImage(type, buf);
  const orientation = type === "jpeg" ? jpegOrientation(buf) : 1;
  const display = applyOrientation(fitWithin(decoded, DEVICE_PHOTO_DISPLAY_PX), orientation);
  const thumb = fitWithin(display, DEVICE_PHOTO_THUMB_PX);
  return {
    display: toJpeg(display, DISPLAY_QUALITY),
    thumb: toJpeg(thumb, THUMB_QUALITY),
    width: display.width,
    height: display.height,
  };
};
