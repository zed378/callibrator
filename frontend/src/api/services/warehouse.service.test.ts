import { warehouseService } from "./warehouse.service";
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

const BASE = "/api/v1/warehouses";

describe("warehouseService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getAll", () => {
    it("passes page/limit and maps search to `find`, returning data + meta", async () => {
      const meta = { total: 1, page: 1, limit: 25, totalPages: 1 };
      mockedApi.get.mockResolvedValueOnce(envelope([{ id: "w1" }], meta));
      const res = await warehouseService.getAll(1, 25, "north");
      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { page: 1, limit: 25, find: "north" },
      });
      expect(res.data).toHaveLength(1);
      expect(res.meta).toEqual(meta);
    });

    it("defaults page=1 limit=25 and find=undefined", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope([], { total: 0, page: 1, limit: 25, totalPages: 0 }));
      await warehouseService.getAll();
      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { page: 1, limit: 25, find: undefined },
      });
    });
  });

  describe("getById", () => {
    it("GETs one warehouse and unwraps data", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ id: "w1" }));
      const res = await warehouseService.getById("w1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/w1`);
      expect(res).toEqual({ id: "w1" });
    });
  });

  describe("create", () => {
    it("POSTs the body and unwraps data", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "w1" }));
      const input = { name: "Main", code: "MN" } as never;
      const res = await warehouseService.create(input);
      expect(mockedApi.post).toHaveBeenCalledWith(BASE, input);
      expect(res).toEqual({ id: "w1" });
    });
  });

  describe("update", () => {
    it("PATCHes by id and unwraps data", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "w1" }));
      await warehouseService.update("w1", { name: "Renamed" } as never);
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/w1`, { name: "Renamed" });
    });
  });

  describe("delete", () => {
    it("DELETEs by id", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await warehouseService.delete("w1");
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/w1`);
    });
  });

  describe("getLocations", () => {
    it("GETs the warehouse's locations and unwraps data", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope([{ id: "l1" }]));
      const res = await warehouseService.getLocations("w1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/w1/locations`);
      expect(res).toHaveLength(1);
    });
  });

  describe("createLocation", () => {
    it("POSTs to the flat /locations route and unwraps data", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "l1" }));
      const input = { warehouseId: "w1", name: "Shelf A" } as never;
      const res = await warehouseService.createLocation(input);
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/locations`, input);
      expect(res).toEqual({ id: "l1" });
    });
  });

  describe("updateLocation", () => {
    it("PATCHes /locations/:id and unwraps data", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "l1" }));
      await warehouseService.updateLocation("l1", { name: "Shelf B" } as never);
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/locations/l1`, {
        name: "Shelf B",
      });
    });
  });

  describe("deleteLocation", () => {
    it("DELETEs /locations/:id", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await warehouseService.deleteLocation("l1");
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/locations/l1`);
    });
  });
});
