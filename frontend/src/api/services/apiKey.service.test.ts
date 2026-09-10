import { apiKeyService } from "./apiKey.service";
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

const BASE = "/api/v1/api-keys";

describe("apiKeyService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getAll", () => {
    it("GETs the list with page/limit params and unwraps rows + meta", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope([{ id: "k1" }, { id: "k2" }], {
          total: 2,
          page: 1,
          limit: 20,
          totalPages: 1,
        }),
      );

      const res = await apiKeyService.getAll();

      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { page: 1, limit: 20 },
      });
      expect(res.data).toHaveLength(2);
      expect(res.meta).toEqual({
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it("passes explicit page/limit", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope([]));
      await apiKeyService.getAll(3, 50);
      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { page: 3, limit: 50 },
      });
    });

    it("falls back to [] and derives meta when data is null and meta is missing", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(null));

      const res = await apiKeyService.getAll(2, 10);

      expect(res.data).toEqual([]);
      expect(res.meta).toEqual({
        total: 0,
        page: 2,
        limit: 10,
        totalPages: 1,
      });
    });
  });

  describe("getById", () => {
    it("GETs one key by id and unwraps data", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ id: "k1" }));
      const res = await apiKeyService.getById("k1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/k1`);
      expect(res).toEqual({ id: "k1" });
    });
  });

  describe("create", () => {
    it("POSTs the input and returns the created key (with raw secret)", async () => {
      mockedApi.post.mockResolvedValueOnce(
        envelope({ id: "k1", key: "raw-secret" }),
      );

      const input = { name: "CI", scopes: ["read"] };
      const res = await apiKeyService.create(input);

      expect(mockedApi.post).toHaveBeenCalledWith(BASE, input);
      expect(res).toEqual({ id: "k1", key: "raw-secret" });
    });
  });

  describe("revoke", () => {
    it("DELETEs the key by id and unwraps data", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope({ id: "k1" }));
      const res = await apiKeyService.revoke("k1");
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/k1`);
      expect(res).toEqual({ id: "k1" });
    });
  });
});
