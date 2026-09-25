/**
 * A-151 — a GDPR subject export contained other people's data.
 * A-154 — an anonymised account kept its avatar, sessions and second factors.
 *
 * Runs the REAL models barrel on an UNCONNECTED PostgreSQL-dialect Sequelize
 * (the A-140 harness): every statement Sequelize generates is captured, so the
 * assertions are on real table and column names, not on a mock's arguments.
 * The transaction, the audit insert, the session revocation and the file
 * delete are doubles — each has its own suite — and are observed for WHAT is
 * called, in WHICH transaction, and in WHAT order.
 *
 * A-151: the export dumped whole-tenant tables (stocks, devices, calibration
 * records, certificates, notifications — up to 1,000 rows each) into one
 * person's Article 15 archive, and a missing subject answered 500. The export
 * now reads only rows that name the subject, per table, by a column that holds
 * a user id.
 */

const mockDb = { statements: [], userRow: null, events: [] };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async (sql, options = {}) => {
    const text = typeof sql === "string" ? sql : sql.query;
    mockDb.statements.push(text);
    if (text.startsWith("UPDATE")) {
      mockDb.events.push("update");
      mockDb.updateBind = (typeof sql === "object" && sql.bind) || options.bind;
    }
    if (/^SELECT .* FROM "users" AS "User"/.test(text) && options.model && mockDb.userRow) {
      const built = options.model.build(mockDb.userRow, {
        isNewRecord: false,
        include: options.include,
        raw: true,
      });
      return options.plain ? built : [built];
    }
    if (text.startsWith("UPDATE")) {
      return [[], 1];
    }
    return options.plain ? null : [];
  };
  // No connection to begin one on: a managed-transaction double that records
  // commit or rollback, as sequelize.transaction(cb) does.
  db.transaction = async (cb) => {
    const tx = { id: "tx", afterCommit: () => {} };
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
jest.mock("../../services/session.service", () => ({
  revokeOtherSessions: jest.fn(async () => {
    mockDb.events.push("revoke-sessions");
    return 2;
  }),
}));
jest.mock("../../utils/upload.util", () => ({
  deleteUpload: jest.fn(async () => {
    mockDb.events.push("delete-avatar");
  }),
}));

const fs = require("fs");
const path = require("path");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const auditService = require("../../services/audit.service");
const sessionService = require("../../services/session.service");
const { deleteUpload } = require("../../utils/upload.util");
const { logger } = require("../../middlewares/activityLog.middleware");
const gdprService = require("../../services/gdpr.service");

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "33333333-3333-4333-8333-333333333333";
const DPO = "55555555-5555-4555-8555-555555555555";

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
  mockDb.statements = [];
  mockDb.events = [];
  mockDb.userRow = {
    id: USER,
    tenantId: TENANT,
    username: "nurse.jane",
    email: "jane@hospital.test",
    firstName: "Jane",
    lastName: "Doe",
    avatarUrl: "jane-photo.png",
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
});

const selectFrom = (table) =>
  mockDb.statements.filter((s) => s.startsWith("SELECT") && s.includes(` FROM "${table}" `));

describe("A-151 — the export holds only records that name the subject", () => {
  // Hand-written: table -> the user-id columns that make a row the subject's.
  const SUBJECT_TABLES = {
    stock_transfers: ["requested_by", "approved_by"],
    stock_adjustments: ["adjusted_by"],
    stock_opnames: ["performed_by"],
    calibration_records: ["performed_by"],
    certificates: ["calibrated_by", "approved_by", "signed_by", "created_by", "updated_by"],
    maintenance_work_orders: ["assigned_to"],
    notifications: ["user_id"],
  };

  it.each(Object.entries(SUBJECT_TABLES))(
    "%s is read for the subject, in the tenant, by %j",
    async (table, columns) => {
      await asTenant(() => gdprService.exportUserData(TENANT, USER));

      const [sql, ...more] = selectFrom(table);
      expect(more).toEqual([]);
      expect(sql).toMatch(new RegExp(`"tenant_id" = '${TENANT}'`));
      for (const column of columns) {
        expect(sql).toContain(`"${column}" = '${USER}'`);
      }
      // The subject columns are ONE parenthesised OR group, ANDed with the
      // tenant — not an OR that a single column could satisfy across tenants.
      const group = columns.map((c) => `"\\w+"\\."${c}" = '${USER}'`).join(" OR ");
      expect(sql).toMatch(new RegExp(`\\(${group}\\) AND `));
      // D-24 (ADR-070): a keyset page at a time, not the first 1,000.
      expect(sql).toMatch(/ORDER BY "\w+"\."id" ASC LIMIT 500/);
    },
  );

  it("a whole-tenant table that names no user is not exported at all", async () => {
    await asTenant(() => gdprService.exportUserData(TENANT, USER));

    expect(selectFrom("stocks")).toEqual([]);
    expect(selectFrom("calibration_devices")).toEqual([]);
    expect(written["tenant_data.json"]).toBeUndefined();
    expect(written["calibration_data.json"]).toBeUndefined();
    expect(Object.keys(written["subject_records.json"]).sort()).toEqual([
      "CalibrationRecord",
      "Certificate",
      "MaintenanceWorkOrder",
      "Notification",
      "StockAdjustment",
      "StockOpname",
      "StockTransfer",
    ]);
  });

  it("every tenant-table read in the export names the subject", async () => {
    await asTenant(() => gdprService.exportUserData(TENANT, USER));

    const reads = mockDb.statements.filter((s) => s.startsWith("SELECT"));
    expect(reads.length).toBeGreaterThan(0);
    for (const sql of reads) {
      expect({ sql, namesSubject: sql.includes(`'${USER}'`) }).toEqual({ sql, namesSubject: true });
    }
  });

  it("a subject with no account in the tenant is a 404, not a 500", async () => {
    mockDb.userRow = null;

    await expect(asTenant(() => gdprService.exportUserData(TENANT, USER))).rejects.toMatchObject({
      status: 404,
      message: "User not found",
    });
    expect(fs.promises.rm).toHaveBeenCalledWith(expect.stringContaining("export-"), {
      recursive: true,
      force: true,
    });
  });
});

describe("A-154 — anonymising an account removes everything that identifies or signs in as it", () => {
  const userUpdate = () =>
    mockDb.statements.find((s) => s.startsWith('UPDATE "users"'));

  it("clears the avatar, every second factor and one-time code, and deactivates the account", async () => {
    await asTenant(() => gdprService.eraseUserData(TENANT, USER, { requestedBy: DPO }));

    const sql = userUpdate();
    expect(sql).toBeDefined();
    // Hand-written: the columns that must be overwritten.
    for (const column of [
      "email",
      "username",
      "first_name",
      "last_name",
      "phone",
      "avatar_url",
      "status",
      "is_active",
      "mfa_enabled",
      "mfa_secret",
      "mfa_pending_secret",
      "mfa_pending_created_at",
      "mfa_last_used_step",
      "mfa_recovery_codes",
      "webauthn_enabled",
      "webauthn_credential_id",
      "webauthn_public_key",
      "webauthn_sign_count",
      "otp_code",
      "otp_expired_at",
      // D-11: the password hash and the sign-in history go too.
      "password",
      "password_changed_at",
      "must_change_password",
      "last_login_at",
      "failed_login_attempts",
      "locked_until",
      "otp_request_count",
      "otp_last_requested_at",
      "is_email_verified",
    ]) {
      expect({ column, set: sql.includes(`"${column}"=`) }).toEqual({ column, set: true });
    }
    // Confined to the subject in the tenant (bound parameters).
    expect(sql).toMatch(/"id" = \$\d+ AND "tenant_id" = \$\d+/);
    expect(mockDb.updateBind).toEqual(expect.arrayContaining([USER, TENANT]));
    expect(mockDb.updateBind).not.toContain("jane@hospital.test");
    expect(mockDb.updateBind).not.toContain("jane-photo.png");
    expect(mockDb.updateBind).toContain(false); // is_active, mfa/webauthn enabled
  });

  it("revokes every session and writes the audit row inside the erasure's transaction", async () => {
    await asTenant(() => gdprService.eraseUserData(TENANT, USER, { requestedBy: DPO }));

    expect(sessionService.revokeOtherSessions).toHaveBeenCalledWith(USER, null, "GDPR_ERASURE", {
      transaction: expect.objectContaining({ id: "tx" }),
    });
    expect(auditService.logAction).toHaveBeenCalledWith(
      {
        tenantId: TENANT,
        userId: DPO,
        action: "DELETE",
        resourceType: "User",
        resourceId: USER,
        changes: {
          operation: "GDPR_ERASURE",
          method: "anonymized",
          sessionsRevoked: 2,
          avatarRemoved: true,
        },
      },
      { transaction: expect.objectContaining({ id: "tx" }) },
    );
  });

  it("deletes the avatar file only after the commit", async () => {
    await asTenant(() => gdprService.eraseUserData(TENANT, USER, { requestedBy: DPO }));

    expect(deleteUpload).toHaveBeenCalledWith("jane-photo.png", "uploads/public/profile");
    expect(mockDb.events).toEqual([
      "update",
      "revoke-sessions",
      "audit",
      "commit",
      "delete-avatar",
    ]);
  });

  it("a failed audit row rolls the erasure back and keeps the avatar file", async () => {
    auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));

    await expect(
      asTenant(() => gdprService.eraseUserData(TENANT, USER, { requestedBy: DPO })),
    ).rejects.toMatchObject({ status: 500 });

    expect(mockDb.events).toContain("rollback");
    expect(mockDb.events).not.toContain("commit");
    expect(deleteUpload).not.toHaveBeenCalled();
  });

  it("the shared no-photo placeholder is never deleted", async () => {
    mockDb.userRow.avatarUrl = "default.svg";

    await asTenant(() => gdprService.eraseUserData(TENANT, USER, { requestedBy: DPO }));

    expect(deleteUpload).not.toHaveBeenCalled();
    expect(auditService.logAction.mock.calls[0][0].changes.avatarRemoved).toBe(false);
  });

  it("an account with no avatar erases without a file delete", async () => {
    mockDb.userRow.avatarUrl = null;

    await asTenant(() => gdprService.eraseUserData(TENANT, USER, { requestedBy: DPO }));

    expect(deleteUpload).not.toHaveBeenCalled();
  });

  it("a file that cannot be deleted after commit is logged, not reported as a failed erasure", async () => {
    deleteUpload.mockRejectedValueOnce(new Error("EACCES"));

    const result = await asTenant(() =>
      gdprService.eraseUserData(TENANT, USER, { requestedBy: DPO }),
    );

    expect(result).toMatchObject({ erased: true, method: "anonymized" });
    expect(logger.warn).toHaveBeenCalledWith("Failed to delete an erased user's avatar file", {
      userId: USER,
      error: "EACCES",
    });
  });

  it("erasing a subject with no account in the tenant is a 404 and writes nothing", async () => {
    mockDb.userRow = null;

    await expect(
      asTenant(() => gdprService.eraseUserData(TENANT, USER, { requestedBy: DPO })),
    ).rejects.toMatchObject({ status: 404, message: "User not found" });

    expect(userUpdate()).toBeUndefined();
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("a soft delete is audited in its transaction too; a hardDelete request is refused before any transaction (D-11)", async () => {
    await asTenant(() =>
      gdprService.eraseUserData(TENANT, USER, { requestedBy: DPO, anonymize: false }),
    );
    await expect(
      asTenant(() =>
        gdprService.eraseUserData(TENANT, USER, {
          requestedBy: DPO,
          anonymize: false,
          hardDelete: true,
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });

    expect(auditService.logAction.mock.calls.map(([e]) => e.changes)).toEqual([
      { operation: "GDPR_ERASURE", method: "soft_deleted", sessionsRevoked: 0, avatarRemoved: false },
    ]);
    expect(mockDb.events.filter((e) => e === "commit")).toHaveLength(1);
  });
});
