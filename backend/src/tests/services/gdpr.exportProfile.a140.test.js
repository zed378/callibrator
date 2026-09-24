/**
 * A-140 — the GDPR profile export always threw.
 *
 * `exportUserProfile` read the user with `include: [Role]`. `User` is
 * associated to `Role` under the alias `role` (user.model.js), and Sequelize
 * refuses an include that omits a declared alias: "Role is associated to User
 * using an alias. You must use the 'as' keyword to specify the alias within
 * your include statement." `exportUserData` caught that and answered 500
 * "Failed to export user data" — so every Article 15 (right of access) request
 * failed, for every user, on every deployment. The profile then read
 * `user.Role?.name`, which is never set under the alias either, and `raw: true`
 * flattens an include to `"role.name"` keys, so even a fixed include would
 * have exported `role: undefined`.
 *
 * The audit-row export filtered on `performedBy`, which is not an `audit_logs`
 * column, so PostgreSQL rejected it and the subject received
 * `{ "error": "Failed to export" }` in place of their own audit rows.
 *
 * A mock of `User.findOne` cannot see either defect: it accepts any include.
 * So this runs the REAL models barrel on an UNCONNECTED PostgreSQL-dialect
 * Sequelize (includes.a90.test.js), and asserts on the SQL Sequelize generates
 * and on the files the export writes.
 */

const mockDb = { statements: [], profileRow: null };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async (sql, options = {}) => {
    const text = typeof sql === "string" ? sql : sql.query;
    mockDb.statements.push(text);
    if (/^SELECT .* FROM "users" AS "User"/.test(text) && options.model && mockDb.profileRow) {
      // What the driver hands back for this SELECT: the row, with the joined
      // role under the include's alias.
      const built = options.model.build(mockDb.profileRow, {
        isNewRecord: false,
        include: options.include,
        raw: true,
      });
      return options.plain ? built : [built];
    }
    return options.plain ? null : [];
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
    // The service registers its "end" handler AFTER finalize(), as archiver
    // allows, so the event is emitted on a later tick.
    finalize: () => {
      Promise.resolve().then(() => handlers.end());
    },
  };
});

const fs = require("fs");
const models = require("../../models");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const gdprService = require("../../services/gdpr.service");

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "33333333-3333-4333-8333-333333333333";
const ROLE = "44444444-4444-4444-8444-444444444444";

const asTenant = (fn) => tenantStorage.run({ tenantId: TENANT }, fn);

let written;

beforeEach(() => {
  jest.restoreAllMocks();
  mockDb.statements = [];
  mockDb.profileRow = {
    id: USER,
    tenantId: TENANT,
    username: "nurse.jane",
    email: "jane@hospital.test",
    firstName: "Jane",
    lastName: "Doe",
    phone: "+62 811 000 000",
    avatarUrl: "default.svg",
    status: "ACTIVE",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastLoginAt: new Date("2026-09-01T00:00:00Z"),
    role: { id: ROLE, name: "TECHNICIAN" },
  };
  written = {};
  jest.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined);
  jest.spyOn(fs.promises, "writeFile").mockImplementation(async (file, content) => {
    written[require("path").basename(file)] = JSON.parse(content);
  });
  jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 1 });
  jest.spyOn(fs, "createWriteStream").mockReturnValue({ on: () => {} });
  // The 7-day cleanup timer is not what is under test.
  jest.spyOn(global, "setTimeout").mockImplementation(() => 0);
});

const profileSelect = () => mockDb.statements.find((s) => /FROM "users" AS "User"/.test(s));

describe("A-140 — GDPR Article 15 profile export", () => {
  it("exports the subject's profile with their role, instead of failing every request", async () => {
    const result = await asTenant(() => gdprService.exportUserData(TENANT, USER));

    expect(result.exportId).toMatch(/^export-/);
    expect(written["user_profile.json"].user).toEqual({
      id: USER,
      email: "jane@hospital.test",
      username: "nurse.jane",
      firstName: "Jane",
      lastName: "Doe",
      phone: "+62 811 000 000",
      avatarUrl: "default.svg",
      role: "TECHNICIAN",
      status: "ACTIVE",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastLoginAt: "2026-09-01T00:00:00.000Z",
    });
  });

  it("joins the role under its alias, as a LEFT JOIN, confined to the subject in the tenant", async () => {
    await asTenant(() => gdprService.exportUserData(TENANT, USER));

    const sql = profileSelect();
    // A user whose role was deleted (role_id SET NULL) must still get their data.
    expect(sql).toMatch(/LEFT OUTER JOIN "roles" AS "role" ON "User"\."role_id" = "role"\."id"/);
    expect(sql).toContain(`"User"."id" = '${USER}'`);
    expect(sql).toContain(`"User"."tenant_id" = '${TENANT}'`);
  });

  it("never selects a credential or second-factor column into the export", async () => {
    await asTenant(() => gdprService.exportUserData(TENANT, USER));

    const selectList = profileSelect().split(" FROM ")[0];
    for (const column of [
      "password",
      "mfa_secret",
      "mfa_pending_secret",
      "mfa_recovery_codes",
      "otp_code",
      "webauthn_public_key",
      "webauthn_credential_id",
    ]) {
      expect({ column, selected: selectList.includes(`"${column}"`) }).toEqual({
        column,
        selected: false,
      });
    }
  });

  it("exports the audit rows the subject acted in, filtering on real audit_logs columns", async () => {
    await asTenant(() => gdprService.exportUserData(TENANT, USER));

    const auditSelect = mockDb.statements.find((s) => /FROM "audit_logs" AS "AuditLog"/.test(s));
    expect(auditSelect).not.toMatch(/performedBy|performed_by/);
    expect(auditSelect).toContain(`"AuditLog"."user_id" = '${USER}'`);
    expect(auditSelect).toContain(`"AuditLog"."impersonator_id" = '${USER}'`);
    expect(auditSelect).toContain(`"AuditLog"."tenant_id" = '${TENANT}'`);
    expect(written["audit_logs.json"]).toEqual([]);
  });

  it("writes no profile for a subject with no row in the tenant", async () => {
    mockDb.profileRow = null;

    await expect(asTenant(() => gdprService.exportUserData(TENANT, USER))).rejects.toMatchObject({
      status: 500,
      message: "Failed to export user data",
    });
    expect(written["user_profile.json"]).toBeUndefined();
  });

  it("the User -> Role association is declared under the alias the export uses", () => {
    expect(models.User.associations.role.target).toBe(models.Role);
  });
});
