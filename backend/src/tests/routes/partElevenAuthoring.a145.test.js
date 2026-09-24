/**
 * A-145 — the writes Q-17 left unreviewed: SOP publish, SOP training
 * acknowledgement, workflow instance action, predictive-maintenance approve.
 *
 * The decisions (which carry denyPlatformAuthoring and which do not, with the
 * reasons) are enumerated in denyPlatformAuthoring.a127.test.js. This file
 * proves the behaviour behind them, through the REAL routers, middleware
 * (validateUuid, denyApiKey, denyPlatformAuthoring, validate), controllers and
 * services:
 *
 *  - every one of these routes writes its audit row INSIDE the mutation's
 *    transaction — an audit failure rolls the act back;
 *  - a closed or repeated act is a 409 that names the state (a training
 *    acknowledgement is never rewritten);
 *  - two tenants: another tenant's id answers 404, indistinguishable from an
 *    id that does not exist, and writes nothing — including for a super admin
 *    in their home tenant, whom ADR-052 rebinds as a member;
 *  - an impersonated acknowledgement or approval writes nothing.
 *
 * Stubbed: `auth` (sets the principal, effective tenant and impersonator as
 * auth.middleware does), `dynamicAccess` (the permission gate is not under
 * test), and the model layer. Writes go through the auditLedger fixture with
 * CLS OFF: a write that does not pass `{ transaction }` explicitly autocommits
 * and survives a rollback, and these tests would see it. The model doubles
 * match `where` exactly and do not scope by themselves, so a service that
 * forgot its tenant predicate would find the foreign row.
 */

const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null, store: null, user: null, tenantId: null, impersonatorId: null };

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual("../../middlewares/auth.middleware");
  return {
    ...actual,
    auth: (req, res, next) => {
      req.user = mockRef.user;
      req.tenantId = mockRef.tenantId;
      req.impersonatorId = mockRef.impersonatorId;
      next();
    },
  };
});
jest.mock("../../middlewares/dynamicAccess.middleware", () => ({
  dynamicAccess: () => (req, res, next) => next(),
  // A-183 — the per-record-type check submitAction makes (not under test here;
  // workflows.decision.a182a183.test.js covers it).
  principalHasMenuPermission: async () => true,
}));

/** A row as a Sequelize instance would present it: save/update write to the ledger. */
const mockInstance = (table, row) => {
  const inst = { ...row };
  Object.defineProperty(inst, "save", {
    enumerable: false,
    value: async (options) => mockRef.ledger.write(table, mockPlain(inst), options),
  });
  Object.defineProperty(inst, "update", {
    enumerable: false,
    value: async (values, options) => {
      Object.assign(inst, values);
      return mockRef.ledger.write(table, mockPlain(inst), options);
    },
  });
  Object.defineProperty(inst, "toJSON", { enumerable: false, value: () => mockPlain(inst) });
  return inst;
};
const mockPlain = (inst) => {
  const out = {};
  for (const [k, v] of Object.entries(inst)) {
    if (typeof v !== "function" && k !== "workflow" && k !== "actions") {out[k] = v;}
  }
  return out;
};
/** findOne over a store table: every key of `where` must match exactly. */
const mockFindOne = (table) =>
  jest.fn(async ({ where }) => {
    const row = mockRef.store[table].find((r) =>
      Object.entries(where).every(([k, v]) => r[k] === v),
    );
    return row ? mockInstance(table, row) : null;
  });

jest.mock("../../models", () => ({
  SopDocument: { findOne: mockFindOne("sop_documents") },
  SopTrainingAcknowledgment: {
    findOne: mockFindOne("sop_training_acknowledgments"),
    bulkCreate: jest.fn(async (rows, options) =>
      rows.map((r) => mockRef.ledger.write("sop_training_acknowledgments", r, options)),
    ),
  },
  User: {
    findAll: jest.fn(async ({ where }) =>
      mockRef.store.users.filter((u) => u.tenantId === where.tenantId),
    ),
  },
  WorkflowInstance: {
    findOne: jest.fn(async ({ where }) => {
      const row = mockRef.store.workflow_instances.find(
        (r) => r.id === where.id && r.tenantId === where.tenantId,
      );
      if (!row) {return null;}
      const inst = mockInstance("workflow_instances", row);
      inst.workflow = row.workflow;
      inst.actions = row.actions;
      return inst;
    }),
  },
  WorkflowAction: {
    create: jest.fn(async (values, options) =>
      mockRef.ledger.write("workflow_actions", values, options),
    ),
  },
  Workflow: {},
  WorkflowStep: {},
  Role: {},
  Certificate: { findOne: jest.fn(async () => null) },
  StockTransfer: { findOne: jest.fn(async () => null) },
  MaintenanceWorkOrder: { findOne: jest.fn(async () => null) },
  CalibrationDevice: { findOne: mockFindOne("devices") },
  IotReading: {},
  Notification: {},
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
  sequelize: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));

const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const { logger } = require("../../middlewares/activityLog.middleware");
const { MESSAGES } = require("../../middlewares/denyPlatformAuthoring.middleware");

const ROUTERS = {
  sop: require("../../routes/api/sop.route"),
  workflows: require("../../routes/api/workflows.route"),
  "predictive-maintenance": require("../../routes/api/predictiveMaintenance.route"),
};

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AUTHOR_A = "a0000001-0000-4000-8000-000000000001";
const ADMIN_A = "a0000001-0000-4000-8000-000000000002";
const TECH_A = "a0000001-0000-4000-8000-000000000003";
const ADMIN_B = "b0000001-0000-4000-8000-000000000002";
const TECH_B = "b0000001-0000-4000-8000-000000000003";
const OPERATOR = "99999999-9999-4999-8999-999999999999";
const APPROVER_ROLE = "d0000001-0000-4000-8000-000000000001";
const SOP_A = "a0000002-0000-4000-8000-000000000001";
const SOP_B = "b0000002-0000-4000-8000-000000000001";
const ACK_A = "a0000003-0000-4000-8000-000000000001";
const ACK_B = "b0000003-0000-4000-8000-000000000001";
const INSTANCE_A = "a0000004-0000-4000-8000-000000000001";
const INSTANCE_B = "b0000004-0000-4000-8000-000000000001";
const DEVICE_A = "a0000005-0000-4000-8000-000000000001";
const DEVICE_B = "b0000005-0000-4000-8000-000000000001";
const MISSING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const member = (id, tenantId, roleName = "TECHNICIAN", roleId = APPROVER_ROLE) => ({
  id,
  tenantId,
  roleId,
  role: { id: roleId, name: roleName },
  isApiKey: false,
});

const as = (user, { tenantId = user.tenantId, impersonatorId = null } = {}) => {
  mockRef.user = user;
  mockRef.tenantId = tenantId;
  mockRef.impersonatorId = impersonatorId;
};

/** Drive `mount`'s real router inside the tenant context auth would open. */
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
    const roleName = mockRef.user && mockRef.user.role && mockRef.user.role.name;
    tenantStorage.run(
      {
        tenantId: mockRef.tenantId,
        isSuperAdmin: roleName === "SUPERADMIN",
        isSystemTask: false,
      },
      () =>
        ROUTERS[mount].handle(req, res, (err) =>
          resolve({
            status: err ? err.status || err.statusCode || 500 : 404,
            body: { message: err ? err.message : "no route" },
          }),
        ),
    );
  });

const committedTables = () => [...new Set(mockRef.ledger.rows.map((e) => e.table))];

const twoStepWorkflow = (tenantId) => ({
  resourceType: "StockTransfer",
  steps: [
    { id: `${tenantId}-s1`, stepOrder: 1, roleId: APPROVER_ROLE, requiredApprovals: 1 },
    { id: `${tenantId}-s2`, stepOrder: 2, roleId: APPROVER_ROLE, requiredApprovals: 1 },
  ],
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(logger, "error").mockImplementation(() => logger);
  jest.spyOn(logger, "info").mockImplementation(() => logger);
  mockRef.ledger = createLedger({ cls: false });
  mockRef.store = {
    users: [
      { id: AUTHOR_A, tenantId: TENANT_A },
      { id: ADMIN_A, tenantId: TENANT_A },
      { id: TECH_A, tenantId: TENANT_A },
      { id: ADMIN_B, tenantId: TENANT_B },
      { id: TECH_B, tenantId: TENANT_B },
    ],
    sop_documents: [
      { id: SOP_A, tenantId: TENANT_A, authorId: AUTHOR_A, documentNumber: "SOP-0001", version: "1.0", status: "DRAFT", requiresTraining: true },
      { id: SOP_B, tenantId: TENANT_B, authorId: TECH_B, documentNumber: "SOP-0001", version: "1.0", status: "DRAFT", requiresTraining: true },
    ],
    sop_training_acknowledgments: [
      { id: ACK_A, tenantId: TENANT_A, userId: TECH_A, documentId: SOP_A, status: "PENDING", acknowledgedAt: null },
      { id: ACK_B, tenantId: TENANT_B, userId: TECH_B, documentId: SOP_B, status: "PENDING", acknowledgedAt: null },
    ],
    workflow_instances: [
      { id: INSTANCE_A, tenantId: TENANT_A, status: "PENDING", currentStepOrder: 1, resourceId: "st-a", workflow: twoStepWorkflow(TENANT_A), actions: [] },
      { id: INSTANCE_B, tenantId: TENANT_B, status: "PENDING", currentStepOrder: 1, resourceId: "st-b", workflow: twoStepWorkflow(TENANT_B), actions: [] },
    ],
    devices: [
      { id: DEVICE_A, tenantId: TENANT_A, calibrationIntervalDays: 365, recommendedCalibrationInterval: 180, recommendationReason: "drift" },
      { id: DEVICE_B, tenantId: TENANT_B, calibrationIntervalDays: 365, recommendedCalibrationInterval: 180, recommendationReason: "drift" },
    ],
  };
});

// ---------------------------------------------------------------------------
// SOP publish
// ---------------------------------------------------------------------------

describe("A-145 — PATCH /sop/:id/publish", () => {
  it("another tenant's SOP answers 404, the same as one that does not exist, and nothing is written", async () => {
    as(member(ADMIN_B, TENANT_B, "HEALTHCARE ADMIN"));
    const foreign = await http("sop", "PATCH", `/${SOP_A}/publish`);
    const missing = await http("sop", "PATCH", `/${MISSING}/publish`);

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("publishing commits the release, the training fan-out and one APPROVE audit row together", async () => {
    as(member(ADMIN_A, TENANT_A, "HEALTHCARE ADMIN"));
    const res = await http("sop", "PATCH", `/${SOP_A}/publish`);

    expect(res.status).toBe(200);
    expect(mockRef.ledger.committed("sop_documents")).toEqual([
      expect.objectContaining({ id: SOP_A, status: "PUBLISHED" }),
    ]);
    expect(mockRef.ledger.committed("sop_training_acknowledgments")).toHaveLength(3);
    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({ tenantId: TENANT_A, userId: ADMIN_A, action: "APPROVE", resourceType: "SopDocument", resourceId: SOP_A }),
    ]);
  });

  it("when the audit row cannot be written, the release rolls back", async () => {
    as(member(ADMIN_A, TENANT_A, "HEALTHCARE ADMIN"));
    mockRef.ledger.failNext("audit_logs");
    const res = await http("sop", "PATCH", `/${SOP_A}/publish`);

    expect(res.status).toBe(500);
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("while impersonating, nothing is published", async () => {
    as(member(ADMIN_A, TENANT_A, "HEALTHCARE ADMIN"), { impersonatorId: OPERATOR });
    const res = await http("sop", "PATCH", `/${SOP_A}/publish`);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(MESSAGES.IMPERSONATING);
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("a malformed id is a 400, not a database error", async () => {
    as(member(ADMIN_A, TENANT_A, "HEALTHCARE ADMIN"));
    const res = await http("sop", "PATCH", "/not-a-uuid/publish");

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// SOP training acknowledgement
// ---------------------------------------------------------------------------

describe("A-145 — POST /sop/:id/acknowledge", () => {
  it("another tenant's SOP answers 404, the same as one that does not exist, and nothing is written", async () => {
    as(member(TECH_B, TENANT_B));
    const foreign = await http("sop", "POST", `/${SOP_A}/acknowledge`);
    const missing = await http("sop", "POST", `/${MISSING}/acknowledge`);

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("the acknowledgement and its audit row commit together, attributed to the caller", async () => {
    as(member(TECH_A, TENANT_A));
    const res = await http("sop", "POST", `/${SOP_A}/acknowledge`);

    expect(res.status).toBe(200);
    expect(mockRef.ledger.committed("sop_training_acknowledgments")).toEqual([
      expect.objectContaining({ id: ACK_A, status: "COMPLETED", acknowledgedAt: expect.any(Date) }),
    ]);
    const [row] = mockRef.ledger.auditRows();
    expect(mockRef.ledger.auditRows()).toHaveLength(1);
    expect(row).toMatchObject({
      tenantId: TENANT_A,
      userId: TECH_A,
      actorType: "user",
      action: "UPDATE",
      resourceType: "SopTrainingAcknowledgment",
      resourceId: ACK_A,
      changes: {
        operation: "ACKNOWLEDGE_TRAINING",
        documentId: SOP_A,
        before: { status: "PENDING" },
        after: { status: "COMPLETED" },
      },
    });
  });

  it("when the audit row cannot be written, the acknowledgement rolls back", async () => {
    as(member(TECH_A, TENANT_A));
    mockRef.ledger.failNext("audit_logs");
    const res = await http("sop", "POST", `/${SOP_A}/acknowledge`);

    expect(res.status).toBe(500);
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("a second acknowledgement is a 409 naming the recorded date, and the record is not rewritten", async () => {
    const recorded = new Date("2026-09-01T08:00:00.000Z");
    Object.assign(mockRef.store.sop_training_acknowledgments[0], { status: "COMPLETED", acknowledgedAt: recorded });
    as(member(TECH_A, TENANT_A));
    const res = await http("sop", "POST", `/${SOP_A}/acknowledge`);

    expect(res.status).toBe(409);
    expect(res.body.message).toContain("2026-09-01T08:00:00.000Z");
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("a completed acknowledgement with no recorded date still refuses, without inventing one", async () => {
    Object.assign(mockRef.store.sop_training_acknowledgments[0], { status: "COMPLETED", acknowledgedAt: null });
    as(member(TECH_A, TENANT_A));
    const res = await http("sop", "POST", `/${SOP_A}/acknowledge`);

    expect(res.status).toBe(409);
    expect(res.body.message).toContain("an earlier date");
  });

  it("while impersonating, no one's training is acknowledged", async () => {
    as(member(TECH_A, TENANT_A), { impersonatorId: OPERATOR });
    const res = await http("sop", "POST", `/${SOP_A}/acknowledge`);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(MESSAGES.IMPERSONATING);
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("a super admin overriding into another tenant is refused", async () => {
    as(member(OPERATOR, TENANT_A, "SUPERADMIN"), { tenantId: TENANT_B });
    const res = await http("sop", "POST", `/${SOP_B}/acknowledge`);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(MESSAGES.OTHER_TENANT);
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("an API key cannot attest a person's training", async () => {
    as({ ...member(TECH_A, TENANT_A), isApiKey: true });
    const res = await http("sop", "POST", `/${SOP_A}/acknowledge`);

    expect(res.status).toBe(403);
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("a malformed id is a 400, not a database error", async () => {
    as(member(TECH_A, TENANT_A));
    const res = await http("sop", "POST", "/not-a-uuid/acknowledge");

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Workflow instance action
// ---------------------------------------------------------------------------

describe("A-145 — POST /workflows/instances/:instanceId/action", () => {
  it("another tenant's instance answers 404, the same as one that does not exist, and nothing is written", async () => {
    as(member(ADMIN_B, TENANT_B));
    const foreign = await http("workflows", "POST", `/instances/${INSTANCE_A}/action`, { action: "APPROVED" });
    const missing = await http("workflows", "POST", `/instances/${MISSING}/action`, { action: "APPROVED" });

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("a super admin in their home tenant is a member there (ADR-052): another tenant's instance is 404", async () => {
    // Home tenant A, no override. Unrebound, the super-admin context would
    // skip the tenant hooks; the service's own predicate is on req.tenantId.
    as(member(OPERATOR, TENANT_A, "SUPERADMIN"));
    const res = await http("workflows", "POST", `/instances/${INSTANCE_B}/action`, { action: "APPROVED" });

    expect(res.status).toBe(404);
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("an approval commits the action and one APPROVE audit row naming the approver", async () => {
    as(member(ADMIN_A, TENANT_A));
    const res = await http("workflows", "POST", `/instances/${INSTANCE_A}/action`, { action: "APPROVED", comments: "ok" });

    expect(res.status).toBe(200);
    expect(mockRef.ledger.committed("workflow_actions")).toEqual([
      expect.objectContaining({ instanceId: INSTANCE_A, userId: ADMIN_A, action: "APPROVED" }),
    ]);
    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({
        tenantId: TENANT_A,
        userId: ADMIN_A,
        action: "APPROVE",
        resourceType: "WorkflowInstance",
        resourceId: INSTANCE_A,
        changes: expect.objectContaining({
          operation: "WORKFLOW_APPROVE",
          decision: "APPROVED",
          comments: "ok",
          before: { status: "PENDING", currentStepOrder: 1 },
          after: { status: "PENDING", currentStepOrder: 2 },
        }),
      }),
    ]);
  });

  it("a rejection is audited as an UPDATE naming the rejection", async () => {
    as(member(ADMIN_A, TENANT_A));
    const res = await http("workflows", "POST", `/instances/${INSTANCE_A}/action`, { action: "REJECTED" });

    expect(res.status).toBe(200);
    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({
        action: "UPDATE",
        changes: expect.objectContaining({
          operation: "WORKFLOW_REJECT",
          comments: null,
          after: { status: "REJECTED", currentStepOrder: 1 },
        }),
      }),
    ]);
  });

  it("when the audit row cannot be written, the action rolls back", async () => {
    as(member(ADMIN_A, TENANT_A));
    mockRef.ledger.failNext("audit_logs");
    const res = await http("workflows", "POST", `/instances/${INSTANCE_A}/action`, { action: "APPROVED" });

    expect(res.status).toBe(500);
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("a closed instance is a 409 that names its state", async () => {
    mockRef.store.workflow_instances[0].status = "APPROVED";
    as(member(ADMIN_A, TENANT_A));
    const res = await http("workflows", "POST", `/instances/${INSTANCE_A}/action`, { action: "APPROVED" });

    expect(res.status).toBe(409);
    expect(res.body.message).toContain("already APPROVED");
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("acting twice on one step is a 409", async () => {
    mockRef.store.workflow_instances[0].actions = [
      { stepId: `${TENANT_A}-s1`, userId: ADMIN_A, action: "APPROVED" },
    ];
    as(member(ADMIN_A, TENANT_A));
    const res = await http("workflows", "POST", `/instances/${INSTANCE_A}/action`, { action: "APPROVED" });

    expect(res.status).toBe(409);
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("while impersonating, nothing is approved", async () => {
    as(member(ADMIN_A, TENANT_A), { impersonatorId: OPERATOR });
    const res = await http("workflows", "POST", `/instances/${INSTANCE_A}/action`, { action: "APPROVED" });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(MESSAGES.IMPERSONATING);
    expect(mockRef.ledger.rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Predictive maintenance approve (reviewed: NOT a Part 11 authoring route)
// ---------------------------------------------------------------------------

describe("A-145 — POST /predictive-maintenance/recommendations/:deviceId/approve", () => {
  it("another tenant's device answers 404, the same as one that does not exist, and nothing is written", async () => {
    as(member(ADMIN_B, TENANT_B));
    const foreign = await http("predictive-maintenance", "POST", `/recommendations/${DEVICE_A}/approve`);
    const missing = await http("predictive-maintenance", "POST", `/recommendations/${MISSING}/approve`);

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("applying commits the interval change and one APPROVE audit row with before and after", async () => {
    as(member(ADMIN_A, TENANT_A));
    const res = await http("predictive-maintenance", "POST", `/recommendations/${DEVICE_A}/approve`);

    expect(res.status).toBe(200);
    expect(mockRef.ledger.committed("devices")).toEqual([
      expect.objectContaining({ id: DEVICE_A, calibrationIntervalDays: 180, recommendedCalibrationInterval: null }),
    ]);
    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({
        tenantId: TENANT_A,
        userId: ADMIN_A,
        action: "APPROVE",
        resourceType: "CalibrationDevice",
        resourceId: DEVICE_A,
        changes: {
          operation: "APPLY_RECOMMENDED_INTERVAL",
          before: { calibrationIntervalDays: 365, recommendedCalibrationInterval: 180, recommendationReason: "drift" },
          after: { calibrationIntervalDays: 180 },
        },
      }),
    ]);
  });

  it("when the audit row cannot be written, the interval is not changed", async () => {
    as(member(ADMIN_A, TENANT_A));
    mockRef.ledger.failNext("audit_logs");
    const res = await http("predictive-maintenance", "POST", `/recommendations/${DEVICE_A}/approve`);

    expect(res.status).toBe(500);
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("no pending recommendation is a 409 state explanation", async () => {
    mockRef.store.devices[0].recommendedCalibrationInterval = null;
    as(member(ADMIN_A, TENANT_A));
    const res = await http("predictive-maintenance", "POST", `/recommendations/${DEVICE_A}/approve`);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/no(?:t have a)? pending recommendation/i);
    expect(committedTables()).toEqual([]);
  });

  it("is deliberately not refused while impersonating (A-145: equipment master data), and the audit row carries the impersonator", async () => {
    // auth.middleware opens this context for an impersonation token (F-8).
    const { runWithImpersonator } = require("../../utils/auditActor.util");
    as(member(ADMIN_A, TENANT_A), { impersonatorId: OPERATOR });
    const res = await runWithImpersonator(OPERATOR, () =>
      http("predictive-maintenance", "POST", `/recommendations/${DEVICE_A}/approve`),
    );

    expect(res.status).toBe(200);
    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({ userId: ADMIN_A, impersonatorId: OPERATOR }),
    ]);
  });
});
