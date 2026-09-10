import { reportService } from "./report.service";
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

const BASE = "/api/v1/reports";

describe("reportService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getSummary", () => {
    it("GETs the summary and unwraps data", async () => {
      const summary = { compliance: { complianceRate: 0.9 } };
      mockedApi.get.mockResolvedValueOnce(envelope(summary));

      const res = await reportService.getSummary();

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/summary`);
      expect(res).toEqual(summary);
    });
  });

  describe("getCompliance", () => {
    it("passes from/to as params and unwraps data", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ summary: { complianceRate: 1 } }),
      );

      const res = await reportService.getCompliance("2026-01-01", "2026-02-01");

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/compliance`, {
        params: { from: "2026-01-01", to: "2026-02-01" },
      });
      expect(res.summary.complianceRate).toBe(1);
    });

    it("coerces empty from/to to undefined params", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ summary: {} }));

      await reportService.getCompliance();

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/compliance`, {
        params: { from: undefined, to: undefined },
      });
    });
  });

  describe("getCalibrationWorkload", () => {
    it("GETs the workload and unwraps data", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ workOrders: {}, upcomingDue: {} }),
      );

      await reportService.getCalibrationWorkload();

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/calibration-workload`);
    });
  });

  describe("getOverdueDevices", () => {
    it("GETs overdue devices and unwraps data", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ total: 2, rows: [] }));

      const res = await reportService.getOverdueDevices();

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/overdue-devices`);
      expect(res.total).toBe(2);
    });
  });

  describe("getInventory", () => {
    it("GETs inventory and unwraps data", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ summary: {}, lowStock: [], rows: [] }),
      );

      await reportService.getInventory();

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/inventory`);
    });
  });

  describe("exportComplianceCsv", () => {
    it("requests the compliance endpoint with csv format + text responseType, returns raw string", async () => {
      mockedApi.get.mockResolvedValueOnce("a,b,c\n1,2,3");

      const res = await reportService.exportComplianceCsv("2026-01-01", "2026-02-01");

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/compliance`, {
        params: { format: "csv", from: "2026-01-01", to: "2026-02-01" },
        responseType: "text",
      });
      expect(res).toBe("a,b,c\n1,2,3");
    });

    it("coerces empty from/to to undefined", async () => {
      mockedApi.get.mockResolvedValueOnce("");

      await reportService.exportComplianceCsv();

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/compliance`, {
        params: { format: "csv", from: undefined, to: undefined },
        responseType: "text",
      });
    });
  });

  describe("exportOverdueDevicesCsv", () => {
    it("requests overdue-devices as csv text", async () => {
      mockedApi.get.mockResolvedValueOnce("csv");

      const res = await reportService.exportOverdueDevicesCsv();

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/overdue-devices`, {
        params: { format: "csv" },
        responseType: "text",
      });
      expect(res).toBe("csv");
    });
  });

  describe("exportInventoryCsv", () => {
    it("requests inventory as csv text", async () => {
      mockedApi.get.mockResolvedValueOnce("csv");

      const res = await reportService.exportInventoryCsv();

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/inventory`, {
        params: { format: "csv" },
        responseType: "text",
      });
      expect(res).toBe("csv");
    });
  });
});
