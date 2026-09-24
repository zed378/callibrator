const mockSopDocument = {
  count: jest.fn(),
  create: jest.fn(),
  findAndCountAll: jest.fn(),
  findOne: jest.fn(),
};

const mockSopTrainingAcknowledgment = {
  bulkCreate: jest.fn(),
  findOne: jest.fn(),
};

const mockUser = {
  findAll: jest.fn(),
};

const mockAuditLog = {
  create: jest.fn(),
};

const mockModels = {
  SopDocument: mockSopDocument,
  SopTrainingAcknowledgment: mockSopTrainingAcknowledgment,
  User: mockUser,
  AuditLog: mockAuditLog,
};

jest.mock("../../models", () => mockModels);

// A-28: the release, its training fan-out and its audit row share one
// transaction. The sentinel handle lets the assertions prove all three carry it.
jest.mock("../../config", () => ({
  db: { transaction: jest.fn(async (cb) => cb("TX")) },
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const sopService = require("../../services/sop.service");

describe("sop.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createDocument", () => {
    it("should create SOP document with formatted number", async () => {
      mockSopDocument.count.mockResolvedValue(5);
      mockSopDocument.create.mockImplementation((data) =>
        Promise.resolve({ id: "sop-1", ...data }),
      );

      const result = await sopService.createDocument("tenant-1", "user-1", {
        title: "Test SOP",
        version: "1.1",
        contentUrl: "https://example.com/sop",
        requiresTraining: false,
      });

      expect(mockSopDocument.count).toHaveBeenCalledWith({
        where: { tenantId: "tenant-1" },
      });
      expect(mockSopDocument.create).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        authorId: "user-1",
        documentNumber: "SOP-0006",
        title: "Test SOP",
        version: "1.1",
        contentUrl: "https://example.com/sop",
        requiresTraining: false,
        status: "DRAFT",
      });
      expect(result.id).toBe("sop-1");
    });

    it("should default version to 1.0 and requiresTraining to true", async () => {
      mockSopDocument.count.mockResolvedValue(0);
      mockSopDocument.create.mockImplementation((data) =>
        Promise.resolve({ id: "sop-2", ...data }),
      );

      await sopService.createDocument("tenant-1", "user-1", {
        title: "Minimal SOP",
      });

      expect(mockSopDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          documentNumber: "SOP-0001",
          version: "1.0",
          requiresTraining: true,
          status: "DRAFT",
        }),
      );
    });

    it("should preserve requiresTraining:false rather than defaulting it", async () => {
      mockSopDocument.count.mockResolvedValue(0);
      mockSopDocument.create.mockImplementation((data) =>
        Promise.resolve({ id: "sop-3", ...data }),
      );

      await sopService.createDocument("tenant-1", "user-1", {
        title: "No training",
        requiresTraining: false,
      });

      // `!== undefined ? x : true` must not coerce an explicit false to true.
      expect(mockSopDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({ requiresTraining: false }),
      );
    });
  });

  describe("getDocuments", () => {
    it("should default to page 1 / limit 10 and omit the status filter", async () => {
      mockSopDocument.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      const result = await sopService.getDocuments("tenant-1");

      expect(mockSopDocument.findAndCountAll).toHaveBeenCalledWith(
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
      mockSopDocument.findAndCountAll.mockResolvedValue({ count: 7, rows: [] });

      const result = await sopService.getDocuments("tenant-1", 2, 5);

      expect(mockSopDocument.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 5, limit: 5 }),
      );
      expect(result.totalPages).toBe(2);
    });

    it("should return paginated list of documents", async () => {
      mockSopDocument.findAndCountAll.mockResolvedValue({
        count: 1,
        rows: [{ id: "sop-1", title: "SOP 1" }],
      });

      const result = await sopService.getDocuments("tenant-1", 1, 10, "PUBLISHED");

      expect(mockSopDocument.findAndCountAll).toHaveBeenCalledWith({
        where: { tenantId: "tenant-1", status: "PUBLISHED" },
        limit: 10,
        offset: 0,
        include: [
          {
            model: mockUser,
            as: "author",
            attributes: ["id", "firstName", "lastName"],
            required: false, // A-90: LEFT JOIN — see includes.a90.test.js
          },
        ],
        order: [["createdAt", "DESC"]],
      });
      expect(result.total).toBe(1);
      expect(result.documents).toHaveLength(1);
    });
  });

  describe("publishDocument", () => {
    const AUTHOR = "user-author";
    const PUBLISHER = "user-publisher";

    it("should publish SOP and create bulk training acknowledgments if required", async () => {
      const mockDoc = {
        id: "sop-1",
        documentNumber: "SOP-0001",
        version: "1.0",
        authorId: AUTHOR,
        requiresTraining: true,
        status: "DRAFT",
        save: jest.fn().mockResolvedValue(true),
      };
      mockSopDocument.findOne.mockResolvedValue(mockDoc);
      mockUser.findAll.mockResolvedValue([
        { id: "user-1" },
        { id: "user-2" },
      ]);

      const result = await sopService.publishDocument("tenant-1", "sop-1", PUBLISHER);

      expect(mockSopDocument.findOne).toHaveBeenCalledWith({
        where: { id: "sop-1", tenantId: "tenant-1" },
      });
      expect(mockDoc.status).toBe("PUBLISHED");
      expect(mockDoc.publishedDate).toBeDefined();
      expect(mockDoc.save).toHaveBeenCalledWith({ transaction: "TX" });
      expect(mockUser.findAll).toHaveBeenCalledWith({
        where: { tenantId: "tenant-1" },
        transaction: "TX",
      });
      expect(mockSopTrainingAcknowledgment.bulkCreate).toHaveBeenCalledWith(
        [
          { tenantId: "tenant-1", documentId: "sop-1", userId: "user-1", status: "PENDING" },
          { tenantId: "tenant-1", documentId: "sop-1", userId: "user-2", status: "PENDING" },
        ],
        { transaction: "TX" },
      );
      // The release is attributable: who published, and who had authored it.
      expect(mockAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "tenant-1",
          userId: PUBLISHER,
          action: "APPROVE",
          resourceType: "SopDocument",
          resourceId: "sop-1",
          changes: expect.objectContaining({
            before: { status: "DRAFT" },
            authorId: AUTHOR,
          }),
        }),
        { transaction: "TX" },
      );
      expect(result.id).toBe("sop-1");
    });

    it("should publish without assigning training when it is not required", async () => {
      const mockDoc = {
        id: "sop-9",
        documentNumber: "SOP-0009",
        authorId: AUTHOR,
        requiresTraining: false,
        status: "UNDER_REVIEW",
        save: jest.fn().mockResolvedValue(true),
      };
      mockSopDocument.findOne.mockResolvedValue(mockDoc);

      const result = await sopService.publishDocument("tenant-1", "sop-9", PUBLISHER);

      expect(mockDoc.status).toBe("PUBLISHED");
      expect(mockDoc.save).toHaveBeenCalledWith({ transaction: "TX" });
      // No fan-out when the document needs no training.
      expect(mockUser.findAll).not.toHaveBeenCalled();
      expect(mockSopTrainingAcknowledgment.bulkCreate).not.toHaveBeenCalled();
      expect(result.id).toBe("sop-9");
    });

    it("should throw 404 AppError if document not found", async () => {
      mockSopDocument.findOne.mockResolvedValue(null);

      await expect(
        sopService.publishDocument("tenant-1", "sop-1", PUBLISHER),
      ).rejects.toThrow("Document not found");
    });

    // ---- A-28: separation of duties ----
    it("refuses with 409 when the publisher is the author, and changes nothing", async () => {
      const mockDoc = {
        id: "sop-2",
        documentNumber: "SOP-0002",
        authorId: AUTHOR,
        requiresTraining: true,
        status: "DRAFT",
        save: jest.fn(),
      };
      mockSopDocument.findOne.mockResolvedValue(mockDoc);

      await expect(
        sopService.publishDocument("tenant-1", "sop-2", AUTHOR),
      ).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining("SOP-0002 was authored by you"),
      });

      expect(mockDoc.status).toBe("DRAFT");
      expect(mockDoc.save).not.toHaveBeenCalled();
      expect(mockSopTrainingAcknowledgment.bulkCreate).not.toHaveBeenCalled();
      expect(mockAuditLog.create).not.toHaveBeenCalled();
    });

    it.each(["PUBLISHED", "ARCHIVED"])(
      "refuses with a 409 state explanation when the SOP is already %s",
      async (status) => {
        const mockDoc = {
          id: "sop-3",
          documentNumber: "SOP-0003",
          authorId: AUTHOR,
          requiresTraining: true,
          status,
          save: jest.fn(),
        };
        mockSopDocument.findOne.mockResolvedValue(mockDoc);

        await expect(
          sopService.publishDocument("tenant-1", "sop-3", PUBLISHER),
        ).rejects.toMatchObject({
          status: 409,
          message: expect.stringContaining(`SOP-0003 is ${status} and cannot be published`),
        });

        expect(mockDoc.save).not.toHaveBeenCalled();
        expect(mockAuditLog.create).not.toHaveBeenCalled();
      },
    );
  });

  describe("acknowledgeTraining", () => {
    it("should complete training acknowledgment if found", async () => {
      const mockAck = {
        tenantId: "tenant-1",
        userId: "user-1",
        documentId: "sop-1",
        status: "PENDING",
        save: jest.fn().mockResolvedValue(true),
      };
      mockSopTrainingAcknowledgment.findOne.mockResolvedValue(mockAck);

      const result = await sopService.acknowledgeTraining("tenant-1", "user-1", "sop-1");

      expect(mockSopTrainingAcknowledgment.findOne).toHaveBeenCalledWith({
        where: { tenantId: "tenant-1", userId: "user-1", documentId: "sop-1" },
      });
      expect(mockAck.status).toBe("COMPLETED");
      expect(mockAck.acknowledgedAt).toBeDefined();
      expect(mockAck.save).toHaveBeenCalledWith({ transaction: "TX" });
      expect(result.status).toBe("COMPLETED");
      // A-145 — the training record and its audit row share the transaction.
      expect(mockAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "tenant-1",
          userId: "user-1",
          action: "UPDATE",
          resourceType: "SopTrainingAcknowledgment",
          changes: expect.objectContaining({
            operation: "ACKNOWLEDGE_TRAINING",
            documentId: "sop-1",
            before: { status: "PENDING" },
          }),
        }),
        { transaction: "TX" },
      );
    });

    it.each([
      [new Date("2026-09-01T08:00:00.000Z"), "2026-09-01T08:00:00.000Z"],
      [null, "an earlier date"],
    ])(
      "A-145: an acknowledgement already COMPLETED (at %s) is a 409 and is not rewritten",
      async (acknowledgedAt, named) => {
        const mockAck = {
          status: "COMPLETED",
          acknowledgedAt,
          save: jest.fn(),
        };
        mockSopTrainingAcknowledgment.findOne.mockResolvedValue(mockAck);

        await expect(
          sopService.acknowledgeTraining("tenant-1", "user-1", "sop-1"),
        ).rejects.toMatchObject({ status: 409, message: expect.stringContaining(named) });
        expect(mockAck.acknowledgedAt).toBe(acknowledgedAt);
        expect(mockAck.save).not.toHaveBeenCalled();
        expect(mockAuditLog.create).not.toHaveBeenCalled();
      },
    );

    it("should throw 404 AppError if training acknowledgment not found", async () => {
      mockSopTrainingAcknowledgment.findOne.mockResolvedValue(null);

      await expect(
        sopService.acknowledgeTraining("tenant-1", "user-1", "sop-1"),
      ).rejects.toThrow("Training acknowledgment not found");
    });
  });
});
