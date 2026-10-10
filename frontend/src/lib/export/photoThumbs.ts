/**
 * P22-06 (`docs/UPSTREAM/09-REPORT-LAYOUTS.md` § 3.3) — the inventory PDF's photos: each device
 * photo's **thumbnail derivative** (P21-02b; never the original), fetched through a short-lived
 * signed link as a SAME-ORIGIN path (the page's CSP `connect-src 'self'`), at most
 * `PHOTO_CONCURRENCY` at a time, and down-scaled in the browser to `PHOTO_PX` for the cell. A photo
 * that cannot be had prints as "-"; it never fails the export.
 */
import { deviceRegisterService } from "@/api/services/deviceRegister.service";
import { mapLimited } from "./pagedRead";

/** At most this many photo fetches in flight. */
export const PHOTO_CONCURRENCY = 4;
/** The long edge a thumbnail is drawn at for the PDF cell (40 pt at about 2×). */
export const PHOTO_PX = 80;

export interface ThumbCodec {
  /** The bytes of a same-origin path. */
  fetchBytes: (path: string) => Promise<Blob>;
  /** A JPEG data URL of the image, its long edge at most `px`. */
  toJpegDataUrl: (blob: Blob, px: number) => Promise<string>;
}

export const browserThumbCodec: ThumbCodec = {
  fetchBytes: async (path) => {
    const response = await fetch(path, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
    return response.blob();
  },
  toJpegDataUrl: async (blob, px) => {
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, px / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no 2d context");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.7);
    } finally {
      bitmap.close();
    }
  },
};

/** The thumbnails of `ids` (duplicates read once), by id; the ones that failed are absent. */
export const loadThumbnails = async (
  ids: readonly string[],
  options: { signal?: AbortSignal; onDone?: (done: number, total: number) => void; codec?: ThumbCodec } = {},
): Promise<Map<string, string>> => {
  const codec = options.codec ?? browserThumbCodec;
  const unique = [...new Set(ids)];
  const urls = await mapLimited(
    unique,
    PHOTO_CONCURRENCY,
    async (id) => codec.toJpegDataUrl(await codec.fetchBytes(await deviceRegisterService.photoLink(id, "thumb")), PHOTO_PX),
    { signal: options.signal, onDone: (done) => options.onDone?.(done, unique.length) },
  );
  const out = new Map<string, string>();
  unique.forEach((id, i) => {
    const url = urls[i];
    if (url) out.set(id, url);
  });
  return out;
};
