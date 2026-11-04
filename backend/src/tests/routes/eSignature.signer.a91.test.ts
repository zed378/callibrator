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

import type { Request, Response, NextFunction } from "express";
import { createTwoTenants } from "../fixtures/twoTenants";
import { generateTestKeyPair } from "../utils/esignatureKey.utils";

let currentUser: unknown = null;

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual<typeof import("../../middlewares/auth.middleware")>(
    "../../middlewares/auth.middleware",
  );
  return {
    ...actual,
    auth: (req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as { user: unknown }).user = currentUser;
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
  // A-158: the real export (emailQueueService never existed).
  queueNotificationEmail: jest.fn().mockResolvedValue(true),
}));
const PASSWORD = "correct horse battery staple";
jest.mock("../../services/auth.service", () => ({
  // The boundary double: a password is right only if it IS the password.
  passIsValid: jest.fn(async (_userId: string, password: string) => ({
    data: { valid: password === "correct horse battery staple" },
  })),
}));
jest.mock("../../services/mfa.service", () => ({ verifyLogin: jest.fn(() => false) }));
jest.mock("../../config", () => ({
  db: { transaction: async (cb: (tx: string) => Promise<unknown>) => cb("TX") },
}));

// ---- the in-memory model layer ------------------------------------------

interface MockWorkflow {
  id: string;
  tenantId: string;
  documentId: string;
  subject: string;
  status: string;
  message?: string | null;
  expiresAt?: Date | null;
  signatureAlgorithm?: string;
  createdAt: Date;
  updatedAt: Date;
  steps?: MockStep[];
  update?: (values: Record<string, unknown>) => Promise<MockWorkflow>;
  [key: string]: unknown;
}

interface MockStep {
  id: string;
  tenantId: string;
  workflowId: string;
  stepNumber: number;
  signerId: string;
  signerEmail: string;
  status: string;
  signerName?: string | null;
  signedAt?: Date | null;
  ipAddress?: string;
  userAgent?: string;
  update?: (values: Record<string, unknown>) => Promise<MockStep>;
  [key: string]: unknown;
}

interface MockStore {
  workflows: MockWorkflow[];
  steps: MockStep[];
  records: Record<string, unknown>[];
  users: Record<string, { id: string; status: string; isActive: boolean }>;
  key: { keyId: string; privateKey: string } | null;
}

const mockStore: MockStore = { workflows: [], steps: [], records: [], users: {}, key: null };

// What the global tenant hooks do: every read is confined to the caller's
// tenant, and a principal with no tenant sees nothing.
const mockInTenant = (row: { tenantId: string }) => !!currentUser && row.tenantId === (currentUser as { tenantId: string }).tenantId;

const mockMatches = (row: Record<string, unknown>, where: Record<string, unknown> = {}) =>
  Object.entries(where).every(([key, value]) =>
    Array.isArray(value) ? value.includes(row[key]) : row[key] === value,
  );

const mockPick = <T extends Record<string, unknown>>(row: T, attributes?: string[]): T => {
  if (!attributes) {
    return row;
  }
  const out: Record<string, unknown> = {};
  for (const key of attributes) {
    out[key] = row[key];
  }
  return out as T;
};

// A workflow as the service's findAll/findOne with the steps include returns
// it. The include is honoured the way Sequelize would: its `attributes`, its
// `where`, and — load-bearing — `required`. An include with a `where` and no
// `required: false` is an INNER JOIN, which would drop a workflow with no
// matching step (CLAUDE.md, the first trap); the double refuses it outright.
const mockHydrate = (wf: MockWorkflow, options: { attributes?: string[]; include?: { where?: Record<string, unknown>; required?: boolean; attributes?: string[] }[] }): MockWorkflow => {
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
    findByPk: jest.fn(async (id: string) => mockStore.users[id] || null),
    findOne: jest.fn().mockResolvedValue(null),
  },
  Tenants: { findByPk: jest.fn() },
  SignatureWorkflow: {
    findAll: jest.fn(async (options: { where?: Record<string, unknown>; attributes?: string[]; include?: { where?: Record<string, unknown>; required?: boolean; attributes?: string[] }[] }) =>
      mockStore.workflows
        .filter((w) => mockInTenant(w) && mockMatches(w, options.where))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((w) => mockHydrate(w, options)),
    ),
    findOne: jest.fn(async (options: { where?: Record<string, unknown>; attributes?: string[]; include?: { where?: Record<string, unknown>; required?: boolean; attributes?: string[] }[] }) => {
      const wf = mockStore.workflows.find((w) => mockInTenant(w) && mockMatches(w, options.where));
      return wf ? mockHydrate(wf, options) : null;
    }),
    findByPk: jest.fn(async (id: string) => {
      const wf = mockStore.workflows.find((w) => w.id === id && mockInTenant(w));
      return wf || null;
    }),
  },
  SignatureWorkflowStep: {
    findAll: jest.fn(async (options: { where?: Record<string, unknown>; attributes?: string[] }) =>
      mockStore.steps
        .filter((s) => mockInTenant(s) && mockMatches(s, options.where))
        .map((s) => (options.attributes ? mockPick(s, options.attributes) : s)),
    ),
    findByPk: jest.fn(async (id: string) => mockStore.steps.find((s) => s.id === id && mockInTenant(s)) || null),
  },
  SignatureRecord: {
    create: jest.fn(async (attrs: Record<string, unknown>) => {
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

const RolesService = require("../../services/roles.service") as typeof import("../../services/roles.service");
const { ROLE_NAMES, ROLE_MENU_ASSIGNMENTS, MENU_SLUGS } = require("../../constants") as typeof import("../../constants");
const router = require("../../routes/api/eSignature.route") as { handle: (req: unknown, res: unknown, next: (err?: unknown) => void) => void };

interface HttpResponse {
  status: number;
  body: {
    message?: string;
    data?: any;
    meta?: any;
    [key: string]: unknown;
  };
}

const http = (method: string, url: string, { body = {}, query = {} }: { body?: Record<string, unknown>; query?: Record<string, unknown> } = {}): Promise<HttpResponse> =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: HttpResponse["body"]) {
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
      get: (h: string) => (h.toLowerCase() === "user-agent" ? "jest-agent" : undefined),
    };
    (router as unknown as { handle: (req: unknown, res: unknown, next: (err?: { status?: number; message?: string }) => void) => void }).handle(req, res, (err?: { status?: number; message?: string }) =>
      resolve({
        status: err ? err.status || 500 : 404,
        body: { message: err?.message ?? "no route" },
      }),
    );
  });

const matrixFor = (roleName?: string) => {
  const entry = ROLE_MENU_ASSIGNMENTS.find((a) => a.roleName === roleName);
  const matrix: Record<string, string[]> = {};
  for (const [slug, permission] of Object.entries(entry ? entry.menus : {})) {
    matrix[slug] = [permission as string];
  }
  return matrix;
};

// The seed's matrix is keyed by role; the fixture's principals carry a role id,
// so map it back to the role name.
const roleNameById = new Map<string, string>();
const as = (principal: ReturnType<typeof fx.principal>) => {
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

let fx: ReturnType<typeof createTwoTenants>;
let technicianA: ReturnType<typeof fx.principal>;
let supervisorA: ReturnType<typeof fx.principal>;
let bystanderA: ReturnType<typeof fx.principal>;
let technicianB: ReturnType<typeof fx.principal>;
let keyPair: { keyId: string; privateKey: string };

beforeAll(() => {
  keyPair = generateTestKeyPair({ keyId: "key-a91" });
});

beforeEach(() => {
  jest.clearAllMocks();
  (RolesService.getRolePermissionsMatrix as jest.Mock).mockImplementation(async (roleId: string) =>
    matrixFor(roleNameById.get(roleId)),
  );

  fx = createTwoTenants();
  technicianA = fx.principal(fx.tenantA, "TECHNICIAN");
  supervisorA = fx.principal(fx.tenantA, "SUPERVISOR");
  bystanderA = fx.principal(fx.tenantA, "HEALTHCARE_TECHNICIAN"); // A-129: holds esignature, named in no step
  technicianB = fx.principal(fx.tenantB, "TECHNICIAN");

  const step = (fields: Partial<MockStep>): MockStep => ({
    id: "step-id",
    tenantId: "tenant-id",
    workflowId: "wf-id",
    stepNumber: 1,
    signerId: "signer-id",
    signerEmail: "signer@test.test",
    status: "pending",
    signerName: null,
    signedAt: null,
    // Part 11 capture a signer view must never carry.
    ipAddress: "198.51.100.7",
    userAgent: "someone-elses-browser",
    update: jest.fn(async function (this: MockStep, values: Record<string, unknown>) {
      Object.assign(this, values);
      return this;
    }),
    ...fields,
  });
  const workflow = (fields: Partial<MockWorkflow>): MockWorkflow => ({
    id: "wf-id",
    tenantId: "tenant-id",
    documentId: "doc-id",
    subject: "subject",
    status: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
    message: null,
    expiresAt: null,
    signatureAlgorithm: "RS256",
    update: jest.fn(async function (this: MockWorkflow, values: Record<string, unknown>) {
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
    [bystanderA.id]: { id: bystanderA.id, status: "ACTIVE", isActive: true },
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
    expect(list.body.data.map((w: { id: string }) => w.id)).toEqual([WF_A]);
    expect(list.body.meta).toEqual({ total: 1 });

    const opened = await http("get", `/my-workflows/${WF_A}`);
    expect(opened.status).toBe(200);
    expect(opened.body.data.id).toBe(WF_A);
    expect(opened.body.data.steps.map((s: { id: string; signerId: string; status: string }) => [s.id, s.signerId, s.status])).toEqual([
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
    expect(after.body.data.steps.map((s: { status: string }) => s.status)).toEqual(["signed", "pending"]);
  });

  it("a user not named as signer cannot read the workflow", async () => {
    as(bystanderA);

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
    as(bystanderA);
    const notNamed = await http("get", `/my-workflows/${WF_A}`);
    const foreign = await http("get", `/my-workflows/${WF_B}`);
    const missing = await http("get", "/my-workflows/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");

    expect(foreign).toEqual(notNamed);
    expect(missing).toEqual(notNamed);
  });

  it("tenant B's own signer sees B's workflow, and none of A's", async () => {
    mockStore.steps.find((s) => s.id === STEP_B)!.signerId = technicianB.id;
    as(technicianB);

    const list = await http("get", "/my-workflows");

    expect(list.body.data.map((w: { id: string }) => w.id)).toEqual([WF_B]);
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
    expect(all.body.data.map((w: { id: string }) => w.id)).toEqual([WF_A_OTHER, WF_A]);
    // WF_A's supervisor step is still `waiting` for the technician.
    expect(pending.body.data.map((w: { id: string }) => w.id)).toEqual([WF_A_OTHER]);
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
    (RolesService.getRolePermissionsMatrix as jest.Mock).mockImplementation(async (roleId: string) => {
      const matrix = matrixFor(roleNameById.get(roleId));
      delete matrix[MENU_SLUGS.ESIGNATURE];
      return matrix;
    });
    as(technicianA);

    const models = require("../../models") as {
      SignatureWorkflowStep: { findAll: jest.Mock };
      SignatureWorkflow: { findOne: jest.Mock };
    };

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
