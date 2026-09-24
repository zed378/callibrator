/**
 * A-129 / A-130 / A-144 (ADR-051 Q-19, A-107, A-86; F-9, F-10) — who may be
 * named a signer, what a workflow's steps record about them, who may read the
 * signature history, and which workflows may be deleted or cancelled.
 *
 * Everything between the principal and the models is REAL: the router, the
 * real `dynamicAccess` over the permission matrix the seed builds from
 * ROLE_MENU_ASSIGNMENTS, `validateUuid`, the real Joi validators, the
 * controller, the service and audit.service. Doubled: `auth` (to set the
 * principal), the model layer (an in-memory store that applies the tenant
 * predicate the service passes), and the transaction — the auditLedger
 * fixture, with `cls: false`, so a write that does not pass `{ transaction }`
 * autocommits and survives a rollback, and the test sees it.
 *
 * Fail-before (each assertion was run against the code as it stood on
 * 2026-09-24, before this change):
 *  - POST /workflows wrote the body's `name`/`email` onto the step, accepted a
 *    USER, an inactive user, another tenant's user id and an email-only signer,
 *    and wrote no audit row;
 *  - GET /history answered a TECHNICIAN every signature in the tenant, with
 *    ipAddress/userAgent/biometricData, and honoured `?userId=` of another user;
 *  - DELETE /workflows/:id deleted an in_progress workflow with a signature;
 *  - POST /workflows/:id/cancel did not exist (404 "no route").
 */

const { createTwoTenants } = require("../fixtures/twoTenants");
const { createLedger } = require("../fixtures/auditLedger");

let currentUser = null;

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual("../../middlewares/auth.middleware");
  return {
    ...actual,
    auth: (req, res, next) => {
      req.user = currentUser;
      next();
    },
  };
});

jest.mock("../../services/roles.service", () => ({
  getRolePermissionsMatrix: jest.fn(),
}));
jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn(),
}));
jest.mock("../../services/emailQueue.service", () => ({
  // A-158: the real export (emailQueueService never existed).
  queueNotificationEmail: jest.fn().mockResolvedValue(true),
}));

const mockRef = { ledger: null };
jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));

// ---- the in-memory model layer ------------------------------------------

const mockStore = { users: [], roles: new Map(), workflows: [], records: [] };

const mockMatches = (row, where = {}) =>
  Object.entries(where).every(([key, value]) =>
    Array.isArray(value) ? value.includes(row[key]) : row[key] === value,
  );

const mockWorkflowInstance = (row) => ({
  ...row,
  async update(values, options) {
    mockRef.ledger.write("signature_workflows", { id: row.id, ...values }, options);
    Object.assign(this, values);
    return this;
  },
  async destroy(options) {
    mockRef.ledger.write("signature_workflows", { id: row.id, deletedAt: new Date() }, options);
  },
});

jest.mock("../../models", () => ({
  // The User defaultScope (is_deleted = false) is applied here as the model
  // would: a deleted user is not found.
  User: {
    findOne: jest.fn(async ({ where }) =>
      mockStore.users.find((u) => !u.isDeleted && mockMatches(u, where)) || null,
    ),
    findAll: jest.fn(async ({ where }) =>
      mockStore.users.filter((u) => !u.isDeleted && mockMatches(u, where)),
    ),
    findByPk: jest.fn(async (id) => mockStore.users.find((u) => u.id === id) || null),
  },
  Role: {
    findByPk: jest.fn(async (id) => mockStore.roles.get(id) || null),
    findAll: jest.fn(async ({ where }) =>
      [...mockStore.roles.values()].filter((r) => where.id.includes(r.id)),
    ),
  },
  Tenants: { findByPk: jest.fn() },
  SignatureWorkflow: {
    create: jest.fn(async (attrs, options) => {
      const row = mockRef.ledger.write(
        "signature_workflows",
        { id: `wf-new-${mockStore.workflows.length + 1}`, ...attrs },
        options,
      );
      return mockWorkflowInstance(row);
    }),
    findOne: jest.fn(async ({ where }) => {
      const row = mockStore.workflows.find((w) => mockMatches(w, where));
      return row ? mockWorkflowInstance(row) : null;
    }),
  },
  SignatureWorkflowStep: {
    create: jest.fn(async (attrs, options) =>
      mockRef.ledger.write(
        "signature_workflow_steps",
        { id: `step-new-${attrs.stepNumber}`, ...attrs },
        options,
      ),
    ),
  },
  SignatureRecord: {
    // paranoid: a soft-deleted record is counted only with paranoid: false.
    count: jest.fn(async ({ where, paranoid }) =>
      mockStore.records.filter(
        (r) => mockMatches(r, where) && (paranoid === false || !r.deletedAt),
      ).length,
    ),
    findAll: jest.fn(async ({ where, attributes }) =>
      mockStore.records
        .filter((r) => !r.deletedAt && mockMatches(r, where))
        .map((r) => {
          const out = { ...r };
          for (const key of (attributes && attributes.exclude) || []) {
            delete out[key];
          }
          return out;
        }),
    ),
  },
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
}));

// ---- the harness ---------------------------------------------------------

const RolesService = require("../../services/roles.service");
const { getUserOverrideMatrix } = require("../../services/userPermission.service");
const { ROLE_MENU_ASSIGNMENTS, MENU_SLUGS } = require("../../constants");
const router = require("../../routes/api/eSignature.route");

const http = (method, url, { body = {}, query = {} } = {}) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        if (!this.headersSent) {
          this.headersSent = true;
          resolve({ status: this.statusCode, body: payload });
        }
        return this;
      },
      setHeader() {
        return this;
      },
    };
    const req = {
      method: method.toUpperCase(),
      url,
      originalUrl: "/api/v1/esignature" + url,
      body,
      query,
      params: {},
      headers: { "user-agent": "jest-agent" },
      ip: "203.0.113.9",
      get: (h) => (h.toLowerCase() === "user-agent" ? "jest-agent" : undefined),
    };
    router.handle(req, res, (err) =>
      resolve({
        status: err ? err.status || 500 : 404,
        body: { message: err ? err.message : "no route" },
      }),
    );
  });

const matrixFor = (roleName) => {
  const entry = ROLE_MENU_ASSIGNMENTS.find((a) => a.roleName === roleName);
  const matrix = {};
  for (const [slug, permission] of Object.entries(entry ? entry.menus : {})) {
    matrix[slug] = [permission];
  }
  return matrix;
};

let fx;
let overrides;
const P = {};

/** Register a principal as a user row the service can look up. */
const addUser = (principal, fields = {}) => {
  mockStore.roles.set(principal.role.id, { id: principal.role.id, name: principal.role.name });
  const row = {
    id: principal.id,
    tenantId: principal.tenantId,
    roleId: principal.role.id,
    username: principal.username,
    email: `${principal.username}@hospital.example`,
    firstName: principal.username.replace(/[0-9]+$/, ""),
    lastName: "Tester",
    isActive: true,
    status: "ACTIVE",
    isDeleted: false,
    ...fields,
  };
  mockStore.users.push(row);
  return row;
};

const as = (principal) => {
  currentUser = principal;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRef.ledger = createLedger({ cls: false });
  overrides = {};
  getUserOverrideMatrix.mockImplementation(async (userId) => overrides[userId] || {});
  RolesService.getRolePermissionsMatrix.mockImplementation(async (roleId) => {
    const role = mockStore.roles.get(roleId);
    return matrixFor(role && role.name);
  });

  fx = createTwoTenants();
  mockStore.users = [];
  mockStore.roles = new Map();
  mockStore.workflows = [];
  mockStore.records = [];

  P.adminA = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  P.techA = fx.principal(fx.tenantA, "TECHNICIAN");
  P.supA = fx.principal(fx.tenantA, "SUPERVISOR");
  P.userA = fx.principal(fx.tenantA, "USER");
  P.roomA = fx.principal(fx.tenantA, "ROOM_USER");
  P.whA = fx.principal(fx.tenantA, "WAREHOUSE_STAFF");
  P.facilityA = fx.principal(fx.tenantA, "FACILITY_MAINTENANCE");
  P.techB = fx.principal(fx.tenantB, "TECHNICIAN");
  P.adminB = fx.principal(fx.tenantB, "HEALTCARE_ADMIN");
  for (const principal of Object.values(P)) {
    addUser(principal);
  }
});

const workflowBody = (signers) => ({
  documentId: "cert-1",
  subject: "Approve certificate CAL-1",
  signers,
});

const nothingCommitted = () => {
  expect(mockRef.ledger.committed("signature_workflows")).toEqual([]);
  expect(mockRef.ledger.committed("signature_workflow_steps")).toEqual([]);
  expect(mockRef.ledger.auditRows()).toEqual([]);
};

// ==========================================================================
describe("A-129 — POST /workflows: signers are users of the tenant who may sign", () => {
  it("writes each step's name and email from the user row, never the body's (F-10), with a CREATE audit row in the same transaction", async () => {
    as(P.adminA);

    const res = await http("post", "/workflows", {
      body: workflowBody([
        { userId: P.techA.id, name: "Forged Name", email: "forged@evil.example" },
        { userId: P.supA.id },
      ]),
    });

    expect(res.status).toBe(201);
    const steps = mockRef.ledger.committed("signature_workflow_steps");
    expect(steps).toEqual([
      expect.objectContaining({
        tenantId: fx.tenantA.id,
        stepNumber: 1,
        signerId: P.techA.id,
        signerEmail: `${P.techA.username}@hospital.example`,
        signerName: "technician Tester",
        status: "pending",
      }),
      expect.objectContaining({ stepNumber: 2, signerId: P.supA.id, status: "waiting" }),
    ]);
    expect(JSON.stringify(steps)).not.toMatch(/Forged|forged@evil/);
    // A step no longer carries an IP address or user agent from the body.
    expect(steps[0].ipAddress).toBeUndefined();

    const [workflow] = mockRef.ledger.committed("signature_workflows");
    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({
        tenantId: fx.tenantA.id,
        userId: P.adminA.id,
        action: "CREATE",
        resourceType: "SignatureWorkflow",
        resourceId: workflow.id,
        ipAddress: "203.0.113.9",
        changes: expect.objectContaining({
          after: expect.objectContaining({
            documentId: "cert-1",
            signers: [
              { stepNumber: 1, userId: P.techA.id },
              { stepNumber: 2, userId: P.supA.id },
            ],
          }),
        }),
      }),
    ]);
    expect(res.body.data.signers).toEqual([
      expect.objectContaining({ userId: P.techA.id, name: "technician Tester", status: "pending" }),
      expect.objectContaining({ userId: P.supA.id, status: "waiting" }),
    ]);
  });

  it("A-86: an email-only (external) signer is refused with 400 and the way forward; nothing is written", async () => {
    as(P.adminA);

    const res = await http("post", "/workflows", {
      body: workflowBody([{ userId: P.techA.id }, { email: "vendor@outside.example", name: "Vendor" }]),
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/^Signer 2: Signers must be users of this organisation/);
    expect(res.body.message).toMatch(/invite them as a user with e-signature permission/);
    nothingCommitted();
  });

  it("two tenants: a signer from tenant B is 404, byte-identical to an unknown id and a deleted user; nothing is written", async () => {
    addUser(fx.principal(fx.tenantA, "HEALTHCARE_TECHNICIAN"), { isDeleted: true });
    const deleted = mockStore.users[mockStore.users.length - 1];
    as(P.adminA);

    const foreign = await http("post", "/workflows", { body: workflowBody([{ userId: P.techB.id }]) });
    const unknown = await http("post", "/workflows", {
      body: workflowBody([{ userId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }]),
    });
    const gone = await http("post", "/workflows", { body: workflowBody([{ userId: deleted.id }]) });

    expect(foreign.status).toBe(404);
    expect(foreign.body.message).toBe("Signer not found");
    expect(unknown).toEqual(foreign);
    expect(gone).toEqual(foreign);
    nothingCommitted();
  });

  it.each([
    ["USER", "userA"],
    ["ROOM USER", "roomA"],
    ["WAREHOUSE STAFF", "whA"],
  ])("a %s cannot be named a signer (ADR-051 Q-19): 400 naming the signer; nothing is written", async (_role, key) => {
    as(P.adminA);

    const res = await http("post", "/workflows", {
      body: workflowBody([{ userId: P.techA.id }, { userId: P[key].id }]),
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/^Signer 2 \(.+\) does not hold the e-signature signing permission/);
    nothingCommitted();
  });

  it.each([
    ["inactive", { isActive: false }],
    ["suspended", { status: "SUSPENDED" }],
  ])("an %s user of the tenant is refused with 400", async (_label, fields) => {
    Object.assign(mockStore.users.find((u) => u.id === P.facilityA.id), fields);
    as(P.adminA);

    const res = await http("post", "/workflows", { body: workflowBody([{ userId: P.facilityA.id }]) });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/^Signer 1 \(.+\) is not an active user/);
    nothingCommitted();
  });

  it("a tenant can still let one USER sign, through a per-user grant", async () => {
    overrides[P.userA.id] = { [MENU_SLUGS.ESIGNATURE]: "write" };
    as(P.adminA);

    const res = await http("post", "/workflows", { body: workflowBody([{ userId: P.userA.id }]) });

    expect(res.status).toBe(201);
  });

  it("a per-user `none` withdraws signing from a TECHNICIAN at creation too", async () => {
    overrides[P.techA.id] = { [MENU_SLUGS.ESIGNATURE]: "none" };
    as(P.adminA);

    const res = await http("post", "/workflows", { body: workflowBody([{ userId: P.techA.id }]) });

    expect(res.status).toBe(400);
    nothingCommitted();
  });

  it("a failing audit insert rolls the workflow and its steps back", async () => {
    mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));
    as(P.adminA);

    const res = await http("post", "/workflows", { body: workflowBody([{ userId: P.techA.id }]) });

    expect(res.status).toBe(500);
    nothingCommitted();
  });
});

// ==========================================================================
describe("A-129 — GET /signers: the users a workflow may name", () => {
  it("lists the tenant's active users holding esignature write — no USER, ROOM USER, WAREHOUSE STAFF, inactive user or other tenant", async () => {
    Object.assign(mockStore.users.find((u) => u.id === P.facilityA.id), { isActive: false });
    as(P.adminA);

    const res = await http("get", "/signers");

    expect(res.status).toBe(200);
    const ids = res.body.data.map((s) => s.id).sort();
    expect(ids).toEqual([P.adminA.id, P.techA.id, P.supA.id].sort());
    expect(res.body.meta).toEqual({ total: 3 });
    for (const row of res.body.data) {
      expect(Object.keys(row).sort()).toEqual(["email", "id", "name"]);
    }
  });

  it("is workflow management: a TECHNICIAN (no qms write) gets 403", async () => {
    as(P.techA);

    expect((await http("get", "/signers")).status).toBe(403);
  });
});

// ==========================================================================
describe("A-129 — GET /history (F-9)", () => {
  beforeEach(() => {
    const record = (id, principal) => ({
      id,
      tenantId: principal.tenantId,
      userId: principal.id,
      workflowId: "wf-x",
      signedAt: new Date("2026-09-24T10:00:00Z"),
      ipAddress: "198.51.100.7",
      userAgent: "signer-browser",
      biometricData: { pressure: [1, 2, 3] },
    });
    mockStore.records = [
      record("sig-tech-a", P.techA),
      record("sig-sup-a", P.supA),
      record("sig-tech-b", P.techB),
    ];
  });

  it("a TECHNICIAN sees only their own signatures, without ipAddress, userAgent or biometricData — a ?userId= of someone else is ignored", async () => {
    as(P.techA);

    const res = await http("get", "/history", { query: { userId: P.supA.id } });

    expect(res.status).toBe(200);
    expect(res.body.data.map((r) => r.id)).toEqual(["sig-tech-a"]);
    expect(res.body.data[0]).not.toHaveProperty("ipAddress");
    expect(res.body.data[0]).not.toHaveProperty("userAgent");
    expect(res.body.data[0]).not.toHaveProperty("biometricData");
    expect(res.body.meta).toEqual({ total: 1 });
  });

  it("a caller holding qms read gets the tenant's history — and never another tenant's", async () => {
    as(P.adminA);

    const res = await http("get", "/history");

    expect(res.body.data.map((r) => r.id).sort()).toEqual(["sig-sup-a", "sig-tech-a"]);
    expect(res.body.data[0]).toHaveProperty("ipAddress", "198.51.100.7");
  });

  it("a USER, who no longer holds esignature, gets 403", async () => {
    as(P.userA);

    expect((await http("get", "/history")).status).toBe(403);
  });
});

// ==========================================================================
describe("A-130 / A-144 — DELETE /workflows/:id refuses a workflow with any signature", () => {
  const WF = "a1a1a1a1-0000-4000-8000-000000000001";
  const WF_B = "b2b2b2b2-0000-4000-8000-000000000001";

  beforeEach(() => {
    mockStore.workflows = [
      { id: WF, tenantId: fx.tenantA.id, status: "in_progress", documentId: "cert-1" },
      { id: WF_B, tenantId: fx.tenantB.id, status: "pending", documentId: "cert-b" },
    ];
  });

  it("A-144: an in_progress workflow with one step signed is 409 with the way forward; nothing is deleted or audited", async () => {
    mockStore.records = [{ id: "sig-1", workflowId: WF, tenantId: fx.tenantA.id }];
    as(P.adminA);

    const res = await http("delete", `/workflows/${WF}`);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe(
      'This signature workflow is "in_progress" and has 1 signature, so it cannot be deleted: ' +
        "a signature stays linked to the record it signs (21 CFR 11.70); cancel it instead " +
        "(POST /esignature/workflows/:workflowId/cancel), which keeps the signatures.",
    );
    expect(mockRef.ledger.committed("signature_workflows")).toEqual([]);
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });

  it("a soft-deleted (or revoked) signature still counts", async () => {
    mockStore.records = [
      { id: "sig-1", workflowId: WF, tenantId: fx.tenantA.id, deletedAt: new Date() },
      { id: "sig-2", workflowId: WF, tenantId: fx.tenantA.id, status: "revoked" },
    ];
    as(P.adminA);

    const res = await http("delete", `/workflows/${WF}`);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/has 2 signatures/);
  });

  it("a cancelled workflow with signatures says it stays as the record", async () => {
    mockStore.workflows[0].status = "cancelled";
    mockStore.records = [{ id: "sig-1", workflowId: WF, tenantId: fx.tenantA.id }];
    as(P.adminA);

    const res = await http("delete", `/workflows/${WF}`);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/it stays as the record of what was signed\.$/);
  });

  it("a workflow with no signature is still deleted, with its DELETE audit row", async () => {
    as(P.adminA);

    const res = await http("delete", `/workflows/${WF}`);

    expect(res.status).toBe(200);
    expect(mockRef.ledger.committed("signature_workflows")).toEqual([
      expect.objectContaining({ id: WF, deletedAt: expect.any(Date) }),
    ]);
    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({ action: "DELETE", resourceId: WF, userId: P.adminA.id }),
    ]);
  });

  it("two tenants: tenant A deleting tenant B's workflow is 404, and B's signatures are not even counted", async () => {
    mockStore.records = [{ id: "sig-b", workflowId: WF_B, tenantId: fx.tenantB.id }];
    as(P.adminA);

    const res = await http("delete", `/workflows/${WF_B}`);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Workflow not found");
  });
});

// ==========================================================================
describe("A-130 — POST /workflows/:id/cancel", () => {
  const WF = "a1a1a1a1-0000-4000-8000-000000000001";
  const WF_B = "b2b2b2b2-0000-4000-8000-000000000001";

  beforeEach(() => {
    mockStore.workflows = [
      { id: WF, tenantId: fx.tenantA.id, status: "in_progress", documentId: "cert-1" },
      { id: WF_B, tenantId: fx.tenantB.id, status: "pending", documentId: "cert-b" },
    ];
  });

  it("cancels an open workflow, with one UPDATE/CANCEL audit row carrying the reason, in the same transaction", async () => {
    as(P.adminA);

    const res = await http("post", `/workflows/${WF}/cancel`, { body: { reason: "Superseded by CAL-2" } });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Workflow cancelled");
    expect(mockRef.ledger.committed("signature_workflows")).toEqual([
      expect.objectContaining({ id: WF, status: "cancelled" }),
    ]);
    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({
        tenantId: fx.tenantA.id,
        userId: P.adminA.id,
        action: "UPDATE",
        resourceType: "SignatureWorkflow",
        resourceId: WF,
        changes: {
          operation: "CANCEL",
          before: { status: "in_progress" },
          after: { status: "cancelled", reason: "Superseded by CAL-2" },
        },
      }),
    ]);
  });

  it("works with no body at all", async () => {
    as(P.adminA);

    const res = await http("post", `/workflows/${WF}/cancel`, { body: undefined });

    expect(res.status).toBe(200);
    expect(mockRef.ledger.auditRows()[0].changes.after).toEqual({ status: "cancelled" });
  });

  it.each([
    ["completed", "every signer has signed"],
    ["cancelled", "cancellation is final"],
  ])("a %s workflow is 409 with the state explanation; nothing written", async (status, why) => {
    mockStore.workflows[0].status = status;
    as(P.adminA);

    const res = await http("post", `/workflows/${WF}/cancel`);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe(
      `This signature workflow is "${status}" and cannot be cancelled: ${why}` +
        (status === "completed"
          ? ", and the signatures cover the workflow as it was signed."
          : "; create a new workflow instead."),
    );
    expect(mockRef.ledger.committed("signature_workflows")).toEqual([]);
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });

  it("two tenants: cancelling tenant B's workflow from tenant A is 404, byte-identical to a missing id; B is unchanged", async () => {
    as(P.adminA);

    const foreign = await http("post", `/workflows/${WF_B}/cancel`);
    const missing = await http("post", "/workflows/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/cancel");

    expect(foreign.status).toBe(404);
    expect(foreign.body.message).toBe("Workflow not found");
    expect(missing).toEqual(foreign);
    expect(mockStore.workflows[1].status).toBe("pending");
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });

  it("is gated on qms write: a TECHNICIAN gets 403 and nothing changes", async () => {
    as(P.techA);

    const res = await http("post", `/workflows/${WF}/cancel`);

    expect(res.status).toBe(403);
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });

  it("a non-uuid id is 400 before anything is looked up", async () => {
    as(P.adminA);

    expect((await http("post", "/workflows/not-a-uuid/cancel")).status).toBe(400);
  });

  it("a reason over 500 characters is 400", async () => {
    as(P.adminA);

    const res = await http("post", `/workflows/${WF}/cancel`, { body: { reason: "x".repeat(501) } });

    expect(res.status).toBe(400);
  });
});
