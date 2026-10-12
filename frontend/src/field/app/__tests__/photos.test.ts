/**
 * P22-10c1 — a photo admitted into the field app (P19-08 § 8.1): the 25 MB refusal before decoding,
 * the "phone almost full" refusal (under 50 MB or 10 % free), and the re-encode through
 * `lib/photoPrep.ts` (its own suite proves the downscale and the JPEG re-encode); a HEIC the
 * browser cannot decode is refused, not queued (ADR-132 Am. 3).
 */
import type { PhotoCodec } from "@/lib/photoPrep";
import { admitPhoto, hasRoom, MAX_PHOTO_BYTES, MIN_FREE_BYTES } from "../photos";

const codec = (fail = false): PhotoCodec => ({
  decode: async () => {
    if (fail) throw new Error("cannot decode");
    return { image: {} as CanvasImageSource, width: 4000, height: 3000, close: () => undefined };
  },
  encode: async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }),
});

const roomy = async () => ({ usage: 0, quota: 10 * 1024 * 1024 * 1024 });

describe("hasRoom", () => {
  it("needs 50 MB and 10 % free; an unknown quota counts as room", () => {
    expect(hasRoom(null)).toBe(true);
    expect(hasRoom({})).toBe(true);
    expect(hasRoom({ usage: 0, quota: MIN_FREE_BYTES - 1 })).toBe(false);
    expect(hasRoom({ usage: 950, quota: 1000 * 1024 * 1024 })).toBe(true);
    expect(hasRoom({ usage: 950 * 1024 * 1024, quota: 1000 * 1024 * 1024 })).toBe(false);
  });
});

describe("admitPhoto", () => {
  it("re-encodes an admitted photo as a JPEG", async () => {
    const result = await admitPhoto(new File([new Uint8Array([1, 2, 3])], "IMG_1.png", { type: "image/png" }), roomy, codec());
    expect(result.ok).toBe(true);
    expect(result.ok && result.file.type).toBe("image/jpeg");
    expect(result.ok && result.file.name).toBe("IMG_1.jpg");
  });

  it("refuses above 25 MB before decoding, and a full phone", async () => {
    const big = new File([new Uint8Array(1)], "big.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: MAX_PHOTO_BYTES + 1 });
    expect(await admitPhoto(big, roomy, codec())).toEqual({ ok: false, reason: "too_large" });
    expect(await admitPhoto(new File([new Uint8Array(1)], "a.jpg", { type: "image/jpeg" }), async () => ({ usage: 99, quota: 100 }), codec())).toEqual({ ok: false, reason: "storage_full" });
  });

  it("a failing estimate counts as room; an undecodable HEIC and a non-image are refused by reason", async () => {
    const heic = new File([new Uint8Array(12)], "IMG.HEIC", { type: "image/heic" });
    expect(
      await admitPhoto(heic, async () => {
        throw new Error("no estimate");
      }, codec(true)),
    ).toEqual({ ok: false, reason: "heic_unreadable" });
    expect(await admitPhoto(new File(["x"], "a.txt", { type: "text/plain" }), roomy, codec())).toEqual({ ok: false, reason: "not_an_image" });
  });

  it("a read failure outside the codec is 'unreadable'", async () => {
    const broken = new File([new Uint8Array(4)], "a.jpg", { type: "" });
    Object.defineProperty(broken, "slice", { value: () => ({ arrayBuffer: () => Promise.reject(new Error("io")) }) });
    expect(await admitPhoto(broken, roomy, codec())).toEqual({ ok: false, reason: "unreadable" });
  });
});
