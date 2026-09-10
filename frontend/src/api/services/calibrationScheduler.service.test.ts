import { calibrationSchedulerService } from "./calibrationScheduler.service";
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

describe("calibrationSchedulerService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getDue", () => {
    it("GETs /due with leadDays and allTenants params and returns the array", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope([{ id: "d1" }]));

      const res = await calibrationSchedulerService.getDue({
        leadDays: 30,
        allTenants: true,
      });

      expect(mockedApi.get).toHaveBeenCalledWith(
        "/api/v1/calibration-scheduler/due",
        { params: { leadDays: 30, allTenants: true } },
      );
      expect(res).toEqual([{ id: "d1" }]);
    });

    it("coerces falsy allTenants to undefined and defaults params when none given", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope([]));

      await calibrationSchedulerService.getDue();

      expect(mockedApi.get).toHaveBeenCalledWith(
        "/api/v1/calibration-scheduler/due",
        { params: { leadDays: undefined, allTenants: undefined } },
      );
    });

    it("returns [] when data is not an array", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(null));
      await expect(calibrationSchedulerService.getDue()).resolves.toEqual([]);
    });
  });

  describe("run", () => {
    it("POSTs /run with the scheduler input and returns the summary", async () => {
      const summary = {
        scanned: 5,
        workOrdersCreated: 2,
        notificationsCreated: 2,
        skipped: 3,
        overdue: 1,
        errors: 0,
        details: [],
      };
      mockedApi.post.mockResolvedValueOnce(envelope(summary));

      const res = await calibrationSchedulerService.run({
        leadDays: 14,
        allTenants: true,
        tenantId: "t1",
      });

      expect(mockedApi.post).toHaveBeenCalledWith(
        "/api/v1/calibration-scheduler/run",
        { leadDays: 14, allTenants: true, tenantId: "t1" },
      );
      expect(res).toEqual(summary);
    });

    it("coerces falsy allTenants/tenantId to undefined and defaults with no input", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({}));

      await calibrationSchedulerService.run();

      expect(mockedApi.post).toHaveBeenCalledWith(
        "/api/v1/calibration-scheduler/run",
        { leadDays: undefined, allTenants: undefined, tenantId: undefined },
      );
    });
  });
});
