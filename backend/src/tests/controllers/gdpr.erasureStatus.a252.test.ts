/**
 * A-252 — GET /gdpr/erasure/:requestId read any member's erasure request.
 *
 * `gdprService.getDsarStatus(tenantId, id)` is scoped to the tenant only, and
 * the controller returned whatever it found — so a member holding another
 * member's request id read that person's erasure request (who, what, status),
 * and an unknown id answered 200 with `data: null`.
 *
 * Now: the subject reads their own request; a holder of `gdpr` read (the
 * tenant's privacy officer) reads any request in the tenant; unknown, another
 * member's and another tenant's (the service returns null for it) are the SAME
 * 404, byte for byte.
 */

jest.mock("../../services/gdpr.service", () => ({ getDsarStatus: jest.fn() }));
jest.mock("../../middlewares/dynamicAccess.middleware", () => ({
  principalHasMenuPermission: jest.fn(),
}));

interface FakeReq {
  query?: Record<string, unknown>;
  params: Record<string, unknown>;
  body?: Record<string, unknown>;
  user?: Record<string, unknown> | null;
  tenantId?: string;
  file?: unknown;
  files?: unknown;
  headers?: Record<string, unknown>;
  ip?: string;
  protocol?: string;
  get?: () => undefined;
  validated?: unknown;
}

interface FakeResBody {
  data?: unknown;
  details?: unknown;
  [key: string]: unknown;
}

interface FakeRes {
  statusCode: number;
  body: FakeResBody;
  status: (code: number) => FakeRes;
  json: (payload: FakeResBody) => FakeRes;
}

interface GdprControllerDouble {
  getErasureStatus: (req: FakeReq, res: FakeRes, next: jest.Mock) => Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const gdprService = require("../../services/gdpr.service") as { getDsarStatus: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { principalHasMenuPermission } = require("../../middlewares/dynamicAccess.middleware") as { principalHasMenuPermission: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const gdprController = require("../../controllers/gdpr.controller") as GdprControllerDouble;

const SUBJECT = "11111111-1111-4111-8111-111111111111";
const OTHER_MEMBER = "22222222-2222-4222-8222-222222222222";
const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

const call = async (callerId: string): Promise<FakeRes> => {
  const emptyBody: unknown = null;
  const res: FakeRes = {
    statusCode: 200,
    body: emptyBody as FakeResBody,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: FakeResBody) {
      this.body = payload;
      return this;
    },
  };
  const req: FakeReq = {
    user: { id: callerId, tenantId: TENANT, role: { name: "USER" } },
    tenantId: TENANT,
    params: { requestId: REQUEST_ID },
    headers: {},
    get: () => undefined,
  };
  await gdprController.getErasureStatus(req, res, jest.fn());
  return res;
};

const DSAR = { id: REQUEST_ID, tenantId: TENANT, userId: SUBJECT, type: "erasure", status: "pending" };

beforeEach(() => {
  jest.clearAllMocks();
  principalHasMenuPermission.mockResolvedValue(false);
});

describe("A-252 — erasure status is readable by its subject or the privacy officer only", () => {
  it("the subject reads their own request", async () => {
    gdprService.getDsarStatus.mockResolvedValue(DSAR);

    const res = await call(SUBJECT);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual(DSAR);
    expect(gdprService.getDsarStatus).toHaveBeenCalledWith(TENANT, REQUEST_ID);
  });

  it("another member of the same tenant gets 404", async () => {
    gdprService.getDsarStatus.mockResolvedValue(DSAR);

    const res = await call(OTHER_MEMBER);

    expect(res.statusCode).toBe(404);
    expect(principalHasMenuPermission).toHaveBeenCalledWith(
      expect.objectContaining({ id: OTHER_MEMBER }),
      "gdpr",
      "read",
    );
  });

  it("a holder of gdpr read (privacy officer) reads any request in the tenant", async () => {
    gdprService.getDsarStatus.mockResolvedValue(DSAR);
    principalHasMenuPermission.mockResolvedValue(true);

    const res = await call(OTHER_MEMBER);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual(DSAR);
  });

  it("an unknown or foreign-tenant id is 404 — not 200 with null — even for the privacy officer", async () => {
    gdprService.getDsarStatus.mockResolvedValue(null);
    principalHasMenuPermission.mockResolvedValue(true);

    const res = await call(SUBJECT);

    expect(res.statusCode).toBe(404);
  });

  it("another member's request and a nonexistent one are byte-identical", async () => {
    gdprService.getDsarStatus.mockResolvedValue(DSAR);
    const otherMembers = await call(OTHER_MEMBER);
    gdprService.getDsarStatus.mockResolvedValue(null);
    const missing = await call(OTHER_MEMBER);

    // `details` carries a development-only stack trace whose call-site line
    // differs; production omits it. Everything a client is shown is compared.
    const shown = (body: FakeResBody): FakeResBody => ({ ...body, details: undefined });
    expect(otherMembers.statusCode).toBe(missing.statusCode);
    expect(JSON.stringify(shown(otherMembers.body))).toBe(JSON.stringify(shown(missing.body)));
  });
});
