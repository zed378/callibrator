const { AppError } = require("../../utils/appError.util");

const mockNonConformance = {
  count: jest.fn(),
  create: jest.fn(),
  findAndCountAll: jest.fn(),
  findOne: jest.fn(),
};

const mockCapa = {
  count: jest.fn(),
  create: jest.fn(),
  findAndCountAll: jest.fn(),
  findOne: jest.fn(),
};

const mockUser = { findOne: jest.fn() };
const mockCalibrationDevice = { findOne: jest.fn() };
// A-73: numbers come from the per-tenant counter upsert (db.query), not count().
const mockQuery = jest.fn();

const mockModels = {
  NonConformance: mockNonConformance,
  Capa: mockCapa,
  User: mockUser,
  CalibrationDevice: mockCalibrationDevice,
};

jest.mock("../../models", () => mockModels);
// A-66: mutations run in a transaction and write an audit row inside it. The
// transactional behaviour itself is proved against the auditLedger fixture in
// qms.audit.a66.test.js; here the transaction is a pass-through handle.
jest.mock("../../config", () => ({
  db: {
    transaction: jest.fn(async (cb) => cb("TX")),
    query: (...args) => mockQuery(...args),
  },
}));
jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const qmsService = require("../../services/qms.service");

describe("qms.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue([[{ seq: 1 }]]);
    // The referenced device / user belongs to the tenant unless a test says not.
    mockCalibrationDevice.findOne.mockResolvedValue({ id: "device-1" });
    mockUser.findOne.mockResolvedValue({ id: "user-2" });
  });

  /** The counter upsert's options for the Nth claim. */
  const claim = (n = 0) => mockQuery.mock.calls[n][1];

  describe("Non-Conformance (NC)", () => {
    describe("createNC", () => {
      it("should create a non-conformance with the counter's number, formatted", async () => {
        mockQuery.mockResolvedValue([[{ seq: 3 }]]);
        mockNonConformance.create.mockImplementation((data) =>
          Promise.resolve({ id: "nc-1", ...data }),
        );

        const result = await qmsService.createNC("tenant-1", "user-1", {
          title: "Test NC",
          description: "Test Description",
          severity: "HIGH",
          deviceId: "device-1",
        });

        expect(mockNonConformance.count).not.toHaveBeenCalled();
        expect(claim()).toEqual({
          replacements: { tenantId: "tenant-1", kind: "NC", pattern: "^NC-([0-9]{1,9})$" },
          transaction: "TX",
        });
        // A-75: the device is looked up in the caller's tenant, in the transaction.
        expect(mockCalibrationDevice.findOne).toHaveBeenCalledWith({
          where: { id: "device-1", tenantId: "tenant-1" },
          attributes: ["id"],
          transaction: "TX",
        });
        expect(mockNonConformance.create).toHaveBeenCalledWith({
          tenantId: "tenant-1",
          reportedBy: "user-1",
          ncNumber: "NC-00003",
          title: "Test NC",
          description: "Test Description",
          severity: "HIGH",
          deviceId: "device-1",
          dateIdentified: expect.any(Date),
          rootCause: null,
          status: "OPEN",
        }, { transaction: "TX" });
        expect(result.id).toBe("nc-1");
      });

      it("should default severity to MEDIUM and dateIdentified to now", async () => {
        mockNonConformance.create.mockImplementation((data) =>
          Promise.resolve({ id: "nc-2", ...data }),
        );

        await qmsService.createNC("tenant-1", "user-1", { title: "Minimal" });

        expect(mockNonConformance.create).toHaveBeenCalledWith(
          expect.objectContaining({
            ncNumber: "NC-00001",
            severity: "MEDIUM",
            status: "OPEN",
            deviceId: null,
            dateIdentified: expect.any(Date),
          }),
          { transaction: "TX" },
        );
        // No device named, nothing to look up.
        expect(mockCalibrationDevice.findOne).not.toHaveBeenCalled();
      });

      it("stores a rootCause supplied at creation", async () => {
        mockNonConformance.create.mockImplementation((data) => Promise.resolve({ id: "nc-4", ...data }));

        await qmsService.createNC("tenant-1", "user-1", { title: "t", rootCause: "worn probe" });

        expect(mockNonConformance.create).toHaveBeenCalledWith(
          expect.objectContaining({ rootCause: "worn probe" }),
          { transaction: "TX" },
        );
      });

      it("refuses a deviceId outside the tenant with 404 and creates nothing", async () => {
        mockCalibrationDevice.findOne.mockResolvedValue(null);

        const err = await qmsService
          .createNC("tenant-1", "user-1", { title: "t", deviceId: "foreign" })
          .catch((e) => e);

        expect(err).toBeInstanceOf(AppError);
        expect(err.status).toBe(404);
        expect(err.message).toBe("Device not found");
        expect(mockQuery).not.toHaveBeenCalled();
        expect(mockNonConformance.create).not.toHaveBeenCalled();
      });

      it("should honour an explicitly supplied dateIdentified", async () => {
        const when = new Date("2026-01-15T00:00:00Z");
        mockNonConformance.create.mockImplementation((data) =>
          Promise.resolve({ id: "nc-3", ...data }),
        );

        await qmsService.createNC("tenant-1", "user-1", {
          title: "Dated",
          dateIdentified: when,
        });

        expect(mockNonConformance.create).toHaveBeenCalledWith(
          expect.objectContaining({ dateIdentified: when }),
          { transaction: "TX" },
        );
      });
    });

    describe("getNCs", () => {
      it("should default to page 1 / limit 10 and omit the status filter", async () => {
        mockNonConformance.findAndCountAll.mockResolvedValue({
          count: 0,
          rows: [],
        });

        const result = await qmsService.getNCs("tenant-1");

        expect(mockNonConformance.findAndCountAll).toHaveBeenCalledWith(
          expect.objectContaining({
            // No `status` key when no filter is passed.
            where: { tenantId: "tenant-1" },
            limit: 10,
            offset: 0,
          }),
        );
        expect(result.page).toBe(1);
        expect(result.limit).toBe(10);
        expect(result.totalPages).toBe(0);
      });

      it("should offset correctly for a later page", async () => {
        mockNonConformance.findAndCountAll.mockResolvedValue({
          count: 25,
          rows: [],
        });

        const result = await qmsService.getNCs("tenant-1", 3, 10);

        expect(mockNonConformance.findAndCountAll).toHaveBeenCalledWith(
          expect.objectContaining({ offset: 20, limit: 10 }),
        );
        expect(result.totalPages).toBe(3);
      });

      it("should return paginated list of non-conformances", async () => {
        mockNonConformance.findAndCountAll.mockResolvedValue({
          count: 1,
          rows: [{ id: "nc-1", title: "NC 1" }],
        });

        const result = await qmsService.getNCs("tenant-1", 1, 10, "OPEN");

        expect(mockNonConformance.findAndCountAll).toHaveBeenCalledWith({
          where: { tenantId: "tenant-1", status: "OPEN" },
          limit: 10,
          offset: 0,
          // A-75: LEFT OUTER JOINs, each carrying the tenant predicate.
          include: [
            {
              model: mockUser,
              as: "reporter",
              attributes: ["id", "firstName", "lastName", "email"],
              required: false,
              where: { tenantId: "tenant-1" },
            },
            {
              model: mockCalibrationDevice,
              as: "device",
              attributes: ["id", "name", "serialNumber"],
              required: false,
              where: { tenantId: "tenant-1" },
            },
          ],
          order: [["createdAt", "DESC"]],
        });
        expect(result.total).toBe(1);
        expect(result.nonConformances).toHaveLength(1);
      });
    });

    describe("updateNC", () => {
      it("should update and save NC if found", async () => {
        const mockNc = {
          id: "nc-1",
          title: "Old Title",
          save: jest.fn().mockResolvedValue(true),
        };
        mockNonConformance.findOne.mockResolvedValue(mockNc);

        const result = await qmsService.updateNC("tenant-1", "nc-1", {
          title: "New Title",
          status: "CLOSED",
        });

        expect(mockNonConformance.findOne).toHaveBeenCalledWith({
          where: { id: "nc-1", tenantId: "tenant-1" },
          transaction: "TX",
        });
        expect(mockNc.title).toBe("New Title");
        expect(mockNc.status).toBe("CLOSED");
        expect(mockNc.save).toHaveBeenCalled();
        expect(result.id).toBe("nc-1");
      });

      it("should throw 404 AppError if NC not found", async () => {
        mockNonConformance.findOne.mockResolvedValue(null);

        await expect(
          qmsService.updateNC("tenant-1", "nc-1", { title: "New" }),
        ).rejects.toThrow("Non-Conformance not found");
      });
    });
  });

  describe("CAPA", () => {
    describe("createCapa", () => {
      it("should create CAPA if associated NC exists", async () => {
        mockNonConformance.findOne.mockResolvedValue({ id: "nc-1" });
        mockQuery.mockResolvedValue([[{ seq: 5 }]]);
        mockCapa.create.mockImplementation((data) =>
          Promise.resolve({ id: "capa-1", ...data }),
        );

        const result = await qmsService.createCapa("tenant-1", {
          ncId: "nc-1",
          title: "Capa Title",
          actionPlan: "Plan",
          assignedTo: "user-2",
          dueDate: "2026-08-01",
        });

        expect(mockNonConformance.findOne).toHaveBeenCalledWith({
          where: { id: "nc-1", tenantId: "tenant-1" },
          transaction: "TX",
        });
        expect(mockCapa.count).not.toHaveBeenCalled();
        expect(claim()).toEqual({
          replacements: { tenantId: "tenant-1", kind: "CAPA", pattern: "^CAPA-([0-9]{1,9})$" },
          transaction: "TX",
        });
        expect(mockUser.findOne).toHaveBeenCalledWith({
          where: { id: "user-2", tenantId: "tenant-1" },
          attributes: ["id"],
          transaction: "TX",
        });
        expect(mockCapa.create).toHaveBeenCalledWith({
          tenantId: "tenant-1",
          capaNumber: "CAPA-00005",
          ncId: "nc-1",
          title: "Capa Title",
          actionPlan: "Plan",
          assignedTo: "user-2",
          dueDate: "2026-08-01",
          status: "DRAFT",
        }, { transaction: "TX" });
        expect(result.id).toBe("capa-1");
      });

      it("should throw 404 AppError if associated NC not found", async () => {
        mockNonConformance.findOne.mockResolvedValue(null);

        await expect(
          qmsService.createCapa("tenant-1", { ncId: "nc-1" }),
        ).rejects.toThrow("Non-Conformance not found");
      });

      it("an unassigned CAPA stores null assignee and due date, and looks up no user", async () => {
        mockNonConformance.findOne.mockResolvedValue({ id: "nc-1", ncNumber: "NC-00001" });
        mockCapa.create.mockImplementation((data) => Promise.resolve({ id: "capa-2", ...data }));

        await qmsService.createCapa("tenant-1", { ncId: "nc-1", title: "t", actionPlan: "p" });

        expect(mockUser.findOne).not.toHaveBeenCalled();
        expect(mockCapa.create).toHaveBeenCalledWith(
          expect.objectContaining({ capaNumber: "CAPA-00001", assignedTo: null, dueDate: null }),
          { transaction: "TX" },
        );
      });

      it("refuses an assignedTo outside the tenant with 404 and creates nothing", async () => {
        mockNonConformance.findOne.mockResolvedValue({ id: "nc-1" });
        mockUser.findOne.mockResolvedValue(null);

        const err = await qmsService
          .createCapa("tenant-1", { ncId: "nc-1", title: "t", actionPlan: "p", assignedTo: "foreign" })
          .catch((e) => e);

        expect(err.status).toBe(404);
        expect(err.message).toBe("Assignee not found");
        expect(mockQuery).not.toHaveBeenCalled();
        expect(mockCapa.create).not.toHaveBeenCalled();
      });
    });

    describe("getCapas", () => {
      it("should default to page 1 / limit 10 and omit the status filter", async () => {
        mockCapa.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

        const result = await qmsService.getCapas("tenant-1");

        expect(mockCapa.findAndCountAll).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { tenantId: "tenant-1" },
            limit: 10,
            offset: 0,
          }),
        );
        expect(result.page).toBe(1);
        expect(result.limit).toBe(10);
      });

      it("should offset correctly for a later page", async () => {
        mockCapa.findAndCountAll.mockResolvedValue({ count: 11, rows: [] });

        const result = await qmsService.getCapas("tenant-1", 2, 5);

        expect(mockCapa.findAndCountAll).toHaveBeenCalledWith(
          expect.objectContaining({ offset: 5, limit: 5 }),
        );
        expect(result.totalPages).toBe(3);
      });

      it("should return paginated list of CAPAs", async () => {
        mockCapa.findAndCountAll.mockResolvedValue({
          count: 1,
          rows: [{ id: "capa-1", title: "Capa 1" }],
        });

        const result = await qmsService.getCapas("tenant-1", 1, 10, "DRAFT");

        expect(mockCapa.findAndCountAll).toHaveBeenCalledWith({
          where: { tenantId: "tenant-1", status: "DRAFT" },
          limit: 10,
          offset: 0,
          include: [
            {
              model: mockNonConformance,
              as: "nonConformance",
              attributes: ["id", "ncNumber", "title"],
              required: false,
              where: { tenantId: "tenant-1" },
            },
            {
              model: mockUser,
              as: "assignee",
              attributes: ["id", "firstName", "lastName", "email"],
              required: false,
              where: { tenantId: "tenant-1" },
            },
          ],
          order: [["createdAt", "DESC"]],
        });
        expect(result.total).toBe(1);
        expect(result.capas).toHaveLength(1);
      });
    });

    describe("updateCapa", () => {
      it("should update and save CAPA if found", async () => {
        const mockCapaInstance = {
          id: "capa-1",
          title: "Old Title",
          save: jest.fn().mockResolvedValue(true),
        };
        mockCapa.findOne.mockResolvedValue(mockCapaInstance);

        const result = await qmsService.updateCapa("tenant-1", "capa-1", {
          title: "New Title",
          status: "CLOSED",
        });

        expect(mockCapa.findOne).toHaveBeenCalledWith({
          where: { id: "capa-1", tenantId: "tenant-1" },
          transaction: "TX",
        });
        expect(mockCapaInstance.title).toBe("New Title");
        expect(mockCapaInstance.status).toBe("CLOSED");
        expect(mockCapaInstance.save).toHaveBeenCalled();
        expect(result.id).toBe("capa-1");
      });

      // A-62 — the approver of a CAPA is the caller, never the body.
      it("a body approvedBy naming another user records the caller as approver", async () => {
        const capa = { id: "capa-1", approvedBy: null, save: jest.fn().mockResolvedValue(true) };
        mockCapa.findOne.mockResolvedValue(capa);

        await qmsService.updateCapa(
          "tenant-1",
          "capa-1",
          { approvedBy: "someone-else", verificationNotes: "ok" },
          { userId: "caller-1" },
        );

        expect(capa.approvedBy).toBe("caller-1");
        expect(capa.verificationNotes).toBe("ok");
      });

      it("a null approvedBy clears the approval, and an absent one leaves it", async () => {
        const capa = { id: "capa-1", approvedBy: "prior", save: jest.fn().mockResolvedValue(true) };
        mockCapa.findOne.mockResolvedValue(capa);

        await qmsService.updateCapa("tenant-1", "capa-1", { title: "t" }, { userId: "caller-1" });
        expect(capa.approvedBy).toBe("prior");

        await qmsService.updateCapa("tenant-1", "capa-1", { approvedBy: null }, { userId: "caller-1" });
        expect(capa.approvedBy).toBeNull();
      });

      it("records no approver when no actor is supplied", async () => {
        const capa = { id: "capa-1", approvedBy: null, save: jest.fn().mockResolvedValue(true) };
        mockCapa.findOne.mockResolvedValue(capa);

        await qmsService.updateCapa("tenant-1", "capa-1", { approvedBy: "someone-else" });
        expect(capa.approvedBy).toBeNull();
      });

      it("a new assignedTo must be a user of the tenant — 404 and nothing saved", async () => {
        const capa = { id: "capa-1", assignedTo: null, save: jest.fn() };
        mockCapa.findOne.mockResolvedValue(capa);
        mockUser.findOne.mockResolvedValue(null);

        const err = await qmsService
          .updateCapa("tenant-1", "capa-1", { assignedTo: "foreign" }, { userId: "caller-1" })
          .catch((e) => e);

        expect(err.status).toBe(404);
        expect(err.message).toBe("Assignee not found");
        expect(mockUser.findOne).toHaveBeenCalledWith({
          where: { id: "foreign", tenantId: "tenant-1" },
          attributes: ["id"],
          transaction: "TX",
        });
        expect(capa.assignedTo).toBeNull();
        expect(capa.save).not.toHaveBeenCalled();
      });

      it("an in-tenant assignedTo is saved, and null unassigns without a lookup", async () => {
        const capa = { id: "capa-1", assignedTo: null, save: jest.fn().mockResolvedValue(true) };
        mockCapa.findOne.mockResolvedValue(capa);

        await qmsService.updateCapa("tenant-1", "capa-1", { assignedTo: "user-2" });
        expect(capa.assignedTo).toBe("user-2");

        mockUser.findOne.mockClear();
        await qmsService.updateCapa("tenant-1", "capa-1", { assignedTo: null });
        expect(capa.assignedTo).toBeNull();
        expect(mockUser.findOne).not.toHaveBeenCalled();
      });

      it("should throw 404 AppError if CAPA not found", async () => {
        mockCapa.findOne.mockResolvedValue(null);

        await expect(
          qmsService.updateCapa("tenant-1", "capa-1", { title: "New" }),
        ).rejects.toThrow("CAPA not found");
      });
    });
  });
});
