/**
 * What a migrated photo is, and its location metadata removed losslessly
 * (services/upstreamFileImport/imageInspect.ts; docs/UPSTREAM/08-FILE-POLICY.md § 3, § 4).
 * Every file here is SYNTHETIC (tests/support/syntheticImages.ts).
 */
import {
  detectImageType,
  extensionOf,
  inspectJpeg,
  inspectPng,
  mimeOf,
  stripExifGps,
} from "../../../services/upstreamFileImport/imageInspect";
import {
  exifPayload,
  syntheticHeic,
  syntheticJpeg,
  syntheticPng,
  syntheticShellScript,
  syntheticTextFile,
} from "../../support/syntheticImages";

/** The bytes from the SOS marker to the end: the image data, which must be copied untouched. */
const scanOf = (jpeg: Buffer): Buffer => jpeg.subarray(jpeg.indexOf(Buffer.from([0xff, 0xda])));

/** The GPS rationals' bytes (1/1, 2/1, 3/1) in little-endian, as the synthetic EXIF writes them. */
const GPS_BYTES = Buffer.from([1, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 3, 0, 0, 0, 1, 0, 0, 0]);

describe("detectImageType — magic bytes, never the extension", () => {
  it.each([
    ["JPEG", syntheticJpeg(), "jpeg"],
    ["PNG", syntheticPng(), "png"],
    ["HEIC (major brand)", syntheticHeic(), "heic"],
  ])("%s", (_label, bytes, type) => {
    expect(detectImageType(bytes)).toBe(type);
  });

  it("HEIC by a compatible brand (major brand not HEIF)", () => {
    const heic = syntheticHeic();
    heic.write("isom", 8, "latin1");
    expect(detectImageType(heic)).toBe("heic");
  });

  it.each([
    ["a shell script", syntheticShellScript()],
    ["a text file", syntheticTextFile()],
    ["an SVG", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>')],
    ["an AVIF (ftyp avif, no HEIF brand)", Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from("ftypavif\0\0\0\0avis", "latin1"), Buffer.alloc(64)])],
    ["an MP4 (ftyp isom)", Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from("ftypisom\0\0\0\0isomiso2", "latin1"), Buffer.alloc(64)])],
    ["a PDF", Buffer.from("%PDF-1.7\n%synthetic")],
    ["empty", Buffer.alloc(0)],
    ["a tiny ftyp box", Buffer.concat([Buffer.from([0, 0, 0, 8]), Buffer.from("ftypheic", "latin1"), Buffer.alloc(8)])],
  ])("refuses %s", (_label, bytes) => {
    expect(detectImageType(bytes)).toBeNull();
  });

  it("names the stored extension and MIME type from the detected type", () => {
    expect([extensionOf("jpeg"), extensionOf("png"), extensionOf("heic")]).toEqual(["jpg", "png", "heic"]);
    expect([mimeOf("jpeg"), mimeOf("png"), mimeOf("heic")]).toEqual(["image/jpeg", "image/png", "image/heic"]);
  });
});

describe("inspectJpeg", () => {
  it("empties the GPS IFD, keeps the rest of EXIF and copies the image data byte for byte", () => {
    const source = syntheticJpeg({ gps: true });
    expect(source.includes(GPS_BYTES)).toBe(true);
    const result = inspectJpeg(source);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result).toMatchObject({ width: 640, height: 480, stripped: true });
    expect(result.bytes.includes(GPS_BYTES)).toBe(false);
    expect(result.bytes.includes(Buffer.from("S\0\0\0", "latin1"))).toBe(false);
    expect(result.bytes.includes(Buffer.from("Exif\0\0", "latin1"))).toBe(true);
    // Orientation (0x0112, SHORT, 1, value 6) survives.
    expect(result.bytes.includes(Buffer.from([0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0]))).toBe(true);
    expect(scanOf(result.bytes).equals(scanOf(source))).toBe(true);
    expect(result.bytes.length).toBe(source.length);
  });

  it("handles big-endian EXIF the same way", () => {
    const result = inspectJpeg(syntheticJpeg({ gps: true, bigEndianExif: true }));
    expect(result.ok && result.stripped).toBe(true);
  });

  it("drops XMP, Photoshop/IPTC and comment segments whole", () => {
    const source = syntheticJpeg({ xmp: true, iptc: true, comment: true });
    const result = inspectJpeg(source);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.stripped).toBe(true);
    for (const marker of ["http://ns.adobe.com/xap", "Photoshop 3.0", "synthetic comment"]) {
      expect(result.bytes.includes(Buffer.from(marker, "latin1"))).toBe(false);
    }
    expect(scanOf(result.bytes).equals(scanOf(source))).toBe(true);
  });

  it("a JPEG with EXIF but no GPS is unchanged and not counted as stripped", () => {
    const source = syntheticJpeg();
    const result = inspectJpeg(source);
    expect(result.ok && result.stripped).toBe(false);
    expect(result.ok && result.bytes.equals(source)).toBe(true);
  });

  it("keeps a trailer after EOI", () => {
    const result = inspectJpeg(syntheticJpeg({ trailer: Buffer.from("SEFT-synthetic") }));
    expect(result.ok).toBe(true);
  });

  it("EXIF that cannot be parsed is dropped whole (never kept unchecked)", () => {
    const source = syntheticJpeg({ gps: true });
    const tiffAt = source.indexOf(Buffer.from("Exif\0\0", "latin1")) + 6;
    source.write("XX", tiffAt, "latin1");
    const result = inspectJpeg(source);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.stripped).toBe(true);
    expect(result.bytes.includes(Buffer.from("Exif\0\0", "latin1"))).toBe(false);
  });

  it("refuses an image beyond the decompression-bomb limits", () => {
    expect(inspectJpeg(syntheticJpeg({ width: 12_001, height: 10 }))).toEqual({ ok: false, reason: "image_too_large" });
    expect(inspectJpeg(syntheticJpeg({ width: 10_000, height: 6_000 }))).toEqual({ ok: false, reason: "image_too_large" });
  });

  describe("structure (the polyglot guard)", () => {
    const valid = syntheticJpeg();
    const sosAt = valid.indexOf(Buffer.from([0xff, 0xda]));
    const sofAt = valid.indexOf(Buffer.from([0xff, 0xc0]));

    it.each([
      ["no SOI", Buffer.concat([Buffer.from([0, 0]), valid.subarray(2)])],
      ["too short", Buffer.from([0xff, 0xd8])],
      ["truncated before the scan", valid.subarray(0, sofAt + 3)],
      ["no EOI after the scan", valid.subarray(0, valid.length - 2)],
      ["a scan before any frame header", Buffer.concat([valid.subarray(0, sofAt), valid.subarray(sosAt)])],
      ["a segment length running past the end", Buffer.concat([valid.subarray(0, 2), Buffer.from([0xff, 0xe0, 0xff, 0xff])])],
      ["a segment length under 2", Buffer.concat([valid.subarray(0, 2), Buffer.from([0xff, 0xe0, 0x00, 0x01, 0, 0])])],
      ["EOI before any scan", Buffer.concat([valid.subarray(0, 2), Buffer.from([0xff, 0xd9, 0, 0])])],
      ["a restart marker before the scan", Buffer.concat([valid.subarray(0, 2), Buffer.from([0xff, 0xd0, 0, 0])])],
      ["a stuffed byte where a marker belongs", Buffer.concat([valid.subarray(0, 2), Buffer.from([0xff, 0x00, 0, 0])])],
      ["a byte that is not a marker", Buffer.concat([valid.subarray(0, 2), Buffer.from([0x12, 0x34, 0, 0])])],
      ["fill bytes running to the end", Buffer.concat([valid.subarray(0, 2), Buffer.from([0xff, 0xff, 0xff, 0xff])])],
      ["a marker with no length", Buffer.concat([valid.subarray(0, 2), Buffer.from([0xff, 0xff, 0xff, 0xe0])])],
      ["a frame header too short", Buffer.concat([valid.subarray(0, 2), Buffer.from([0xff, 0xc0, 0, 4, 8, 0]), valid.subarray(sosAt)])],
      ["zero dimensions", syntheticJpeg({ width: 0, height: 0 })],
    ])("%s → image_undecodable", (_label, bytes) => {
      expect(inspectJpeg(bytes)).toEqual({ ok: false, reason: "image_undecodable" });
    });

    it("tolerates fill bytes before a marker", () => {
      const padded = Buffer.concat([valid.subarray(0, 2), Buffer.from([0xff]), valid.subarray(2)]);
      expect(inspectJpeg(padded).ok).toBe(true);
    });
  });
});

describe("stripExifGps — malformed TIFF answers null", () => {
  const good = exifPayload({ gps: true });

  it.each([
    ["too short", good.subarray(0, 10)],
    ["a wrong byte order", Buffer.concat([good.subarray(0, 6), Buffer.from("XX", "latin1"), good.subarray(8)])],
  ])("%s", (_label, bytes) => {
    expect(stripExifGps(Buffer.from(bytes))).toBeNull();
  });

  it("a wrong TIFF magic", () => {
    const bytes = Buffer.from(good);
    bytes.writeUInt16LE(43, 8);
    expect(stripExifGps(bytes)).toBeNull();
  });

  it("IFD0 outside the payload", () => {
    const bytes = Buffer.from(good);
    bytes.writeUInt32LE(10_000, 10);
    expect(stripExifGps(bytes)).toBeNull();
  });

  it("IFD0 entries running past the end", () => {
    const bytes = Buffer.from(good);
    bytes.writeUInt16LE(500, 14);
    expect(stripExifGps(bytes)).toBeNull();
  });

  it("a GPS pointer outside the payload", () => {
    const bytes = Buffer.from(good);
    // IFD0 at TIFF+8; its 2nd entry (GPSInfo) value at TIFF+8+2+12+8.
    bytes.writeUInt32LE(10_000, 6 + 8 + 2 + 12 + 8);
    expect(stripExifGps(bytes)).toBeNull();
  });

  it("GPS entries running past the end", () => {
    const bytes = Buffer.from(good);
    const gpsAt = 6 + bytes.readUInt32LE(6 + 8 + 2 + 12 + 8);
    bytes.writeUInt16LE(500, gpsAt);
    expect(stripExifGps(bytes)).toBeNull();
  });

  it("a GPS value offset outside the payload is skipped (the entry is still zeroed)", () => {
    const bytes = Buffer.from(good);
    const gpsAt = 6 + bytes.readUInt32LE(6 + 8 + 2 + 12 + 8);
    bytes.writeUInt32LE(10_000, gpsAt + 2 + 12 + 8);
    expect(stripExifGps(bytes)).toBe(true);
    expect(bytes.readUInt16LE(gpsAt)).toBe(0);
  });

  it("an unknown field type is sized as one byte per component", () => {
    const bytes = Buffer.from(good);
    const gpsAt = 6 + bytes.readUInt32LE(6 + 8 + 2 + 12 + 8);
    bytes.writeUInt16LE(99, gpsAt + 2 + 12 + 2);
    expect(stripExifGps(bytes)).toBe(true);
  });

  it("an empty GPS IFD has nothing to remove", () => {
    const bytes = Buffer.from(good);
    const gpsAt = 6 + bytes.readUInt32LE(6 + 8 + 2 + 12 + 8);
    bytes.writeUInt16LE(0, gpsAt);
    expect(stripExifGps(bytes)).toBe(false);
  });

  it("no GPS pointer: nothing to remove", () => {
    expect(stripExifGps(exifPayload({ gps: false }))).toBe(false);
  });
});

describe("inspectPng", () => {
  it("drops eXIf, tEXt and iTXt chunks and keeps every other chunk", () => {
    const source = syntheticPng({ exif: true, text: true });
    const result = inspectPng(source);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result).toMatchObject({ width: 320, height: 240, stripped: true });
    for (const chunk of ["eXIf", "tEXt", "iTXt"]) {
      expect(result.bytes.includes(Buffer.from(chunk, "latin1"))).toBe(false);
    }
    expect(inspectPng(result.bytes)).toMatchObject({ ok: true, stripped: false });
  });

  it("a PNG without metadata is unchanged", () => {
    const source = syntheticPng();
    const result = inspectPng(source);
    expect(result.ok && result.bytes.equals(source)).toBe(true);
  });

  it("refuses an image beyond the limits", () => {
    expect(inspectPng(syntheticPng({ width: 20_000, height: 1 }))).toEqual({ ok: false, reason: "image_too_large" });
  });

  describe("structure", () => {
    const valid = syntheticPng();
    it.each([
      ["no signature", Buffer.concat([Buffer.alloc(8), valid.subarray(8)])],
      ["too short", valid.subarray(0, 6)],
      ["truncated", valid.subarray(0, valid.length - 5)],
      ["a bad CRC", (() => { const b = Buffer.from(valid); b[30] = (b[30] ?? 0) ^ 0xff; return b; })()],
      ["a chunk type that is not letters", (() => { const b = Buffer.from(valid); b.write("I1DR", 12, "latin1"); return b; })()],
      ["a chunk length running past the end", (() => { const b = Buffer.from(valid); b.writeUInt32BE(1_000_000, 8); return b; })()],
      ["IHDR not first", Buffer.concat([valid.subarray(0, 8), valid.subarray(8 + 25)])],
      ["zero dimensions", syntheticPng({ width: 0, height: 5 })],
    ])("%s → image_undecodable", (_label, bytes) => {
      expect(inspectPng(bytes)).toEqual({ ok: false, reason: "image_undecodable" });
    });
  });
});
