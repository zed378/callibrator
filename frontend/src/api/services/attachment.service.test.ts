import { attachmentService } from "./attachment.service";
import { api } from "../client";

jest.mock("../client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedApi = api as jest.Mocked<typeof api>;
const envelope = <T,>(data: T, meta?: unknown) => ({
  success: true,
  status: 200,
  message: "ok",
  data,
  ...(meta ? { meta } : {}),
});

const BASE = "/api/v1/attachments";

describe("attachmentService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getAll", () => {
    it("GETs with default page/limit and no filter params", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope([{ id: "a1" }], {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      );

      const res = await attachmentService.getAll();

      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { page: 1, limit: 10 },
      });
      expect(res.data).toHaveLength(1);
      expect(res.meta.total).toBe(1);
    });

    it("adds resourceType/resourceId params only when provided", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope([]));

      await attachmentService.getAll(2, 5, {
        resourceType: "Certificate",
        resourceId: "c1",
      });

      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: {
          page: 2,
          limit: 5,
          resourceType: "Certificate",
          resourceId: "c1",
        },
      });
    });

    it("falls back to [] and derives meta when data is null", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(null));

      const res = await attachmentService.getAll(3, 25);

      expect(res.data).toEqual([]);
      expect(res.meta).toEqual({
        total: 0,
        page: 3,
        limit: 25,
        totalPages: 1,
      });
    });
  });

  describe("upload", () => {
    it("POSTs a FormData containing file (+ optional fields) and unwraps data", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "a1" }));

      const file = new File(["x"], "doc.pdf", { type: "application/pdf" });
      const res = await attachmentService.upload({
        file,
        resourceType: "Certificate",
        resourceId: "c1",
      });

      const [url, body] = mockedApi.post.mock.calls[0];
      expect(url).toBe(BASE);
      expect(body).toBeInstanceOf(FormData);
      const fd = body as FormData;
      expect(fd.get("file")).toBe(file);
      expect(fd.get("resourceType")).toBe("Certificate");
      expect(fd.get("resourceId")).toBe("c1");
      expect(res).toEqual({ id: "a1" });
    });

    it("omits resourceType/resourceId from FormData when not provided", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "a1" }));

      const file = new File(["x"], "doc.pdf");
      await attachmentService.upload({ file });

      const fd = mockedApi.post.mock.calls[0][1] as FormData;
      expect(fd.get("file")).toBe(file);
      expect(fd.has("resourceType")).toBe(false);
      expect(fd.has("resourceId")).toBe(false);
    });
  });

  describe("getById", () => {
    it("GETs a single attachment and unwraps data", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ id: "a1" }));
      const res = await attachmentService.getById("a1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/a1`);
      expect(res).toEqual({ id: "a1" });
    });
  });

  describe("download", () => {
    it("GETs the download URL with responseType blob and returns the blob directly", async () => {
      const blob = new Blob(["file"], { type: "application/pdf" });
      mockedApi.get.mockResolvedValueOnce(blob);

      const res = await attachmentService.download("a1");

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/a1/download`, {
        responseType: "blob",
      });
      expect(res).toBe(blob);
    });
  });

  describe("downloadToDevice", () => {
    it("downloads and triggers a browser save via an anchor click", async () => {
      const blob = new Blob(["file"], { type: "application/pdf" });
      mockedApi.get.mockResolvedValueOnce(blob);

      const createObjectURL = jest.fn(() => "blob:url");
      const revokeObjectURL = jest.fn();
      (URL as unknown as { createObjectURL: unknown }).createObjectURL =
        createObjectURL;
      (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL =
        revokeObjectURL;

      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});

      await attachmentService.downloadToDevice("a1", "myfile.pdf");

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/a1/download`, {
        responseType: "blob",
      });
      expect(createObjectURL).toHaveBeenCalledWith(blob);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:url");

      clickSpy.mockRestore();
    });
  });

  describe("getSignedUrl", () => {
    it("POSTs { expiresInSec } when a TTL is provided", async () => {
      mockedApi.post.mockResolvedValueOnce(
        envelope({ url: "u", token: "t", expiresAt: "x", expiresInSec: 60 }),
      );

      const res = await attachmentService.getSignedUrl("a1", 60);

      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/a1/signed-url`, {
        expiresInSec: 60,
      });
      expect(res.expiresInSec).toBe(60);
    });

    it("POSTs an empty body when no TTL is provided", async () => {
      mockedApi.post.mockResolvedValueOnce(
        envelope({ url: "u", token: "t", expiresAt: "x", expiresInSec: 0 }),
      );

      await attachmentService.getSignedUrl("a1");

      expect(mockedApi.post).toHaveBeenCalledWith(
        `${BASE}/a1/signed-url`,
        {},
      );
    });
  });

  describe("remove", () => {
    it("DELETEs by id and unwraps data", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope({ id: "a1" }));
      const res = await attachmentService.remove("a1");
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/a1`);
      expect(res).toEqual({ id: "a1" });
    });
  });
});
