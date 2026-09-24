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
    // A-111: the backend answers the standard envelope — rows in `data`,
    // pagination in a top-level `meta` (backend session.envelope.a111.test.js
    // pins the same body from the real response.util).
    it("sends default page/limit params and reads rows from data and meta from the top level", async () => {
      const meta = { total: 21, page: 1, limit: 20, totalPages: 2 };
      mockedApi.get.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Sessions retrieved successfully",
        data: [{ id: "s1" }],
        meta,
      });

      const res = await sessionService.getAll();

      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { page: 1, limit: 20 },
      });
      expect(res).toEqual({ sessions: [{ id: "s1" }], meta });
    });

    it("falls back to an empty list and a one-page meta when data and meta are absent", async () => {
      mockedApi.get.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "ok",
        data: null,
      });

      const res = await sessionService.getAll(3, 10);

      expect(res).toEqual({
        sessions: [],
        meta: { total: 0, page: 3, limit: 10, totalPages: 1 },
      });
    });

    it("adds search/status/userId only when provided", async () => {
      mockedApi.get.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "ok",
        data: [],
        meta: { total: 0, page: 2, limit: 50, totalPages: 0 },
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
