import { deviceService } from "./device.service";
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

const envelope = <T,>(data: T) => ({
  success: true,
  status: 200,
  message: "ok",
  data,
});

describe("deviceService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getAll", () => {
    it("GETs devices with pagination + filter params and unwraps data.rows with top-level meta", async () => {
      mockedApi.get.mockResolvedValueOnce({
        success: true,
        message: "ok",
        data: { rows: [{ id: "d1" }], count: 1 },
        meta: { total: 12, page: 2, limit: 5, totalPages: 3 },
      });

      const res = await deviceService.getAll(2, 5, "pump", "active", "cat1");

      expect(mockedApi.get).toHaveBeenCalledWith(
        "/api/v1/calibration-devices",
        {
          params: {
            page: 2,
            limit: 5,
            find: "pump",
            status: "active",
            category: "cat1",
          },
        },
      );
      expect(res.data).toEqual([{ id: "d1" }]);
      expect(res.meta).toEqual({
        total: 12,
        page: 2,
        limit: 5,
        totalPages: 3,
      });
    });

    it("returns [] and computed meta when data is null", async () => {
      mockedApi.get.mockResolvedValueOnce({
        success: true,
        message: "",
        data: null,
      });

      const res = await deviceService.getAll();

      expect(mockedApi.get).toHaveBeenCalledWith(
        "/api/v1/calibration-devices",
        {
          params: {
            page: 1,
            limit: 20,
            find: undefined,
            status: undefined,
            category: undefined,
          },
        },
      );
      expect(res.data).toEqual([]);
      expect(res.meta).toEqual({ total: 0, page: 1, limit: 20, totalPages: 1 });
    });

    it("accepts a plain-array data payload", async () => {
      mockedApi.get.mockResolvedValueOnce({
        success: true,
        message: "ok",
        data: [{ id: "d1" }, { id: "d2" }],
      });

      const res = await deviceService.getAll();
      expect(res.data).toHaveLength(2);
      expect(res.meta.total).toBe(2);
    });
  });

  describe("getById", () => {
    it("GETs one device and returns data", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ id: "d1" }));
      const res = await deviceService.getById("d1");
      expect(mockedApi.get).toHaveBeenCalledWith(
        "/api/v1/calibration-devices/d1",
      );
      expect(res).toEqual({ id: "d1" });
    });
  });

  describe("create", () => {
    it("POSTs the input and returns data", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "d1" }));
      const input = { name: "Pump" };
      const res = await deviceService.create(input);
      expect(mockedApi.post).toHaveBeenCalledWith(
        "/api/v1/calibration-devices",
        input,
      );
      expect(res).toEqual({ id: "d1" });
    });
  });

  describe("update", () => {
    it("strips id and PUTs the rest to /:id", async () => {
      mockedApi.put.mockResolvedValueOnce(envelope({ id: "d1" }));
      await deviceService.update({ id: "d1", name: "Renamed" });
      expect(mockedApi.put).toHaveBeenCalledWith(
        "/api/v1/calibration-devices/d1",
        { name: "Renamed" },
      );
    });
  });

  describe("delete", () => {
    it("DELETEs by id", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await deviceService.delete("d1");
      expect(mockedApi.delete).toHaveBeenCalledWith(
        "/api/v1/calibration-devices/d1",
      );
    });
  });

  describe("bulkImport", () => {
    it("POSTs a FormData with the file and returns data", async () => {
      const result = {
        successCount: 1,
        failedCount: 0,
        totalCount: 1,
        errors: [],
      };
      mockedApi.post.mockResolvedValueOnce(envelope(result));

      const file = new File(["a,b"], "devices.csv", { type: "text/csv" });
      const res = await deviceService.bulkImport(file);

      expect(mockedApi.post).toHaveBeenCalledTimes(1);
      const [url, body] = mockedApi.post.mock.calls[0];
      expect(url).toBe("/api/v1/calibration-devices/bulk-import");
      expect(body).toBeInstanceOf(FormData);
      expect((body as FormData).get("file")).toBe(file);
      expect(res).toEqual(result);
    });
  });
});
