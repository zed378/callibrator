/**
 * A-168 — an expired signature workflow cannot be edited (409, explained; a
 *   new workflow is the way to re-request), and MAY be cancelled, which closes
 *   it with an audit row. "Expired" is either the status or an open workflow
 *   whose expiresAt has passed without a signature attempt marking it.
 * A-169 — the signer view (GET /my-workflows) leaves out expired workflows
 *   the caller has nothing on record in, and flags the rest; nothing is
 *   written on the read.
 * A-170 — a workflow records who requested it (`requestedBy`, from the
 *   actor), and the completion email reaches the requester as well as the
 *   signers.
 *
 * What is real and what is doubled, as in esignature.a158a159.test.js:
 *
 *  - emailQueue.service and email.service are NOT mocked. Only `amqplib`
 *    (the broker) and `nodemailer` (SMTP) are doubled; the assertions are on
 *    what reaches SMTP.
 *  - persistence is the auditLedger fixture: the real audit_logs ENUM and
 *    actor CHECK, real rollback, and `cls: false`, so a write that does not
 *    pass `{ transaction }` is visible as an autocommit.
 *  - the SignatureWorkflow model is the REAL model on an unconnected
 *    Sequelize where the JSON a route sends is at stake (the `expired` flag).
 */
const { createLedger } = require("../fixtures/auditLedger");
const { generateTestKeyPair } = require("../utils/esignatureKey.utils");

const mockRef = {
  ledger: null,
  keyPair: null,
  workflow: null,
  workflows: [],
  steps: [],
  stepsForCompletion: null,
  users: {},
  userLookupError: null,
  reads: [],
};

// ---- transports: the only email doubles ------------------------------------
const mockSendMail = jest.fn();
const mockConnect = jest.fn();
jest.mock("amqplib", () => ({ connect: (...args) => mockConnect(...args) }));
jest.mock("nodemailer", () => ({
  createTransport: () => ({ sendMail: (...args) => mockSendMail(...args) }),
}));

// ---- persistence -------------------------------------------------------------
jest.mock("../../models", () => ({
  TenantKey: {
    unscoped: () => ({ findOne: async () => mockRef.keyPair }),
    findOne: async () => mockRef.keyPair,
  },
  SignatureWorkflow: {
    findByPk: async () => mockRef.workflow,
    findOne: async (options) => {
      mockRef.reads.push(options);
      return mockRef.workflow;
    },
    findAll: async (options) => {
      mockRef.reads.push(options);
      return mockRef.workflows.filter((w) => options.where.id.includes(w.id));
    },
    create: async (values, options) => {
      mockRef.ledger.write("signature_workflows", { op: "create", ...values }, options);
      mockRef.workflow = mockMakeWorkflow({ id: "wf-1", ...values });
      return mockRef.workflow;
    },
  },
  SignatureWorkflowStep: {
    findByPk: async (id) => mockRef.steps.find((s) => s.id === id) || null,
    findAll: async (options) => {
      if (options.attributes && options.attributes.length === 1) {
        // getSignerWorkflows' first read: the caller's own steps.
        return mockRef.steps.filter(
          (s) =>
            s.signerId === options.where.signerId &&
            (options.where.status === undefined || s.status === options.where.status),
        );
      }
      if (!options.transaction && mockRef.stepsForCompletion) {
        return mockRef.stepsForCompletion();
      }
      return mockRef.steps;
    },
    create: async (values, options) => {
      mockRef.ledger.write("signature_workflow_steps", { op: "create", ...values }, options);
      const step = mockMakeStep(`step-${values.stepNumber}`, values);
      mockRef.steps.push(step);
      return step;
    },
  },
  SignatureRecord: {
    create: async (values, options) => {
      mockRef.ledger.write("signature_records", values, options);
      return { id: "sig-1", ...values };
    },
  },
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
  User: {
    findByPk: async () => ({ id: "u-1", status: "ACTIVE", isActive: true }),
    findOne: async (options) => {
      mockRef.reads.push({ model: "User", ...options });
      if (mockRef.userLookupError) {
        throw mockRef.userLookupError;
      }
      const { where } = options;
      if (Object.prototype.hasOwnProperty.call(mockRef.users, where.id)) {
        const user = mockRef.users[where.id];
        return user && user.tenantId === where.tenantId ? user : null;
      }
      return {
        id: where.id,
        tenantId: where.tenantId,
        email: `${where.id}@hospital.example`,
        firstName: "Signer",
        lastName: where.id,
        isActive: true,
        status: "ACTIVE",
        roleId: null,
      };
    },
  },
  Role: { findByPk: async () => null },
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));
// A-65 — signing re-authenticates the signer; the password check is doubled.
jest.mock("../../services/auth.service", () => ({
  passIsValid: async () => ({ data: { valid: true } }),
}));
// A-129 — every named signer may sign.
jest.mock("../../middlewares/dynamicAccess.middleware", () => ({
  principalHasMenuPermission: async () => true,
}));

function mockMakeWorkflow(fields) {
  const workflow = {
    id: "wf-1",
    tenantId: "tenant-1",
    documentId: "doc-1",
    subject: "Sign me",
    message: "",
    status: "pending",
    expiresAt: new Date(Date.now() + 86400000),
    ...fields,
  };
  workflow.update = async (values, options) => {
    mockRef.ledger.write("signature_workflows", { id: workflow.id, ...values }, options);
    Object.assign(workflow, values);
    return workflow;
  };
  return workflow;
}

function mockMakeStep(id, fields) {
  const step = {
    id,
    workflowId: "wf-1",
    tenantId: "tenant-1",
    signerId: "u-1",
    signerEmail: `${id}@hospital.example`,
    signerName: `Signer ${id}`,
    ...fields,
  };
  step.update = async (values, options) => {
    mockRef.ledger.write("signature_workflow_steps", { id, ...values }, options);
    Object.assign(step, values);
    return step;
  };
  return step;
}

const { Sequelize, DataTypes } = jest.requireActual("sequelize");
const RealWorkflow = jest.requireActual("../../models/signatureWorkflow.model")(
  new Sequelize({ dialect: "postgres", logging: false }),
  DataTypes,
);

const ORIGIN = "https://kalibrasi.example.test";
const PAST = new Date(Date.now() - 60000);
const FUTURE = new Date(Date.now() + 86400000);
const ACTOR = { userId: "admin-1", ipAddress: "10.0.0.2", userAgent: "UA-admin" };

let svc;
let logger;
let envBackup;

const mailsTo = (address) => mockSendMail.mock.calls.map((c) => c[0]).filter((m) => m.to === address);
const errorLogs = (message) =>
  logger.error.mock.calls.filter(([m]) => m === message).map(([, ctx]) => ctx);

beforeAll(() => {
  mockRef.keyPair = generateTestKeyPair({ keyId: "key-a170" });
});

beforeEach(async () => {
  envBackup = { FRONTEND_URL: process.env.FRONTEND_URL };
  process.env.FRONTEND_URL = ORIGIN;

  await require("../../services/emailQueue.service").closeRabbitMQ();
  svc = require("../../services/eSignature.service");
  logger = require("../../middlewares/activityLog.middleware").logger;
  for (const level of ["error", "warn", "info"]) {
    jest.spyOn(logger, level).mockImplementation(() => logger);
  }

  mockRef.ledger = createLedger({ cls: false });
  mockRef.workflow = mockMakeWorkflow({});
  mockRef.workflows = [];
  mockRef.steps = [];
  mockRef.stepsForCompletion = null;
  mockRef.users = {};
  mockRef.userLookupError = null;
  mockRef.reads = [];
  mockSendMail.mockReset().mockResolvedValue({ messageId: "m-1" });
  mockConnect.mockReset().mockRejectedValue(new Error("ECONNREFUSED"));
});

afterEach(() => {
  if (envBackup.FRONTEND_URL === undefined) {
    delete process.env.FRONTEND_URL;
  } else {
    process.env.FRONTEND_URL = envBackup.FRONTEND_URL;
  }
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
describe("A-168 — editing an expired workflow is a 409", () => {
  const EXPECTED =
    `This signature workflow is "expired" (its expiry date, ${PAST.toISOString()}, has passed) ` +
    "and cannot be edited: expiry is final, and its expiry date cannot be extended; " +
    "create a new workflow for the remaining signers instead.";

  it.each([
    ["marked expired", { status: "expired", expiresAt: PAST }],
    ["pending, past expiresAt, not yet marked", { status: "pending", expiresAt: PAST }],
    ["in_progress, past expiresAt, not yet marked", { status: "in_progress", expiresAt: PAST }],
  ])("refuses a workflow %s — even an edit that would extend expiresAt — and writes nothing", async (_label, fields) => {
    mockRef.workflow = mockMakeWorkflow(fields);

    const err = await svc
      .updateWorkflow("wf-1", "tenant-1", { expiresAt: FUTURE, subject: "Again" }, ACTOR)
      .catch((e) => e);

    expect(err.status).toBe(409);
    expect(err.message).toBe(EXPECTED);
    expect(mockRef.ledger.rows).toEqual([]);
    expect(mockRef.workflow.expiresAt).toBe(PAST);
  });

  it("decides it on the workflow read inside the transaction, locked", async () => {
    mockRef.workflow = mockMakeWorkflow({ status: "pending", expiresAt: PAST });

    await svc.updateWorkflow("wf-1", "tenant-1", { subject: "x" }, ACTOR).catch(() => {});

    expect(mockRef.reads).toEqual([
      expect.objectContaining({ where: { id: "wf-1", tenantId: "tenant-1" }, lock: true, transaction: expect.any(Object) }),
    ]);
  });

  it("an open workflow before its expiry date is still edited, with its audit row", async () => {
    mockRef.workflow = mockMakeWorkflow({ status: "pending", expiresAt: FUTURE });

    await svc.updateWorkflow("wf-1", "tenant-1", { subject: "New subject" }, ACTOR);

    expect(mockRef.ledger.committed("signature_workflows")).toEqual([
      expect.objectContaining({ id: "wf-1", subject: "New subject" }),
    ]);
    expect(mockRef.ledger.auditRows()).toHaveLength(1);
  });

  it("a workflow with no expiry date is edited", async () => {
    mockRef.workflow = mockMakeWorkflow({ status: "pending", expiresAt: null });

    await svc.updateWorkflow("wf-1", "tenant-1", { message: "m" }, ACTOR);

    expect(mockRef.ledger.committed("signature_workflows")).toHaveLength(1);
  });

  it("a completed workflow keeps its own explanation, not the expiry one", async () => {
    mockRef.workflow = mockMakeWorkflow({ status: "completed", expiresAt: PAST });

    const err = await svc.updateWorkflow("wf-1", "tenant-1", { subject: "x" }, ACTOR).catch((e) => e);

    expect(err.status).toBe(409);
    expect(err.message).toMatch(/^This signature workflow is "completed" and cannot be edited/);
  });
});

describe("A-168 — cancelling an expired workflow closes it, audited", () => {
  it.each([
    ["marked expired", "expired"],
    ["pending past expiresAt", "pending"],
    ["in_progress past expiresAt", "in_progress"],
  ])("cancels a workflow %s, with one audit row saying it had expired", async (_label, status) => {
    mockRef.workflow = mockMakeWorkflow({ status, expiresAt: PAST });

    const result = await svc.cancelWorkflow("wf-1", "admin-1", "tenant-1", ACTOR, "lapsed");

    expect(result).toEqual({ success: true });
    expect(mockRef.ledger.committed("signature_workflows")).toEqual([
      expect.objectContaining({ id: "wf-1", status: "cancelled" }),
    ]);
    const audit = mockRef.ledger.auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      tenantId: "tenant-1",
      userId: "admin-1",
      actorType: "user",
      action: "UPDATE",
      resourceType: "SignatureWorkflow",
      resourceId: "wf-1",
      ipAddress: "10.0.0.2",
      changes: {
        operation: "CANCEL",
        before: { status, expired: true, expiresAt: PAST.toISOString() },
        after: { status: "cancelled", reason: "lapsed" },
      },
    });
  });

  it("an open workflow's cancel row does not claim an expiry", async () => {
    mockRef.workflow = mockMakeWorkflow({ status: "pending", expiresAt: FUTURE });

    await svc.cancelWorkflow("wf-1", "admin-1", "tenant-1", ACTOR);

    expect(mockRef.ledger.auditRows()[0].changes.before).toEqual({ status: "pending" });
  });

  it("the cancellation rolls back with a failed audit insert", async () => {
    mockRef.workflow = mockMakeWorkflow({ status: "expired", expiresAt: PAST });
    mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

    await expect(svc.cancelWorkflow("wf-1", "admin-1", "tenant-1", ACTOR)).rejects.toMatchObject({ status: 500 });

    expect(mockRef.ledger.committed("signature_workflows")).toEqual([]);
  });

  it("a cancelled expired workflow cannot be cancelled again", async () => {
    mockRef.workflow = mockMakeWorkflow({ status: "cancelled", expiresAt: PAST });

    const err = await svc.cancelWorkflow("wf-1", "admin-1", "tenant-1", ACTOR).catch((e) => e);

    expect(err.status).toBe(409);
    expect(mockRef.ledger.rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("A-169 — the signer view leaves out expired workflows, and flags the rest", () => {
  // Workflows naming u-1, as real SignatureWorkflow instances.
  const workflow = (id, fields, mySteps) => {
    const instance = RealWorkflow.build({
      id,
      tenantId: "tenant-1",
      documentId: `doc-${id}`,
      subject: id,
      status: "pending",
      expiresAt: FUTURE,
      ...fields,
    });
    instance.steps = mySteps.map((status, i) => ({
      id: `${id}-s${i}`,
      workflowId: id,
      signerId: "u-1",
      status,
    }));
    mockRef.steps.push(...instance.steps);
    mockRef.workflows.push(instance);
    return instance;
  };

  beforeEach(() => {
    workflow("open", {}, ["pending"]);
    workflow("lapsed-unmarked", { expiresAt: PAST }, ["pending"]);
    workflow("lapsed-marked", { status: "expired", expiresAt: PAST }, ["pending"]);
    workflow("lapsed-waiting", { status: "in_progress", expiresAt: PAST }, ["waiting"]);
    workflow("lapsed-i-signed", { status: "in_progress", expiresAt: PAST }, ["signed"]);
    workflow("lapsed-i-declined", { status: "expired", expiresAt: PAST }, ["declined"]);
    workflow("completed-late", { status: "completed", expiresAt: PAST }, ["signed"]);
  });

  const ids = (list) => list.map((w) => w.id);
  const flags = (list) => Object.fromEntries(list.map((w) => [w.id, w.toJSON().expired]));

  it("unfiltered: an expired workflow stays only where the caller signed or declined, flagged", async () => {
    const list = await svc.getSignerWorkflows("tenant-1", "u-1", {});

    expect(ids(list)).toEqual(["open", "lapsed-i-signed", "lapsed-i-declined", "completed-late"]);
    expect(flags(list)).toEqual({
      open: false,
      "lapsed-i-signed": true,
      "lapsed-i-declined": true,
      // Completed before anything lapsed: closed, not expired.
      "completed-late": false,
    });
  });

  it('"To sign" (stepStatus=pending) lists only what can still be signed', async () => {
    const list = await svc.getSignerWorkflows("tenant-1", "u-1", { stepStatus: "pending" });

    expect(ids(list)).toEqual(["open"]);
    expect(flags(list)).toEqual({ open: false });
  });

  it("stepStatus=waiting leaves expired workflows out as well", async () => {
    const list = await svc.getSignerWorkflows("tenant-1", "u-1", { stepStatus: "waiting" });

    expect(ids(list)).toEqual([]);
  });

  it("stepStatus=signed keeps the caller's record of an expired workflow, flagged", async () => {
    const list = await svc.getSignerWorkflows("tenant-1", "u-1", { stepStatus: "signed" });

    expect(ids(list)).toEqual(["lapsed-i-signed", "completed-late"]);
    expect(flags(list)).toEqual({ "lapsed-i-signed": true, "completed-late": false });
  });

  it("the flag is in the JSON the route sends (a data value, not a stray property)", async () => {
    const [first] = await svc.getSignerWorkflows("tenant-1", "u-1", { stepStatus: "signed" });

    expect(JSON.parse(JSON.stringify(first))).toMatchObject({ id: "lapsed-i-signed", expired: true });
  });

  it("writes nothing: an unmarked lapsed workflow is not marked expired on a GET", async () => {
    await svc.getSignerWorkflows("tenant-1", "u-1", {});

    expect(mockRef.ledger.rows).toEqual([]);
    const unmarked = mockRef.workflows.find((w) => w.id === "lapsed-unmarked");
    expect(unmarked.status).toBe("pending");
  });

  it("the one-workflow signer read carries the flag too", async () => {
    mockRef.workflow = mockRef.workflows.find((w) => w.id === "lapsed-unmarked");

    const one = await svc.getSignerWorkflow("lapsed-unmarked", "tenant-1", "u-1");

    expect(one.toJSON().expired).toBe(true);
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("a plain row (no model instance) is flagged as a property", async () => {
    mockRef.workflow = { id: "p", status: "pending", expiresAt: FUTURE, steps: [{ signerId: "u-1" }] };

    const one = await svc.getSignerWorkflow("p", "tenant-1", "u-1");

    expect(one.expired).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("A-170 — the requester", () => {
  const create = (data = {}) =>
    svc.createSignatureWorkflow(
      "tenant-1",
      { documentId: "doc-1", subject: "Sign me", signers: [{ userId: "u-1" }], ...data },
      ACTOR,
    );

  it("is recorded at creation from the actor, inside the creating transaction", async () => {
    await create();

    expect(mockRef.ledger.committed("signature_workflows")).toEqual([
      expect.objectContaining({ op: "create", requestedBy: "admin-1" }),
    ]);
  });

  it("is never taken from the body", async () => {
    await create({ requestedBy: "someone-else" });

    expect(mockRef.ledger.committed("signature_workflows")[0].requestedBy).toBe("admin-1");
  });
});

describe("A-170 — the completion email reaches the requester", () => {
  const sign = () =>
    svc.signDocument("step-1", "u-1", {
      authenticationMethod: "password",
      authPayload: "pw",
      reason: "Approved by QA",
      ipAddress: "10.0.0.1",
      userAgent: "UA",
    });

  beforeEach(() => {
    mockRef.steps = [mockMakeStep("step-1", { status: "pending", stepNumber: 1 })];
    mockRef.stepsForCompletion = () => [
      mockMakeStep("step-1", { status: "signed", signerEmail: "signer@hospital.example" }),
    ];
    mockRef.workflow = mockMakeWorkflow({ requestedBy: "admin-1" });
  });

  it("emails the requester and every signer, each once, linking the E-Signature page", async () => {
    await sign();

    const requesterMails = mailsTo("admin-1@hospital.example");
    expect(requesterMails).toHaveLength(1);
    expect(requesterMails[0].subject).toBe("Document signed: Sign me");
    expect(requesterMails[0].html).toContain(`href="${ORIGIN}/dashboard/esignature"`);
    expect(mailsTo("signer@hospital.example")).toHaveLength(1);
    expect(mockSendMail).toHaveBeenCalledTimes(2);
  });

  it("reads the requester in the workflow's own tenant", async () => {
    await sign();

    expect(mockRef.reads.filter((r) => r.model === "User")).toEqual([
      expect.objectContaining({ where: { id: "admin-1", tenantId: "tenant-1" } }),
    ]);
  });

  it("a requester who is also a signer gets one email", async () => {
    mockRef.stepsForCompletion = () => [
      mockMakeStep("step-1", { status: "signed", signerEmail: "admin-1@hospital.example" }),
    ];

    await sign();

    expect(mailsTo("admin-1@hospital.example")).toHaveLength(1);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it("a workflow with no recorded requester (before migration 0039) emails its signers only", async () => {
    mockRef.workflow = mockMakeWorkflow({ requestedBy: null });

    await sign();

    expect(mockRef.reads.filter((r) => r.model === "User")).toEqual([]);
    expect(mailsTo("signer@hospital.example")).toHaveLength(1);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it("a requester who cannot be found is logged at ERROR; the signers are still told", async () => {
    mockRef.users = { "admin-1": null };

    const result = await sign();

    expect(result.signatureId).toBe("sig-1");
    expect(errorLogs("Workflow completion email was not sent to the requester: no email address for them")).toEqual([
      { tenantId: "tenant-1", workflowId: "wf-1", requesterId: "admin-1" },
    ]);
    expect(mailsTo("signer@hospital.example")).toHaveLength(1);
  });

  it("a requester in another tenant is not found (and not emailed)", async () => {
    mockRef.users = { "admin-1": { id: "admin-1", tenantId: "tenant-2", email: "other@tenant2.example" } };

    await sign();

    expect(mailsTo("other@tenant2.example")).toHaveLength(0);
  });

  it("a requester with no first name is greeted generically", async () => {
    mockRef.users = { "admin-1": { id: "admin-1", tenantId: "tenant-1", email: "req@hospital.example", firstName: null } };

    await sign();

    expect(mailsTo("req@hospital.example")[0].html).toContain("Hi there");
  });

  it("a requester with no email address is logged at ERROR; the signers are still told", async () => {
    mockRef.users = { "admin-1": { id: "admin-1", tenantId: "tenant-1", email: null } };

    await sign();

    expect(errorLogs("Workflow completion email was not sent to the requester: no email address for them")).toHaveLength(1);
    expect(mailsTo("signer@hospital.example")).toHaveLength(1);
  });

  it("a failed requester lookup is logged at ERROR; the signature and the signers' email stand", async () => {
    mockRef.userLookupError = new Error("connection reset");

    const result = await sign();

    expect(result.signatureId).toBe("sig-1");
    expect(errorLogs("Workflow completion email was not sent to the requester: they could not be read")).toEqual([
      { tenantId: "tenant-1", workflowId: "wf-1", requesterId: "admin-1", error: "connection reset" },
    ]);
    expect(mailsTo("signer@hospital.example")).toHaveLength(1);
  });

  it("a failed send to the requester is logged at ERROR with the requester's id, no address", async () => {
    mockSendMail.mockImplementation(async (mail) => {
      if (mail.to === "admin-1@hospital.example") {
        throw new Error("SMTP 554");
      }
      return { messageId: "m-2" };
    });

    await sign();

    const failures = errorLogs("Workflow completion email was not sent");
    expect(failures).toEqual([
      expect.objectContaining({ tenantId: "tenant-1", workflowId: "wf-1", requesterId: "admin-1" }),
    ]);
    expect(JSON.stringify(failures)).not.toContain("@");
    expect(mailsTo("signer@hospital.example")).toHaveLength(1);
  });
});
