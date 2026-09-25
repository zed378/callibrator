/**
 * A-180 — GDPR gaps in the self-service subject rights.
 *
 *  1. The Article 15 export omitted the subject's consent history, their
 *     data-subject requests and their sign-in sessions. They are now in
 *     `privacy_records.json`, each read filtered by the tenant AND the subject.
 *  2. Rectifying `email` to an address another account holds answered 500
 *     (the unique index threw inside the transaction). It is a 409 whose
 *     message explains the state. A new address is unverified until the link
 *     sent to it is followed, and the previous address is told of the change.
 *
 * (The other two A-180 points are proven elsewhere: `maskPII("users")` in
 * dataRetention.service.test.js, the refused `erased` status in
 * auth.erasedStatus.a180.test.js, auth.test.js and socket.test.js.)
 *
 * Runs the REAL models barrel on an UNCONNECTED PostgreSQL-dialect Sequelize
 * (the A-140 / A-151 harness): every statement Sequelize generates is
 * captured, so the assertions are on real table and column names.
 */

const mockDb = {
  statements: [],
  rows: {},
  userRow: null,
  takenRow: null,
  updateError: null,
  events: [],
  updateBind: null,
};

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async (sql, options = {}) => {
    const text = typeof sql === "string" ? sql : sql.query;
    mockDb.statements.push(text);
    if (text.startsWith("UPDATE")) {
      mockDb.events.push("update");
      mockDb.updateBind = (typeof sql === "object" && sql.bind) || options.bind;
      if (mockDb.updateError) {
        throw mockDb.updateError;
      }
      return [[], 1];
    }
    const table = (text.match(/FROM "([a-z_]+)"/) || [])[1];
    if (table === "users" && options.model) {
      const row = /lower\("email"\)/.test(text) ? mockDb.takenRow : mockDb.userRow;
      if (!row) {
        return options.plain ? null : [];
      }
      const built = options.model.build(row, { isNewRecord: false, raw: true });
      return options.plain ? built : [built];
    }
    if (mockDb.rows[table]) {
      return mockDb.rows[table].map((r) => ({ ...r }));
    }
    return options.plain ? null : [];
  };
  db.transaction = async (cb) => {
    const tx = { id: "tx" };
    try {
      const result = await cb(tx);
      mockDb.events.push("commit");
      return result;
    } catch (err) {
      mockDb.events.push("rollback");
      throw err;
    }
  };
  return { db };
});
jest.mock("archiver", () => () => {
  const handlers = {};
  return {
    on: (event, cb) => {
      handlers[event] = cb;
    },
    pipe: () => {},
    directory: () => {},
    finalize: () => {
      Promise.resolve().then(() => handlers.end());
    },
  };
});
jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn(async () => {
    mockDb.events.push("audit");
  }),
}));
jest.mock("../../services/emailQueue.service", () => ({
  queueActivationEmail: jest.fn(async () => {
    mockDb.events.push("mail-new-address");
    return true;
  }),
  queueNotificationEmail: jest.fn(async () => {
    mockDb.events.push("mail-previous-address");
    return true;
  }),
}));
jest.mock("../../utils/jwt.util", () => ({
  generatePurposeToken: jest.fn(() => "ACTIVATION-TOKEN"),
}));
// A-214: an email change re-authenticates first; that step is proven in
// gdpr.rectifyReauth.a214.test.js. Here it passes, as for a password holder.
jest.mock("../../services/auth.service", () => ({
  passwordManagedBy: jest.fn(async () => null),
  reauthenticate: jest.fn(async () => "password"),
}));

const fs = require("fs");
const path = require("path");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const auditService = require("../../services/audit.service");
const emailQueue = require("../../services/emailQueue.service");
const { generatePurposeToken } = require("../../utils/jwt.util");
const { logger } = require("../../middlewares/activityLog.middleware");
const gdprService = require("../../services/gdpr.service");

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const ADMIN = "55555555-5555-4555-8555-555555555555";

const asTenant = (fn) => tenantStorage.run({ tenantId: TENANT }, fn);

let written;

// D-24 (ADR-070): the export streams — writeFile is handed an async iterable
// of chunks, not a string.
const readAll = async (content) => {
  if (typeof content === "string") {
    return content;
  }
  let text = "";
  for await (const chunk of content) {
    text += chunk;
  }
  return text;
};

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  process.env.GDPR_ENABLED = "true";
  process.env.FRONTEND_URL = "https://app.hospital.test/";
  mockDb.statements = [];
  mockDb.events = [];
  mockDb.updateBind = null;
  mockDb.updateError = null;
  mockDb.takenRow = null;
  mockDb.rows = {};
  mockDb.userRow = {
    id: USER,
    // Attribute names: the driver returns the SELECT's `AS "firstName"` aliases.
    tenantId: TENANT,
    username: "nurse.jane",
    email: "jane@hospital.test",
    firstName: "Jane",
    lastName: "Doe",
    avatarUrl: "default.svg",
    status: "ACTIVE",
  };
  written = {};
  jest.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined);
  jest.spyOn(fs.promises, "writeFile").mockImplementation(async (file, content) => {
    written[path.basename(file)] = JSON.parse(await readAll(content));
  });
  jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 1 });
  jest.spyOn(fs.promises, "rm").mockResolvedValue(undefined);
  jest.spyOn(fs, "createWriteStream").mockReturnValue({ on: () => {} });
  jest.spyOn(global, "setTimeout").mockImplementation(() => 0);
  jest.spyOn(logger, "warn").mockImplementation(() => {});
  jest.spyOn(logger, "error").mockImplementation(() => {});
  jest.spyOn(logger, "info").mockImplementation(() => {});
});

afterAll(() => {
  delete process.env.FRONTEND_URL;
});

const selectFrom = (table) =>
  mockDb.statements.filter((s) => s.startsWith("SELECT") && s.includes(` FROM "${table}" `));

describe("A-180 — the Article 15 export includes consent history, DSARs and sessions", () => {
  it.each([["consent_records"], ["dsar_requests"], ["sessions"]])(
    "%s is read once, for the subject, in the tenant",
    async (table) => {
      await asTenant(() => gdprService.exportUserData(TENANT, USER));

      const [sql, ...more] = selectFrom(table);
      expect(sql).toBeDefined();
      expect(more).toEqual([]);
      expect(sql).toMatch(new RegExp(`"tenant_id" = '${TENANT}'`));
      expect(sql).toMatch(new RegExp(`"user_id" = '${USER}'`));
      // D-24 (ADR-070): a keyset page at a time, not the first 1,000.
      expect(sql).toMatch(/ORDER BY "\w+"\."id" ASC LIMIT 500/);
    },
  );

  it("the rows reach privacy_records.json", async () => {
    mockDb.rows = {
      consent_records: [{ id: "c1", purpose: "analytics", status: "withdrawn" }],
      dsar_requests: [{ id: "d1", type: "erasure", status: "pending" }],
      sessions: [{ id: "s1", impersonator_id: null, ip_address: "203.0.113.7", user_agent: "Firefox" }],
    };

    await asTenant(() => gdprService.exportUserData(TENANT, USER));

    expect(written["privacy_records.json"]).toEqual({
      consentHistory: [{ id: "c1", purpose: "analytics", status: "withdrawn" }],
      dsarRequests: [{ id: "d1", type: "erasure", status: "pending" }],
      sessions: [{ id: "s1", impersonator_id: null, ip_address: "203.0.113.7", user_agent: "Firefox" }],
    });
  });

  it("a session's refresh-token hash is never selected", async () => {
    await asTenant(() => gdprService.exportUserData(TENANT, USER));

    const [sql] = selectFrom("sessions");
    expect(sql.slice(0, sql.indexOf(" FROM "))).not.toContain("token_hash");
  });

  it("soft-deleted sessions are still the subject's history (the defaultScope is not applied)", async () => {
    await asTenant(() => gdprService.exportUserData(TENANT, USER));

    const [sql] = selectFrom("sessions");
    expect(sql).not.toContain('"is_deleted" = false');
  });

  it("an impersonated session withholds the impersonator's network address, agent, device and id", async () => {
    mockDb.rows = {
      sessions: [
        {
          id: "s2",
          impersonator_id: ADMIN,
          ip_address: "198.51.100.1",
          user_agent: "Admin-Chrome",
          device: "admin-laptop",
          created_at: "2026-09-01T00:00:00.000Z",
        },
      ],
    };

    await asTenant(() => gdprService.exportUserData(TENANT, USER));

    expect(written["privacy_records.json"].sessions).toEqual([
      {
        id: "s2",
        impersonated: true,
        ip_address: null,
        user_agent: null,
        device: null,
        created_at: "2026-09-01T00:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(written)).not.toContain(ADMIN);
  });

  it("a failed read fails the export — an incomplete Article 15 answer is never presented as complete", async () => {
    const models = require("../../models");
    jest.spyOn(models.DsarRequest, "findAll").mockRejectedValueOnce(new Error("relation missing"));

    await expect(asTenant(() => gdprService.exportUserData(TENANT, USER))).rejects.toMatchObject({
      status: 500,
    });
    expect(written["privacy_records.json"]).toBeUndefined();
  });
});

describe("A-180 — rectifying the email", () => {
  const rectify = (value) =>
    asTenant(() =>
      gdprService.rectifyData(TENANT, USER, "email", value, { ipAddress: "10.0.0.1", userAgent: "ua" }),
    );

  it("an address another account holds is a 409 explaining the state — not a 500 — and nothing is written", async () => {
    mockDb.takenRow = { id: OTHER };

    await expect(rectify("Taken@Hospital.test")).rejects.toMatchObject({
      status: 409,
      message:
        "This email address is already in use by another account. Choose a different address; your current address is unchanged.",
    });
    expect(mockDb.statements.some((s) => s.startsWith("UPDATE"))).toBe(false);
    expect(auditService.logAction).not.toHaveBeenCalled();
    expect(emailQueue.queueActivationEmail).not.toHaveBeenCalled();
  });

  it("the taken-address check is case-insensitive, platform-wide (the index is global), excludes the subject and sees soft-deleted accounts", async () => {
    await rectify("New.Address@Hospital.test");

    const check = mockDb.statements.find((s) => /lower\("email"\)/.test(s));
    expect(check).toMatch(/lower\("email"\) = 'new.address@hospital.test'/);
    expect(check).toContain(`"id" != '${USER}'`);
    expect(check).not.toContain('"tenant_id"');
    expect(check).not.toContain('"deleted_at" IS NULL');
    expect(check).not.toContain('"is_deleted" = false');
  });

  it("a unique-index violation (a race past the check) is still the 409, and rolls back", async () => {
    const { UniqueConstraintError } = jest.requireActual("sequelize");
    mockDb.updateError = new UniqueConstraintError({ message: "duplicate key" });

    await expect(rectify("race@hospital.test")).rejects.toMatchObject({ status: 409 });
    expect(mockDb.events).toContain("rollback");
    expect(emailQueue.queueActivationEmail).not.toHaveBeenCalled();
  });

  it("a new address is stored lower-cased and UNVERIFIED, audited in the transaction, then mailed after the commit", async () => {
    const result = await rectify("  New.Address@Hospital.test ");

    const update = mockDb.statements.find((s) => s.startsWith('UPDATE "users"'));
    expect(update).toContain('"email"=');
    expect(update).toContain('"is_email_verified"=');
    expect(mockDb.updateBind).toEqual(expect.arrayContaining(["new.address@hospital.test", false]));
    expect(auditService.logAction.mock.calls[0][0].changes).toEqual({
      operation: "GDPR_RECTIFICATION",
      fields: ["email"],
      emailVerificationReset: true,
      // A-214: how the caller re-authenticated.
      reauthenticatedWith: "password",
    });
    // The audit trail never holds the address (A-153).
    expect(JSON.stringify(auditService.logAction.mock.calls)).not.toContain("new.address");

    // A-191: the link is bound to the NEW address, by hash (never the address itself).
    const { activationEmailHash } = require("../../utils/activationToken.util");
    expect(generatePurposeToken).toHaveBeenCalledWith(
      { id: USER, eh: activationEmailHash("new.address@hospital.test") },
      "activation",
    );
    expect(emailQueue.queueActivationEmail).toHaveBeenCalledWith({
      email: "new.address@hospital.test",
      firstName: "Jane",
      lastName: "Doe",
      activationLink: "https://app.hospital.test/activation?token=ACTIVATION-TOKEN",
    });
    expect(emailQueue.queueNotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: "jane@hospital.test", title: "Your email address was changed" }),
    );
    expect(mockDb.events).toEqual([
      "update",
      "audit",
      "commit",
      "mail-new-address",
      "mail-previous-address",
    ]);
    expect(result).toEqual({ rectified: true, field: "email", emailVerificationRequired: true });
  });

  it("the account's own address (any case) is not a change: no re-verification, no mail", async () => {
    const result = await rectify("JANE@hospital.test");

    const update = mockDb.statements.find((s) => s.startsWith('UPDATE "users"'));
    expect(update).not.toContain('"is_email_verified"=');
    expect(emailQueue.queueActivationEmail).not.toHaveBeenCalled();
    expect(emailQueue.queueNotificationEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ rectified: true, field: "email" });
  });

  it.each([["not-an-email"], [""], [42], [undefined]])(
    "%p is a 400 before anything is read or written",
    async (value) => {
      await expect(rectify(value)).rejects.toMatchObject({
        status: 400,
        message: "email must be a valid email address",
      });
      expect(mockDb.statements).toEqual([]);
    },
  );

  it("a subject with no account in the tenant is a 404 and writes nothing", async () => {
    mockDb.userRow = null;

    await expect(rectify("new@hospital.test")).rejects.toMatchObject({ status: 404 });
    expect(mockDb.statements.some((s) => s.startsWith("UPDATE"))).toBe(false);
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("mail that cannot be queued is logged; the committed change stands", async () => {
    emailQueue.queueActivationEmail.mockRejectedValueOnce(new Error("broker down"));

    const result = await rectify("new@hospital.test");

    expect(result.emailVerificationRequired).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith("Email-change mail could not be queued", {
      userId: USER,
      error: "broker down",
    });
  });

  it("with no front-end origin configured the link is still built (relative)", async () => {
    delete process.env.FRONTEND_URL;
    delete process.env.HOST_URL;

    await rectify("new@hospital.test");

    expect(emailQueue.queueActivationEmail.mock.calls[0][0].activationLink).toBe(
      "/activation?token=ACTIVATION-TOKEN",
    );
  });

  it("a non-email field is unchanged: no account read, no mail", async () => {
    const result = await asTenant(() => gdprService.rectifyData(TENANT, USER, "phone", "+62 811"));

    expect(selectFrom("users")).toEqual([]);
    expect(emailQueue.queueActivationEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ rectified: true, field: "phone" });
  });

  it("any other failure is re-thrown as it was", async () => {
    mockDb.updateError = new Error("connection reset");

    await expect(rectify("new@hospital.test")).rejects.toThrow("connection reset");
  });
});
