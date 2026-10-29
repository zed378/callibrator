/**
 * Tests for reporting controller
 */

jest.mock("../../services/reporting.service", () => ({
  getSummary: jest.fn(),
  getCompliance: jest.fn(),
  getCalibrationWorkload: jest.fn(),
  getOverdueDevices: jest.fn(),
  getInventory: jest.fn(),
  toCsv: jest.fn(() => {
    return "header1,header2\nval1,val2";
  }),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

interface FakeReq {
  query: Record<string, unknown>;
  params: Record<string, unknown>;
  body: Record<string, unknown>;
  user?: Record<string, unknown> | null;
  file?: unknown;
  files?: unknown;
  headers?: Record<string, unknown>;
  ip?: string;
  protocol?: string;
  get?: jest.Mock;
  validated?: unknown;
  setHeader?: jest.Mock;
}

interface FakeRes {
  status: jest.Mock;
  json: jest.Mock;
  setHeader: jest.Mock;
  send: jest.Mock;
}

type Handler = (req: FakeReq, res: FakeRes, next: jest.Mock) => Promise<unknown>;

interface ReportingServiceDouble {
  getSummary: jest.Mock;
  getCompliance: jest.Mock;
  getCalibrationWorkload: jest.Mock;
  getOverdueDevices: jest.Mock;
  getInventory: jest.Mock;
  toCsv: jest.Mock;
}

interface ReportingControllerDouble {
  summary: Handler;
  compliance: Handler;
  calibrationWorkload: Handler;
  overdueDevices: Handler;
  inventory: Handler;
}

interface ResponseDouble {
  success: jest.Mock;
  error: jest.Mock;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const reportingService = require("../../services/reporting.service") as ReportingServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const reportingController = require("../../controllers/reporting.controller") as ReportingControllerDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { success } = require("../../utils/response.util") as ResponseDouble;

const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440002";

describe("reporting Controller", () => {
  let req: FakeReq;
  let res: FakeRes;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((resObj: FakeRes, data: unknown, _meta: unknown, message: unknown, status?: number) => {
      resObj.status(status ?? 200);
      resObj.json({ success: true, data, message });
    });
    req = {
      body: {},
      params: {},
      query: {},
      user: { id: "user-1", tenantId: VALID_TENANT_ID },
      ip: "127.0.0.1",
      setHeader: jest.fn().mockReturnThis(),
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("summary", () => {
    it("should return dashboard summary", async () => {
      const result = { devices: { byStatus: {} }, compliance: { complianceRate: 95 } };
      reportingService.getSummary.mockResolvedValue(result);

      await reportingController.summary(req, res, next);

      expect(reportingService.getSummary).toHaveBeenCalledWith(VALID_TENANT_ID);
      expect(success).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("compliance", () => {
    it("should return compliance report as JSON when no format param", async () => {
      const result = { summary: { total: 100, compliant: 95, complianceRate: 95 } };
      reportingService.getCompliance.mockResolvedValue(result);

      await reportingController.compliance(req, res, next);

      expect(reportingService.getCompliance).toHaveBeenCalledWith(VALID_TENANT_ID, { from: undefined, to: undefined });
      expect(success).toHaveBeenCalled();
    });

    it("should filter compliance by date range", async () => {
      req.query = { from: "2025-01-01", to: "2025-12-31" };
      const result = { summary: { total: 50, compliant: 48 } };
      reportingService.getCompliance.mockResolvedValue(result);

      await reportingController.compliance(req, res, next);

      expect(reportingService.getCompliance).toHaveBeenCalledWith(VALID_TENANT_ID, { from: "2025-01-01", to: "2025-12-31" });
    });

    it("should return CSV when format=csv", async () => {
      req.query = { format: "csv" };
      const result = {
        summary: { total: 100, compliant: 95 },
        csv: { headers: [{ key: "metric", label: "Metric" }], rows: [{ metric: "rate", value: 95 }] },
      };
      reportingService.getCompliance.mockResolvedValue(result);

      await reportingController.compliance(req, res, next);

      expect(res.setHeader).toHaveBeenNthCalledWith(1, "Content-Type", "text/csv");
      expect(res.setHeader).toHaveBeenNthCalledWith(2, "Content-Disposition", "attachment; filename=compliance_report.csv");
      expect(res.send).toHaveBeenCalled();
    });
  });

  describe("calibrationWorkload", () => {
    it("should return calibration workload report", async () => {
      const result = { workOrders: { byStatus: {} }, upcomingDue: { in30Days: 5 } };
      reportingService.getCalibrationWorkload.mockResolvedValue(result);

      await reportingController.calibrationWorkload(req, res, next);

      expect(reportingService.getCalibrationWorkload).toHaveBeenCalledWith(VALID_TENANT_ID);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("overdueDevices", () => {
    it("should return overdue devices report", async () => {
      const result = { total: 3, rows: [] };
      reportingService.getOverdueDevices.mockResolvedValue(result);

      await reportingController.overdueDevices(req, res, next);

      expect(reportingService.getOverdueDevices).toHaveBeenCalledWith(VALID_TENANT_ID);
      expect(success).toHaveBeenCalled();
    });

    it("should return CSV when format=csv", async () => {
      req.query = { format: "csv" };
      const result = { total: 2, rows: [], csv: { headers: [{ key: "name", label: "Device" }], rows: [] } };
      reportingService.getOverdueDevices.mockResolvedValue(result);

      await reportingController.overdueDevices(req, res, next);

      expect(res.setHeader).toHaveBeenNthCalledWith(1, "Content-Type", "text/csv");
      expect(res.send).toHaveBeenCalled();
    });
  });

  describe("inventory", () => {
    it("should return inventory report", async () => {
      const result = { summary: { totalItems: 100, totalQuantity: 500 }, lowStock: [] };
      reportingService.getInventory.mockResolvedValue(result);

      await reportingController.inventory(req, res, next);

      expect(reportingService.getInventory).toHaveBeenCalledWith(VALID_TENANT_ID);
      expect(success).toHaveBeenCalled();
    });

    it("should return CSV when format=csv", async () => {
      req.query = { format: "csv" };
      const result = { summary: { totalItems: 50 }, rows: [], csv: { headers: [{ key: "itemName", label: "Item" }], rows: [] } };
      reportingService.getInventory.mockResolvedValue(result);

      await reportingController.inventory(req, res, next);

      expect(res.setHeader).toHaveBeenNthCalledWith(1, "Content-Type", "text/csv");
      expect(res.setHeader).toHaveBeenNthCalledWith(2, "Content-Disposition", "attachment; filename=inventory_report.csv");
      expect(res.send).toHaveBeenCalled();
    });
  });
});
