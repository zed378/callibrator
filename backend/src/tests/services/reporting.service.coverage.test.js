/**
 * Branch/line coverage tests for reporting.service.js
 *
 * Complements reporting.service.test.js — targets groupCount, the compliance
 * date-window branches, getCalibrationWorkload and the getSummary rollup, plus
 * the CSV escaping / default-argument edges.
 */

jest.mock("../../models", () => ({
  CalibrationDevice: { findAll: jest.fn(), count: jest.fn() },
  CalibrationRecord: { findAll: jest.fn() },
  Certificate: { findAll: jest.fn() },
  MaintenanceWorkOrder: { findAll: jest.fn() },
  Stock: { findAll: jest.fn() },
}));

const { Op } = require("sequelize");
const reporting = require("../../services/reporting.service");
const {
  CalibrationDevice,
  CalibrationRecord,
  Certificate,
  MaintenanceWorkOrder,
  Stock,
} = require("../../models");

describe("reporting.service (coverage)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ================================================================
  describe("toCsv", () => {
    it("renders a header-only CSV when rows are omitted", () => {
      expect(reporting.toCsv([{ key: "a", label: "A" }])).toBe("A\n");
    });

    it("renders empty cells for null/undefined values", () => {
      const csv = reporting.toCsv(
        [{ key: "a", label: "A" }, { key: "b", label: "B" }],
        [{ a: null, b: undefined }],
      );
      expect(csv).toBe("A,B\n,");
    });

    it("quotes values containing newlines", () => {
      const csv = reporting.toCsv([{ key: "a", label: "A" }], [{ a: "x\ny" }]);
      expect(csv).toBe('A\n"x\ny"');
    });

    it("quotes a label that itself contains a comma", () => {
      const csv = reporting.toCsv([{ key: "a", label: "Name, Full" }], []);
      expect(csv).toBe('"Name, Full"\n');
    });
  });

  // ================================================================
  describe("getOverdueDevices", () => {
    it("scopes the query by tenant and orders by due date", async () => {
      const now = new Date("2026-03-01T00:00:00Z");
      CalibrationDevice.findAll.mockResolvedValue([]);

      const r = await reporting.getOverdueDevices("t1", { now });

      expect(r).toEqual({
        total: 0,
        rows: [],
        csv: { headers: expect.any(Array), rows: [] },
      });
      expect(CalibrationDevice.findAll).toHaveBeenCalledWith({
        where: {
          status: "active",
          nextCalibrationDate: { [Op.ne]: null, [Op.lt]: now },
          tenantId: "t1",
        },
        attributes: ["id", "name", "serialNumber", "category", "nextCalibrationDate"],
        order: [["nextCalibrationDate", "ASC"]],
      });
    });

    it("omits the tenant filter when no tenantId is given", async () => {
      CalibrationDevice.findAll.mockResolvedValue([]);

      await reporting.getOverdueDevices(null, { now: new Date() });

      const where = CalibrationDevice.findAll.mock.calls[0][0].where;
      expect(where).not.toHaveProperty("tenantId");
    });

    it("defaults `now` to the current time when no options are passed", async () => {
      CalibrationDevice.findAll.mockResolvedValue([
        {
          id: "d1",
          name: "Dev",
          serialNumber: "s1",
          category: "c1",
          nextCalibrationDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        },
      ]);

      const r = await reporting.getOverdueDevices("t1");

      expect(r.total).toBe(1);
      expect(r.rows[0].daysOverdue).toBe(2);
    });

    it("blanks out a missing serial number and category", async () => {
      const now = new Date("2026-01-11T00:00:00Z");
      CalibrationDevice.findAll.mockResolvedValue([
        {
          id: "d1",
          name: "Dev",
          serialNumber: null,
          category: undefined,
          nextCalibrationDate: new Date("2026-01-04T00:00:00Z"),
        },
      ]);

      const r = await reporting.getOverdueDevices("t1", { now });

      expect(r.rows[0]).toMatchObject({
        serialNumber: "",
        category: "",
        nextCalibrationDate: "2026-01-04",
        daysOverdue: 7,
      });
    });

    it("blanks out the formatted date when nextCalibrationDate is null", async () => {
      const now = new Date("2026-01-11T00:00:00Z");
      CalibrationDevice.findAll.mockResolvedValue([
        {
          id: "d1",
          name: "Dev",
          serialNumber: "s",
          category: "c",
          nextCalibrationDate: null,
        },
      ]);

      const r = await reporting.getOverdueDevices("t1", { now });

      expect(r.rows[0].nextCalibrationDate).toBe("");
    });
  });

  // ================================================================
  describe("getCompliance", () => {
    it("applies both `from` and `to` bounds to calibrationDate", async () => {
      CalibrationRecord.findAll.mockResolvedValue([]);

      await reporting.getCompliance("t1", {
        from: "2026-01-01",
        to: "2026-02-01",
      });

      expect(CalibrationRecord.findAll).toHaveBeenCalledWith({
        where: {
          tenantId: "t1",
          calibrationDate: {
            [Op.gte]: new Date("2026-01-01"),
            [Op.lte]: new Date("2026-02-01"),
          },
        },
        attributes: ["isCompliant"],
        raw: true,
      });
    });

    it("applies only the lower bound when `to` is omitted", async () => {
      CalibrationRecord.findAll.mockResolvedValue([]);

      await reporting.getCompliance("t1", { from: "2026-01-01" });

      const { calibrationDate } = CalibrationRecord.findAll.mock.calls[0][0].where;
      expect(calibrationDate[Op.gte]).toEqual(new Date("2026-01-01"));
      expect(calibrationDate[Op.lte]).toBeUndefined();
    });

    it("applies only the upper bound when `from` is omitted", async () => {
      CalibrationRecord.findAll.mockResolvedValue([]);

      await reporting.getCompliance("t1", { to: "2026-02-01" });

      const { calibrationDate } = CalibrationRecord.findAll.mock.calls[0][0].where;
      expect(calibrationDate[Op.lte]).toEqual(new Date("2026-02-01"));
      expect(calibrationDate[Op.gte]).toBeUndefined();
    });

    it("omits the date filter entirely when no range is given", async () => {
      CalibrationRecord.findAll.mockResolvedValue([]);

      await reporting.getCompliance("t1");

      expect(CalibrationRecord.findAll.mock.calls[0][0].where).toEqual({
        tenantId: "t1",
      });
    });

    it("reports a 0% rate for an empty record set rather than dividing by zero", async () => {
      CalibrationRecord.findAll.mockResolvedValue([]);

      const r = await reporting.getCompliance("t1");

      expect(r.summary).toEqual({
        total: 0,
        compliant: 0,
        nonCompliant: 0,
        unknown: 0,
        complianceRate: 0,
      });
      expect(r.csv.rows).toEqual([
        { metric: "total", value: 0 },
        { metric: "compliant", value: 0 },
        { metric: "nonCompliant", value: 0 },
        { metric: "unknown", value: 0 },
        { metric: "complianceRate", value: 0 },
      ]);
    });

    it("rounds the compliance rate to two decimals", async () => {
      CalibrationRecord.findAll.mockResolvedValue([
        { isCompliant: true },
        { isCompliant: false },
        { isCompliant: false },
      ]);

      const r = await reporting.getCompliance("t1");

      expect(r.summary.complianceRate).toBe(33.33);
    });
  });

  // ================================================================
  describe("getInventory", () => {
    it("coerces null quantities to zero and flags them as low stock", async () => {
      Stock.findAll.mockResolvedValue([
        { itemName: "A", sku: null, quantity: null, minQuantity: null },
      ]);

      const r = await reporting.getInventory("t1");

      expect(r.summary).toEqual({
        totalItems: 1,
        totalQuantity: 0,
        lowStockCount: 1,
      });
      expect(r.rows[0]).toEqual({
        itemName: "A",
        sku: "",
        quantity: 0,
        minQuantity: 0,
        lowStock: true,
      });
    });

    it("returns an empty summary when the tenant has no stock", async () => {
      Stock.findAll.mockResolvedValue([]);

      const r = await reporting.getInventory("t1");

      expect(r.summary).toEqual({
        totalItems: 0,
        totalQuantity: 0,
        lowStockCount: 0,
      });
      expect(r.lowStock).toEqual([]);
      expect(Stock.findAll).toHaveBeenCalledWith({
        where: { tenantId: "t1" },
        attributes: ["id", "itemName", "sku", "quantity", "minQuantity"],
        raw: true,
      });
    });
  });

  // ================================================================
  describe("getCalibrationWorkload", () => {
    it("groups work orders and counts the 30/60/90-day due windows", async () => {
      const now = new Date("2026-01-01T00:00:00Z");
      MaintenanceWorkOrder.findAll
        .mockResolvedValueOnce([
          { status: "open", count: "4" },
          { status: "closed", count: "6" },
        ])
        .mockResolvedValueOnce([{ type: "calibration", count: "10" }])
        .mockResolvedValueOnce([{ priority: "high", count: "3" }]);
      CalibrationDevice.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(3);

      const r = await reporting.getCalibrationWorkload("t1", { now });

      expect(r).toEqual({
        workOrders: {
          byStatus: { open: 4, closed: 6 },
          byType: { calibration: 10 },
          byPriority: { high: 3 },
        },
        upcomingDue: { in30Days: 1, in60Days: 2, in90Days: 3 },
      });
      expect(MaintenanceWorkOrder.findAll).toHaveBeenNthCalledWith(1, {
        where: { tenantId: "t1" },
        attributes: ["status", [expect.anything(), "count"]],
        group: ["status"],
        raw: true,
      });
      expect(CalibrationDevice.count).toHaveBeenNthCalledWith(1, {
        where: {
          tenantId: "t1",
          status: "active",
          nextCalibrationDate: {
            [Op.gte]: now,
            [Op.lte]: new Date("2026-01-31T00:00:00Z"),
          },
        },
      });
      expect(CalibrationDevice.count).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          where: expect.objectContaining({
            nextCalibrationDate: expect.objectContaining({
              [Op.lte]: new Date("2026-04-01T00:00:00Z"),
            }),
          }),
        }),
      );
    });

    it("buckets null and undefined group keys under 'unknown'", async () => {
      MaintenanceWorkOrder.findAll
        .mockResolvedValueOnce([{ status: null, count: "2" }])
        .mockResolvedValueOnce([{ type: undefined, count: "5" }])
        .mockResolvedValueOnce([]);
      CalibrationDevice.count.mockResolvedValue(0);

      const r = await reporting.getCalibrationWorkload("t1", {
        now: new Date("2026-01-01T00:00:00Z"),
      });

      expect(r.workOrders.byStatus).toEqual({ unknown: 2 });
      expect(r.workOrders.byType).toEqual({ unknown: 5 });
      expect(r.workOrders.byPriority).toEqual({});
    });

    it("defaults `now` to the current time when no options are passed", async () => {
      MaintenanceWorkOrder.findAll.mockResolvedValue([]);
      CalibrationDevice.count.mockResolvedValue(0);

      const r = await reporting.getCalibrationWorkload("t1");

      expect(r.upcomingDue).toEqual({ in30Days: 0, in60Days: 0, in90Days: 0 });
      expect(CalibrationDevice.count).toHaveBeenCalledTimes(3);
    });
  });

  // ================================================================
  describe("getSummary", () => {
    it("rolls up devices, certificates, work orders, compliance and inventory", async () => {
      CalibrationDevice.findAll
        .mockResolvedValueOnce([
          { status: "active", count: "7" },
          { status: "retired", count: "1" },
        ]) // groupCount(CalibrationDevice)
        .mockResolvedValueOnce([
          {
            id: "d1",
            name: "Dev",
            serialNumber: "s",
            category: "c",
            nextCalibrationDate: new Date("2020-01-01T00:00:00Z"),
          },
        ]); // getOverdueDevices
      Certificate.findAll.mockResolvedValue([{ status: "issued", count: "3" }]);
      MaintenanceWorkOrder.findAll.mockResolvedValue([
        { status: "open", count: "2" },
      ]);
      CalibrationRecord.findAll.mockResolvedValue([
        { isCompliant: true },
        { isCompliant: false },
      ]);
      Stock.findAll.mockResolvedValue([
        { itemName: "A", sku: "s1", quantity: 5, minQuantity: 1 },
      ]);

      const r = await reporting.getSummary("t1");

      expect(r).toEqual({
        devices: { byStatus: { active: 7, retired: 1 }, overdue: 1 },
        certificates: { byStatus: { issued: 3 } },
        workOrders: { byStatus: { open: 2 } },
        compliance: {
          total: 2,
          compliant: 1,
          nonCompliant: 1,
          unknown: 0,
          complianceRate: 50,
        },
        inventory: { totalItems: 1, totalQuantity: 5, lowStockCount: 0 },
      });
    });
  });
});
