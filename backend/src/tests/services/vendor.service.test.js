const { describe, it, expect, beforeEach } = require("@jest/globals");

jest.mock("sequelize", () => ({
  Op: {
    or: Symbol("or"),
    like: Symbol("like"),
    iLike: Symbol("iLike"),
  },
}));

jest.mock("../../config", () => ({
  db: { transaction: jest.fn() },
}));

jest.mock("../../models", () => ({
  Vendors: {
    findAndCountAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
  },
}));

jest.mock("../../utils/appError.util", () => {
  class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.name = "AppError";
      this.status = status;
    }
  }
  return { AppError };
});

const { Vendors } = require("../../models");

const {
  fetchVendors,
  getVendorById,
  createVendor,
  updateVendor,
  deleteVendor,
  qualifyVendor,
} = require("../../services/vendor.service");

// ---- helpers ----
const expectRejectsWithMessage = async (promise, message) => {
  try {
    await promise;
    expect(true).toBe(false);
  } catch (err) {
    expect(err).toBeDefined();
    const actual = (err && err.message) || String(err);
    expect(actual).toContain(message);
  }
};

const mockVendor = (extra = {}) => ({
  id: "v-1",
  name: "Acme Corp",
  status: "active",
  type: "supplier",
  ...extra,
  toJSON: () => ({ ...extra, id: "v-1", name: "Acme Corp", status: "active", type: "supplier" }),
});

// ================================================================
describe("vendor.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ================================================================
  describe("fetchVendors", () => {
    it("should fetch vendors with pagination", async () => {
      Vendors.findAndCountAll.mockResolvedValueOnce({
        rows: [mockVendor({ id: "v-1" })],
        count: 1,
      });

      const result = await fetchVendors({
        tenantId: "t-1",
        page: 1,
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.data.rows).toHaveLength(1);
      expect(result.data.meta.total).toBe(1);
      expect(result.data.meta.page).toBe(1);
      expect(result.data.meta.totalPages).toBe(1);
    });

    it("should filter by search term", async () => {
      Vendors.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });
      await fetchVendors({ tenantId: "t-1", find: "Acme" });

      // Op.like is { [Op.like]: '%Acme%' }
      const callArgs = Vendors.findAndCountAll.mock.calls[0][0];
      expect(callArgs.where.name).toBeDefined();
      expect(typeof callArgs.where.name).toBe("object");
    });

    it("should filter by status", async () => {
      Vendors.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });
      await fetchVendors({ tenantId: "t-1", status: "active" });

      expect(Vendors.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "active" }),
        }),
      );
    });

    it("should filter by type", async () => {
      Vendors.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });
      await fetchVendors({ tenantId: "t-1", type: "supplier" });

      expect(Vendors.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: "supplier" }),
        }),
      );
    });

    it("should cap limit to MAX_LIMIT", async () => {
      Vendors.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });
      await fetchVendors({ tenantId: "t-1", limit: 9999 });

      const callArgs = Vendors.findAndCountAll.mock.calls[0][0];
      expect(callArgs.limit).toBe(200); // MAX_LIMIT default
    });

    it("should propagate error on failure", async () => {
      Vendors.findAndCountAll.mockRejectedValueOnce(new Error("DB error"));
      await expectRejectsWithMessage(fetchVendors({ tenantId: "t-1" }), "DB error");
    });
  });

  // ================================================================
  describe("getVendorById", () => {
    it("should return vendor by ID", async () => {
      Vendors.findOne.mockResolvedValueOnce(mockVendor());

      const result = await getVendorById("t-1", "v-1");
      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
    });

    it("should throw 404 when vendor not found", async () => {
      Vendors.findOne.mockResolvedValueOnce(null);
      await expectRejectsWithMessage(
        getVendorById("t-1", "missing"),
        "Vendor not found",
      );
    });

    it("should propagate database error", async () => {
      Vendors.findOne.mockRejectedValueOnce(new Error("Query failed"));
      await expectRejectsWithMessage(
        getVendorById("t-1", "v-1"),
        "Query failed",
      );
    });
  });

  // ================================================================
  describe("createVendor", () => {
    it("should create a new vendor", async () => {
      const created = mockVendor({ id: "v-new" });
      Vendors.create.mockResolvedValueOnce(created);

      const result = await createVendor("t-1", {
        name: "New Vendor",
        type: "supplier",
        status: "active",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe(201);
      expect(Vendors.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "t-1",
          name: "New Vendor",
        }),
      );
    });

    it("should propagate database error", async () => {
      Vendors.create.mockRejectedValueOnce(new Error("Create failed"));
      await expectRejectsWithMessage(
        createVendor("t-1", { name: "X" }),
        "Create failed",
      );
    });
  });

  // ================================================================
  describe("updateVendor", () => {
    it("should update vendor fields", async () => {
      const vendor = mockVendor({ id: "v-1" });
      vendor.update = jest.fn().mockResolvedValue({});
      Vendors.findOne.mockResolvedValueOnce(vendor);

      const result = await updateVendor("t-1", "v-1", {
        name: "Updated Name",
        status: "inactive",
      });

      expect(result.success).toBe(true);
      expect(vendor.update).toHaveBeenCalledWith({
        name: "Updated Name",
        status: "inactive",
      });
    });

    it("should throw 404 when vendor not found", async () => {
      Vendors.findOne.mockResolvedValueOnce(null);
      await expectRejectsWithMessage(
        updateVendor("t-1", "missing", { name: "X" }),
        "Vendor not found",
      );
    });

    it("should propagate database error", async () => {
      Vendors.findOne.mockRejectedValueOnce(new Error("Update failed"));
      await expectRejectsWithMessage(
        updateVendor("t-1", "v-1", { name: "X" }),
        "Update failed",
      );
    });
  });

  // ================================================================
  describe("deleteVendor", () => {
    it("should delete a vendor", async () => {
      const vendor = mockVendor({ id: "v-del" });
      vendor.destroy = jest.fn().mockResolvedValue(1);
      Vendors.findOne.mockResolvedValueOnce(vendor);

      const result = await deleteVendor("t-1", "v-del");
      expect(result.success).toBe(true);
      expect(vendor.destroy).toHaveBeenCalled();
    });

    it("should throw 404 when vendor not found", async () => {
      Vendors.findOne.mockResolvedValueOnce(null);
      await expectRejectsWithMessage(
        deleteVendor("t-1", "missing"),
        "Vendor not found",
      );
    });

    it("should propagate database error", async () => {
      Vendors.findOne.mockRejectedValueOnce(new Error("Delete failed"));
      await expectRejectsWithMessage(
        deleteVendor("t-1", "v-1"),
        "Delete failed",
      );
    });
  });

  // ================================================================
  describe("qualifyVendor", () => {
    it("should qualify a vendor with all fields", async () => {
      const vendor = mockVendor({ id: "v-q" });
      vendor.approvalStatus = "pending";
      vendor.scorecard = null;
      vendor.lastAuditDate = null;
      vendor.nextAuditDate = null;
      vendor.save = jest.fn().mockResolvedValue({});

      Vendors.findOne.mockResolvedValueOnce(vendor);

      const result = await qualifyVendor({
        tenantId: "t-1",
        id: "v-q",
        approvalStatus: "approved",
        scorecard: 95,
        lastAuditDate: "2025-01-01",
        nextAuditDate: "2026-01-01",
      });

      expect(vendor.approvalStatus).toBe("approved");
      expect(vendor.scorecard).toBe(95);
      expect(vendor.lastAuditDate).toBe("2025-01-01");
      expect(vendor.nextAuditDate).toBe("2026-01-01");
      expect(vendor.save).toHaveBeenCalled();
    });

    it("should qualify a vendor with partial fields", async () => {
      const vendor = mockVendor({ id: "v-p" });
      vendor.approvalStatus = "pending";
      vendor.save = jest.fn().mockResolvedValue({});

      Vendors.findOne.mockResolvedValueOnce(vendor);

      await qualifyVendor({
        tenantId: "t-1",
        id: "v-p",
        approvalStatus: "approved",
      });

      expect(vendor.approvalStatus).toBe("approved");
      expect(vendor.save).toHaveBeenCalled();
    });

    it("should throw 404 when vendor not found", async () => {
      Vendors.findOne.mockResolvedValueOnce(null);
      await expectRejectsWithMessage(
        qualifyVendor({ tenantId: "t-1", id: "missing" }),
        "Vendor not found",
      );
    });

    it("should propagate database error", async () => {
      Vendors.findOne.mockRejectedValueOnce(new Error("DB down"));
      await expectRejectsWithMessage(
        qualifyVendor({ tenantId: "t-1", id: "v-1" }),
        "DB down",
      );
    });

    it("should not overwrite scorecard when omitted but should set it to 0 when explicitly 0", async () => {
      // scorecard uses `!== undefined`, so 0 (falsy) must still be assigned.
      const vendor = mockVendor({ id: "v-z" });
      vendor.scorecard = 42;
      vendor.save = jest.fn().mockResolvedValue({});
      Vendors.findOne.mockResolvedValueOnce(vendor);

      await qualifyVendor({ tenantId: "t-1", id: "v-z", scorecard: 0 });

      expect(vendor.scorecard).toBe(0);
    });

    it("should leave all optional fields untouched when none are supplied", async () => {
      const vendor = mockVendor({ id: "v-none" });
      vendor.approvalStatus = "pending";
      vendor.scorecard = 42;
      vendor.lastAuditDate = "2020-01-01";
      vendor.nextAuditDate = "2021-01-01";
      vendor.save = jest.fn().mockResolvedValue({});
      Vendors.findOne.mockResolvedValueOnce(vendor);

      await qualifyVendor({ tenantId: "t-1", id: "v-none" });

      expect(vendor.approvalStatus).toBe("pending");
      expect(vendor.scorecard).toBe(42);
      expect(vendor.lastAuditDate).toBe("2020-01-01");
      expect(vendor.nextAuditDate).toBe("2021-01-01");
      expect(vendor.save).toHaveBeenCalled();
    });
  });

  // ================================================================
  // Branch coverage: transform helpers + error-normalisation fallbacks
  // ================================================================
  describe("transform helpers (via fetchVendors)", () => {
    it("should map a plain (non-Sequelize) row by spreading it when toJSON is absent", async () => {
      Vendors.findAndCountAll.mockResolvedValueOnce({
        rows: [{ id: "plain-1", name: "Plain Vendor" }],
        count: 1,
      });

      const result = await fetchVendors({ tenantId: "t-1" });

      expect(result.data.rows).toEqual([{ id: "plain-1", name: "Plain Vendor" }]);
    });

    it("should map a null row to null rather than throwing", async () => {
      Vendors.findAndCountAll.mockResolvedValueOnce({ rows: [null], count: 1 });

      const result = await fetchVendors({ tenantId: "t-1" });

      expect(result.data.rows).toEqual([null]);
    });

    it("should return an empty rows array when the model returns undefined rows", async () => {
      Vendors.findAndCountAll.mockResolvedValueOnce({ rows: undefined, count: 0 });

      const result = await fetchVendors({ tenantId: "t-1" });

      expect(result.data.rows).toEqual([]);
    });

    it("should fall back to DEFAULT_LIMIT when limit is not numeric", async () => {
      Vendors.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });

      await fetchVendors({ tenantId: "t-1", limit: "not-a-number" });

      expect(Vendors.findAndCountAll.mock.calls[0][0].limit).toBe(25); // DEFAULT_LIMIT
    });
  });

  describe("error normalisation fallbacks", () => {
    // Every exported method funnels failures through
    // `{ status: error.status || 500, message: error.message || "<default>" }`.
    // A bare throw with neither field must surface the 500 + per-method default.
    const cases = [
      ["fetchVendors", () => fetchVendors({ tenantId: "t-1" }), "findAndCountAll", "Failed to fetch vendors"],
      ["getVendorById", () => getVendorById("t-1", "v-1"), "findOne", "Failed to retrieve vendor"],
      ["createVendor", () => createVendor("t-1", { name: "X" }), "create", "Failed to create vendor"],
      ["updateVendor", () => updateVendor("t-1", "v-1", { name: "X" }), "findOne", "Failed to update vendor"],
      ["deleteVendor", () => deleteVendor("t-1", "v-1"), "findOne", "Failed to delete vendor"],
      ["qualifyVendor", () => qualifyVendor({ tenantId: "t-1", id: "v-1" }), "findOne", "Failed to qualify vendor"],
    ];

    it.each(cases)(
      "%s should default to status 500 and its own message when the error carries neither",
      async (_name, invoke, mockFn, defaultMessage) => {
        // A rejection with no `status` and no `message`.
        Vendors[mockFn].mockRejectedValueOnce({});

        await expect(invoke()).rejects.toEqual({
          status: 500,
          message: defaultMessage,
        });
      },
    );

    it.each(cases)(
      "%s should preserve a status carried on the thrown error",
      async (_name, invoke, mockFn) => {
        Vendors[mockFn].mockRejectedValueOnce({ status: 409, message: "Conflict" });

        await expect(invoke()).rejects.toEqual({
          status: 409,
          message: "Conflict",
        });
      },
    );
  });
});
