import { maintenanceService } from "./maintenance.service";
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

const BASE = "/api/v1/maintenance";

describe("maintenanceService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getAll", () => {
    it("GETs with defaulted page/limit merged into params and returns the paginated shape", async () => {
      mockedApi.get.mockResolvedValueOnce(
        listEnvelope([{ id: "wo1" }], {
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
        }),
      );

      const res = await maintenanceService.getAll();

      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { page: 1, limit: 20 },
      });
      expect(res.data).toHaveLength(1);
      expect(res.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it("forwards caller params but overrides page/limit defaults", async () => {
      mockedApi.get.mockResolvedValueOnce(listEnvelope([]));
      await maintenanceService.getAll({ status: "Open", page: 2, limit: 5 });
      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { status: "Open", page: 2, limit: 5 },
      });
    });

    it("falls back to [] and derived meta when data is null and meta missing", async () => {
      mockedApi.get.mockResolvedValueOnce(listEnvelope(null));

      const res = await maintenanceService.getAll();

      expect(res.data).toEqual([]);
      expect(res.meta).toEqual({
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });
  });

  describe("getById", () => {
    it("GETs one work order and unwraps data", async () => {
      mockedApi.get.mockResolvedValueOnce(itemEnvelope({ id: "wo1" }));
      const res = await maintenanceService.getById("wo1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/wo1`);
      expect(res).toEqual({ id: "wo1" });
    });
  });

  describe("create", () => {
    it("POSTs the create payload", async () => {
      mockedApi.post.mockResolvedValueOnce(itemEnvelope({ id: "wo1" }));
      const input = {
        deviceId: "d1",
        title: "Fix",
        type: "Repair" as const,
      };
      await maintenanceService.create(input);
      expect(mockedApi.post).toHaveBeenCalledWith(BASE, input);
    });
  });

  describe("update", () => {
    it("PATCHes /:id with the id stripped from the body", async () => {
      mockedApi.patch.mockResolvedValueOnce(itemEnvelope({ id: "wo1" }));

      await maintenanceService.update({ id: "wo1", title: "Renamed" });

      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/wo1`, {
        title: "Renamed",
      });
      const body = mockedApi.patch.mock.calls[0][1] as Record<string, unknown>;
      expect(body).not.toHaveProperty("id");
    });
  });

  describe("delete", () => {
    it("DELETEs /:id", async () => {
      mockedApi.delete.mockResolvedValueOnce(itemEnvelope(null));
      await maintenanceService.delete("wo1");
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/wo1`);
    });
  });
});
