/**
 * A-186 — custom domains: every change is audited in the tenant's trail inside
 * its transaction, and the verification email goes to the requester and the
 * tenant's administrators — not to the tenant's oldest user.
 *
 * Audit effects are asserted against the auditLedger fixture (real audit ENUM,
 * NOT NULL columns, migration 0033's actor CHECK, real rollback) with
 * `cls: false`, so a write that does not carry `{ transaction }` autocommits
 * and survives the rollback — and the test sees it.
 */
process.env.CUSTOM_DOMAINS_ENABLED = "true";

const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null, record: null, requester: null, admins: [], findAllArgs: null };

const mockRecord = (over = {}) => {
  const rec = {
    id: "d-1",
    tenantId: "tenant-a",
    domain: "portal.hospital-a.example",
    status: "pending_verification",
    isDefault: false,
    sslEnabled: true,
    verificationToken: "callibrator-verify=abc",
    ...over,
  };
  rec.update = async (values, options) => {
    mockRef.ledger.write("custom_domains", { id: rec.id, ...values }, options);
    Object.assign(rec, values);
    return rec;
  };
  return rec;
};

jest.mock("../../models", () => ({
  CustomDomain: {
    findOne: async ({ where }) => {
      if (where.domain) {
        return null; // getDomainByDomain: not taken
      }
      // loadOwned: the tenant predicate is part of the lookup.
      return mockRef.record && where.id === mockRef.record.id && where.tenantId === mockRef.record.tenantId
        ? mockRef.record
        : null;
    },
    create: async (values, options) => {
      mockRef.ledger.write("custom_domains", values, options);
      return { id: "d-new", ...values };
    },
    update: async (values, options) => mockRef.ledger.write("custom_domains", { ...values, where: options.where }, options),
  },
  User: {
    findOne: async () => mockRef.requester,
    findAll: async (args) => {
      mockRef.findAllArgs = args;
      return mockRef.admins;
    },
  },
  Role: { name: "Role" },
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
}));
jest.mock("../../config", () => ({
  db: {
    transaction: (...args) => mockRef.ledger.transaction(...args),
    Sequelize: { Op: { ne: Symbol("ne") } },
  },
}));
jest.mock("../../services/emailQueue.service", () => ({ queueNotificationEmail: jest.fn() }));
jest.mock("dns", () => ({ promises: { resolveTxt: jest.fn() } }));

const svc = require("../../services/customDomains.service");
const { queueNotificationEmail } = require("../../services/emailQueue.service");
const dns = require("dns").promises;
const { logger } = require("../../middlewares/activityLog.middleware");
const { ROLE_NAMES } = require("../../constants/roleConstants");

const actor = { userId: "user-requester", tenantId: "tenant-a", ipAddress: "10.1.2.3", userAgent: "UA" };

beforeEach(() => {
  mockRef.ledger = createLedger({ cls: false });
  mockRef.record = mockRecord();
  mockRef.requester = { id: "user-requester", email: "it.lead@hospital-a.example", firstName: "Ira" };
  mockRef.admins = [{ id: "user-admin", email: "admin@hospital-a.example", firstName: "Ada" }];
  mockRef.findAllArgs = null;
  queueNotificationEmail.mockReset().mockResolvedValue(true);
  dns.resolveTxt.mockReset().mockResolvedValue([["callibrator-verify=abc"]]);
  jest.spyOn(logger, "error").mockImplementation(() => logger);
  jest.spyOn(logger, "info").mockImplementation(() => logger);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  delete process.env.CUSTOM_DOMAINS_ENABLED;
});

const CASES = [
  {
    name: "addDomain",
    run: (a) => svc.addDomain("tenant-a", { domain: "portal.hospital-a.example" }, undefined, a),
    action: "CREATE",
    resourceId: "d-new",
    changes: {
      operation: "ADD_DOMAIN",
      before: {},
      after: { domain: "portal.hospital-a.example", domainType: "subdomain", sslEnabled: true, status: "pending_verification" },
    },
  },
  {
    name: "verifyDomain",
    run: (a) => svc.verifyDomain("tenant-a", "d-1", a),
    action: "UPDATE",
    resourceId: "d-1",
    changes: {
      operation: "VERIFY_DOMAIN",
      domain: "portal.hospital-a.example",
      before: { status: "pending_verification" },
      after: { status: "active", verified: true },
    },
  },
  {
    name: "removeDomain",
    run: (a) => svc.removeDomain("tenant-a", "d-1", a),
    action: "DELETE",
    resourceId: "d-1",
    changes: {
      operation: "REMOVE_DOMAIN",
      domain: "portal.hospital-a.example",
      before: { status: "pending_verification", isDefault: false },
      after: { status: "deleted", isDefault: false },
    },
  },
  {
    name: "setDefaultDomain",
    run: (a) => svc.setDefaultDomain("tenant-a", "d-1", a),
    action: "UPDATE",
    resourceId: "d-1",
    changes: {
      operation: "SET_DEFAULT_DOMAIN",
      domain: "portal.hospital-a.example",
      before: { isDefault: false },
      after: { isDefault: true },
    },
  },
];

describe("A-186 — domain changes are audited in the tenant's trail, inside their transaction", () => {
  describe.each(CASES)("$name", ({ run, action, resourceId, changes }) => {
    it("commits the change with exactly one audit row in the tenant, naming the actor", async () => {
      await run(actor);

      expect(mockRef.ledger.committed("custom_domains").length).toBeGreaterThan(0);
      expect(mockRef.ledger.auditRows()).toEqual([
        expect.objectContaining({
          tenantId: "tenant-a",
          userId: "user-requester",
          actorType: "user",
          action,
          resourceType: "CustomDomain",
          resourceId,
          ipAddress: "10.1.2.3",
          userAgent: "UA",
          changes,
        }),
      ]);
    });

    it("a failing audit insert rolls the change back", async () => {
      mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

      await expect(run(actor)).rejects.toBeDefined();

      expect(mockRef.ledger.committed("custom_domains")).toEqual([]);
      expect(mockRef.ledger.auditRows()).toEqual([]);
      expect(queueNotificationEmail).not.toHaveBeenCalled();
    });

    it("with no actor the change is refused, not committed unattributed (A-124)", async () => {
      await expect(run({})).rejects.toBeDefined();

      expect(mockRef.ledger.committed("custom_domains")).toEqual([]);
    });
  });

  it("another tenant's domain id is 404 for every write, and nothing is written", async () => {
    const other = { ...actor, userId: "user-b", tenantId: "tenant-b" };
    for (const run of [
      () => svc.verifyDomain("tenant-b", "d-1", other),
      () => svc.removeDomain("tenant-b", "d-1", other),
      () => svc.setDefaultDomain("tenant-b", "d-1", other),
    ]) {
      await expect(run()).rejects.toMatchObject({ status: 404 });
    }
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("a failed DNS check is recorded as a failed verification", async () => {
    dns.resolveTxt.mockResolvedValueOnce([["something-else"]]);

    const result = await svc.verifyDomain("tenant-a", "d-1", actor);

    expect(result.verified).toBe(false);
    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({
        changes: expect.objectContaining({ after: { status: "verification_failed", verified: false } }),
      }),
    ]);
  });
});

describe("A-186 — who is told that a domain was added", () => {
  const recipients = () => queueNotificationEmail.mock.calls.map(([job]) => job.email);

  it("the requester and every active tenant administrator, each once", async () => {
    mockRef.admins = [
      { id: "user-admin", email: "admin@hospital-a.example", firstName: "Ada" },
      // the requester is also an admin: one email, not two
      { id: "user-requester", email: "IT.Lead@hospital-a.example", firstName: "Ira" },
    ];

    await svc.addDomain("tenant-a", { domain: "portal.hospital-a.example" }, undefined, actor);

    expect(recipients()).toEqual(["it.lead@hospital-a.example", "admin@hospital-a.example"]);
    // The admin query is the tenant's, active users only, filtered by the admin roles.
    expect(mockRef.findAllArgs.where).toEqual({ tenantId: "tenant-a", isActive: true });
    expect(mockRef.findAllArgs.include).toEqual([
      expect.objectContaining({
        as: "role",
        required: true,
        where: { name: [ROLE_NAMES.HEALTCARE_ADMIN, ROLE_NAMES.CALIBRATOR_ADMIN] },
      }),
    ]);
    expect(logger.info).toHaveBeenCalledWith("Domain verification email queued", {
      tenantId: "tenant-a",
      domain: "portal.hospital-a.example",
      recipients: 2,
    });
  });

  it("a requester who is not a user of the tenant is not emailed; the administrators are", async () => {
    mockRef.requester = null; // User.findOne({ id, tenantId }) found nobody

    await svc.addDomain("tenant-a", { domain: "portal.hospital-a.example" }, undefined, actor);

    expect(recipients()).toEqual(["admin@hospital-a.example"]);
  });

  it("an email that reaches only some recipients is logged at ERROR, with counts and no address", async () => {
    queueNotificationEmail.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await svc.addDomain("tenant-a", { domain: "portal.hospital-a.example" }, undefined, actor);

    expect(logger.error).toHaveBeenCalledWith("Domain verification email reached only some recipients", {
      tenantId: "tenant-a",
      domain: "portal.hospital-a.example",
      accepted: 1,
      recipients: 2,
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("@");
  });
});
