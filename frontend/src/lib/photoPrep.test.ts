/** @jest-environment jsdom */
/**
 * P22-02 (ADR-132 Am. 3) — a register photo prepared in the browser: HEIC detected by type, name or
 * `ftyp` brand; the long edge downscaled, never upscaled; always a JPEG; each failure named
 * (`heic_unreadable`, `not_an_image`, `unreadable`); the browser codec's canvas steps.
 */
import { browserCodec, fitWithin, isHeic, jpegName, MAX_EDGE_PX, PhotoPrepError, preparePhoto, type PhotoCodec } from "./photoPrep";

const ftyp = (brand: string) => new Uint8Array([0, 0, 0, 24, ...[..."ftyp"].map((c) => c.charCodeAt(0)), ...[...brand].map((c) => c.charCodeAt(0))]);

const codec = (width = 4000, height = 3000): PhotoCodec & { encode: jest.Mock; decode: jest.Mock; close: jest.Mock } => {
  const close = jest.fn();
  return {
    close,
    decode: jest.fn(async () => ({ image: {} as CanvasImageSource, width, height, close })),
    encode: jest.fn(async () => new Blob(["jpeg"], { type: "image/jpeg" })),
  };
};

describe("photoPrep (P22-02)", () => {
  it("isHeic: by type, by name, by ftyp brand; a JPEG and a short file are not", async () => {
    expect(await isHeic(new File(["x"], "a.bin", { type: "image/heic" }))).toBe(true);
    expect(await isHeic(new File(["x"], "IMG_1.HEIF", { type: "" }))).toBe(true);
    expect(await isHeic(new File([ftyp("heic")], "a", { type: "" }))).toBe(true);
    expect(await isHeic(new File([ftyp("isom")], "a.mp4", { type: "" }))).toBe(false);
    expect(await isHeic(new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])], "a.jpg", { type: "image/jpeg" }))).toBe(false);
    expect(await isHeic(new File(["ab"], "a", { type: "" }))).toBe(false);
  });

  it("isHeic reads the head through Blob#arrayBuffer where the browser has it", async () => {
    const bytes = ftyp("mif1");
    const blob = { type: "", name: "x", slice: () => ({ arrayBuffer: async () => bytes.buffer }) } as unknown as Blob;
    expect(await isHeic(blob)).toBe(true);
  });

  it("fitWithin keeps the long edge at most the maximum, never upscales", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: MAX_EDGE_PX, height: 1536 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1536, height: MAX_EDGE_PX });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(10000, 1, 100)).toEqual({ width: 100, height: 1 });
  });

  it("jpegName keeps the stem", () => {
    expect(jpegName("IMG_0001.HEIC")).toBe("IMG_0001.jpg");
    expect(jpegName("")).toBe("photo.jpg");
    expect(jpegName(undefined)).toBe("photo.jpg");
  });

  it("decodes, downscales and re-encodes as a JPEG File, closing the bitmap", async () => {
    const c = codec();
    const out = await preparePhoto(new File(["x"], "front.png", { type: "image/png" }), c);
    expect(out.type).toBe("image/jpeg");
    expect(out.name).toBe("front.jpg");
    expect(c.encode).toHaveBeenCalledWith(expect.anything(), MAX_EDGE_PX, 1536, 0.85);
    expect(c.close).toHaveBeenCalled();
  });

  it("converts a HEIC the browser can decode", async () => {
    const out = await preparePhoto(new File([ftyp("heic")], "IMG.HEIC", { type: "image/heic" }), codec(1200, 900));
    expect(out.name).toBe("IMG.jpg");
  });

  it("names each failure", async () => {
    await expect(preparePhoto(new File(["x"], "a.pdf", { type: "application/pdf" }), codec())).rejects.toEqual(new PhotoPrepError("not_an_image"));
    const heicFails = codec();
    heicFails.decode.mockRejectedValueOnce(new Error("no decoder"));
    await expect(preparePhoto(new File(["x"], "a.heic", { type: "image/heic" }), heicFails)).rejects.toMatchObject({ reason: "heic_unreadable" });
    const jpgFails = codec();
    jpgFails.decode.mockRejectedValueOnce(new Error("corrupt"));
    await expect(preparePhoto(new File(["x"], "a.jpg", { type: "image/jpeg" }), jpgFails)).rejects.toMatchObject({ reason: "unreadable" });
    const encodeFails = codec();
    encodeFails.encode.mockRejectedValueOnce(new Error("no canvas"));
    await expect(preparePhoto(new File(["x"], "a.jpg", { type: "image/jpeg" }), encodeFails)).rejects.toMatchObject({ reason: "unreadable" });
    expect(encodeFails.close).toHaveBeenCalled();
  });

  describe("browserCodec", () => {
    const original = { createImageBitmap: (globalThis as { createImageBitmap?: unknown }).createImageBitmap };
    afterEach(() => {
      (globalThis as { createImageBitmap?: unknown }).createImageBitmap = original.createImageBitmap;
      jest.restoreAllMocks();
    });

    it("decodes with the image's orientation", async () => {
      const close = jest.fn();
      const create = jest.fn(async () => ({ width: 10, height: 20, close }));
      (globalThis as { createImageBitmap?: unknown }).createImageBitmap = create;
      const decoded = await browserCodec.decode(new Blob(["x"]));
      expect(create).toHaveBeenCalledWith(expect.any(Blob), { imageOrientation: "from-image" });
      expect([decoded.width, decoded.height]).toEqual([10, 20]);
      decoded.close();
      expect(close).toHaveBeenCalled();
    });

    it("draws on a white canvas and encodes a JPEG; no context or no blob fails", async () => {
      const context = { fillRect: jest.fn(), drawImage: jest.fn(), fillStyle: "" };
      const getContext = jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
      const toBlob = jest
        .spyOn(HTMLCanvasElement.prototype, "toBlob")
        .mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback, type?: string) {
          cb(new Blob(["j"], { type }));
        });
      const blob = await browserCodec.encode({} as CanvasImageSource, 4, 3, 0.85);
      expect(blob.type).toBe("image/jpeg");
      expect(context.fillStyle).toBe("#fff");
      expect(context.drawImage).toHaveBeenCalledWith({}, 0, 0, 4, 3);

      toBlob.mockImplementation((cb: BlobCallback) => cb(null));
      await expect(browserCodec.encode({} as CanvasImageSource, 4, 3, 0.85)).rejects.toThrow("encode failed");
      getContext.mockReturnValue(null);
      await expect(browserCodec.encode({} as CanvasImageSource, 4, 3, 0.85)).rejects.toThrow("no 2d context");
    });
  });
});
