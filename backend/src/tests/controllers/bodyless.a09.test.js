/**
 * A-09 — a request with NO body must not become a 500.
 *
 * Express 5 leaves `req.body` **undefined** when no body was sent; Express 4
 * gave `{}`. Every `const { x } = req.body` and every `req.body.x` then throws
 * a TypeError, which the wrapper reports as a 500 — on a request that should
 * have been a 400 (missing required field), a 401 (unauthenticated ingest), or
 * a 2xx where the body is genuinely optional.
 *
 * Each case below drives the real handler with `body: undefined` — the exact
 * shape Express 5 hands it — and asserts the status it owes. Before the fix
 * every one of these produced `status 500` with a
 * "Cannot destructure property … of undefined" message.
 *
 * The response utilities are REAL here on purpose: the status code is the
 * thing under test, and a mocked `error()` would prove only the call site.
 */

jest.mock("../../services/admin.service", () => ({ updateTenantStatus: jest.fn(), updateTenantFlags: jest.fn() }));
jest.mock("../../services/ai.service", () => ({ queryDocuments: jest.fn() }));
jest.mock("../../services/apiKey.service", () => ({ createApiKey: jest.fn() }));
jest.mock("../../services/attachment.service", () => ({ createAttachment: jest.fn() }));
jest.mock("../../services/batchJob.service", () => ({ createJob: jest.fn() }));
jest.mock("../../services/iot.service", () => ({ ingestReading: jest.fn() }));
jest.mock("../../services/menuGroup.service", () => ({ deleteMenuGroup: jest.fn() }));
jest.mock("../../services/meteredBilling.service", () => ({ estimateCost: jest.fn(), createUsageAlert: jest.fn() }));
jest.mock("../../services/oidcProvider.service", () => ({ decideAuthorization: jest.fn() }));
jest.mock("../../services/qms.service", () => ({ createNC: jest.fn(), createCapa: jest.fn() }));
jest.mock("../../services/risk.service", () => ({ createRisk: jest.fn(), updateRisk: jest.fn() }));
jest.mock("../../services/roles.service", () => ({
  createMenu: jest.fn(),
  updateMenu: jest.fn(),
  assignRoleToUser: jest.fn(),
  assignMenuToRole: jest.fn(),
}));
jest.mock("../../services/sop.service", () => ({ createDocument: jest.fn() }));
jest.mock("../../services/supplierScorecard.service", () => ({ createScorecard: jest.fn(), updateScorecard: jest.fn() }));
jest.mock("../../services/tenantHierarchy.service", () => ({ createSubOrganization: jest.fn(), updateTenantParent: jest.fn() }));
jest.mock("../../services/userPermission.service", () => ({ setUserPermission: jest.fn() }));
jest.mock("../../services/vendor.service", () => ({ qualifyVendor: jest.fn() }));
jest.mock("../../services/webauthn.service", () => ({ verifyRegistration: jest.fn(), verifyLogin: jest.fn() }));
jest.mock("../../services/webhook.service", () => ({ updateWebhook: jest.fn() }));
jest.mock("../../services/eSignature.service", () => ({ updateWorkflow: jest.fn() }));
jest.mock("../../services/auth.service", () => ({
  justUpdatePassword: jest.fn(),
  passIsValid: jest.fn(),
  verifyMfaSetup: jest.fn(),
  impersonateUser: jest.fn(),
  refreshUserToken: jest.fn(),
}));
jest.mock("../../services/sso.service", () => ({}));
jest.mock("../../services/tenant.service", () => ({ updateTenantSettings: jest.fn() }));
jest.mock("../../services/tenantUpload.service", () => ({}));
jest.mock("../../services/session.service", () => ({ createSession: jest.fn() }));
jest.mock("../../models", () => ({
  CalibrationDevice: { unscoped: jest.fn(() => ({ findOne: jest.fn() })) },
  Tenants: { findOne: jest.fn() },
  Tenant: { findByPk: jest.fn(), update: jest.fn() },
  TenantHierarchy: { findOne: jest.fn() },
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../middlewares/auth.middleware", () => ({ auth: jest.fn() }));

const adminController = require("../../controllers/admin.controller");
const aiController = require("../../controllers/ai.controller");
const apiKeyController = require("../../controllers/apiKey.controller");
const attachmentController = require("../../controllers/attachment.controller");
const batchJobController = require("../../controllers/batchJob.controller");
const iotController = require("../../controllers/iot.controller");
const menuGroupController = require("../../controllers/menuGroup.controller");
const meteredBillingController = require("../../controllers/meteredBilling.controller");
const oidcProviderController = require("../../controllers/oidcProvider.controller");
const qmsController = require("../../controllers/qms.controller");
const riskController = require("../../controllers/risk.controller");
const rolesController = require("../../controllers/roles.controller");
const sopController = require("../../controllers/sop.controller");
const ssoController = require("../../controllers/sso.controller");
const scorecardController = require("../../controllers/supplierScorecard.controller");
const tenantHierarchyController = require("../../controllers/tenantHierarchy.controller");
const userPermissionController = require("../../controllers/userPermission.controller");
const vendorController = require("../../controllers/vendor.controller");
const webauthnController = require("../../controllers/webauthn.controller");
const webhookController = require("../../controllers/webhook.controller");
const authController = require("../../controllers/auth.controller");
const tenantController = require("../../controllers/tenant.controller");
const eSignatureController = require("../../controllers/eSignature.controller");

const adminService = require("../../services/admin.service");
const apiKeyService = require("../../services/apiKey.service");
const attachmentService = require("../../services/attachment.service");
const batchJobService = require("../../services/batchJob.service");
const qmsService = require("../../services/qms.service");
const riskService = require("../../services/risk.service");
const rolesService = require("../../services/roles.service");
const sopService = require("../../services/sop.service");
const scorecardService = require("../../services/supplierScorecard.service");
const meteredBillingService = require("../../services/meteredBilling.service");
const webauthnService = require("../../services/webauthn.service");
const webhookService = require("../../services/webhook.service");
const authService = require("../../services/auth.service");
const tenantService = require("../../services/tenant.service");
const eSignatureService = require("../../services/eSignature.service");
const { Tenant } = require("../../models");

const TENANT_ID = "550e8400-e29b-41d4-a716-446655440001";
const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const RESOURCE_ID = "550e8400-e29b-41d4-a716-446655440002";

// A request as Express 5 actually hands it to a handler when no body was sent.
const bodylessReq = (overrides = {}) => ({
  body: undefined,
  params: {},
  query: {},
  headers: {},
  ip: "127.0.0.1",
  get: jest.fn(() => undefined),
  user: { id: USER_ID, tenantId: TENANT_ID },
  ...overrides,
});

const makeRes = () => {
  const res = {};
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((payload) => {
    res.payload = payload;
    return res;
  });
  res.download = jest.fn();
  // A-188: a refused SSO callback redirects the browser to the login page.
  res.redirect = jest.fn((location) => {
    res.statusCode = 302;
    res.location = location;
    return res;
  });
  return res;
};

/** Drives a handler with no body and returns { status, payload, nextArg }. */
const callBodyless = async (handler, reqOverrides = {}) => {
  const req = bodylessReq(reqOverrides);
  const res = makeRes();
  const next = jest.fn();
  await handler(req, res, next);
  return {
    status: res.statusCode,
    location: res.location,
    payload: res.payload,
    message: res.payload && res.payload.message,
    nextArg: next.mock.calls.length ? next.mock.calls[0][0] : undefined,
    req,
  };
};

const expectNoTypeError = (result) => {
  const text = `${result.message || ""} ${(result.nextArg && result.nextArg.message) || ""}`;
  expect(text).not.toMatch(/Cannot destructure|of undefined|is not a function/);
  expect(result.status).not.toBe(500);
};

describe("A-09 — handlers that own their own 400", () => {
  beforeEach(() => jest.clearAllMocks());

  it("ai.queryRAG answers 400 'Question is required', not 500", async () => {
    const result = await callBodyless(aiController.queryRAG);

    expect(result.status).toBe(400);
    expect(result.message).toBe("Question is required");
    expectNoTypeError(result);
  });

  it("menuGroup.deleteMenuGroup answers 400 'menuGroupId is required', not 500", async () => {
    const result = await callBodyless(menuGroupController.deleteMenuGroup);

    expect(result.status).toBe(400);
    expect(result.message).toBe("menuGroupId is required");
    expectNoTypeError(result);
  });

  it("userPermission.setUserPermission answers 400, not 500", async () => {
    const result = await callBodyless(userPermissionController.setUserPermission, {
      params: { userId: USER_ID },
    });

    expect(result.status).toBe(400);
    expect(result.message).toBe("menuGroupId and permissionType are required");
    expectNoTypeError(result);
  });

  it("tenantHierarchy.addChildTenant answers 400 — Joi no longer waves an absent body through", async () => {
    const result = await callBodyless(tenantHierarchyController.addChildTenant, {
      params: { parentId: TENANT_ID },
    });

    expect(result.status).toBe(400);
    expectNoTypeError(result);
  });

  it("auth.verifyMfaSetup answers 400 'MFA code is required', not 500", async () => {
    const result = await callBodyless(authController.verifyMfaSetup);

    expect(result.status).toBe(400);
    expect(result.message).toBe("MFA code is required");
    expectNoTypeError(result);
  });

  it("auth.loginMfa answers 400, not 500", async () => {
    const result = await callBodyless(authController.loginMfa);

    expect(result.status).toBe(400);
    expect(result.message).toBe("MFA code and temporary token are required");
    expectNoTypeError(result);
  });

  it("auth.impersonateUser answers 400, not 500", async () => {
    const result = await callBodyless(authController.impersonateUser);

    expect(result.status).toBe(400);
    expect(result.message).toBe("tenantId and userId are required");
    expectNoTypeError(result);
  });

  it("auth.refresh answers 400 'Refresh token is required', not 500", async () => {
    const result = await callBodyless(authController.refresh);

    expect(result.status).toBe(400);
    expect(result.message).toBe("Refresh token is required");
    expectNoTypeError(result);
  });

  // A-188: a browser callback's refusal is a redirect to the login page with
  // a code (it used to be the JSON 400) — and still never a 500.
  it("sso.ssoCallback sends the browser to /login?error=sso_unavailable, not 500", async () => {
    const result = await callBodyless(ssoController.ssoCallback);

    expect(result.status).toBe(302);
    expect(new URL(result.location).pathname).toBe("/login");
    expect(new URL(result.location).searchParams.get("error")).toBe("sso_unavailable");
    expectNoTypeError(result);
  });

  it("sso.oidcCallback sends the browser to /login?error=sso_state, not 500", async () => {
    const result = await callBodyless(ssoController.oidcCallback);

    expect(result.status).toBe(302);
    expect(new URL(result.location).searchParams.get("error")).toBe("sso_state");
    expectNoTypeError(result);
  });
});

describe("A-09 — the public IoT ingest endpoint", () => {
  beforeEach(() => jest.clearAllMocks());

  it("answers 401 'IoT Device Token is required' for a bodyless POST, not 500", async () => {
    const result = await callBodyless(iotController.ingestHttp);

    // ingestHttp forwards to next(err); the error handler maps err.status.
    expect(result.nextArg).toBeDefined();
    expect(result.nextArg.status).toBe(401);
    expect(result.nextArg.message).toBe("IoT Device Token is required");
    expect(result.nextArg).not.toBeInstanceOf(TypeError);
  });

  it("answers 400 'Payload object is required' when only the header token is present", async () => {
    const result = await callBodyless(iotController.ingestHttp, {
      headers: { "x-iot-token": "tok_abc" },
    });

    expect(result.nextArg.status).toBe(400);
    expect(result.nextArg.message).toBe("Payload object is required");
  });
});

describe("A-09 — handlers that hand an absent body to a service", () => {
  beforeEach(() => jest.clearAllMocks());

  it("apiKey.create reaches the service with undefined fields instead of throwing", async () => {
    apiKeyService.createApiKey.mockRejectedValue(
      Object.assign(new Error("name is required"), { status: 400 }),
    );

    const result = await callBodyless(apiKeyController.create);

    expect(apiKeyService.createApiKey).toHaveBeenCalledWith(TENANT_ID, {
      name: undefined,
      scopes: undefined,
      expiresAt: undefined,
      createdBy: USER_ID,
    });
    expect(result.status).toBe(400);
    expectNoTypeError(result);
  });

  it("attachment.upload reaches the service (multer leaves no body on a non-multipart POST)", async () => {
    attachmentService.createAttachment.mockResolvedValue({ id: RESOURCE_ID });

    const result = await callBodyless(attachmentController.upload, { file: undefined });

    expect(attachmentService.createAttachment).toHaveBeenCalledWith(TENANT_ID, undefined, {
      resourceType: undefined,
      resourceId: undefined,
      uploadedBy: USER_ID,
      // A-117: the request's address and agent, for the CREATE audit row.
      ipAddress: "127.0.0.1",
      userAgent: undefined,
    });
    expectNoTypeError(result);
  });

  it.each([
    ["admin.updateTenantStatus", () => adminController.updateTenantStatus, adminService.updateTenantStatus, { params: { id: TENANT_ID } }],
    ["admin.updateTenantFlags", () => adminController.updateTenantFlags, adminService.updateTenantFlags, { params: { id: TENANT_ID } }],
    ["batchJob.createTestJob", () => batchJobController.createTestJob, batchJobService.createJob, {}],
    ["qms.createNC", () => qmsController.createNC, qmsService.createNC, {}],
    ["qms.createCapa", () => qmsController.createCapa, qmsService.createCapa, {}],
    ["risk.createRisk", () => riskController.createRisk, riskService.createRisk, {}],
    ["risk.updateRisk", () => riskController.updateRisk, riskService.updateRisk, { params: { id: RESOURCE_ID } }],
    ["roles.createMenu", () => rolesController.createMenu, rolesService.createMenu, {}],
    ["roles.updateMenu", () => rolesController.updateMenu, rolesService.updateMenu, { params: { id: RESOURCE_ID } }],
    ["roles.assignRoleToUser", () => rolesController.assignRoleToUser, rolesService.assignRoleToUser, {}],
    ["roles.assignPermissionToRole", () => rolesController.assignPermissionToRole, rolesService.assignMenuToRole, { params: { roleId: RESOURCE_ID } }],
    ["sop.createDocument", () => sopController.createDocument, sopService.createDocument, {}],
    ["supplierScorecard.createScorecard", () => scorecardController.createScorecard, scorecardService.createScorecard, {}],
    ["supplierScorecard.updateScorecard", () => scorecardController.updateScorecard, scorecardService.updateScorecard, { params: { id: RESOURCE_ID } }],
    ["meteredBilling.estimateCost", () => meteredBillingController.estimateCost, meteredBillingService.estimateCost, {}],
    ["meteredBilling.createUsageAlert", () => meteredBillingController.createUsageAlert, meteredBillingService.createUsageAlert, {}],
    ["vendor.qualifyVendor", () => vendorController.qualifyVendor, require("../../services/vendor.service").qualifyVendor, { params: { vendorId: RESOURCE_ID } }],
    ["webauthn.verifyRegistration", () => webauthnController.verifyRegistration, webauthnService.verifyRegistration, {}],
    ["webauthn.verifyLogin", () => webauthnController.verifyLogin, webauthnService.verifyLogin, {}],
    ["webhook.update", () => webhookController.update, webhookService.updateWebhook, { params: { id: RESOURCE_ID } }],
    ["oidcProvider.decision", () => oidcProviderController.decision, require("../../services/oidcProvider.service").decideAuthorization, {}],
    // A-224: the move is the service's; a bodyless request reaches it (which answers 400).
    ["tenantHierarchy.updateTenantParent", () => tenantHierarchyController.updateTenantParent, require("../../services/tenantHierarchy.service").updateTenantParent, { params: { tenantId: TENANT_ID } }],
    ["auth.justUpdatePassword", () => authController.justUpdatePassword, authService.justUpdatePassword, {}],
    ["auth.passIsValid", () => authController.passIsValid, authService.passIsValid, {}],
    ["eSignature.updateWorkflow", () => eSignatureController.updateWorkflow, eSignatureService.updateWorkflow, { params: { workflowId: RESOURCE_ID } }],
  ])("%s reaches its service without a TypeError", async (_name, getHandler, serviceFn, overrides) => {
    serviceFn.mockResolvedValue({ status: 200, message: "ok", data: {} });

    const result = await callBodyless(getHandler(), overrides);

    expect(serviceFn).toHaveBeenCalled();
    expectNoTypeError(result);
  });
});

describe("A-09 — handlers whose own validator sees params, not the body", () => {
  beforeEach(() => jest.clearAllMocks());

  // updateTenantSettings validates `{ ...req.body, ...req.params }` — spreading
  // an absent body is harmless — but then passed the RAW `req.body` on to the
  // service, which destructures it.
  it("tenant.updateTenantSettings hands the service an object, not undefined", async () => {
    tenantService.updateTenantSettings.mockResolvedValue({
      status: 200,
      message: "ok",
      data: {},
    });

    const result = await callBodyless(tenantController.updateTenantSettings, {
      params: { tenantId: TENANT_ID },
    });

    expect(tenantService.updateTenantSettings).toHaveBeenCalledWith(
      TENANT_ID,
      {},
      USER_ID,
      expect.objectContaining({ userId: USER_ID }), // A-117: the audit actor
    );
    expectNoTypeError(result);
  });

});
