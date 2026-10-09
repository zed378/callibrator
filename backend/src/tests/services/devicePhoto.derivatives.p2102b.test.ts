/**
 * P21-02b — the device photo derivatives (ADR-132 Am. 3; docs/UPSTREAM/08-FILE-POLICY.md § 4.1):
 * decoded and re-encoded in pure JavaScript, upright, downscaled, and carrying NO metadata.
 *
 * REAL: imageDerivatives and derivativeKeys, over synthetic JPEGs and PNGs (fixtures/photoFixtures).
 */
import { decode as decodeJpeg } from "jpeg-js";
import {
  UndecodableImageError,
  applyOrientation,
  buildDerivatives,
  decodeImage,
  fitWithin,
  jpegOrientation,
  type Raster,
} from "../../services/devicePhoto/imageDerivatives";
import { derivativeKeyOf, derivativeKeysOf, hasDerivatives } from "../../services/devicePhoto/derivativeKeys";
import { GPS_MARKER, exifSegment, jpeg, png } from "../fixtures/photoFixtures";

/** The markers a JPEG's header carries before its scan. */
const markersOf = (buf: Buffer): number[] => {
  const out: number[] = [];
  let at = 2;
  while (at + 4 <= buf.length && buf[at] === 0xff) {
    const marker = buf[at + 1] as number;
    out.push(marker);
    if (marker === 0xda) {
      break;
    }
    at += 2 + buf.readUInt16BE(at + 2);
  }
  return out;
};

/** A 3 × 2 raster whose pixels are numbered 0 … 5 in the red channel. */
const numbered = (): Raster => {
  const data = new Uint8Array(3 * 2 * 4);
  for (let i = 0; i < 6; i += 1) {
    data[i * 4] = i;
    data[i * 4 + 3] = 255;
  }
  return { width: 3, height: 2, data };
};
const reds = (r: Raster): number[] => Array.from({ length: r.width * r.height }, (_, i) => r.data[i * 4] as number);

describe("the derivatives carry no metadata (08 § 4.1)", () => {
  it("a JPEG with EXIF (orientation, GPS): display ≤ 1,600 px and thumb ≤ 320 px, JFIF only, no GPS bytes", () => {
    const source = jpeg(2000, 1000, [exifSegment({ orientation: 1 })]);
    expect(source.includes(GPS_MARKER)).toBe(true);
    const d = buildDerivatives("jpeg", source);
    for (const out of [d.display, d.thumb]) {
      expect(markersOf(out).filter((m) => m >= 0xe1 && m <= 0xef)).toEqual([]);
      expect(out.includes(Buffer.from("Exif", "latin1"))).toBe(false);
      expect(out.includes(GPS_MARKER)).toBe(false);
    }
    const display = decodeJpeg(d.display);
    const thumb = decodeJpeg(d.thumb);
    expect([display.width, display.height, thumb.width, thumb.height, d.width, d.height]).toEqual([1600, 800, 320, 160, 1600, 800]);
  });

  it("orientation 6 is applied: a landscape sensor image comes out portrait", () => {
    const d = buildDerivatives("jpeg", jpeg(400, 200, [exifSegment({ orientation: 6, bigEndian: true })]));
    expect([d.width, d.height]).toEqual([200, 400]);
  });

  it("a PNG with a text chunk and transparency: flattened, JPEG-encoded, nothing kept; a small image is not upscaled", () => {
    const d = buildDerivatives("png", png(200, 100, { text: true, alpha: 0 }));
    const display = decodeJpeg(d.display);
    expect([display.width, display.height]).toEqual([200, 100]);
    // Fully transparent → white.
    expect(Array.from(display.data.subarray(0, 3)).every((v) => v > 245)).toBe(true);
    expect(d.display.includes(Buffer.from("synthetic lab", "latin1"))).toBe(false);
  });

  it("pixels that do not decode are UndecodableImageError (the polyglot guard), for either type", () => {
    const good = jpeg(64, 64);
    const corrupt = Buffer.concat([good.subarray(0, good.length - 200), Buffer.alloc(198, 0xff), Buffer.from([0xff, 0xd9])]);
    expect(() => decodeImage("jpeg", corrupt)).toThrow(UndecodableImageError);
    expect(() => decodeImage("png", Buffer.from("not a png at all"))).toThrow(UndecodableImageError);
  });
});

describe("orientation and scaling", () => {
  it.each([
    [1, [0, 1, 2, 3, 4, 5], [3, 2]],
    [2, [2, 1, 0, 5, 4, 3], [3, 2]],
    [3, [5, 4, 3, 2, 1, 0], [3, 2]],
    [4, [3, 4, 5, 0, 1, 2], [3, 2]],
    [5, [0, 3, 1, 4, 2, 5], [2, 3]],
    [6, [3, 0, 4, 1, 5, 2], [2, 3]],
    [7, [5, 2, 4, 1, 3, 0], [2, 3]],
    [8, [2, 5, 1, 4, 0, 3], [2, 3]],
    [9, [0, 1, 2, 3, 4, 5], [3, 2]],
  ])("orientation %i maps the pixels as EXIF defines", (orientation, expected, size) => {
    const out = applyOrientation(numbered(), orientation);
    expect([reds(out), [out.width, out.height]]).toEqual([expected, size]);
  });

  it("fitWithin averages areas and never upscales", () => {
    const src: Raster = { width: 2, height: 1, data: new Uint8Array([0, 0, 0, 255, 200, 100, 50, 255]) };
    expect(Array.from(fitWithin(src, 1).data)).toEqual([100, 50, 25, 255]);
    expect(fitWithin(src, 10)).toMatchObject({ width: 2, height: 1 });
  });
});

describe("jpegOrientation reads IFD0's tag and nothing else", () => {
  const withSegment = (segment: Buffer): Buffer => Buffer.concat([Buffer.from([0xff, 0xd8]), segment, Buffer.from([0xff, 0xda, 0, 2])]);
  const exifHead = (tiff: Buffer): Buffer => {
    const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
    const head = Buffer.from([0xff, 0xe1, 0, 0]);
    head.writeUInt16BE(payload.length + 2, 2);
    return Buffer.concat([head, payload]);
  };

  it("a tag present (LE and BE), absent, out of range, or unreadable", () => {
    expect(jpegOrientation(withSegment(exifSegment({ orientation: 3 })))).toBe(3);
    expect(jpegOrientation(withSegment(exifSegment({ orientation: 8, bigEndian: true })))).toBe(8);
    expect(jpegOrientation(withSegment(exifSegment({ orientation: 0 })))).toBe(1);
    expect(jpegOrientation(withSegment(exifSegment({ orientation: 9 })))).toBe(1);
    // No EXIF before the scan; an EOI first; no marker at all.
    expect(jpegOrientation(jpeg(8, 8))).toBe(1);
    expect(jpegOrientation(Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0, 0]))).toBe(1);
    expect(jpegOrientation(Buffer.from([0xff, 0xd8, 0x00]))).toBe(1);
  });

  it("a truncated TIFF, an IFD0 past the end, an entry past the end, an IFD0 without the tag", () => {
    expect(jpegOrientation(Buffer.concat([Buffer.from([0xff, 0xd8]), exifHead(Buffer.from("II*\0", "latin1"))]))).toBe(1);
    const farIfd = Buffer.from("II*\0\xff\xff\x00\x00", "latin1");
    expect(jpegOrientation(withSegment(exifHead(farIfd)))).toBe(1);
    const shortEntries = Buffer.concat([Buffer.from("II*\0\x08\x00\x00\x00", "latin1"), Buffer.from([5, 0])]);
    expect(jpegOrientation(Buffer.concat([Buffer.from([0xff, 0xd8]), exifHead(shortEntries)]))).toBe(1);
    const noTag = Buffer.concat([Buffer.from("II*\0\x08\x00\x00\x00", "latin1"), Buffer.from([1, 0, 0x0f, 0x01, 2, 0, 1, 0, 0, 0, 0, 0, 0, 0]), Buffer.alloc(4)]);
    expect(jpegOrientation(withSegment(exifHead(noTag)))).toBe(1);
  });
});

describe("derivative keys (08 § 7)", () => {
  it("beside the original, the extension replaced; only device photos have them", () => {
    const key = "t/a/f/b/attachments/1234.png";
    expect(derivativeKeyOf(key, "display")).toBe("t/a/f/b/attachments/1234.display.jpg");
    expect(derivativeKeysOf(key)).toEqual(["t/a/f/b/attachments/1234.display.jpg", "t/a/f/b/attachments/1234.thumb.jpg"]);
    expect([hasDerivatives("device_front"), hasDerivatives("device_other"), hasDerivatives("ipm_evidence"), hasDerivatives(null), hasDerivatives(undefined)]).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});
