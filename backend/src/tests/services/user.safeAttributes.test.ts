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
import type * as SequelizeModule from "sequelize";

const mockSql: { statements: string[] } = { statements: [] };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual<typeof SequelizeModule>("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  (db as unknown as { query: unknown }).query = (
    sql: string | { query: string },
    options?: { plain?: boolean },
  ) => {
    mockSql.statements.push(typeof sql === "string" ? sql : sql.query);
    if (options?.plain) {
      return Promise.resolve(null);
    }
    return Promise.resolve([]);
  };
  (db as unknown as { transaction: unknown }).transaction = () =>
    Promise.resolve({
      finished: undefined,
      commit: () => Promise.resolve(),
      rollback: () => Promise.resolve(),
    });
  return { db };
});
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as includes.a90 does */
require("../../models");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware") as {
    tenantStorage: { run<T>(store: object, fn: () => T): T };
};
const userService = require("../../services/user.service") as {
    fetchUsers: (q: Record<string, unknown>) => Promise<unknown>;
    fetchSpecificUser: (id: string) => Promise<unknown>;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const TENANT = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

const SECRET_COLUMNS: readonly string[] = [
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
const userColumns = (sql: string): string[] =>
  [...sql.matchAll(/"User"\."([a-z_]+)"/g)].map((m) => m[1] ?? "");

beforeEach(() => {
  mockSql.statements = [];
});

describe("user reads never select a credential or second-factor column", () => {
  it("GET /users (fetchUsers)", async () => {
    await tenantStorage.run({ tenantId: TENANT }, () => userService.fetchUsers({ tenantId: TENANT }));

    const list =
            mockSql.statements.find((s) => /^SELECT (?!count\()/i.test(s) && s.includes('FROM "users"')) ?? "";
    const selected = userColumns(list.slice(0, list.indexOf(" FROM ")));
    expect(selected).toEqual(expect.arrayContaining(["id", "username", "email", "mfa_enabled"]));
    expect(selected.filter((c) => SECRET_COLUMNS.includes(c))).toEqual([]);
  });

  it("GET /users/:id (fetchSpecificUser)", async () => {
    await tenantStorage.run({ tenantId: TENANT }, () =>
      userService.fetchSpecificUser(ID).catch(() => undefined),
    );

    const detail = mockSql.statements.find((s) => s.includes('FROM "users"')) ?? "";
    const selected = userColumns(detail.slice(0, detail.indexOf(" FROM ")));
    expect(selected).toEqual(expect.arrayContaining(["id", "username", "email"]));
    expect(selected.filter((c) => SECRET_COLUMNS.includes(c))).toEqual([]);
  });
});
