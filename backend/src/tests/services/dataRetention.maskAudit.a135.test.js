/**
 * A-135 (ADR-051 Q-12) — GDPR masking of the audit trail.
 *
 * Q-12 decided that audit rows are NEVER purged, and that GDPR minimisation
 * inside them is done by masking: IP address and user agent, and the personal
 * data a row's `changes` carries about the subject. The masking path it relied
 * on, `maskPII("audit_logs", ...)`, had never worked: it derived a model name
 * from the entity type (`"audit_logs"` -> `Audit_log`), found none, and
 * answered 400. The existing unit test passed because its models mock invented
 * an `Audit_log` model — a mock proving the client, not the contract.
 *
 * This runs the REAL models barrel on an UNCONNECTED PostgreSQL-dialect
 * Sequelize whose `query` plays the database (includes.a90.test.js): it
 * answers the audit_logs SELECT from stored rows and records every statement,
 * with its bind values, so the assertions are on the SQL that would reach
 * PostgreSQL — real column names, the UPDATE values, and the absence of any
 * DELETE.
 */

const mockDb = { rows: [], statements: [] };
const mockTx = { id: "tx-a135", afterCommit: () => {} };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async (sql, options = {}) => {
    const text = typeof sql === "string" ? sql : sql.query;
    const bind = (typeof sql === "object" && sql.bind) || options.bind;
    mockDb.statements.push({ text, bind, transaction: options.transaction });
    if (/^SELECT .* FROM "audit_logs"/.test(text) && options.model) {
      const built = options.model.bulkBuild(
        mockDb.rows.map((r) => ({ ...r })),
        { raw: true, isNewRecord: false },
      );
      return options.plain ? built[0] || null : built;
    }
    if (/^UPDATE /.test(text)) {
      // An instance save reads back [the updated instance, rows affected].
      return [options.instance || [], 1];
    }
    return options.plain ? null : [];
  };
  // A managed transaction: run the callback with a transaction handle, as
  // sequelize.transaction(cb) does, without a connection.
  db.transaction = async (cb) => cb(mockTx);
  return { db };
});
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));

const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const auditService = require("../../services/audit.service");
const dataRetention = require("../../services/dataRetention.service");

const TENANT = "11111111-1111-4111-8111-111111111111";
const SUBJECT = "33333333-3333-4333-8333-333333333333";
const ADMIN = "55555555-5555-4555-8555-555555555555";
const OTHER = "66666666-6666-4666-8666-666666666666";
const ROW = (n) => `aaaaaaaa-0000-4000-8000-00000000000${n}`;

const asSuperAdmin = (fn) => tenantStorage.run({ tenantId: TENANT, isSuperAdmin: true }, fn);

// Keyed by ATTRIBUTE, as the driver returns the aliased SELECT
// (`"user_id" AS "userId"`).
const row = (n, fields) => ({
  id: ROW(n),
  tenantId: TENANT,
  userId: null,
  impersonatorId: null,
  action: "UPDATE",
  resourceType: "Device",
  resourceId: null,
  changes: null,
  ipAddress: null,
  userAgent: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...fields,
});

const updates = () => mockDb.statements.filter((s) => /^UPDATE /.test(s.text));
/** The `changes` value an UPDATE sends: JSONB is bound as serialised JSON. */
const changesBound = (u) =>
  JSON.parse(u.bind.find((v) => typeof v === "string" && v.startsWith("{")));

const updateOf = (n) => updates().find((s) => s.bind && s.bind.includes(ROW(n)));

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.statements = [];
  mockDb.rows = [
    // 1. The subject acted: their IP and browser, also echoed inside changes.
    row(1, {
      userId: SUBJECT,
      ipAddress: "10.0.0.5",
      userAgent: "Firefox/128",
      changes: { before: { name: "Pump" }, after: { name: "Pump 2" }, ipAddress: "10.0.0.5" },
    }),
    // 2. An admin changed the subject's account: the row is ABOUT the subject.
    //    Its IP is the admin's and is kept; the subject's details are masked.
    row(2, {
      userId: ADMIN,
      resourceType: "User",
      resourceId: SUBJECT,
      ipAddress: "10.0.0.9",
      userAgent: "Chrome/139",
      changes: {
        before: { email: "jane@hospital.test", firstName: "Jane", roleId: "r-1" },
        after: { email: "jane.doe@hospital.test", firstName: "Jane", roleId: "r-2" },
      },
    }),
    // 3. The subject is a super admin who acted through an impersonation.
    row(3, { userId: OTHER, impersonatorId: SUBJECT, ipAddress: "10.0.0.7", userAgent: "Edge" }),
    // 4. Someone else's row: untouched.
    row(4, { userId: OTHER, ipAddress: "10.0.0.8", userAgent: "Safari" }),
    // 5. Already masked: nothing to write.
    row(5, { userId: SUBJECT, ipAddress: "[REDACTED]", userAgent: "[REDACTED]" }),
  ];
});

describe("A-135 — maskPII('audit_logs') masks a data subject's audit trail", () => {
  it("masking a data subject's audit trail masks IP, user agent and personal data in changes, and deletes no row", async () => {
    const actor = { userId: ADMIN, ipAddress: "10.9.9.9", userAgent: "ops-console" };

    const result = await asSuperAdmin(() =>
      dataRetention.maskPII(TENANT, "audit_logs", [SUBJECT], actor),
    );

    // Never a DELETE (Q-12).
    expect(mockDb.statements.filter((s) => /^DELETE /i.test(s.text))).toEqual([]);

    // The SELECT uses real audit_logs columns and is confined to the tenant.
    const select = mockDb.statements.find((s) => /^SELECT .* FROM "audit_logs"/.test(s.text)).text;
    expect(select).toContain(`"AuditLog"."tenant_id" = '${TENANT}'`);
    expect(select).toContain(`"AuditLog"."user_id" IN ('${SUBJECT}')`);
    expect(select).toContain(`"AuditLog"."impersonator_id" IN ('${SUBJECT}')`);
    expect(select).toMatch(/"AuditLog"\."resource_type" = 'User'/);
    expect(select).toContain(`"AuditLog"."resource_id" IN ('${SUBJECT}')`);

    // Row 1: IP and user agent masked, the echoed IP in changes masked, the
    // device data the subject changed kept.
    const u1 = updateOf(1);
    expect(u1.text).toMatch(/SET "ip_address"=\$\d+,"user_agent"=\$\d+,"changes"=\$\d+/);
    expect(u1.bind.slice(0, 2)).toEqual(["[REDACTED]", "[REDACTED]"]);
    expect(changesBound(u1)).toEqual({
      before: { name: "Pump" },
      after: { name: "Pump 2" },
      ipAddress: "[REDACTED]",
    });

    // Row 2: the admin's IP is not touched; the subject's details are.
    const u2 = updateOf(2);
    expect(u2.text).not.toMatch(/"ip_address"|"user_agent"/);
    expect(changesBound(u2)).toEqual({
      before: { email: "[REDACTED]", firstName: "[REDACTED]", roleId: "r-1" },
      after: { email: "[REDACTED]", firstName: "[REDACTED]", roleId: "r-2" },
    });

    // Row 3: the impersonating super admin's network identity is masked.
    expect(updateOf(3).text).toMatch(/SET "ip_address"=\$\d+,"user_agent"=\$\d+/);

    // Rows 4 and 5: nothing written.
    expect(updateOf(4)).toBeUndefined();
    expect(updateOf(5)).toBeUndefined();

    // The trail's "who did what" is never in a SET clause.
    for (const u of updates()) {
      expect(u.text).not.toMatch(/"user_id"=|"action"=|"resource_type"=|"resource_id"=|"created_at"=/);
    }

    // Every write, and the audit row recording them, in ONE transaction.
    // (Sequelize clones query options, so the handle is compared by its id.)
    expect(updates()).toHaveLength(3);
    for (const u of updates()) {
      expect(u.transaction && u.transaction.id).toBe(mockTx.id);
    }
    expect(auditService.logAction).toHaveBeenCalledTimes(1);
    expect(auditService.logAction).toHaveBeenCalledWith(
      {
        tenantId: TENANT,
        userId: ADMIN,
        action: "UPDATE",
        resourceType: "AuditLog",
        resourceId: null,
        changes: {
          operation: "GDPR_MASK_AUDIT_PII",
          subjectIds: [SUBJECT],
          rowsMasked: 3,
          fields: ["changes", "ipAddress", "userAgent"],
        },
        ipAddress: "10.9.9.9",
        userAgent: "ops-console",
      },
      { transaction: mockTx },
    );
    expect(result).toEqual({ masked: 3, fields: ["changes", "ipAddress", "userAgent"] });
  });

  it("masks network identity nested in arrays, and leaves nulls and already-masked values alone", async () => {
    mockDb.rows = [
      row(6, {
        userId: SUBJECT,
        // No column values to mask on this row: only `changes` is written.
        ipAddress: null,
        userAgent: null,
        changes: {
          attempts: [{ ip: "10.0.0.5", at: "t1" }, "plain", 7],
          ipAddress: null,
          userAgent: "[REDACTED]",
        },
      }),
    ];

    const result = await asSuperAdmin(() =>
      dataRetention.maskPII(TENANT, "audit_logs", [SUBJECT], { userId: ADMIN }),
    );

    const [u6] = updates();
    expect(u6.text).toMatch(/^UPDATE "audit_logs" SET "changes"=\$1 WHERE/);
    expect(changesBound(u6)).toEqual({
      attempts: [{ ip: "[REDACTED]", at: "t1" }, "plain", 7],
      ipAddress: null,
      userAgent: "[REDACTED]",
    });
    expect(result).toEqual({ masked: 1, fields: ["changes"] });
  });

  it("is refused while a legal hold is active, and writes nothing", async () => {
    jest
      .spyOn(dataRetention, "isOnLegalHold")
      .mockResolvedValueOnce(true);

    await expect(
      asSuperAdmin(() => dataRetention.maskPII(TENANT, "audit_logs", [SUBJECT], {})),
    ).rejects.toMatchObject({ status: 400, message: "Cannot mask PII while legal hold is active" });
    expect(updates()).toEqual([]);
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("anonymizeDataset refuses audit_logs outright: the trail is never rewritten wholesale", async () => {
    await expect(
      asSuperAdmin(() => dataRetention.anonymizeDataset(TENANT, "audit_logs")),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/cannot be anonymized/) });
    expect(updates()).toEqual([]);
  });
});
