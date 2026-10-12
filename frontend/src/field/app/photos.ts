/**
 * P22-10c1 — a photo taken into the field app (P19-08 § 8.1), before it is sealed into the store:
 *
 *  1. refused above 25 MB before decoding (the server's limit is the authority);
 *  2. refused when the phone is almost full — under 50 MB or under 10 % of the quota free — so a
 *     write never fails half-way ("sync, or free space");
 *  3. decoded, oriented, downscaled to 2048 px and re-encoded as a JPEG by `lib/photoPrep.ts`
 *     (P22-02), which drops every metadata block (EXIF, GPS) before the bytes are stored.
 *
 * A HEIC the browser cannot decode is REFUSED (`heic_unreadable`), not queued as is: since ADR-132
 * Am. 3 the server takes JPEG and PNG only, so the "queue the original" path of P19-08 § 8.1 step 4
 * would only move the refusal to the sync (ADR-127 Am. 3 § 3).
 */
import { preparePhoto, PhotoPrepError, type PhotoCodec } from "@/lib/photoPrep";

export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const MIN_FREE_BYTES = 50 * 1024 * 1024;
export const MIN_FREE_RATIO = 0.1;

export type PhotoRefusal = "too_large" | "storage_full" | "heic_unreadable" | "not_an_image" | "unreadable";

export type AdmittedPhoto = { readonly ok: true; readonly file: File } | { readonly ok: false; readonly reason: PhotoRefusal };

/** Whether the phone has room (unknown quota = room: the browser will refuse the write itself). */
export const hasRoom = (estimate: { usage?: number; quota?: number } | null): boolean => {
  if (!estimate || typeof estimate.quota !== "number" || typeof estimate.usage !== "number") return true;
  const free = estimate.quota - estimate.usage;
  return free >= MIN_FREE_BYTES && free >= estimate.quota * MIN_FREE_RATIO;
};

export async function admitPhoto(file: File, estimate: () => Promise<{ usage?: number; quota?: number } | null>, codec?: PhotoCodec): Promise<AdmittedPhoto> {
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, reason: "too_large" };
  let room: { usage?: number; quota?: number } | null = null;
  try {
    room = await estimate();
  } catch {
    room = null;
  }
  if (!hasRoom(room)) return { ok: false, reason: "storage_full" };
  try {
    return { ok: true, file: await preparePhoto(file, codec) };
  } catch (err) {
    return { ok: false, reason: err instanceof PhotoPrepError ? err.reason : "unreadable" };
  }
}
