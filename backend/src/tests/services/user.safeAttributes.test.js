/**
 * GET /users and GET /users/:id returned every user's TOTP secret.
 *
 * user.service's `safeUserAttributes.exclude` named COLUMNS (`otp_code`,
 * `locked_until`, ...). `exclude` takes ATTRIBUTE names, so those matched
 * nothing and excluded nothing — and the list never named `mfaSecret` at all.
 * Anyone allowed to list users received each user's TOTP seed, i.e. the power
 * to generate their second factor, plus the pending enrolment secret (A-114),
 * the e-mail OTP and the lockout state.
 *
 * Measured on the SQL the real models barrel generates (unconnected
 * PostgreSQL-dialect Sequelize, `query` recorded), not on the list itself: a
 * test that iterated the exclude list could not notice a name that matches no
 * attribute.
 */

const mockSql = { statements: [] };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async (sql, options) => {
    mockSql.statements.push(typeof sql === "string" ? sql : sql.query);
    if (options && options.plain) {return null;}
    return [];
  };
  db.transaction = async () => ({
    finished: undefined,
    commit: async () => {},
    rollback: async () => {},
  });
  return { db };
});
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));

const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const userService = require("../../services/user.service");

const TENANT = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

const SECRET_COLUMNS = [
  "password",
  "password_changed_at",
  "otp_code",
  "otp_expired_at",
  "otp_request_count",
  "otp_last_requested_at",
  "failed_login_attempts",
  "locked_until",
  "mfa_secret",
  "mfa_pending_secret",
  "mfa_pending_created_at",
  "mfa_last_used_step",
  "webauthn_credential_id",
  "webauthn_public_key",
  "webauthn_sign_count",
];

/** The columns a SELECT reads from the User table (alias "User"). */
const userColumns = (sql) =>
  [...sql.matchAll(/"User"\."([a-z_]+)"/g)].map((m) => m[1]);

beforeEach(() => {
  mockSql.statements = [];
});

describe("user reads never select a credential or second-factor column", () => {
  it("GET /users (fetchUsers)", async () => {
    await tenantStorage.run({ tenantId: TENANT }, () => userService.fetchUsers({ tenantId: TENANT }));

    const list = mockSql.statements.find((s) => /^SELECT (?!count\()/i.test(s) && /FROM "users"/.test(s));
    const selected = userColumns(list.slice(0, list.indexOf(" FROM ")));
    expect(selected).toEqual(expect.arrayContaining(["id", "username", "email", "mfa_enabled"]));
    expect(selected.filter((c) => SECRET_COLUMNS.includes(c))).toEqual([]);
  });

  it("GET /users/:id (fetchSpecificUser)", async () => {
    await tenantStorage.run({ tenantId: TENANT }, () =>
      userService.fetchSpecificUser(ID).catch(() => {}),
    );

    const detail = mockSql.statements.find((s) => /FROM "users"/.test(s));
    const selected = userColumns(detail.slice(0, detail.indexOf(" FROM ")));
    expect(selected).toEqual(expect.arrayContaining(["id", "username", "email"]));
    expect(selected.filter((c) => SECRET_COLUMNS.includes(c))).toEqual([]);
  });
});
