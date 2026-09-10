import { ticketService } from "./ticket.service";
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
  message: "ok",
  data,
  ...(meta !== undefined ? { meta } : {}),
});

const BASE = "/api/v1/tickets";

describe("ticketService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("list", () => {
    it("defaults page=1 limit=25 and omits unset filters", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope([{ id: "k1" }]));
      const res = await ticketService.list();
      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { page: 1, limit: 25 },
      });
      expect(res.data).toHaveLength(1);
      // synthesized meta when the envelope has none
      expect(res.meta).toEqual({ total: 1, page: 1, limit: 25, totalPages: 1 });
    });

    it("maps all filters into params (mine becomes true)", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope([]));
      await ticketService.list({
        status: "open",
        priority: "high",
        category: "bug",
        assignedTo: "u1",
        mine: true,
        q: "printer",
        page: 3,
        limit: 10,
      });
      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: {
          status: "open",
          priority: "high",
          category: "bug",
          assignedTo: "u1",
          mine: true,
          q: "printer",
          page: 3,
          limit: 10,
        },
      });
    });

    it("prefers the envelope meta when present", async () => {
      const meta = { total: 42, page: 2, limit: 25, totalPages: 2 };
      mockedApi.get.mockResolvedValueOnce(envelope([{ id: "k1" }], meta));
      const res = await ticketService.list({ page: 2 });
      expect(res.meta).toEqual(meta);
    });
  });

  describe("getMetrics", () => {
    it("GETs /metrics and unwraps data", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ total: 5, open: 2 }));
      const res = await ticketService.getMetrics();
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/metrics`);
      expect(res).toEqual({ total: 5, open: 2 });
    });
  });

  describe("get", () => {
    it("GETs one ticket and unwraps data", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ id: "k1" }));
      const res = await ticketService.get("k1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/k1`);
      expect(res).toEqual({ id: "k1" });
    });
  });

  describe("create", () => {
    it("POSTs the body and unwraps data", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "k1" }));
      const input = { subject: "help" };
      const res = await ticketService.create(input);
      expect(mockedApi.post).toHaveBeenCalledWith(BASE, input);
      expect(res).toEqual({ id: "k1" });
    });
  });

  describe("update", () => {
    it("PATCHes by id and unwraps data", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "k1" }));
      await ticketService.update("k1", { status: "resolved" });
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/k1`, {
        status: "resolved",
      });
    });
  });

  describe("assign", () => {
    it("POSTs /assign with assignedTo", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "k1" }));
      await ticketService.assign("k1", "u2");
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/k1/assign`, {
        assignedTo: "u2",
      });
    });

    it("supports unassign via null", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "k1" }));
      await ticketService.assign("k1", null);
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/k1/assign`, {
        assignedTo: null,
      });
    });
  });

  describe("remove", () => {
    it("DELETEs by id", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await ticketService.remove("k1");
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/k1`);
    });
  });

  describe("addComment", () => {
    it("POSTs /comments and unwraps data", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "c1" }));
      const res = await ticketService.addComment("k1", {
        body: "hi",
        isInternal: true,
      });
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/k1/comments`, {
        body: "hi",
        isInternal: true,
      });
      expect(res).toEqual({ id: "c1" });
    });
  });
});
