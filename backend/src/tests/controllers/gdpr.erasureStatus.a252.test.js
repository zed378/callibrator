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

const gdprService = require("../../services/gdpr.service");
const { principalHasMenuPermission } = require("../../middlewares/dynamicAccess.middleware");
const gdprController = require("../../controllers/gdpr.controller");

const SUBJECT = "11111111-1111-4111-8111-111111111111";
const OTHER_MEMBER = "22222222-2222-4222-8222-222222222222";
const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

const call = async (callerId) => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  const req = {
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
    const shown = ({ details: _details, ...rest }) => rest;
    expect(otherMembers.statusCode).toBe(missing.statusCode);
    expect(JSON.stringify(shown(otherMembers.body))).toBe(JSON.stringify(shown(missing.body)));
  });
});
