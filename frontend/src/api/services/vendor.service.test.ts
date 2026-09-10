import { vendorService } from "./vendor.service";
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

const BASE = "/api/v1/vendors";

describe("vendorService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getAll", () => {
    it("passes pagination + filter params and returns rows with top-level meta", async () => {
      const meta = { total: 1, page: 2, limit: 10, totalPages: 1 };
      mockedApi.get.mockResolvedValueOnce(envelope([{ id: "v1" }], meta));
      const res = await vendorService.getAll(2, 10, "acme", "Active", "Other");
      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { page: 2, limit: 10, find: "acme", status: "Active", type: "Other" },
      });
      expect(res.data).toHaveLength(1);
      expect(res.meta).toEqual(meta);
    });

    it("defends against null data and missing meta (synthesizes meta)", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(null));
      const res = await vendorService.getAll();
      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { page: 1, limit: 20, find: undefined, status: undefined, type: undefined },
      });
      expect(res.data).toEqual([]);
      expect(res.meta).toEqual({ total: 0, page: 1, limit: 20, totalPages: 1 });
    });
  });

  describe("getById", () => {
    it("GETs one vendor and unwraps data", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ id: "v1" }));
      const res = await vendorService.getById("v1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/v1`);
      expect(res).toEqual({ id: "v1" });
    });
  });

  describe("create", () => {
    it("POSTs the body and unwraps data", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "v1" }));
      const input = { name: "Acme" };
      const res = await vendorService.create(input);
      expect(mockedApi.post).toHaveBeenCalledWith(BASE, input);
      expect(res).toEqual({ id: "v1" });
    });
  });

  describe("update", () => {
    it("PATCHes by id with the rest of the fields (id stripped from body)", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "v1" }));
      await vendorService.update({ id: "v1", name: "New" });
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/v1`, { name: "New" });
    });
  });

  describe("delete", () => {
    it("DELETEs by id", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await vendorService.delete("v1");
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/v1`);
    });
  });

  describe("qualify", () => {
    it("PATCHes /qualify with the input and unwraps data", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "v1" }));
      const input = { approvalStatus: "Approved", lastAuditDate: "2026-01-01" };
      const res = await vendorService.qualify("v1", input);
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/v1/qualify`, input);
      expect(res).toEqual({ id: "v1" });
    });
  });
});
