/**
 * A-103 — a service result with a non-2xx status goes out as an ERROR envelope.
 *
 * certificate.service RETURNS its not-found (404) and state-conflict (409)
 * outcomes as `{ success: false, status, message, data: null }`. The
 * controller used to forward every result through
 * `success(res, result.data, null, result.message, result.status)`, so a
 * missing certificate answered HTTP 404 with `success: true` in the body.
 *
 * This file runs the controller against the REAL response.util and the REAL
 * validator — only the service is doubled — and asserts on what reaches the
 * wire. certificate.controller.test.js mocks response.util, so it cannot see
 * this defect.
 */

jest.mock("../../services/certificate.service", () => ({
  fetchCertificates: jest.fn(),
  fetchSpecificCertificate: jest.fn(),
  createCertificate: jest.fn(),
  updateCertificate: jest.fn(),
  deleteCertificate: jest.fn(),
  approveCertificate: jest.fn(),
  submitCertificateForApproval: jest.fn(),
  signCertificate: jest.fn(),
  revokeCertificate: jest.fn(),
  getCertificateStats: jest.fn(),
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
}

interface FakeRes {
  statusCode: number | null;
  body: unknown;
  headersSent: boolean;
  status: jest.Mock;
  json: jest.Mock;
}

type ControllerHandler = (req: FakeReq, res: FakeRes, next?: jest.Mock) => Promise<void>;

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const certificateController = require("../../controllers/certificate.controller") as Record<
  string,
  ControllerHandler
>;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const certificateService = require("../../services/certificate.service") as Record<
  string,
  jest.Mock
>;

const getServiceMock = (method: string): jest.Mock => certificateService[method] as jest.Mock;
const getControllerHandler = (handler: string): ControllerHandler =>
  certificateController[handler] as ControllerHandler;

const CERT_ID = "0b3f8a52-6f0e-4c1b-9a3e-2f7d5c1e9a01";
const DEVICE_ID = "5d2c1e77-8a4b-4f3e-b1c2-9e8d7f6a5b4c";

const notFound = {
  success: false,
  status: 404,
  message: "Certificate not found",
  data: null,
};
const conflict = {
  success: false,
  status: 409,
  message: "This certificate is signed and can no longer be edited.",
  data: null,
};

const makeRes = (): FakeRes => {
  const res: FakeRes = {
    statusCode: null,
    body: null,
    headersSent: false,
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    res.headersSent = true;
    return res;
  });
  return res;
};

const makeReq = (overrides: Partial<FakeReq> = {}): FakeReq => ({
  user: { id: "user-1", tenantId: "tenant-1" },
  query: {},
  params: { certificateId: CERT_ID },
  body: {},
  headers: { "user-agent": "jest-agent" },
  ip: "10.0.0.9",
  ...overrides,
});

const reauth = { authMethod: "password", authPayload: "pw", meaning: "Reviewed" };

// [handler, service method, request body]
const HANDLERS: [string, string, Record<string, unknown>][] = [
  ["getSpecificCertificate", "fetchSpecificCertificate", {}],
  ["updateCertificate", "updateCertificate", { summary: "x" }],
  ["deleteCertificate", "deleteCertificate", {}],
  ["approveCertificate", "approveCertificate", reauth],
  ["submitCertificate", "submitCertificateForApproval", {}],
  [
    "signCertificate",
    "signCertificate",
    { digitalSignature: "sig", digitalSignatureKeyId: "key-1", ...reauth },
  ],
  ["revokeCertificate", "revokeCertificate", { reason: "wrong device", ...reauth }],
  ["getCertificateStats", "getCertificateStats", {}],
];

describe("A-103 — certificate controller: a non-2xx result is an error envelope", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe.each(HANDLERS)("%s", (handler, method, body) => {
    it("a returned 404 goes out as HTTP 404 with success: false and no data", async () => {
      getServiceMock(method).mockResolvedValueOnce(notFound);
      const res = makeRes();

      await getControllerHandler(handler)(makeReq({ body }), res, jest.fn());

      expect(getServiceMock(method)).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({
        success: false,
        status: 404,
        message: "Certificate not found",
        data: null,
      });
    });

    it("a returned 409 goes out as HTTP 409 with its state explanation, success: false", async () => {
      getServiceMock(method).mockResolvedValueOnce(conflict);
      const res = makeRes();

      await getControllerHandler(handler)(makeReq({ body }), res, jest.fn());

      expect(res.statusCode).toBe(409);
      expect(res.body).toMatchObject({
        success: false,
        status: 409,
        message: conflict.message,
        data: null,
      });
    });

    it("a 2xx result is still a success envelope, at the service's status", async () => {
      getServiceMock(method).mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "ok",
        data: { id: CERT_ID },
      });
      const res = makeRes();

      await getControllerHandler(handler)(makeReq({ body }), res, jest.fn());

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        success: true,
        status: 200,
        message: "ok",
        // P21-09e (spec § 12): the certificate READ carries its people's displays.
        data:
          handler === "getSpecificCertificate"
            ? {
              id: CERT_ID,
              calibratedByDisplay: null,
              approvedByDisplay: null,
              signedByDisplay: null,
            }
            : { id: CERT_ID },
      });
    });
  });

  it("createCertificate keeps its 201", async () => {
    getServiceMock("createCertificate").mockResolvedValueOnce({
      success: true,
      status: 201,
      message: "Certificate created",
      data: { id: CERT_ID },
    });
    const res = makeRes();

    await getControllerHandler("createCertificate")(
      makeReq({ params: {}, body: { deviceId: DEVICE_ID } }),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ success: true, status: 201, data: { id: CERT_ID } });
  });

  it("createCertificate: a returned 404 (device not found) is an error envelope", async () => {
    getServiceMock("createCertificate").mockResolvedValueOnce({
      ...notFound,
      message: "Device not found",
    });
    const res = makeRes();

    await getControllerHandler("createCertificate")(
      makeReq({ params: {}, body: { deviceId: DEVICE_ID } }),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ success: false, message: "Device not found", data: null });
  });

  it("getAllCertificates: rows in `data`, pagination in a top-level `meta`", async () => {
    const meta = { total: 1, page: 1, limit: 10, totalPages: 1 };
    getServiceMock("fetchCertificates").mockResolvedValueOnce({
      success: true,
      status: 200,
      message: "Fetch certificates successful",
      data: { rows: [{ id: CERT_ID }], count: 1, meta },
    });
    const res = makeRes();

    await getControllerHandler("getAllCertificates")(makeReq({ params: {} }), res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      status: 200,
      message: "Fetch certificates successful",
      data: [
        { id: CERT_ID, calibratedByDisplay: null, approvedByDisplay: null, signedByDisplay: null },
      ], // P21-09e
      meta,
    });
  });
});
