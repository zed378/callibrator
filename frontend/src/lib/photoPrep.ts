/**
 * P22-02 (ADR-132 Am. 3; P19-03 spec § 7.2) — a register photo made ready for upload IN THE
 * BROWSER: the server takes JPEG and PNG only (HEIC/HEIF is refused 415 `PHOTO_HEIC_UNSUPPORTED`,
 * it has no HEVC decoder) and its pure-JavaScript decode holds the event loop about 2 s per
 * 12 megapixels. So every photo is decoded by the browser, orientation applied, downscaled to at
 * most `MAX_EDGE_PX` on its long edge and re-encoded as a JPEG — which also drops every metadata
 * block (EXIF, GPS) before the file leaves the device.
 *
 * HEIC: a browser that can decode it (Safari / iOS, where HEIC photos come from) converts it here;
 * iOS also hands a JPEG to a file input whose `accept` names no HEIC. A browser that cannot decode
 * it answers `heic_unreadable`, which the page explains (no WASM HEVC decoder is shipped: the same
 * patent and size reasons as the server's, ADR-132 Am. 3).
 */

/** The long edge a photo is downscaled to: above the server's 1,600 px display copy, well under its limits. */
export const MAX_EDGE_PX = 2048;
/** The JPEG quality of the re-encode. */
export const JPEG_QUALITY = 0.85;
/** What the file input offers (no HEIC: iOS then converts at pick time). */
export const PHOTO_ACCEPT = "image/jpeg,image/png";

/** Why a photo could not be prepared. */
export type PhotoPrepFailure = "heic_unreadable" | "not_an_image" | "unreadable";

export class PhotoPrepError extends Error {
  constructor(readonly reason: PhotoPrepFailure) {
    super(reason);
    this.name = "PhotoPrepError";
  }
}

const HEIC_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "avif"];

/** The first `count` bytes of a blob (through a FileReader where `Blob#arrayBuffer` is missing, as in older WebViews). */
const firstBytes = async (blob: Blob, count: number): Promise<Uint8Array> => {
  const part = blob.slice(0, count);
  if (typeof part.arrayBuffer === "function") return new Uint8Array(await part.arrayBuffer());
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsArrayBuffer(part);
  });
};

/** Whether the file is HEIC/HEIF, by its declared type, its name or its `ftyp` brand. */
export const isHeic = async (file: Blob & { name?: string }): Promise<boolean> => {
  if (/^image\/hei[cf]/i.test(file.type)) return true;
  if (file.name && /\.hei[cf]$/i.test(file.name)) return true;
  const head = await firstBytes(file, 12);
  if (head.length < 12) return false;
  const box = String.fromCharCode(...head.slice(4, 8));
  const brand = String.fromCharCode(...head.slice(8, 12));
  return box === "ftyp" && HEIC_BRANDS.includes(brand);
};

/** The size a `width` × `height` image is drawn at: the long edge at most `max`, never upscaled. */
export const fitWithin = (width: number, height: number, max: number = MAX_EDGE_PX): { width: number; height: number } => {
  const long = Math.max(width, height);
  if (long <= max) return { width, height };
  const scale = max / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
};

/** The JPEG's name: the original's stem, or `photo`. */
export const jpegName = (name: string | undefined): string => {
  const stem = (name ?? "").replace(/\.[^.]*$/, "").trim();
  return `${stem || "photo"}.jpg`;
};

/** The browser's own decoders, injectable so the steps above are testable without a canvas. */
export interface PhotoCodec {
  decode: (file: Blob) => Promise<{ image: CanvasImageSource; width: number; height: number; close: () => void }>;
  encode: (image: CanvasImageSource, width: number, height: number, quality: number) => Promise<Blob>;
}

export const browserCodec: PhotoCodec = {
  decode: async (file) => {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  },
  encode: async (image, width, height, quality) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    // A PNG's transparency becomes white, as the server's own derivatives flatten it.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))), "image/jpeg", quality);
    });
  },
};

/**
 * The photo, decoded, downscaled and re-encoded as a JPEG `File`.
 *
 * @throws PhotoPrepError `heic_unreadable` (a HEIC this browser cannot decode), `not_an_image`,
 *   `unreadable` (an image the browser could not decode or encode)
 */
export const preparePhoto = async (file: File, codec: PhotoCodec = browserCodec): Promise<File> => {
  const heic = await isHeic(file);
  if (!heic && file.type !== "" && !file.type.startsWith("image/")) throw new PhotoPrepError("not_an_image");
  let decoded: Awaited<ReturnType<PhotoCodec["decode"]>>;
  try {
    decoded = await codec.decode(file);
  } catch {
    throw new PhotoPrepError(heic ? "heic_unreadable" : "unreadable");
  }
  try {
    const size = fitWithin(decoded.width, decoded.height);
    const blob = await codec.encode(decoded.image, size.width, size.height, JPEG_QUALITY);
    return new File([blob], jpegName(file.name), { type: "image/jpeg" });
  } catch {
    throw new PhotoPrepError("unreadable");
  } finally {
    decoded.close();
  }
};
