/**
 * P6-02 — `PATCH /vendors/:vendorId/qualify` had no validator.
 *
 * `vendors.approval_status` is a PostgreSQL enum of upper-case values
 * (APPROVED, PENDING, REJECTED, CONDITIONAL). The frontend's approve and reject
 * buttons send "approved" / "rejected" (VendorsTable.tsx) and the E2E spec sent
 * "Approved"; both reached the database unchanged and failed as an invalid enum
 * value — a 500 for every qualification. Found by the live E2E suite.
 *
 * Drives the REAL route (routes/api/vendor.route.js) with the real validation
 * middleware and the real qualifyVendor schema. Stubbed: `auth` and
 * `dynamicAccess` (the gate is not under test) and the service, so what
 * reaches it is observable.
 */
const VENDOR = "7c0e2d4a-1111-4a2b-9c3d-000000000602";

jest.mock("../../middlewares/auth.middleware", () => ({
  auth: (req, res, next) => {
    req.user = { id: "user-1", tenantId: "tenant-1" };
    next();
  },
}));
jest.mock("../../middlewares/dynamicAccess.middleware", () => ({
  dynamicAccess: () => (req, res, next) => next(),
}));
jest.mock("../../services/vendor.service", () => ({
  fetchVendors: jest.fn(),
  getVendorById: jest.fn(),
  createVendor: jest.fn(),
  updateVendor: jest.fn(),
  deleteVendor: jest.fn(),
  qualifyVendor: jest.fn(async (args) => ({ id: args.id, approvalStatus: args.approvalStatus })),
}));

const vendorService = require("../../services/vendor.service");
const router = require("../../routes/api/vendor.route");

// Express's own router.handle with a minimal req/res pair — supertest is not a
// dependency of this workspace (same harness as admin.flags.a174).
const qualify = (body) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      send(payload) {
        return this.json(payload);
      },
      setHeader() {
        return this;
      },
      end() {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: null });
        return this;
      },
    };
    const req = {
      method: "PATCH",
      url: `/${VENDOR}/qualify`,
      originalUrl: `/api/v1/vendors/${VENDOR}/qualify`,
      body,
      query: {},
      params: {},
      headers: { "user-agent": "jest-agent" },
      ip: "10.0.0.7",
      get: () => undefined,
    };
    router.handle(req, res, (err) =>
      resolve({
        status: err ? err.status || err.statusCode || 500 : 404,
        body: { message: err ? err.message : "no route" },
      }),
    );
  });

describe("P6-02 — PATCH /vendors/:vendorId/qualify validates approvalStatus", () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ["approved", "APPROVED"], // what the frontend's approve button sends
    ["rejected", "REJECTED"], // what the frontend's reject button sends
    ["Approved", "APPROVED"],
    [" conditional ", "CONDITIONAL"],
    ["PENDING", "PENDING"],
  ])("stores %j in the enum's case as %s", async (sent, stored) => {
    const res = await qualify({ approvalStatus: sent, scorecard: 88 });

    expect(res.status).toBe(200);
    expect(vendorService.qualifyVendor).toHaveBeenCalledWith(
      expect.objectContaining({ id: VENDOR, tenantId: "tenant-1", approvalStatus: stored, scorecard: 88 }),
    );
  });

  it.each([["qualified"], ["APPROVED!"], [""], [7]])(
    "refuses the approvalStatus %j with a 400, before the service",
    async (approvalStatus) => {
      const res = await qualify({ approvalStatus });

      expect(res.status).toBe(400);
      expect(vendorService.qualifyVendor).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["a scorecard above 100", { scorecard: 101 }],
    ["a fractional scorecard", { scorecard: 8.5 }],
    ["a malformed audit date", { lastAuditDate: "next tuesday" }],
  ])("refuses %s with a 400", async (_name, body) => {
    const res = await qualify(body);

    expect(res.status).toBe(400);
    expect(vendorService.qualifyVendor).not.toHaveBeenCalled();
  });

  it("accepts the dates and a null scorecard the frontend may send", async () => {
    const res = await qualify({
      approvalStatus: "approved",
      scorecard: null,
      lastAuditDate: "2026-01-15",
      nextAuditDate: "2027-01-15",
    });

    expect(res.status).toBe(200);
    expect(vendorService.qualifyVendor).toHaveBeenCalledTimes(1);
  });
});
