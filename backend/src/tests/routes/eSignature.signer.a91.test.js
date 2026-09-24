/**
 * A-91 — a signer can open the workflow they are asked to sign.
 *
 * GET /workflows and GET /workflows/:id are workflow management, gated on
 * `qms`. TECHNICIAN and most other roles hold no `qms` menu, yet a workflow
 * may name any of them, and A-65 made the named signer the only person who can
 * sign their step. So a workflow naming a technician could not be opened —
 * and could never complete.
 *
 * The fix is a signer view gated on `esignature` (read):
 *   GET /my-workflows              — workflows in which a step names the caller
 *   GET /my-workflows/:workflowId  — one of them; 404 when it does not name the
 *                                    caller, is deleted, or is another tenant's
 *
 * Everything between the principal and the models is REAL: the router, the
 * real `dynamicAccess` over the permission matrix the seed builds from
 * ROLE_MENU_ASSIGNMENTS, `validateUuid`, the controller, and the service —
 * including signDocument's real crypto and real credential check. Only `auth`
 * (to set the principal), the model layer (an in-memory store that applies the
 * tenant predicate the way the global hooks do, deny-by-default), the password
 * comparison and the transaction are doubled.
 */

const { createTwoTenants } = require("../fixtures/twoTenants");
const { generateTestKeyPair } = require("../utils/esignatureKey.utils");

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
  getUserOverrideMatrix: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn().mockResolvedValue(true),
}));
jest.mock("../../services/emailQueue.service", () => ({
  emailQueueService: { queueEmail: jest.fn().mockResolvedValue(true) },
}));
const PASSWORD = "correct horse battery staple";
jest.mock("../../services/auth.service", () => ({
  // The boundary double: a password is right only if it IS the password.
  passIsValid: jest.fn(async (userId, password) => ({
    data: { valid: password === "correct horse battery staple" },
  })),
}));
jest.mock("../../services/mfa.service", () => ({ verifyLogin: jest.fn(() => false) }));
jest.mock("../../config", () => ({
  db: { transaction: async (cb) => cb("TX") },
}));

// ---- the in-memory model layer ------------------------------------------

const mockStore = { workflows: [], steps: [], records: [], users: {}, key: null };

// What the global tenant hooks do: every read is confined to the caller's
// tenant, and a principal with no tenant sees nothing.
const mockInTenant = (row) => !!currentUser && row.tenantId === currentUser.tenantId;

const mockMatches = (row, where = {}) =>
  Object.entries(where).every(([key, value]) =>
    Array.isArray(value) ? value.includes(row[key]) : row[key] === value,
  );

const mockPick = (row, attributes) => {
  if (!attributes) {
    return row;
  }
  const out = {};
  for (const key of attributes) {
    out[key] = row[key];
  }
  return out;
};

// A workflow as the service's findAll/findOne with the steps include returns
// it. The include is honoured the way Sequelize would: its `attributes`, its
// `where`, and — load-bearing — `required`. An include with a `where` and no
// `required: false` is an INNER JOIN, which would drop a workflow with no
// matching step (CLAUDE.md, the first trap); the double refuses it outright.
const mockHydrate = (wf, options) => {
  const out = mockPick(wf, options.attributes);
  for (const inc of options.include || []) {
    if (inc.required !== false) {
      throw new Error("the steps include must be required: false");
    }
    out.steps = mockStore.steps
      .filter((s) => s.workflowId === wf.id && mockInTenant(s) && mockMatches(s, inc.where))
      .sort((a, b) => a.stepNumber - b.stepNumber)
      .map((s) => mockPick(s, inc.attributes));
  }
  return out;
};

jest.mock("../../models", () => ({
  User: {
    findByPk: jest.fn(async (id) => mockStore.users[id] || null),
    findOne: jest.fn().mockResolvedValue(null),
  },
  Tenants: { findByPk: jest.fn() },
  SignatureWorkflow: {
    findAll: jest.fn(async (options) =>
      mockStore.workflows
        .filter((w) => mockInTenant(w) && mockMatches(w, options.where))
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((w) => mockHydrate(w, options)),
    ),
    findOne: jest.fn(async (options) => {
      const wf = mockStore.workflows.find((w) => mockInTenant(w) && mockMatches(w, options.where));
      return wf ? mockHydrate(wf, options) : null;
    }),
    findByPk: jest.fn(async (id) => {
      const wf = mockStore.workflows.find((w) => w.id === id && mockInTenant(w));
      return wf || null;
    }),
  },
  SignatureWorkflowStep: {
    findAll: jest.fn(async (options) =>
      mockStore.steps
        .filter((s) => mockInTenant(s) && mockMatches(s, options.where))
        .map((s) => (options.attributes ? mockPick(s, options.attributes) : s)),
    ),
    findByPk: jest.fn(async (id) => mockStore.steps.find((s) => s.id === id && mockInTenant(s)) || null),
  },
  SignatureRecord: {
    create: jest.fn(async (attrs) => {
      const row = { ...attrs, id: "99999999-9999-4999-8999-999999999999" };
      mockStore.records.push(row);
      return row;
    }),
  },
  TenantKey: {
    unscoped: () => ({ findOne: jest.fn(async () => mockStore.key) }),
  },
}));

// ---- the harness ---------------------------------------------------------

const RolesService = require("../../services/roles.service");
const { ROLE_NAMES, ROLE_MENU_ASSIGNMENTS, MENU_SLUGS } = require("../../constants");
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
      headers: {},
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

// The seed's matrix is keyed by role; the fixture's principals carry a role id,
// so map it back to the role name.
const roleNameById = new Map();
const as = (principal) => {
  roleNameById.set(principal.role.id, principal.role.name);
  currentUser = principal;
};

const WF_A = "a1a1a1a1-0000-4000-8000-000000000001"; // names the technician
const WF_A_OTHER = "a1a1a1a1-0000-4000-8000-000000000002"; // does not
const WF_B = "b2b2b2b2-0000-4000-8000-000000000001"; // tenant B
const STEP_TECH = "5a5a5a5a-0000-4000-8000-000000000001";
const STEP_SUP = "5a5a5a5a-0000-4000-8000-000000000002";
const STEP_OTHER = "5a5a5a5a-0000-4000-8000-000000000003";
const STEP_B = "5b5b5b5b-0000-4000-8000-000000000001";

let fx;
let technicianA;
let supervisorA;
let userA;
let technicianB;
let keyPair;

beforeAll(() => {
  keyPair = generateTestKeyPair({ keyId: "key-a91" });
});

beforeEach(() => {
  jest.clearAllMocks();
  RolesService.getRolePermissionsMatrix.mockImplementation(async (roleId) =>
    matrixFor(roleNameById.get(roleId)),
  );

  fx = createTwoTenants();
  technicianA = fx.principal(fx.tenantA, "TECHNICIAN");
  supervisorA = fx.principal(fx.tenantA, "SUPERVISOR");
  userA = fx.principal(fx.tenantA, "USER");
  technicianB = fx.principal(fx.tenantB, "TECHNICIAN");

  const step = (fields) => ({
    signerName: null,
    signedAt: null,
    // Part 11 capture a signer view must never carry.
    ipAddress: "198.51.100.7",
    userAgent: "someone-elses-browser",
    update: jest.fn(async function update(values) {
      Object.assign(this, values);
      return this;
    }),
    ...fields,
  });
  const workflow = (fields) => ({
    message: null,
    expiresAt: null,
    signatureAlgorithm: "RS256",
    update: jest.fn(async function update(values) {
      Object.assign(this, values);
      return this;
    }),
    ...fields,
  });

  mockStore.records = [];
  mockStore.key = { keyId: keyPair.keyId, privateKey: keyPair.privateKey };
  mockStore.users = {
    [technicianA.id]: { id: technicianA.id, status: "ACTIVE", isActive: true },
    [supervisorA.id]: { id: supervisorA.id, status: "ACTIVE", isActive: true },
    [userA.id]: { id: userA.id, status: "ACTIVE", isActive: true },
  };
  mockStore.workflows = [
    workflow({
      id: WF_A,
      tenantId: fx.tenantA.id,
      documentId: "cert-1",
      subject: "Approve certificate CAL-1",
      status: "in_progress",
      createdAt: new Date("2026-09-24T08:00:00Z"),
      updatedAt: new Date("2026-09-24T08:00:00Z"),
    }),
    workflow({
      id: WF_A_OTHER,
      tenantId: fx.tenantA.id,
      documentId: "cert-2",
      subject: "Approve certificate CAL-2",
      status: "pending",
      createdAt: new Date("2026-09-24T09:00:00Z"),
      updatedAt: new Date("2026-09-24T09:00:00Z"),
    }),
    workflow({
      id: WF_B,
      tenantId: fx.tenantB.id,
      documentId: "cert-b",
      subject: "Tenant B certificate",
      status: "pending",
      createdAt: new Date("2026-09-24T10:00:00Z"),
      updatedAt: new Date("2026-09-24T10:00:00Z"),
    }),
  ];
  mockStore.steps = [
    step({
      id: STEP_TECH,
      tenantId: fx.tenantA.id,
      workflowId: WF_A,
      stepNumber: 1,
      signerId: technicianA.id,
      signerEmail: "tech@hospital-a.test",
      status: "pending",
    }),
    step({
      id: STEP_SUP,
      tenantId: fx.tenantA.id,
      workflowId: WF_A,
      stepNumber: 2,
      signerId: supervisorA.id,
      signerEmail: "sup@hospital-a.test",
      status: "waiting",
    }),
    step({
      id: STEP_OTHER,
      tenantId: fx.tenantA.id,
      workflowId: WF_A_OTHER,
      stepNumber: 1,
      signerId: supervisorA.id,
      signerEmail: "sup@hospital-a.test",
      status: "pending",
    }),
    // Tenant B's workflow names tenant A's technician id: only the tenant
    // predicate stands between that technician and this row.
    step({
      id: STEP_B,
      tenantId: fx.tenantB.id,
      workflowId: WF_B,
      stepNumber: 1,
      signerId: technicianA.id,
      signerEmail: "tech-b@hospital-b.test",
      status: "pending",
    }),
  ];
});

describe("A-91 — the signer view of e-signature workflows", () => {
  it("a technician named as signer can open and sign their step", async () => {
    as(technicianA);

    // The management routes stay closed to a technician (no `qms` menu)...
    expect(matrixFor(ROLE_NAMES.TECHNICIAN)[MENU_SLUGS.QMS]).toBeUndefined();
    expect((await http("get", "/workflows")).status).toBe(403);
    expect((await http("get", `/workflows/${WF_A}`)).status).toBe(403);

    // ...and the signer view lists the one workflow that names them.
    const list = await http("get", "/my-workflows");
    expect(list.status).toBe(200);
    expect(list.body.data.map((w) => w.id)).toEqual([WF_A]);
    expect(list.body.meta).toEqual({ total: 1 });

    const opened = await http("get", `/my-workflows/${WF_A}`);
    expect(opened.status).toBe(200);
    expect(opened.body.data.id).toBe(WF_A);
    expect(opened.body.data.steps.map((s) => [s.id, s.signerId, s.status])).toEqual([
      [STEP_TECH, technicianA.id, "pending"],
      [STEP_SUP, supervisorA.id, "waiting"],
    ]);

    // Then signs their step, re-authenticating, through the real service.
    const signed = await http("post", "/sign", {
      body: { stepId: STEP_TECH, authPayload: PASSWORD, reason: "Reviewed and approved" },
    });
    expect(signed.status).toBe(200);
    expect(signed.body.data.certificate).toEqual(
      expect.objectContaining({ workflowId: WF_A, signerId: technicianA.id }),
    );
    expect(mockStore.records).toHaveLength(1);
    expect(mockStore.records[0]).toEqual(
      expect.objectContaining({
        tenantId: fx.tenantA.id,
        workflowStepId: STEP_TECH,
        userId: technicianA.id,
        ipAddress: "203.0.113.9",
      }),
    );

    // The next signer's step is now theirs to sign.
    const after = await http("get", `/my-workflows/${WF_A}`);
    expect(after.body.data.steps.map((s) => s.status)).toEqual(["signed", "pending"]);
  });

  it("a user not named as signer cannot read the workflow", async () => {
    as(userA);

    const res = await http("get", `/my-workflows/${WF_A}`);

    // 404, not 403: "exists but not yours to sign" must be indistinguishable
    // from "does not exist", or any user could probe workflow ids.
    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Workflow not found");
    expect(res.body.data == null).toBe(true);

    const list = await http("get", "/my-workflows");
    expect(list.body.data).toEqual([]);
    expect(list.body.meta).toEqual({ total: 0 });
  });

  it("a signer named in tenant A who requests tenant B's workflow id gets 404, even though B's step carries their id", async () => {
    as(technicianA);

    const res = await http("get", `/my-workflows/${WF_B}`);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Workflow not found");
  });

  it("not-yours, another tenant's and non-existent are byte-identical", async () => {
    as(userA);
    const notNamed = await http("get", `/my-workflows/${WF_A}`);
    const foreign = await http("get", `/my-workflows/${WF_B}`);
    const missing = await http("get", "/my-workflows/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");

    expect(foreign).toEqual(notNamed);
    expect(missing).toEqual(notNamed);
  });

  it("tenant B's own signer sees B's workflow, and none of A's", async () => {
    mockStore.steps.find((s) => s.id === STEP_B).signerId = technicianB.id;
    as(technicianB);

    const list = await http("get", "/my-workflows");

    expect(list.body.data.map((w) => w.id)).toEqual([WF_B]);
    expect((await http("get", `/my-workflows/${WF_A}`)).status).toBe(404);
  });

  it("carries no signer's recorded IP address or user agent", async () => {
    as(technicianA);

    const opened = await http("get", `/my-workflows/${WF_A}`);

    for (const step of opened.body.data.steps) {
      expect(step).not.toHaveProperty("ipAddress");
      expect(step).not.toHaveProperty("userAgent");
    }
    expect(opened.body.data).not.toHaveProperty("tenantId");
  });

  it("?stepStatus=pending lists only workflows awaiting the caller's own signature", async () => {
    as(supervisorA);

    const all = await http("get", "/my-workflows");
    const pending = await http("get", "/my-workflows", { query: { stepStatus: "pending" } });

    // Newest first.
    expect(all.body.data.map((w) => w.id)).toEqual([WF_A_OTHER, WF_A]);
    // WF_A's supervisor step is still `waiting` for the technician.
    expect(pending.body.data.map((w) => w.id)).toEqual([WF_A_OTHER]);
    expect(pending.body.meta).toEqual({ total: 1 });
  });

  it("an unknown stepStatus is a 400, not an empty list", async () => {
    as(supervisorA);

    const res = await http("get", "/my-workflows", { query: { stepStatus: "approved" } });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/stepStatus must be one of/);
  });

  it("a malformed workflow id is a 400 from validateUuid", async () => {
    as(technicianA);

    expect((await http("get", "/my-workflows/not-a-uuid")).status).toBe(400);
  });

  it("the signer view is gated: without `esignature` read it is 403 and never reaches the service", async () => {
    RolesService.getRolePermissionsMatrix.mockImplementation(async (roleId) => {
      const matrix = matrixFor(roleNameById.get(roleId));
      delete matrix[MENU_SLUGS.ESIGNATURE];
      return matrix;
    });
    as(technicianA);
    const models = require("../../models");

    expect((await http("get", "/my-workflows")).status).toBe(403);
    expect((await http("get", `/my-workflows/${WF_A}`)).status).toBe(403);
    expect(models.SignatureWorkflowStep.findAll).not.toHaveBeenCalled();
    expect(models.SignatureWorkflow.findOne).not.toHaveBeenCalled();
  });

  it("management GET /workflows/:id answers 404 for another tenant's workflow (it used to be 200 with data: null)", async () => {
    const admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
    as(admin);

    const foreign = await http("get", `/workflows/${WF_B}`);
    const own = await http("get", `/workflows/${WF_A}`);

    expect(foreign.status).toBe(404);
    expect(foreign.body.message).toBe("Workflow not found");
    expect(own.status).toBe(200);
    expect(own.body.data.id).toBe(WF_A);
  });
});
