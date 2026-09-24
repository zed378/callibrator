/**
 * A-112 — calibration-record and tenant controllers send a non-2xx service
 * result as an ERROR envelope (`success: false`, `data: null`).
 *
 * Both controllers forwarded every returned service result through
 * `success(res, result.data, null, result.message, result.status)`:
 *  - calibrationRecords.service RETURNS its not-found outcomes as
 *    `{ success: false, status: 404, ... }`, so a missing record answered
 *    HTTP 404 with `success: true` in the body;
 *  - tenant.controller special-cased `status === 404` (and 400 on delete) by
 *    hand, handler by handler, so any other non-2xx result — a 409, a 403 —
 *    went out with `success: true`, and the logo handlers checked nothing.
 * Both now use utils/response.util.js#sendResult (A-103's rule).
 *
 * Runs the controllers against the REAL response.util and the REAL validators;
 * only the services are doubled. The controllers' own test files mock
 * response.util, so they cannot see this defect.
 */

jest.mock("../../services/calibrationRecords.service", () => ({
  fetchCalibrationRecords: jest.fn(),
  fetchSpecificCalibrationRecord: jest.fn(),
  createCalibrationRecord: jest.fn(),
  correctCalibrationRecord: jest.fn(),
  voidCalibrationRecord: jest.fn(),
}));

jest.mock("../../services/tenant.service", () => ({
  fetchTenants: jest.fn(),
  fetchSpecificTenant: jest.fn(),
  createTenant: jest.fn(),
  updateTenant: jest.fn(),
  deleteTenant: jest.fn(),
  getPublicBranding: jest.fn(),
  getTenantSettings: jest.fn(),
  updateTenantSettings: jest.fn(),
  getTenantUserCount: jest.fn(),
}));

jest.mock("../../services/tenantUpload.service", () => ({
  updateTenantLogo: jest.fn(),
  removeTenantLogo: jest.fn(),
}));

jest.mock("../../utils/upload.util", () => ({
  deleteUpload: jest.fn(),
}));

const calibrationRecordsController = require("../../controllers/calibrationRecords.controller");
const calibrationRecordsService = require("../../services/calibrationRecords.service");
const tenantController = require("../../controllers/tenant.controller");
const tenantService = require("../../services/tenant.service");
const tenantUploadService = require("../../services/tenantUpload.service");

const RECORD_ID = "0b3f8a52-6f0e-4c1b-9a3e-2f7d5c1e9a01";
const DEVICE_ID = "5d2c1e77-8a4b-4f3e-b1c2-9e8d7f6a5b4c";
const TENANT_ID = "550e8400-e29b-41d4-a716-446655440001";

const makeRes = () => {
  const res = { statusCode: null, body: null, headersSent: false };
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body) => {
    res.body = body;
    res.headersSent = true;
    return res;
  });
  return res;
};

const makeReq = (overrides = {}) => ({
  user: { id: "user-1", tenantId: TENANT_ID, role: { name: "SUPER_ADMIN" } },
  query: {},
  params: {},
  body: {},
  headers: { "user-agent": "jest-agent" },
  ip: "10.0.0.9",
  ...overrides,
});

const failure = (status, message) => ({ success: false, status, message, data: null });

/**
 * Run a handler and return the response. asyncHandler forwards a thrown error
 * to `next`; a handler that throws here is a test failure, not a response.
 */
const run = async (handler, req) => {
  const res = makeRes();
  const next = jest.fn();
  await handler(req, res, next);
  expect(next).not.toHaveBeenCalled();
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// calibrationRecords.controller
// ---------------------------------------------------------------------------

// [handler, service method, request]
const RECORD_HANDLERS = [
  [
    "getSpecificCalibrationRecord",
    "fetchSpecificCalibrationRecord",
    { params: { calibrationRecordId: RECORD_ID } },
  ],
  [
    "createCalibrationRecord",
    "createCalibrationRecord",
    { body: { deviceId: DEVICE_ID } },
  ],
  [
    "correctCalibrationRecord",
    "correctCalibrationRecord",
    { params: { calibrationRecordId: RECORD_ID }, body: { notes: "x", reason: "misread" } },
  ],
  [
    "voidCalibrationRecord",
    "voidCalibrationRecord",
    { params: { calibrationRecordId: RECORD_ID }, body: { reason: "entered twice" } },
  ],
];

describe("A-112 — calibrationRecords controller: a non-2xx result is an error envelope", () => {
  describe.each(RECORD_HANDLERS)("%s", (handler, method, request) => {
    it("a returned 404 goes out as HTTP 404 with success: false and no data", async () => {
      calibrationRecordsService[method].mockResolvedValueOnce(
        failure(404, "Calibration record not found"),
      );

      const res = await run(calibrationRecordsController[handler], makeReq(request));

      expect(calibrationRecordsService[method]).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({
        success: false,
        status: 404,
        message: "Calibration record not found",
        data: null,
      });
    });

    it("a returned 409 goes out as HTTP 409 with its state explanation", async () => {
      calibrationRecordsService[method].mockResolvedValueOnce(
        failure(409, "This record is locked by a signed certificate."),
      );

      const res = await run(calibrationRecordsController[handler], makeReq(request));

      expect(res.statusCode).toBe(409);
      expect(res.body).toMatchObject({
        success: false,
        message: "This record is locked by a signed certificate.",
        data: null,
      });
    });

    it("a 2xx result is still a success envelope, at the service's status", async () => {
      calibrationRecordsService[method].mockResolvedValueOnce({
        success: true,
        status: method === "createCalibrationRecord" ? 201 : 200,
        message: "ok",
        data: { id: RECORD_ID },
      });

      const res = await run(calibrationRecordsController[handler], makeReq(request));

      expect(res.statusCode).toBe(method === "createCalibrationRecord" ? 201 : 200);
      expect(res.body).toMatchObject({ success: true, message: "ok", data: { id: RECORD_ID } });
    });
  });

  it("getAllCalibrationRecords: rows in `data`, pagination in a top-level `meta`", async () => {
    const meta = { total: 1, page: 1, limit: 20, totalPages: 1 };
    calibrationRecordsService.fetchCalibrationRecords.mockResolvedValueOnce({
      success: true,
      status: 200,
      message: "Fetch calibration records successful",
      data: { rows: [{ id: RECORD_ID }], count: 1, meta },
    });

    const res = await run(calibrationRecordsController.getAllCalibrationRecords, makeReq());

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      status: 200,
      message: "Fetch calibration records successful",
      data: [{ id: RECORD_ID }],
      meta,
    });
  });

  it("getAllCalibrationRecords: a returned failure is an error envelope, not a TypeError", async () => {
    calibrationRecordsService.fetchCalibrationRecords.mockResolvedValueOnce(
      failure(503, "Calibration records are unavailable"),
    );

    const res = await run(calibrationRecordsController.getAllCalibrationRecords, makeReq());

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ success: false, data: null });
  });
});

// ---------------------------------------------------------------------------
// tenant.controller
// ---------------------------------------------------------------------------

const withFile = { file: { originalname: "logo.png" }, uploadFilename: "logo-1.png" };

// [handler, service, method, request]
const TENANT_HANDLERS = [
  ["getSpecificTenant", tenantService, "fetchSpecificTenant", { params: { tenantId: TENANT_ID } }],
  ["createTenant", tenantService, "createTenant", { body: { name: "RS A", code: "RSA" } }],
  ["updateTenant", tenantService, "updateTenant", { params: { tenantId: TENANT_ID }, body: { name: "RS B" } }],
  ["deleteTenant", tenantService, "deleteTenant", { body: { tenantId: TENANT_ID } }],
  ["getTenantSettings", tenantService, "getTenantSettings", { params: { tenantId: TENANT_ID } }],
  ["updateTenantSettings", tenantService, "updateTenantSettings", { params: { tenantId: TENANT_ID }, body: {} }],
  ["getTenantUserCount", tenantService, "getTenantUserCount", { params: { tenantId: TENANT_ID } }],
  ["uploadTenantLogo", tenantUploadService, "updateTenantLogo", { params: { tenantId: TENANT_ID }, ...withFile }],
  ["removeTenantLogo", tenantUploadService, "removeTenantLogo", { params: { tenantId: TENANT_ID } }],
];

describe("A-112 — tenant controller: a non-2xx result is an error envelope", () => {
  describe.each(TENANT_HANDLERS)("%s", (handler, service, method, request) => {
    it("a returned 409 goes out as HTTP 409 with success: false and no data", async () => {
      service[method].mockResolvedValueOnce(failure(409, "Tenant is suspended; reactivate it first."));

      const res = await run(tenantController[handler], makeReq(request));

      expect(service[method]).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(409);
      expect(res.body).toEqual({
        success: false,
        status: 409,
        message: "Tenant is suspended; reactivate it first.",
        data: null,
      });
    });

    it("a returned 404 goes out as HTTP 404 with success: false and no data", async () => {
      service[method].mockResolvedValueOnce(failure(404, "Tenant not found"));

      const res = await run(tenantController[handler], makeReq(request));

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ success: false, status: 404, message: "Tenant not found", data: null });
    });

    it("a 404 with no message says so generically — never the handler's success message", async () => {
      service[method].mockResolvedValueOnce({ success: false, status: 404, data: null });

      const res = await run(tenantController[handler], makeReq(request));

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).not.toMatch(/success/i);
    });

    it("a 2xx result is still a success envelope, at the service's status", async () => {
      service[method].mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "ok",
        data: { id: TENANT_ID },
      });

      const res = await run(tenantController[handler], makeReq(request));

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ success: true, status: 200, message: "ok", data: { id: TENANT_ID } });
    });
  });

  it.each([
    ["createTenant", tenantService, "createTenant", { body: { name: "RS A", code: "RSA" } }, 201, "Tenant created successfully"],
    ["deleteTenant", tenantService, "deleteTenant", { body: { tenantId: TENANT_ID } }, 200, "Tenant deleted successfully"],
    ["removeTenantLogo", tenantUploadService, "removeTenantLogo", { params: { tenantId: TENANT_ID } }, 200, "Tenant logo removed successfully"],
  ])(
    "%s keeps its default status and message when the service gives none",
    async (handler, service, method, request, status, message) => {
      service[method].mockResolvedValueOnce({ data: { id: TENANT_ID } });

      const res = await run(tenantController[handler], makeReq(request));

      expect(res.statusCode).toBe(status);
      expect(res.body).toEqual({ success: true, status, message, data: { id: TENANT_ID } });
    },
  );

  it("getAllTenants: rows in `data`, pagination in a top-level `meta`", async () => {
    const meta = { total: 1, page: 1, limit: 20, totalPages: 1 };
    tenantService.fetchTenants.mockResolvedValueOnce({
      success: true,
      status: 200,
      message: "Fetch tenants successful",
      data: { rows: [{ id: TENANT_ID }], meta },
    });

    const res = await run(tenantController.getAllTenants, makeReq());

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      status: 200,
      message: "Fetch tenants successful",
      data: [{ id: TENANT_ID }],
      meta,
    });
  });

  it("getAllTenants: a returned failure is an error envelope, not a TypeError", async () => {
    tenantService.fetchTenants.mockResolvedValueOnce(failure(503, "Tenants are unavailable"));

    const res = await run(tenantController.getAllTenants, makeReq());

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ success: false, status: 503, message: "Tenants are unavailable", data: null });
  });
});
