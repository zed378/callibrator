/** @jest-environment jsdom */
/**
 * P22-06 — the PDF's photos: each id's THUMBNAIL link (never the original), duplicates read once, the
 * bytes down-scaled to the cell size, a failed photo left out (it prints "-"), progress per photo;
 * the browser codec fetches same-origin with credentials and refuses a non-2xx answer.
 */
import { deviceRegisterService } from "@/api/services/deviceRegister.service";
import { PHOTO_PX, browserThumbCodec, loadThumbnails, type ThumbCodec } from "./photoThumbs";

jest.mock("@/api/services/deviceRegister.service", () => ({
  deviceRegisterService: { photoLink: jest.fn(async (id: string, variant: string) => `/api/v1/attachments/${id}/signed?variant=${variant}`) },
}));

describe("P22-06 — photo thumbnails", () => {
  it("thumb links only, duplicates once, the cell size, a failure left out, progress per photo", async () => {
    const codec: ThumbCodec = {
      fetchBytes: jest.fn(async (path: string) => {
        if (path.includes("bad")) throw new Error("404");
        return new Blob([path]);
      }),
      toJpegDataUrl: jest.fn(async (_blob: Blob, px: number) => `data:image/jpeg;px=${String(px)}`),
    };
    const progress: [number, number][] = [];
    const out = await loadThumbnails(["a", "b", "a", "bad"], { codec, onDone: (d, t) => progress.push([d, t]) });
    expect([...out.entries()]).toEqual([
      ["a", `data:image/jpeg;px=${String(PHOTO_PX)}`],
      ["b", `data:image/jpeg;px=${String(PHOTO_PX)}`],
    ]);
    expect(deviceRegisterService.photoLink).toHaveBeenCalledTimes(3);
    expect(deviceRegisterService.photoLink).toHaveBeenCalledWith("a", "thumb");
    expect(progress.map((p) => p[1])).toEqual([3, 3, 3]);
  });

  it("the browser codec: same-origin fetch, a non-2xx refused", async () => {
    const fetchMock = jest.fn(async () => new Response("x", { status: 200 }));
    Object.assign(global, { fetch: fetchMock });
    await expect(browserThumbCodec.fetchBytes("/p")).resolves.toBeInstanceOf(Blob);
    expect(fetchMock).toHaveBeenCalledWith("/p", { credentials: "same-origin" });
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    await expect(browserThumbCodec.fetchBytes("/p")).rejects.toThrow("HTTP 404");
  });

  it("the browser codec draws the bitmap at most `px` on its long edge, on white, as a JPEG", async () => {
    const close = jest.fn();
    Object.assign(global, { createImageBitmap: jest.fn(async () => ({ width: 400, height: 200, close })) });
    const context = { fillStyle: "", fillRect: jest.fn(), drawImage: jest.fn() };
    const canvas = { width: 0, height: 0, getContext: () => context, toDataURL: jest.fn(() => "data:image/jpeg;x") };
    const create = jest.spyOn(document, "createElement").mockReturnValue(canvas as unknown as HTMLElement);
    await expect(browserThumbCodec.toJpegDataUrl(new Blob(["x"]), 80)).resolves.toBe("data:image/jpeg;x");
    expect([canvas.width, canvas.height]).toEqual([80, 40]);
    expect(context.fillStyle).toBe("#fff");
    expect(canvas.toDataURL).toHaveBeenCalledWith("image/jpeg", 0.7);
    expect(close).toHaveBeenCalled();
    (canvas as { getContext: () => unknown }).getContext = () => null;
    await expect(browserThumbCodec.toJpegDataUrl(new Blob(["x"]), 80)).rejects.toThrow("no 2d context");
    expect(close).toHaveBeenCalledTimes(2);
    create.mockRestore();
  });
});
