import { webhookService } from "./webhook.service";
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
  ...(meta !== undefined ? { meta } : {}),
});

const BASE = "/api/v1/webhooks";

describe("webhookService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getAll", () => {
    it("passes page/limit and returns rows + top-level meta", async () => {
      const meta = { total: 1, page: 2, limit: 10, totalPages: 1 };
      mockedApi.get.mockResolvedValueOnce(envelope([{ id: "h1" }], meta));
      const res = await webhookService.getAll(2, 10);
      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { page: 2, limit: 10 },
      });
      expect(res.data).toHaveLength(1);
      expect(res.meta).toEqual(meta);
    });

    it("defends against null data / missing meta (synthesizes meta)", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(null));
      const res = await webhookService.getAll();
      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { page: 1, limit: 20 },
      });
      expect(res.data).toEqual([]);
      expect(res.meta).toEqual({ total: 0, page: 1, limit: 20, totalPages: 1 });
    });
  });

  describe("getById", () => {
    it("GETs one webhook and unwraps data", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ id: "h1" }));
      const res = await webhookService.getById("h1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/h1`);
      expect(res).toEqual({ id: "h1" });
    });
  });

  describe("create", () => {
    it("POSTs the body and unwraps data (includes one-time secret)", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "h1", secret: "s3cr" }));
      const input = { url: "https://x", events: ["cert.created"] };
      const res = await webhookService.create(input);
      expect(mockedApi.post).toHaveBeenCalledWith(BASE, input);
      expect(res).toEqual({ id: "h1", secret: "s3cr" });
    });
  });

  describe("update", () => {
    it("PATCHes by id and unwraps data", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "h1" }));
      await webhookService.update("h1", { isActive: false });
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/h1`, {
        isActive: false,
      });
    });
  });

  describe("delete", () => {
    it("DELETEs by id and unwraps data ({ id })", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope({ id: "h1" }));
      const res = await webhookService.delete("h1");
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/h1`);
      expect(res).toEqual({ id: "h1" });
    });
  });

  describe("getDeliveries", () => {
    it("GETs /deliveries with pagination and returns paginated rows", async () => {
      const meta = { total: 1, page: 1, limit: 20, totalPages: 1 };
      mockedApi.get.mockResolvedValueOnce(envelope([{ id: "d1" }], meta));
      const res = await webhookService.getDeliveries("h1", 1, 20);
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/h1/deliveries`, {
        params: { page: 1, limit: 20 },
      });
      expect(res.data).toHaveLength(1);
      expect(res.meta).toEqual(meta);
    });
  });

  describe("test", () => {
    it("POSTs /test with an empty body and unwraps data", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ deliveryId: "d1", status: "success", attempts: 1 }));
      const res = await webhookService.test("h1");
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/h1/test`, {});
      expect(res).toEqual({ deliveryId: "d1", status: "success", attempts: 1 });
    });
  });
});
