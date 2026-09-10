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

const mockUser = {};
const mockCalibrationDevice = {};

const mockModels = {
  NonConformance: mockNonConformance,
  Capa: mockCapa,
  User: mockUser,
  CalibrationDevice: mockCalibrationDevice,
};

jest.mock("../../models", () => mockModels);
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
  });

  describe("Non-Conformance (NC)", () => {
    describe("createNC", () => {
      it("should create a non-conformance with formatted ncNumber", async () => {
        mockNonConformance.count.mockResolvedValue(2);
        mockNonConformance.create.mockImplementation((data) =>
          Promise.resolve({ id: "nc-1", ...data }),
        );

        const result = await qmsService.createNC("tenant-1", "user-1", {
          title: "Test NC",
          description: "Test Description",
          severity: "HIGH",
          deviceId: "device-1",
        });

        expect(mockNonConformance.count).toHaveBeenCalledWith({
          where: { tenantId: "tenant-1" },
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
          status: "OPEN",
        });
        expect(result.id).toBe("nc-1");
      });

      it("should default severity to MEDIUM and dateIdentified to now", async () => {
        mockNonConformance.count.mockResolvedValue(0);
        mockNonConformance.create.mockImplementation((data) =>
          Promise.resolve({ id: "nc-2", ...data }),
        );

        await qmsService.createNC("tenant-1", "user-1", { title: "Minimal" });

        expect(mockNonConformance.create).toHaveBeenCalledWith(
          expect.objectContaining({
            ncNumber: "NC-00001",
            severity: "MEDIUM",
            status: "OPEN",
            dateIdentified: expect.any(Date),
          }),
        );
      });

      it("should honour an explicitly supplied dateIdentified", async () => {
        const when = new Date("2026-01-15T00:00:00Z");
        mockNonConformance.count.mockResolvedValue(0);
        mockNonConformance.create.mockImplementation((data) =>
          Promise.resolve({ id: "nc-3", ...data }),
        );

        await qmsService.createNC("tenant-1", "user-1", {
          title: "Dated",
          dateIdentified: when,
        });

        expect(mockNonConformance.create).toHaveBeenCalledWith(
          expect.objectContaining({ dateIdentified: when }),
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
          include: [
            {
              model: mockUser,
              as: "reporter",
              attributes: ["id", "firstName", "lastName", "email"],
            },
            {
              model: mockCalibrationDevice,
              as: "device",
              attributes: ["id", "name", "serialNumber"],
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
        mockCapa.count.mockResolvedValue(4);
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
        });
        expect(mockCapa.count).toHaveBeenCalledWith({
          where: { tenantId: "tenant-1" },
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
        });
        expect(result.id).toBe("capa-1");
      });

      it("should throw 404 AppError if associated NC not found", async () => {
        mockNonConformance.findOne.mockResolvedValue(null);

        await expect(
          qmsService.createCapa("tenant-1", { ncId: "nc-1" }),
        ).rejects.toThrow("Non-Conformance not found");
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
            },
            {
              model: mockUser,
              as: "assignee",
              attributes: ["id", "firstName", "lastName", "email"],
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
          status: "COMPLETED",
        });

        expect(mockCapa.findOne).toHaveBeenCalledWith({
          where: { id: "capa-1", tenantId: "tenant-1" },
        });
        expect(mockCapaInstance.title).toBe("New Title");
        expect(mockCapaInstance.status).toBe("COMPLETED");
        expect(mockCapaInstance.save).toHaveBeenCalled();
        expect(result.id).toBe("capa-1");
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
