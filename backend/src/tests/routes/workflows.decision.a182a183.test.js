/**
 * A-182 / A-183 — a workflow decision on a Certificate is a Part 11 act.
 *
 * A-182: POST /workflows/instances/:instanceId/action used to set a
 * certificate APPROVED on its final approval with NO re-authentication
 * (A-62 / ADR-047 require one for every approval), from ANY status, writing an
 * approver to `approvedById` — not a Certificate attribute, so no approver was
 * recorded at all (A-200). A rejection reset the certificate to "DRAFT" from
 * any status, an approved, signed or revoked one included.
 *
 * A-183: the route and GET /instances/pending had no dynamicAccess, and
 * submitAction read "already acted" and the step's approval count before its
 * transaction, unlocked.
 *
 * Runs the REAL router, middleware (validateUuid, denyPlatformAuthoring,
 * validate), controller, workflow.service AND certificate.service — the
 * certificate state machine, the credential check and the ESignatureRecord.
 * Stubbed: `auth` (sets the principal as auth.middleware does), the permission
 * matrix behind `dynamicAccess` (a grant table per user, applied by the same
 * any-of rule), the password/MFA boundary, and the model layer. Writes go
 * through the auditLedger fixture with CLS OFF: a write that does not pass
 * `{ transaction }` autocommits and survives a rollback, and these tests would
 * see it. Principals come from createTwoTenants.
 */

const { createLedger } = require("../fixtures/auditLedger");
const { createTwoTenants } = require("../fixtures/twoTenants");

const mockRef = {
  ledger: null,
  store: null,
  user: null,
  tenantId: null,
  grants: new Map(), // userId -> Set of menus held with write
  gates: [], // every dynamicAccess(...) the router declared
  lockedReads: [],
};

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual("../../middlewares/auth.middleware");
  return {
    ...actual,
    auth: (req, res, next) => {
      req.user = mockRef.user;
      req.tenantId = mockRef.tenantId;
      req.impersonatorId = null;
      next();
    },
  };
});

/** The matrix: write satisfies read; any-of over the menus, as dynamicAccess does. */
const mockAllowed = (user, menus) => {
  const held = mockRef.grants.get(user.id) || new Set();
  return (Array.isArray(menus) ? menus : [menus]).some((m) => held.has(m));
};
jest.mock("../../middlewares/dynamicAccess.middleware", () => ({
  dynamicAccess: (menus, permission) => {
    mockRef.gates.push({ menus, permission });
    return (req, res, next) =>
      mockAllowed(req.user, menus)
        ? next()
        : res.status(403).json({ success: false, status: 403, message: "Forbidden: Insufficient permissions" });
  },
  principalHasMenuPermission: async (principal, menu) => mockAllowed(principal, menu),
}));

jest.mock("../../services/auth.service", () => ({
  passIsValid: jest.fn(async (userId, password) => ({ data: { valid: password === "correct-password" } })),
}));
jest.mock("../../services/mfa.service", () => ({ verifyLogin: jest.fn(async () => false) }));
jest.mock("../../services/webhook.service", () => ({ emitAfterCommit: jest.fn() }));

/** A row as a Sequelize instance presents it: save/update write to the ledger. */
const mockInstance = (table, row) => {
  const inst = { ...row };
  const define = (name, value) => Object.defineProperty(inst, name, { enumerable: false, value });
  define("save", async (options) => mockRef.ledger.write(table, mockPlain(inst), options));
  define("update", async (values, options) => {
    Object.assign(inst, values);
    return mockRef.ledger.write(table, mockPlain(inst), options);
  });
  define("toJSON", () => mockPlain(inst));
  if (table === "certificates") {
    // The model's own transition (models/certificate.model.js#approve).
    define("approve", async (options) => {
      if (inst.status !== "pending_approval") {
        throw new Error(`Cannot approve certificate with status: ${inst.status}`);
      }
      inst.status = "approved";
      return inst.save(options);
    });
  }
  return inst;
};
const mockPlain = (inst) => {
  const out = {};
  for (const [k, v] of Object.entries(inst)) {
    if (typeof v !== "function" && k !== "workflow" && k !== "actions") {out[k] = v;}
  }
  return out;
};

jest.mock("../../models", () => ({
  WorkflowInstance: {
    // Models READ COMMITTED: a read outside any transaction sees the snapshot
    // taken before a concurrent decision committed (`staleActions`); a read
    // inside the decision's transaction — after the row lock — sees it.
    findOne: jest.fn(async ({ where, transaction, lock }) => {
      if (lock) {mockRef.lockedReads.push({ table: "workflow_instances", transaction, lock });}
      const row = mockRef.store.workflow_instances.find(
        (r) => r.id === where.id && r.tenantId === where.tenantId,
      );
      if (!row) {return null;}
      const inst = mockInstance("workflow_instances", row);
      inst.workflow = row.workflow;
      inst.actions = transaction ? row.actions : row.staleActions || row.actions;
      return inst;
    }),
    findAll: jest.fn(async () => []),
    count: jest.fn(async () => 0),
  },
  WorkflowAction: {
    create: jest.fn(async (values, options) => mockRef.ledger.write("workflow_actions", values, options)),
  },
  Workflow: {
    findOne: jest.fn(async ({ where }) => {
      const row = mockRef.store.workflows.find((r) => r.id === where.id && r.tenantId === where.tenantId);
      if (!row) {return null;}
      const inst = mockInstance("workflows", row);
      Object.defineProperty(inst, "destroy", {
        enumerable: false,
        value: async (options) => mockRef.ledger.write("workflows", { id: inst.id, deleted: true }, options),
      });
      return inst;
    }),
    update: jest.fn(async () => [0]),
  },
  WorkflowStep: {
    findAll: jest.fn(async () => []),
    destroy: jest.fn(async () => 0),
    bulkCreate: jest.fn(async () => []),
  },
  Role: {},
  StockTransfer: { findOne: jest.fn(async () => null) },
  MaintenanceWorkOrder: { findOne: jest.fn(async () => null) },
  Certificate: {
    findOne: jest.fn(async ({ where, transaction, lock }) => {
      if (lock) {mockRef.lockedReads.push({ table: "certificates", transaction, lock });}
      const row = mockRef.store.certificates.find(
        (r) => r.id === where.id && r.tenantId === where.tenantId,
      );
      return row ? mockInstance("certificates", row) : null;
    }),
  },
  ESignatureRecord: {
    create: jest.fn(async (values, options) => mockRef.ledger.write("esignature_records", values, options)),
  },
  CalibrationDevice: {},
  CalibrationRecord: {},
  Tenant: {},
  User: { findByPk: jest.fn(async () => null) },
  Sequelize: {},
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
  sequelize: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));

const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const { logger } = require("../../middlewares/activityLog.middleware");
const router = require("../../routes/api/workflows.route");
const { CERTIFICATE_APPROVAL_NEEDS_REAUTH } = require("../../services/workflow.service");

const fx = createTwoTenants();
const TENANT_A = fx.tenantA.id;
const TENANT_B = fx.tenantB.id;

/** req.user as auth.middleware builds it, with the `roleId` a step names. */
const principal = (tenant, role) => {
  const p = fx.principal(tenant, role);
  p.roleId = p.role.id;
  return p;
};
const APPROVER_A = principal(fx.tenantA, "TECHNICIAN");
const APPROVER_A2 = principal(fx.tenantA, "SUPERVISOR");
const APPROVER_B = principal(fx.tenantB, "TECHNICIAN");

const INSTANCE_A = "a0000004-0000-4000-8000-000000000001";
const INSTANCE_B = "b0000004-0000-4000-8000-000000000001";
const CERT_A = "a0000006-0000-4000-8000-000000000001";
const CERT_B = "b0000006-0000-4000-8000-000000000001";
const MISSING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const WORKFLOW_A = "a0000007-0000-4000-8000-000000000001";
const ADMIN_B = principal(fx.tenantB, "HEALTCARE_ADMIN");

const REAUTH = { authMethod: "password", authPayload: "correct-password", meaning: "Reviewed and approved" };

/** A one-step Certificate workflow whose step both A-approvers' roles... share: the TECHNICIAN role. */
const certificateWorkflow = (tenantId, { requiredApprovals = 1, steps = 1 } = {}) => ({
  resourceType: "Certificate",
  steps: Array.from({ length: steps }, (_, i) => ({
    id: `${tenantId}-s${i + 1}`,
    stepOrder: i + 1,
    roleId: tenantId === TENANT_A ? APPROVER_A.roleId : APPROVER_B.roleId,
    requiredApprovals,
  })),
});

const as = (user) => {
  mockRef.user = user;
  mockRef.tenantId = user.tenantId;
};

/** Drive the real router inside the tenant context auth would open. */
const http = (method, url, body = {}) =>
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
    };
    const req = {
      method,
      url,
      originalUrl: `/api/v1/workflows${url}`,
      body,
      query: {},
      params: {},
      headers: { "user-agent": "jest-a182" },
      ip: "10.1.2.3",
      get: () => undefined,
    };
    tenantStorage.run(
      { tenantId: mockRef.tenantId, isSuperAdmin: false, isSystemTask: false },
      () =>
        router.handle(req, res, (err) =>
          resolve({
            status: err ? err.status || err.statusCode || 500 : 404,
            body: { message: err ? err.message : "no route" },
          }),
        ),
    );
  });

const approve = (instanceId, extra = REAUTH) =>
  http("POST", `/instances/${instanceId}/action`, { action: "APPROVED", ...extra });
const reject = (instanceId) =>
  http("POST", `/instances/${instanceId}/action`, { action: "REJECTED", comments: "rework" });

const certA = () => mockRef.store.certificates.find((c) => c.id === CERT_A);
const committedCertificateA = () =>
  mockRef.ledger.committed("certificates").filter((r) => r.id === CERT_A);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(logger, "error").mockImplementation(() => logger);
  jest.spyOn(logger, "info").mockImplementation(() => logger);
  jest.spyOn(logger, "warn").mockImplementation(() => logger);
  mockRef.ledger = createLedger({ cls: false });
  mockRef.lockedReads = [];
  mockRef.grants = new Map([
    [APPROVER_A.id, new Set(["certificate", "workflows"])],
    [APPROVER_A2.id, new Set(["certificate", "workflows"])],
    [APPROVER_B.id, new Set(["certificate", "workflows"])],
    [ADMIN_B.id, new Set(["workflows"])],
  ]);
  mockRef.store = {
    workflows: [{ id: WORKFLOW_A, tenantId: TENANT_A, name: "Cert approval", resourceType: "Certificate", isActive: true }],
    workflow_instances: [
      { id: INSTANCE_A, tenantId: TENANT_A, status: "PENDING", currentStepOrder: 1, resourceId: CERT_A, workflow: certificateWorkflow(TENANT_A), actions: [] },
      { id: INSTANCE_B, tenantId: TENANT_B, status: "PENDING", currentStepOrder: 1, resourceId: CERT_B, workflow: certificateWorkflow(TENANT_B), actions: [] },
    ],
    certificates: [
      { id: CERT_A, tenantId: TENANT_A, certificateNumber: "CERT-A-1", status: "pending_approval", approvedBy: null, deviceId: "dev-a" },
      { id: CERT_B, tenantId: TENANT_B, certificateNumber: "CERT-B-1", status: "pending_approval", approvedBy: null, deviceId: "dev-b" },
    ],
  };
});

describe("A-183 — the routes are gated", () => {
  it("POST /instances/:instanceId/action declares a write gate on the record types a workflow decides on", () => {
    expect(mockRef.gates).toEqual(
      expect.arrayContaining([
        { menus: ["certificate", "warehouse", "maintenance"], permission: "write" },
        { menus: "workflows", permission: "read" },
      ]),
    );
  });

  it("a caller with no grant on any of them is 403 at the gate, and nothing is written", async () => {
    mockRef.grants.set(APPROVER_A.id, new Set());
    as(APPROVER_A);

    const res = await approve(INSTANCE_A);

    expect(res.status).toBe(403);
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("write access to another record type is not enough: a Certificate decision needs `certificate` (403)", async () => {
    mockRef.grants.set(APPROVER_A.id, new Set(["warehouse"]));
    as(APPROVER_A);

    const res = await approve(INSTANCE_A);

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('"certificate"');
    expect(mockRef.ledger.rows).toEqual([]);
    expect(certA().status).toBe("pending_approval");
  });

  it("GET /instances/pending needs the Workflows page's read grant", async () => {
    mockRef.grants.set(APPROVER_A.id, new Set(["certificate"]));
    as(APPROVER_A);
    expect((await http("GET", "/instances/pending")).status).toBe(403);

    mockRef.grants.set(APPROVER_A.id, new Set(["workflows"]));
    expect((await http("GET", "/instances/pending")).status).toBe(200);
  });
});

describe("two tenants", () => {
  it("another tenant's instance answers 404, the same as one that does not exist, and nothing is written", async () => {
    as(APPROVER_B);
    const foreign = await approve(INSTANCE_A);
    const missing = await approve(MISSING);

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect(mockRef.ledger.rows).toEqual([]);
    expect(certA().status).toBe("pending_approval");
  });

  it("another tenant's instance is 404 for a rejection too", async () => {
    as(APPROVER_B);
    const res = await reject(INSTANCE_A);

    expect(res.status).toBe(404);
    expect(mockRef.ledger.rows).toEqual([]);
  });
});

describe("A-182 — approving a certificate re-authenticates", () => {
  it("a final approval without re-authentication is 400 and the certificate is not approved", async () => {
    as(APPROVER_A);
    const res = await approve(INSTANCE_A, {});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(CERTIFICATE_APPROVAL_NEEDS_REAUTH);
    expect(mockRef.ledger.rows).toEqual([]);
    expect(certA().status).toBe("pending_approval");
  });

  it("an intermediate approval without re-authentication is 400 as well", async () => {
    mockRef.store.workflow_instances[0].workflow = certificateWorkflow(TENANT_A, { steps: 2 });
    as(APPROVER_A);
    const res = await approve(INSTANCE_A, {});

    expect(res.status).toBe(400);
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("a wrong password is 401: only the SIGNATURE_AUTH_FAILED row is written", async () => {
    as(APPROVER_A);
    const res = await approve(INSTANCE_A, { ...REAUTH, authPayload: "wrong" });

    expect(res.status).toBe(401);
    expect(mockRef.ledger.committed("workflow_actions")).toEqual([]);
    expect(committedCertificateA()).toEqual([]);
    expect(mockRef.ledger.committed("esignature_records")).toEqual([]);
    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({
        action: "SIGNATURE_AUTH_FAILED",
        userId: APPROVER_A.id,
        tenantId: TENANT_A,
        resourceType: "Certificate",
        resourceId: CERT_A,
        changes: { method: "password", operation: "workflow-approve" },
      }),
    ]);
  });

  it("a re-authenticated final approval approves through the state machine, names the approver, and signs", async () => {
    as(APPROVER_A);
    const res = await approve(INSTANCE_A);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: "APPROVED" });

    // A-200 — the approver is recorded, in the real column.
    expect(committedCertificateA().pop()).toEqual(
      expect.objectContaining({ status: "approved", approvedBy: APPROVER_A.id }),
    );
    expect(mockRef.ledger.committed("esignature_records")).toEqual([
      expect.objectContaining({
        tenantId: TENANT_A,
        entityType: "Certificate",
        entityId: CERT_A,
        userId: APPROVER_A.id,
        action: "approve",
        meaning: REAUTH.meaning,
        authMethod: "password",
        ipAddress: "10.1.2.3",
        userAgent: "jest-a182",
      }),
    ]);
    const audit = mockRef.ledger.auditRows();
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "APPROVE",
          resourceType: "Certificate",
          resourceId: CERT_A,
          userId: APPROVER_A.id,
          changes: expect.objectContaining({
            operation: "APPROVE",
            before: { status: "pending_approval" },
            after: expect.objectContaining({ status: "approved", approvedBy: APPROVER_A.id, workflowInstanceId: INSTANCE_A }),
          }),
        }),
        expect.objectContaining({
          action: "APPROVE",
          resourceType: "WorkflowInstance",
          resourceId: INSTANCE_A,
          changes: expect.objectContaining({ meaning: REAUTH.meaning, reauthenticated: "password" }),
        }),
      ]),
    );
    expect(audit).toHaveLength(2);
    // Never the credential.
    expect(JSON.stringify(mockRef.ledger.rows)).not.toContain(REAUTH.authPayload);
    // The certificate was locked inside the decision's transaction.
    expect(mockRef.lockedReads.map((r) => r.table)).toEqual(["workflow_instances", "certificates"]);
    expect(mockRef.lockedReads.every((r) => r.transaction && r.lock === "UPDATE")).toBe(true);
  });

  it("the certificate approval rolls back with the decision when the audit row cannot be written", async () => {
    as(APPROVER_A);
    mockRef.ledger.failNext("audit_logs");
    const res = await approve(INSTANCE_A);

    expect(res.status).toBe(500);
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it.each([
    ["draft", "has not been submitted yet"],
    ["approved", "has already been approved"],
    ["signed", "already been approved and signed"],
    ["revoked", "revocation is final"],
  ])("a final approval of a %s certificate is 409 with the state explanation, and nothing is written", async (status, why) => {
    certA().status = status;
    as(APPROVER_A);
    const res = await approve(INSTANCE_A);

    expect(res.status).toBe(409);
    expect(res.body.message).toContain(`This certificate is "${status}" and cannot be approved`);
    expect(res.body.message).toContain(why);
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("a final approval of a deleted certificate is 409, and nothing is written", async () => {
    mockRef.store.certificates = mockRef.store.certificates.filter((c) => c.id !== CERT_A);
    as(APPROVER_A);
    const res = await approve(INSTANCE_A);

    expect(res.status).toBe(409);
    expect(res.body.message).toContain("no longer exists");
    expect(mockRef.ledger.rows).toEqual([]);
  });
});

describe("A-182 — a rejection only from a state it can undo", () => {
  it.each(["approved", "signed", "revoked"])(
    "rejecting a %s certificate is 409 with the state explanation; the certificate keeps its status",
    async (status) => {
      certA().status = status;
      as(APPROVER_A);
      const res = await reject(INSTANCE_A);

      expect(res.status).toBe(409);
      expect(res.body.message).toContain(`This certificate is "${status}" and cannot be rejected`);
      expect(mockRef.ledger.rows).toEqual([]);
      expect(certA().status).toBe(status);
    },
  );

  it("rejecting a pending_approval certificate returns it to draft, audited in the same transaction", async () => {
    as(APPROVER_A);
    const res = await reject(INSTANCE_A);

    expect(res.status).toBe(200);
    expect(committedCertificateA().pop()).toEqual(expect.objectContaining({ status: "draft" }));
    expect(mockRef.ledger.auditRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "UPDATE",
          resourceType: "Certificate",
          resourceId: CERT_A,
          userId: APPROVER_A.id,
          changes: expect.objectContaining({
            operation: "WORKFLOW_REJECT",
            before: { status: "pending_approval" },
            after: { status: "draft", workflowInstanceId: INSTANCE_A, comments: "rework" },
          }),
        }),
        expect.objectContaining({ resourceType: "WorkflowInstance", changes: expect.objectContaining({ operation: "WORKFLOW_REJECT" }) }),
      ]),
    );
  });

  it("a rejection with no comment records null, not undefined", async () => {
    as(APPROVER_A);
    const res = await http("POST", `/instances/${INSTANCE_A}/action`, { action: "REJECTED" });

    expect(res.status).toBe(200);
    const certificateRow = mockRef.ledger.auditRows().find((r) => r.resourceType === "Certificate");
    expect(certificateRow.changes.after).toEqual({ status: "draft", workflowInstanceId: INSTANCE_A, comments: null });
  });

  it("rejecting a draft certificate records the rejection and leaves the certificate as it is", async () => {
    certA().status = "draft";
    as(APPROVER_A);
    const res = await reject(INSTANCE_A);

    expect(res.status).toBe(200);
    expect(committedCertificateA()).toEqual([]);
    expect(mockRef.ledger.committed("workflow_instances")).toEqual([
      expect.objectContaining({ id: INSTANCE_A, status: "REJECTED" }),
    ]);
  });
});

describe("A-183 — the decision reads under the instance lock", () => {
  it("the same approver's concurrent second approval is refused 409 (it used to be counted twice)", async () => {
    // A first approval by APPROVER_A committed after an unlocked read would
    // have been taken: only a read inside the transaction sees it.
    const row = mockRef.store.workflow_instances[0];
    row.workflow = certificateWorkflow(TENANT_A, { requiredApprovals: 2 });
    row.staleActions = [];
    row.actions = [{ stepId: `${TENANT_A}-s1`, userId: APPROVER_A.id, action: "APPROVED" }];
    as(APPROVER_A);

    const res = await approve(INSTANCE_A);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("You have already submitted an action for this step");
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("a concurrent approval by a second approver is counted: the step completes instead of stalling", async () => {
    const row = mockRef.store.workflow_instances[0];
    row.workflow = certificateWorkflow(TENANT_A, { requiredApprovals: 2 });
    APPROVER_A2.roleId = APPROVER_A.roleId; // same step role, a different person
    row.staleActions = [];
    row.actions = [{ stepId: `${TENANT_A}-s1`, userId: APPROVER_A2.id, action: "APPROVED" }];
    as(APPROVER_A);

    const res = await approve(INSTANCE_A);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: "APPROVED" });
    expect(committedCertificateA().pop()).toEqual(
      expect.objectContaining({ status: "approved", approvedBy: APPROVER_A.id }),
    );
  });
});

describe("A-204 — PUT and DELETE /workflows/:id, two tenants", () => {
  it("another tenant's workflow answers 404 to an update, the same as a missing one, and nothing is written", async () => {
    as(ADMIN_B);
    const foreign = await http("PUT", `/${WORKFLOW_A}`, { name: "Hijacked" });
    const missing = await http("PUT", `/${MISSING}`, { name: "Hijacked" });

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect(mockRef.ledger.rows).toEqual([]);
    expect(mockRef.store.workflows[0].name).toBe("Cert approval");
  });

  it("another tenant's workflow answers 404 to a delete, and nothing is written", async () => {
    as(ADMIN_B);
    const foreign = await http("DELETE", `/${WORKFLOW_A}`);
    const missing = await http("DELETE", `/${MISSING}`);

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("the tenant's own delete commits with its DELETE audit row", async () => {
    const ADMIN_A = principal(fx.tenantA, "HEALTCARE_ADMIN");
    mockRef.grants.set(ADMIN_A.id, new Set(["workflows"]));
    as(ADMIN_A);
    const res = await http("DELETE", `/${WORKFLOW_A}`);

    expect(res.status).toBe(200);
    expect(mockRef.ledger.committed("workflows")).toEqual([{ id: WORKFLOW_A, deleted: true }]);
    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({ action: "DELETE", resourceType: "Workflow", resourceId: WORKFLOW_A, userId: ADMIN_A.id, tenantId: TENANT_A }),
    ]);
  });
});
