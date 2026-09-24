/**
 * A-127 (ADR-051 Q-17) — platform operators may not author Part 11 records
 * inside a tenant.
 *
 * Signing (POST /esignature/sign), approving, submitting, signing and revoking
 * a certificate, and creating, editing or deleting a calibration record answer
 * 403 while the request is impersonated (`req.impersonatorId`, from the
 * verified token claim) or while a super admin acts inside another tenant via
 * the x-tenant-id / x-tenant-code override. Other writes stay allowed and are
 * audited with the impersonator (F-8).
 *
 * Two halves:
 *
 *  1. Behaviour, through the REAL routers and the REAL denyPlatformAuthoring
 *     middleware. Stubbed: `auth` (it sets the principal, the effective tenant
 *     and the impersonator exactly as auth.middleware does), `dynamicAccess`
 *     (the permission gate is not under test), body validation, and the
 *     controllers (where "reached" is observed).
 *
 *  2. Enumeration, from SOURCE (the authorizationWiring scanner's helpers, as
 *     uploadAfterGate.a78.test.js does). Every write route whose path or
 *     handler looks like a regulated act — sign, approve, revoke, submit,
 *     publish, acknowledge, a certificate, a calibration record, a workflow —
 *     must be either GUARDED (and actually carry the middleware) or in
 *     NOT_GUARDED with the reason, in writing. A new such route fails this
 *     test until someone decides.
 */

const mockState = { user: null, tenantId: null, impersonatorId: null };

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual("../../middlewares/auth.middleware");
  return {
    ...actual,
    auth: (req, res, next) => {
      req.user = mockState.user;
      req.tenantId = mockState.tenantId;
      req.impersonatorId = mockState.impersonatorId;
      next();
    },
    denyApiKey: (req, res, next) => next(),
  };
});
jest.mock("../../middlewares/dynamicAccess.middleware", () => ({
  dynamicAccess: () => (req, res, next) => next(),
}));
jest.mock("../../middlewares/validation.middleware", () => ({
  validate: () => (req, res, next) => next(),
}));

const mockReached = (name) =>
  jest.fn((req, res) => {
    // What the tenant hooks would see for the rest of the request.
    const { tenantStorage } = jest.requireActual("../../middlewares/tenantContext.middleware");
    return res.status(200).json({ success: true, handler: name, ctx: tenantStorage.getStore() || null });
  });

jest.mock("../../controllers/eSignature.controller", () => ({
  getKeyPairs: mockReached("getKeyPairs"),
  createKeyPair: mockReached("createKeyPair"),
  deleteKeyPair: mockReached("deleteKeyPair"),
  getWorkflows: mockReached("getWorkflows"),
  createWorkflow: mockReached("createWorkflow"),
  getWorkflow: mockReached("getWorkflow"),
  updateWorkflow: mockReached("updateWorkflow"),
  deleteWorkflow: mockReached("deleteWorkflow"),
  signDocument: mockReached("signDocument"),
  verifySignature: mockReached("verifySignature"),
  getSignatureHistory: mockReached("getSignatureHistory"),
  getSignerWorkflows: mockReached("getSignerWorkflows"),
  getSignerWorkflow: mockReached("getSignerWorkflow"),
  getEligibleSigners: mockReached("getEligibleSigners"),
  cancelWorkflow: mockReached("cancelWorkflow"),
}));
jest.mock("../../controllers/certificate.controller", () => ({
  getAllCertificates: mockReached("getAllCertificates"),
  createCertificate: mockReached("createCertificate"),
  getCertificateStats: mockReached("getCertificateStats"),
  getSpecificCertificate: mockReached("getSpecificCertificate"),
  updateCertificate: mockReached("updateCertificate"),
  deleteCertificate: mockReached("deleteCertificate"),
  approveCertificate: mockReached("approveCertificate"),
  submitCertificate: mockReached("submitCertificate"),
  signCertificate: mockReached("signCertificate"),
  revokeCertificate: mockReached("revokeCertificate"),
}));
jest.mock("../../controllers/certificatePdf.controller", () => ({
  verifyCertificate: mockReached("verifyCertificate"),
  verifyDocument: mockReached("verifyDocument"),
  generatePdf: mockReached("generatePdf"),
  downloadPdf: mockReached("downloadPdf"),
  getQrCode: mockReached("getQrCode"),
}));
jest.mock("../../controllers/sop.controller", () => ({
  createDocument: mockReached("createDocument"),
  getDocuments: mockReached("getDocuments"),
  publishDocument: mockReached("publishDocument"),
  acknowledgeTraining: mockReached("acknowledgeTraining"),
}));
jest.mock("../../controllers/workflow.controller", () => ({
  getWorkflows: mockReached("getWorkflows"),
  getWorkflowById: mockReached("getWorkflowById"),
  createWorkflow: mockReached("createWorkflowDefinition"),
  updateWorkflow: mockReached("updateWorkflowDefinition"),
  deleteWorkflow: mockReached("deleteWorkflowDefinition"),
  getPendingTasks: mockReached("getPendingTasks"),
  submitAction: mockReached("submitAction"),
}));
jest.mock("../../controllers/calibrationRecords.controller", () => ({
  getAllCalibrationRecords: mockReached("getAllCalibrationRecords"),
  createCalibrationRecord: mockReached("createCalibrationRecord"),
  getSpecificCalibrationRecord: mockReached("getSpecificCalibrationRecord"),
  correctCalibrationRecord: mockReached("correctCalibrationRecord"),
  voidCalibrationRecord: mockReached("voidCalibrationRecord"),
}));

const fs = require("fs");
const path = require("path");
const {
  stripComments,
  readBracketed,
  splitTopLevel,
} = require("../../utils/authorizationWiring.util");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const { MESSAGES } = require("../../middlewares/denyPlatformAuthoring.middleware");

const ROUTERS = {
  esignature: require("../../routes/api/eSignature.route"),
  certificates: require("../../routes/api/certificates.route"),
  "calibration-records": require("../../routes/api/calibrationRecords.route"),
  sop: require("../../routes/api/sop.route"),
  workflows: require("../../routes/api/workflows.route"),
};

const MEMBER = "11111111-1111-4111-8111-111111111111";
const OPERATOR = "99999999-9999-4999-8999-999999999999";
const HOSPITAL = "22222222-2222-4222-8222-222222222222";
const PLATFORM_HOME = "33333333-3333-4333-8333-333333333333";
const CERT = "44444444-4444-4444-8444-444444444444";
const RECORD = "55555555-5555-4555-8555-555555555555";
const SOP = "66666666-6666-4666-8666-666666666666";
const INSTANCE = "77777777-7777-4777-8777-777777777777";

/** Drive `router` with `method url`, inside the tenant context auth would open. */
const http = (mount, method, url, body = {}) =>
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
      setHeader() {
        return this;
      },
    };
    const req = {
      method: method.toUpperCase(),
      url,
      originalUrl: `/api/v1/${mount}${url}`,
      body,
      query: {},
      params: {},
      headers: {},
      ip: "127.0.0.1",
      get: () => undefined,
    };
    const roleName = mockState.user && mockState.user.role && mockState.user.role.name;
    tenantStorage.run(
      {
        tenantId: mockState.tenantId,
        isSuperAdmin: roleName === "SUPERADMIN" || roleName === "SUPER_ADMIN",
        isSystemTask: false,
      },
      () =>
        ROUTERS[mount].handle(req, res, (err) =>
          resolve({
            status: err ? err.status || 500 : 404,
            body: { message: err ? err.message : "no route" },
          }),
        ),
    );
  });

const asMember = () => {
  mockState.user = { id: MEMBER, tenantId: HOSPITAL, role: { name: "TECHNICIAN" } };
  mockState.tenantId = HOSPITAL;
  mockState.impersonatorId = null;
};
/** A super admin impersonating the hospital member (impersonateUser's token). */
const asImpersonated = () => {
  asMember();
  mockState.impersonatorId = OPERATOR;
};
/** A super admin whose x-tenant-id override selected the hospital. */
const asOperatorIn = (tenantId) => {
  mockState.user = { id: OPERATOR, tenantId: PLATFORM_HOME, role: { name: "SUPERADMIN" } };
  mockState.tenantId = tenantId;
  mockState.impersonatorId = null;
};

beforeEach(() => asMember());

// Every Part 11 act Q-17 names, and those the A-145 review added — the list
// the middleware is mounted on.
const PART11_ACTS = [
  ["esignature", "POST", "/sign", "signDocument"],
  ["certificates", "POST", `/${CERT}/approve`, "approveCertificate"],
  ["certificates", "POST", `/${CERT}/submit`, "submitCertificate"],
  ["certificates", "POST", `/${CERT}/sign`, "signCertificate"],
  ["certificates", "POST", `/${CERT}/revoke`, "revokeCertificate"],
  ["calibration-records", "POST", "/", "createCalibrationRecord"],
  // P6-03: PUT/DELETE are gone; correct and void are the Part 11 acts now.
  ["calibration-records", "POST", `/${RECORD}/corrections`, "correctCalibrationRecord"],
  ["calibration-records", "POST", `/${RECORD}/void`, "voidCalibrationRecord"],
  // A-145
  ["certificates", "POST", "/", "createCertificate"],
  ["certificates", "PUT", `/${CERT}`, "updateCertificate"],
  ["certificates", "DELETE", `/${CERT}`, "deleteCertificate"],
  ["sop", "PATCH", `/${SOP}/publish`, "publishDocument"],
  ["sop", "POST", `/${SOP}/acknowledge`, "acknowledgeTraining"],
  ["workflows", "POST", `/instances/${INSTANCE}/action`, "submitAction"],
];

describe("A-127 — the named behaviours", () => {
  it("signing while impersonating is refused", async () => {
    asImpersonated();
    const res = await http("esignature", "POST", "/sign", { workflowId: CERT });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(MESSAGES.IMPERSONATING);
    expect(require("../../controllers/eSignature.controller").signDocument).not.toHaveBeenCalled();
  });

  it("approving a certificate as a super admin in another tenant is refused", async () => {
    asOperatorIn(HOSPITAL);
    const res = await http("certificates", "POST", `/${CERT}/approve`, { password: "x" });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(MESSAGES.OTHER_TENANT);
    expect(
      require("../../controllers/certificate.controller").approveCertificate,
    ).not.toHaveBeenCalled();
  });

  it("an ordinary member can still sign", async () => {
    asMember();
    const res = await http("esignature", "POST", "/sign", { workflowId: CERT });
    expect(res.status).toBe(200);
    expect(res.body.handler).toBe("signDocument");
    // The member's context is untouched.
    expect(res.body.ctx).toEqual({ tenantId: HOSPITAL, isSuperAdmin: false, isSystemTask: false });
  });
});

describe("A-127 — every Part 11 act, every refused principal", () => {
  it.each(PART11_ACTS)("%s %s %s is refused while impersonating", async (mount, method, url) => {
    asImpersonated();
    const res = await http(mount, method, url);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(MESSAGES.IMPERSONATING);
  });

  it.each(PART11_ACTS)(
    "%s %s %s is refused to a super admin overriding into another tenant",
    async (mount, method, url) => {
      asOperatorIn(HOSPITAL);
      const res = await http(mount, method, url);
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(MESSAGES.OTHER_TENANT);
    },
  );

  it.each(PART11_ACTS)(
    "%s %s %s still reaches its handler for an ordinary member",
    async (mount, method, url, handler) => {
      asMember();
      const res = await http(mount, method, url);
      expect(res.status).toBe(200);
      expect(res.body.handler).toBe(handler);
    },
  );

  it.each(PART11_ACTS)(
    "%s %s %s: a super admin in their OWN home tenant acts as a member of it, not as the cross-tenant operator",
    async (mount, method, url, handler) => {
      asOperatorIn(PLATFORM_HOME);
      const res = await http(mount, method, url);
      expect(res.status).toBe(200);
      expect(res.body.handler).toBe(handler);
      // isSuperAdmin false => the tenant hooks FILTER by the home tenant, so
      // another tenant's certificate/record/workflow id is not found (404).
      expect(res.body.ctx).toEqual({
        tenantId: PLATFORM_HOME,
        isSuperAdmin: false,
        isSystemTask: false,
      });
    },
  );
});

describe("A-127 — other writes remain allowed to an operator (audited with the impersonator, F-8)", () => {
  it.each([
    ["esignature", "POST", "/workflows", "createWorkflow"],
    ["esignature", "POST", `/workflows/${CERT}/cancel`, "cancelWorkflow"],
    ["workflows", "POST", "/", "createWorkflowDefinition"],
    ["sop", "POST", "/", "createDocument"],
  ])("%s %s %s is not refused while impersonating", async (mount, method, url, handler) => {
    asImpersonated();
    const res = await http(mount, method, url);
    expect(res.status).toBe(200);
    expect(res.body.handler).toBe(handler);
  });
});

// ---------------------------------------------------------------------------
// Enumeration from source
// ---------------------------------------------------------------------------

const ROUTES_DIR = path.join(__dirname, "..", "..", "routes", "api");

const routeCalls = (source) => {
  const clean = stripComments(source);
  const calls = [];
  const re = /\brouter\.(get|post|put|patch|delete)\s*\(/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    const inner = readBracketed(clean, clean.indexOf("(", m.index));
    const args = splitTopLevel(inner).map((a) => a.trim());
    calls.push({
      method: m[1].toUpperCase(),
      path: args[0].replace(/^["'`]|["'`]$/g, ""),
      args,
    });
  }
  return calls;
};

// `\bsign` so "assign" is not a candidate; "signDocument", "/sign" and
// "signCertificate" are.
const REGULATED = /\bsign|approv|revok|submit|publish|acknowledg|certificate|calibrationRecord|workflow/i;

/** Every write route that looks like a regulated act, and whether it is guarded. */
const candidates = () => {
  const out = [];
  for (const file of fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".js")).sort()) {
    const source = fs.readFileSync(path.join(ROUTES_DIR, file), "utf8");
    for (const call of routeCalls(source)) {
      if (call.method === "GET") {
        continue;
      }
      if (!REGULATED.test(`${call.path} ${call.args.slice(1).join(" ")}`)) {
        continue;
      }
      out.push({
        key: `${file} ${call.method} ${call.path}`,
        guarded: call.args.some((a) => /^denyPlatformAuthoring$/.test(a)),
      });
    }
  }
  return out;
};

// Carry denyPlatformAuthoring — ADR-051 Q-17's named acts, and the acts the
// A-145 review (2026-09-24) found to be Part 11 authoring as well:
//  - certificate create / update / delete: creation ISSUES a certificate
//    number and date (audited as operation ISSUE); an edit changes the content
//    a member's approval attests — APPROVED certificates stay editable, only
//    signed and revoked ones are locked; a delete withdraws an issued number
//    from the register. Calibration records, their source, are guarded for the
//    same three acts.
//  - SOP publish: releasing a controlled document (ISO 13485 §4.2.4), audited
//    as an APPROVE by the publisher and checked against the author.
//  - SOP acknowledge: the member's own training record (ISO 13485 §6.2).
//  - workflow instance action: an approval or rejection; the final approval
//    stamps the certificate / transfer / work order as approved by the caller.
const GUARDED = [
  "calibrationRecords.route.js POST /",
  "calibrationRecords.route.js POST /:calibrationRecordId/corrections", // P6-03
  "calibrationRecords.route.js POST /:calibrationRecordId/void", // P6-03
  "certificates.route.js DELETE /:certificateId",
  "certificates.route.js POST /",
  "certificates.route.js POST /:certificateId/approve",
  "certificates.route.js POST /:certificateId/revoke",
  "certificates.route.js POST /:certificateId/sign",
  "certificates.route.js POST /:certificateId/submit",
  "certificates.route.js PUT /:certificateId",
  "eSignature.route.js POST /sign",
  "sop.route.js PATCH /:id/publish",
  "sop.route.js POST /:id/acknowledge",
  "workflows.route.js POST /instances/:instanceId/action",
];

// Reviewed 2026-09-24 and deliberately NOT guarded — with the reason. A route
// moved out of this list must move into GUARDED, and a new one must land in
// one of the two.
const NOT_GUARDED = {
  "ai.route.js POST /ocr": "matched on its `certificate` gate; extracts text from a file, authors nothing",
  "apiKeys.route.js DELETE /:id": "API-key revocation — an administrative act, not a Part 11 record",
  "attachments.route.js POST /:id/signed-url": "issues a download URL, authors nothing",
  "certificates.route.js POST /:certificateId/pdf": "renders an existing certificate, authors nothing",
  "eSignature.route.js DELETE /workflows/:workflowId": "workflow management, audited (F-8); authors no signature",
  "eSignature.route.js POST /workflows": "workflow setup, audited (F-8); the signature itself is POST /sign",
  "eSignature.route.js POST /workflows/:workflowId/cancel":
    "A-145 reviewed: withdraws a signing request; authors no signature and no record content, signatures already given stay verifiable; a closed workflow answers 409 and the cancel is audited with the impersonator (F-8, A-130). Unsticking a workflow is a legitimate support act",
  "eSignature.route.js PUT /workflows/:workflowId": "workflow setup, audited (F-8); the signature itself is POST /sign",
  "iot.route.js DELETE /devices/:deviceId/token":
    "IoT device credential revocation — an administrative act on a machine credential, not a Part 11 record",
  "menuGroups.route.js POST /bulk-revoke": "menu configuration, not a record",
  "menuGroups.route.js POST /revoke": "menu configuration, not a record",
  "menuGroups.route.js POST /revoke-item": "menu configuration, not a record",
  "predictiveMaintenance.route.js POST /recommendations/:deviceId/approve":
    "A-145 reviewed: sets a device's calibrationIntervalDays — equipment master data that PUT /calibration-devices/:id edits unguarded under the same grant, so guarding here alone would be theatre. Audited in its transaction (APPROVE, APPLY_RECOMMENDED_INTERVAL)",
  "session.route.js POST /:id/revoke": "session revocation, not a record",
  "session.route.js POST /user/:userId/revoke-all": "session revocation, not a record",
  "workflows.route.js DELETE /:id": "workflow definition management, not a record",
  "workflows.route.js POST /": "workflow definition management, not a record",
  "workflows.route.js PUT /:id": "workflow definition management, not a record",
};

describe("A-127 — every regulated-looking write route is enumerated and reviewed", () => {
  const found = candidates();

  it("the scan finds routes at all (a scan that finds nothing has not passed)", () => {
    expect(found.length).toBeGreaterThan(GUARDED.length);
  });

  it("the guarded routes are exactly the Q-17 and A-145 acts, and each carries denyPlatformAuthoring", () => {
    expect(
      found
        .filter((r) => r.guarded)
        .map((r) => r.key)
        .sort(),
    ).toEqual([...GUARDED].sort());
  });

  it("every other candidate is in the reviewed NOT_GUARDED list — and nothing else is", () => {
    expect(
      found
        .filter((r) => !r.guarded)
        .map((r) => r.key)
        .sort(),
    ).toEqual(Object.keys(NOT_GUARDED).sort());
  });

  it("the guard runs after auth on every guarded route (it reads the principal)", () => {
    const files = [...new Set(GUARDED.map((key) => key.split(" ")[0]))];
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      const source = fs.readFileSync(path.join(ROUTES_DIR, file), "utf8");
      // `router.use(auth)` at the top of a router runs before every route in it.
      const routerWideAuth = /\brouter\.use\(\s*auth\s*\)/.test(stripComments(source));
      for (const call of routeCalls(source)) {
        const guard = call.args.indexOf("denyPlatformAuthoring");
        if (guard === -1) {
          continue;
        }
        const auth = call.args.indexOf("auth");
        expect({
          route: `${file} ${call.method} ${call.path}`,
          afterAuth: routerWideAuth || (auth > 0 && auth < guard),
        }).toEqual({
          route: `${file} ${call.method} ${call.path}`,
          afterAuth: true,
        });
      }
    }
  });
});
