/**
 * A-158 — e-signature emails go through the REAL email path, link to the real
 * signer page on the configured origin, and a failure is logged at error.
 * A-159 — a workflow moves to "in_progress" on its first signature, and a
 * signature attempted after expiresAt is refused (409) and records "expired".
 *
 * What is real and what is doubled, on purpose:
 *
 *  - emailQueue.service and email.service are NOT mocked. The defect was a
 *    call to `emailQueueService.queueEmail`, an export that never existed; a
 *    test that mocks the email module restates whatever the caller believes
 *    (every earlier e-signature test mocked exactly that invented export).
 *    Only the two transports are doubled: `amqplib` (the broker) and
 *    `nodemailer` (SMTP). The assertion is on what reaches them.
 *  - persistence is the auditLedger fixture: the real audit_logs ENUM and
 *    actor CHECK, real rollback, and `cls: false`, so a write that does not
 *    pass `{ transaction }` is visible as an autocommit.
 *  - the signature is real RSA (ADR-040); only the password check is doubled.
 */
const { createLedger } = require("../fixtures/auditLedger");
const { generateTestKeyPair } = require("../utils/esignatureKey.utils");

const mockRef = {
  ledger: null,
  keyPair: null,
  workflow: null,
  steps: null,
  stepsForCompletion: null,
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
    create: async (values, options) => {
      mockRef.ledger.write("signature_workflows", { op: "create", ...values }, options);
      mockRef.workflow = mockMakeWorkflow({ id: "wf-1", ...values });
      return mockRef.workflow;
    },
  },
  SignatureWorkflowStep: {
    findByPk: async (id) => mockRef.steps.find((s) => s.id === id) || null,
    findAll: async (options) => {
      // completeWorkflow reads the steps outside any transaction; the signing
      // transaction's read passes one.
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
    findOne: async ({ where }) => ({
      id: where.id,
      tenantId: where.tenantId,
      email: `${where.id}@hospital.example`,
      firstName: "Signer",
      lastName: where.id,
      isActive: true,
      status: "ACTIVE",
      roleId: null,
    }),
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

const ORIGIN = "https://kalibrasi.example.test";
const SIGN_PAGE = `${ORIGIN}/dashboard/esignature`;

let svc;
let logger;
let envBackup;

const sign = (stepId = "step-1") =>
  svc.signDocument(stepId, "u-1", {
    authenticationMethod: "password",
    authPayload: "pw",
    reason: "Approved by QA",
    ipAddress: "10.0.0.1",
    userAgent: "UA",
  });

const brokerDown = () => mockConnect.mockRejectedValue(new Error("ECONNREFUSED"));

const brokerUp = () => {
  // W-09: a publish declares email_queue, its DLQ and its retry queues on the
  // channel first (emailQueue.service#publishingChannel), as a real channel
  // allows. A double without assertQueue threw there and silently took the
  // direct-SMTP fallback, so the broker path was never reached.
  const channel = { on: jest.fn(), assertQueue: jest.fn().mockResolvedValue({}), sendToQueue: jest.fn(), close: jest.fn() };
  mockConnect.mockResolvedValue({ on: jest.fn(), close: jest.fn(), createChannel: async () => channel });
  return channel;
};

const mailsTo = (address) => mockSendMail.mock.calls.map((c) => c[0]).filter((m) => m.to === address);

beforeAll(() => {
  mockRef.keyPair = generateTestKeyPair({ keyId: "key-a158" });
});

beforeEach(async () => {
  envBackup = { FRONTEND_URL: process.env.FRONTEND_URL, HOST_URL: process.env.HOST_URL };
  process.env.FRONTEND_URL = ORIGIN;
  process.env.HOST_URL = "https://ignored-when-frontend-url-is-set.example";

  // emailQueue caches its broker connection; drop it between tests.
  await require("../../services/emailQueue.service").closeRabbitMQ();
  svc = require("../../services/eSignature.service");
  logger = require("../../middlewares/activityLog.middleware").logger;
  for (const level of ["error", "warn", "info"]) {
    jest.spyOn(logger, level).mockImplementation(() => logger);
  }

  mockRef.ledger = createLedger({ cls: false });
  mockRef.workflow = mockMakeWorkflow({});
  mockRef.steps = [];
  mockRef.stepsForCompletion = null;
  mockSendMail.mockReset().mockResolvedValue({ messageId: "m-1" });
  mockConnect.mockReset();
  brokerDown();
});

afterEach(() => {
  for (const [key, value] of Object.entries(envBackup)) {
    if (value === undefined) {delete process.env[key];} else {process.env[key] = value;}
  }
  jest.restoreAllMocks();
});

const errorLogs = (message) =>
  logger.error.mock.calls.filter(([m]) => m === message).map(([, ctx]) => ctx);

describe("A-158 — the email module's real export surface", () => {
  it("exports queueNotificationEmail, and no `emailQueueService` (the export the old code called)", () => {
    const emailQueue = jest.requireActual("../../services/emailQueue.service");
    expect(typeof emailQueue.queueNotificationEmail).toBe("function");
    expect(emailQueue.emailQueueService).toBeUndefined();
  });
});

describe("A-158 — signature request email", () => {
  const create = () =>
    svc.createSignatureWorkflow(
      "tenant-1",
      { documentId: "doc-1", subject: "Sign me", message: "Please review", signers: [{ userId: "u-1" }, { userId: "u-2" }] },
      { userId: "admin-1" },
    );

  it("reaches SMTP for the first signer, linking the configured front end's E-Signature page", async () => {
    await create();

    const mails = mailsTo("u-1@hospital.example");
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe("Signature request: Sign me");
    expect(mails[0].html).toContain(`href="${SIGN_PAGE}"`);
    expect(mails[0].html).toContain("Please review");
    expect(mails[0].html).not.toContain("app.callibrator.io");
    // Only the first signer is asked; the second is waiting.
    expect(mailsTo("u-2@hospital.example")).toHaveLength(0);
  });

  it("is published to email_queue as a notification job when the broker is up", async () => {
    const channel = brokerUp();

    await create();

    expect(channel.sendToQueue).toHaveBeenCalledTimes(1);
    const [queue, body] = channel.sendToQueue.mock.calls[0];
    expect(queue).toBe("email_queue");
    const job = JSON.parse(body.toString());
    expect(job.type).toBe("notification");
    expect(job.data).toMatchObject({
      email: "u-1@hospital.example",
      title: "Signature request: Sign me",
      actionUrl: SIGN_PAGE,
    });
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("falls back to HOST_URL when FRONTEND_URL is not set", async () => {
    delete process.env.FRONTEND_URL;
    process.env.HOST_URL = "https://host.example.test/";

    await create();

    expect(mailsTo("u-1@hospital.example")[0].html).toContain(
      'href="https://host.example.test/dashboard/esignature"',
    );
  });

  it("with no origin configured, still sends the email and logs the missing link at error", async () => {
    delete process.env.FRONTEND_URL;
    delete process.env.HOST_URL;

    await create();

    expect(mailsTo("u-1@hospital.example")).toHaveLength(1);
    expect(mailsTo("u-1@hospital.example")[0].html).not.toContain("href=");
    expect(errorLogs("Signature request email has no link: neither FRONTEND_URL nor HOST_URL is set")).toEqual([
      expect.objectContaining({ tenantId: "tenant-1", workflowId: "wf-1", stepId: "step-1" }),
    ]);
  });

  it("a failed send is logged at ERROR with its context and does not fail the committed workflow", async () => {
    mockSendMail.mockRejectedValue(new Error("SMTP 554"));

    const result = await create();

    expect(result.workflowId).toBe("wf-1");
    expect(errorLogs("Signature request email was not sent")).toEqual([
      expect.objectContaining({
        tenantId: "tenant-1",
        workflowId: "wf-1",
        stepId: "step-1",
        signerId: "u-1",
        error: "the email queue did not accept the message",
      }),
    ]);
    expect(logger.info).not.toHaveBeenCalledWith("Signature request email queued", expect.anything());
  });

  it("asks the next signer once the previous one has signed", async () => {
    mockRef.steps = [
      mockMakeStep("step-1", { status: "pending", stepNumber: 1 }),
      mockMakeStep("step-2", { status: "waiting", stepNumber: 2, signerId: "u-2" }),
    ];

    await sign();

    const mails = mailsTo("step-2@hospital.example");
    expect(mails).toHaveLength(1);
    expect(mails[0].html).toContain(`href="${SIGN_PAGE}"`);
    expect(mails[0].html).toContain("as signer 2 of this workflow");
  });
});

describe("A-158 — workflow completion email", () => {
  beforeEach(() => {
    mockRef.steps = [mockMakeStep("step-1", { status: "pending", stepNumber: 1 })];
  });

  it("emails every signer once (the old query read a `role` column users do not have)", async () => {
    mockRef.stepsForCompletion = () => [
      mockMakeStep("step-1", { status: "signed", signerEmail: "a@hospital.example" }),
      mockMakeStep("step-2", { status: "signed", signerEmail: "b@hospital.example", signerId: null, signerName: null }),
      mockMakeStep("step-3", { status: "signed", signerEmail: "a@hospital.example" }),
      mockMakeStep("step-4", { status: "signed", signerEmail: null }),
    ];

    await sign();

    expect(mockRef.ledger.committed("signature_workflows")).toEqual([
      expect.objectContaining({ id: "wf-1", status: "completed" }),
    ]);
    for (const address of ["a@hospital.example", "b@hospital.example"]) {
      const mails = mailsTo(address);
      expect(mails).toHaveLength(1);
      expect(mails[0].subject).toBe("Document signed: Sign me");
      expect(mails[0].html).toContain(`href="${SIGN_PAGE}"`);
    }
    expect(mockSendMail).toHaveBeenCalledTimes(2);
    expect(errorLogs("Workflow completion email was not sent")).toEqual([]);
  });

  it("a failed completion email is logged at ERROR; the signature stands", async () => {
    mockRef.stepsForCompletion = () => [mockMakeStep("step-1", { status: "signed" })];
    mockSendMail.mockRejectedValue(new Error("SMTP down"));

    const result = await sign();

    expect(result.signatureId).toBe("sig-1");
    expect(errorLogs("Workflow completion email was not sent")).toEqual([
      expect.objectContaining({ tenantId: "tenant-1", workflowId: "wf-1", stepId: "step-1", signerId: "u-1" }),
    ]);
  });

  it("a failure to read the signers is logged at ERROR; the signature stands", async () => {
    mockRef.stepsForCompletion = () => {
      throw new Error("connection reset");
    };

    const result = await sign();

    expect(result.signatureId).toBe("sig-1");
    expect(errorLogs("Workflow completion email was not sent: the signers could not be read")).toEqual([
      { tenantId: "tenant-1", workflowId: "wf-1", error: "connection reset" },
    ]);
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

describe("A-159 — in_progress on the first signature", () => {
  it("moves a pending multi-signer workflow to in_progress inside the signing transaction", async () => {
    mockRef.steps = [
      mockMakeStep("step-1", { status: "pending", stepNumber: 1 }),
      mockMakeStep("step-2", { status: "waiting", stepNumber: 2 }),
    ];

    await sign();

    expect(mockRef.ledger.committed("signature_workflows")).toEqual([
      expect.objectContaining({ id: "wf-1", status: "in_progress" }),
    ]);
    const audit = mockRef.ledger.auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0].changes.after.workflowStatus).toBe("in_progress");
  });

  it("rolls the in_progress transition back with the signature", async () => {
    mockRef.steps = [
      mockMakeStep("step-1", { status: "pending", stepNumber: 1 }),
      mockMakeStep("step-2", { status: "waiting", stepNumber: 2 }),
    ];
    mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

    await expect(sign()).rejects.toMatchObject({ status: 500 });

    expect(mockRef.ledger.committed("signature_workflows")).toEqual([]);
    expect(mockRef.ledger.committed("signature_records")).toEqual([]);
  });

  it("leaves a workflow that is already in_progress as it is", async () => {
    mockRef.workflow = mockMakeWorkflow({ status: "in_progress" });
    mockRef.steps = [
      mockMakeStep("step-1", { status: "signed", stepNumber: 1 }),
      mockMakeStep("step-2", { status: "pending", stepNumber: 2 }),
      mockMakeStep("step-3", { status: "waiting", stepNumber: 3 }),
    ];

    await sign("step-2");

    expect(mockRef.ledger.committed("signature_workflows")).toEqual([]);
    expect(mockRef.ledger.committed("signature_workflow_steps")).toEqual([
      expect.objectContaining({ id: "step-2", status: "signed" }),
      expect.objectContaining({ id: "step-3", status: "pending" }),
    ]);
  });

  it("still marks it in_progress when no later step is waiting to be activated", async () => {
    mockRef.steps = [
      mockMakeStep("step-1", { status: "pending", stepNumber: 1 }),
      mockMakeStep("step-2", { status: "declined", stepNumber: 2 }),
    ];

    await sign();

    expect(mockRef.ledger.committed("signature_workflows")).toEqual([
      expect.objectContaining({ status: "in_progress" }),
    ]);
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

describe("A-159 — expiry", () => {
  const EXPIRED_AT = new Date(Date.now() - 60000);

  beforeEach(() => {
    mockRef.steps = [mockMakeStep("step-1", { status: "pending", stepNumber: 1 })];
  });

  it("refuses a signature after expiresAt with a 409 that explains it, and records the expiry with its audit row", async () => {
    mockRef.workflow = mockMakeWorkflow({ expiresAt: EXPIRED_AT });

    const err = await sign().catch((e) => e);

    expect(err.status).toBe(409);
    expect(err.message).toBe(
      'This signature workflow is "expired" and cannot be signed: its expiry date has passed, and an ' +
        "expired workflow collects no more signatures; create a new workflow for the remaining signers instead.",
    );
    expect(mockRef.ledger.committed("signature_records")).toEqual([]);
    expect(mockRef.ledger.committed("signature_workflow_steps")).toEqual([]);
    expect(mockRef.ledger.committed("signature_workflows")).toEqual([
      expect.objectContaining({ id: "wf-1", status: "expired" }),
    ]);
    const audit = mockRef.ledger.auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      tenantId: "tenant-1",
      userId: "u-1",
      actorType: "user",
      action: "UPDATE",
      resourceType: "SignatureWorkflow",
      resourceId: "wf-1",
      ipAddress: "10.0.0.1",
      changes: {
        operation: "EXPIRE",
        before: { status: "pending" },
        after: { status: "expired" },
        expiresAt: EXPIRED_AT.toISOString(),
      },
    });
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("refuses a workflow already marked expired, writing nothing", async () => {
    mockRef.workflow = mockMakeWorkflow({ status: "expired", expiresAt: EXPIRED_AT });

    const err = await sign().catch((e) => e);

    expect(err.status).toBe(409);
    expect(err.message).toContain('This signature workflow is "expired" and cannot be signed');
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("does not record the expiry when its audit row cannot be written", async () => {
    mockRef.workflow = mockMakeWorkflow({ status: "in_progress", expiresAt: EXPIRED_AT });
    mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

    await expect(
      svc.signDocument("step-1", "u-1", { authPayload: "pw", reason: "Approved" }),
    ).rejects.toMatchObject({ status: 500 });

    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("a workflow with no expiry date is signable", async () => {
    mockRef.workflow = mockMakeWorkflow({ expiresAt: null });

    const result = await sign();

    expect(result.signatureId).toBe("sig-1");
  });
});
