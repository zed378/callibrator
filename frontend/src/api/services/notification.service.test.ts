import { notificationService } from "./notification.service";
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

// LIST envelope: `data` is the array; `meta` is a TOP-LEVEL sibling.
const listEnvelope = (data: unknown, meta?: unknown) => ({
  success: true,
  status: 200,
  message: "ok",
  data,
  ...(meta ? { meta } : {}),
});
const itemEnvelope = <T,>(data: T) => ({
  success: true,
  status: 200,
  message: "ok",
  data,
});

const BASE = "/api/v1/notifications";

describe("notificationService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getAll", () => {
    it("GETs with default page/limit params and returns notifications + meta", async () => {
      const meta = {
        total: 1,
        unread: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      };
      mockedApi.get.mockResolvedValueOnce(listEnvelope([{ id: "n1" }], meta));

      const res = await notificationService.getAll();

      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { page: 1, limit: 10 },
      });
      expect(res.notifications).toHaveLength(1);
      expect(res.meta).toEqual(meta);
    });

    it("adds isRead and type params only when provided", async () => {
      mockedApi.get.mockResolvedValueOnce(listEnvelope([]));
      await notificationService.getAll(2, 5, false, "SYSTEM");
      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { page: 2, limit: 5, isRead: false, type: "SYSTEM" },
      });
    });

    it("falls back to [] and derived meta when data is null and meta missing", async () => {
      mockedApi.get.mockResolvedValueOnce(listEnvelope(null));

      const res = await notificationService.getAll();

      expect(res.notifications).toEqual([]);
      expect(res.meta).toEqual({
        total: 0,
        unread: 0,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });
  });

  describe("markAllAsRead", () => {
    it("PATCHes /read-all", async () => {
      mockedApi.patch.mockResolvedValueOnce(itemEnvelope(null));
      await notificationService.markAllAsRead();
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/read-all`);
    });
  });

  describe("markAsRead", () => {
    it("PATCHes /:id/read and unwraps data", async () => {
      mockedApi.patch.mockResolvedValueOnce(itemEnvelope({ id: "n1" }));
      const res = await notificationService.markAsRead("n1");
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/n1/read`);
      expect(res).toEqual({ id: "n1" });
    });
  });

  describe("delete", () => {
    it("DELETEs /:id", async () => {
      mockedApi.delete.mockResolvedValueOnce(itemEnvelope(null));
      await notificationService.delete("n1");
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/n1`);
    });
  });

  describe("deleteMany", () => {
    it("DELETEs /bulk with the ids in the request body", async () => {
      mockedApi.delete.mockResolvedValueOnce(
        itemEnvelope({ deleted: 2, requested: 2 }),
      );

      const res = await notificationService.deleteMany(["n1", "n2"]);

      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/bulk`, {
        data: { ids: ["n1", "n2"] },
      });
      expect(res).toEqual({ deleted: 2, requested: 2 });
    });

    it("falls back to deleted:0 / requested:length when data is missing", async () => {
      mockedApi.delete.mockResolvedValueOnce(itemEnvelope(null));
      const res = await notificationService.deleteMany(["n1", "n2", "n3"]);
      expect(res).toEqual({ deleted: 0, requested: 3 });
    });
  });

  describe("deleteAll", () => {
    it("DELETEs /all and unwraps data", async () => {
      mockedApi.delete.mockResolvedValueOnce(itemEnvelope({ deleted: 5 }));
      const res = await notificationService.deleteAll();
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/all`);
      expect(res).toEqual({ deleted: 5 });
    });

    it("falls back to deleted:0 when data is missing", async () => {
      mockedApi.delete.mockResolvedValueOnce(itemEnvelope(null));
      await expect(notificationService.deleteAll()).resolves.toEqual({
        deleted: 0,
      });
    });
  });

  describe("sendTest", () => {
    it("POSTs the default user scope to /test", async () => {
      mockedApi.post.mockResolvedValueOnce(itemEnvelope({ id: "n1" }));
      await notificationService.sendTest();
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/test`, {
        scope: "user",
      });
    });

    it("POSTs the tenant scope when given", async () => {
      mockedApi.post.mockResolvedValueOnce(itemEnvelope(null));
      const res = await notificationService.sendTest("tenant");
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/test`, {
        scope: "tenant",
      });
      expect(res).toBeNull();
    });
  });
});
