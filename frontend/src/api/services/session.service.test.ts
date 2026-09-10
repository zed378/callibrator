import { sessionService } from "./session.service";
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

const BASE = "/api/v1/sessions";

describe("sessionService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getAll", () => {
    it("sends default page/limit params and returns the whole response", async () => {
      const payload = {
        success: true,
        message: "ok",
        data: { sessions: [{ id: "s1" }], meta: { total: 1 } },
      };
      mockedApi.get.mockResolvedValueOnce(payload);

      const res = await sessionService.getAll();

      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { page: 1, limit: 20 },
      });
      expect(res).toBe(payload);
    });

    it("adds search/status/userId only when provided", async () => {
      mockedApi.get.mockResolvedValueOnce({
        success: true,
        data: { sessions: [], meta: {} },
      });

      await sessionService.getAll(2, 50, "10.0.0.1", "active", "u1");

      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: {
          page: 2,
          limit: 50,
          search: "10.0.0.1",
          status: "active",
          userId: "u1",
        },
      });
    });
  });

  describe("getById", () => {
    it("unwraps data for one session", async () => {
      mockedApi.get.mockResolvedValueOnce({ success: true, data: { id: "s1" } });

      const res = await sessionService.getById("s1");

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/s1`);
      expect(res).toEqual({ id: "s1" });
    });
  });

  describe("getStats", () => {
    it("requests stats with empty params by default", async () => {
      mockedApi.get.mockResolvedValueOnce({
        success: true,
        data: { total: 3, active: 1, expired: 1, revoked: 1 },
      });

      const res = await sessionService.getStats();

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/stats`, {
        params: {},
      });
      expect(res).toEqual({ total: 3, active: 1, expired: 1, revoked: 1 });
    });

    it("passes userId param when given", async () => {
      mockedApi.get.mockResolvedValueOnce({ success: true, data: {} });
      await sessionService.getStats("u1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/stats`, {
        params: { userId: "u1" },
      });
    });
  });

  describe("revoke", () => {
    it("posts the default reason and returns the whole response", async () => {
      const payload = { success: true, message: "revoked" };
      mockedApi.post.mockResolvedValueOnce(payload);

      const res = await sessionService.revoke("s1");

      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/s1/revoke`, {
        reason: "MANUAL_REVOKE",
      });
      expect(res).toBe(payload);
    });

    it("forwards a custom reason", async () => {
      mockedApi.post.mockResolvedValueOnce({ success: true, message: "ok" });
      await sessionService.revoke("s1", "STOLEN");
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/s1/revoke`, {
        reason: "STOLEN",
      });
    });
  });

  describe("revokeAllForUser", () => {
    it("posts to the user revoke-all path and unwraps data", async () => {
      mockedApi.post.mockResolvedValueOnce({
        success: true,
        message: "ok",
        data: { revokedCount: 4 },
      });

      const res = await sessionService.revokeAllForUser("u1");

      expect(mockedApi.post).toHaveBeenCalledWith(
        `${BASE}/user/u1/revoke-all`,
        { reason: "ADMIN_REVOKE_ALL" },
      );
      expect(res).toEqual({ revokedCount: 4 });
    });
  });

  describe("delete", () => {
    it("deletes by id and returns the whole response", async () => {
      const payload = { success: true, message: "deleted" };
      mockedApi.delete.mockResolvedValueOnce(payload);

      const res = await sessionService.delete("s1");

      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/s1`);
      expect(res).toBe(payload);
    });
  });
});
