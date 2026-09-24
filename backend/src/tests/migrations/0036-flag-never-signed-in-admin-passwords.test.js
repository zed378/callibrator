/**
 * Migration 0036 — A-163: flag the never-signed-in accounts created before
 * A-123 so the admin-chosen password is changed at first sign-in.
 *
 * Fake `sequelize.query`: proves the control flow — refuse (not skip) a
 * missing table or the missing 0031 column, run the flag UPDATE in one
 * transaction with the seeded operator and the super-admin role excluded,
 * report and return the count, and a `down` that changes nothing.
 *
 * WHICH rows the UPDATE selects is proven against PostgreSQL 18, not here:
 * a fake cannot evaluate SQL. Verified on pgvector/pgvector:pg18 over a
 * db.sync() schema with 15 fixture accounts, one per rule: exactly the
 * never-signed-in admin-created account, the one with a NULL mfa_enabled and
 * the admin-created account in an SSO tenant were flagged; the seeded
 * operator (email matched case-insensitively), another super admin, the
 * signed-in, password-changed, deleted (both ways), MFA/passkey-enrolled,
 * session-holding, LOGIN-audited and SSO-provisioned ones were not; a second
 * run flagged 0.
 */
const fs = require("fs");
const path = require("path");
const migration = require("../../migrations/0036-flag-never-signed-in-admin-passwords");
const { ROLE_IDS } = require("../../constants/roleConstants");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "../../migrations/0036-flag-never-signed-in-admin-passwords.js"),
  "utf8",
);
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

const fakeContext = ({ missingTables = [], column = true, flagged = [] } = {}) => {
  const calls = [];
  const query = jest.fn(async (sql, options = {}) => {
    calls.push({ sql, options });
    if (/to_regclass/.test(sql)) {
      return [
        options.replacements.tables.map((name) => ({ name, present: !missingTables.includes(name) })),
      ];
    }
    if (/information_schema\.columns/.test(sql)) {
      return [column ? [{ "?column?": 1 }] : []];
    }
    if (/^\s*UPDATE users u/.test(sql)) {
      return [flagged.map((id) => ({ id }))];
    }
    throw new Error(`unexpected: ${sql}`);
  });
  const tx = { id: "tx" };
  return {
    calls,
    tx,
    context: { sequelize: { query, transaction: async (fn) => fn(tx) } },
  };
};

let warn;
beforeEach(() => {
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe("migration 0036 — flag never-signed-in accounts (A-163)", () => {
  it("is registered in the static manifest under its frozen .js name, after 0035", () => {
    const line =
      '["0036-flag-never-signed-in-admin-passwords.js", require("../migrations/0036-flag-never-signed-in-admin-passwords")]';
    expect(MANIFEST).toContain(line);
    expect(MANIFEST.indexOf(line)).toBeGreaterThan(MANIFEST.indexOf("0035-tenant-settings-secrets.js"));
  });

  it("has no try/catch", () => {
    expect(SOURCE).not.toMatch(/\btry\s*\{/);
    expect(SOURCE).not.toMatch(/\.catch\(/);
  });

  it("the frozen super-admin role id is the real one", () => {
    expect(migration.SUPER_ADMIN_ROLE_ID).toBe(ROLE_IDS.SUPER_ADMIN);
    expect(migration.SEEDED_SYSTEM_EMAILS).toEqual(["sys@mail.com"]);
  });

  it("flags in one transaction, excluding the seeded operator and the super-admin role, and reports the count", async () => {
    const { calls, tx, context } = fakeContext({ flagged: ["u-1", "u-2", "u-3"] });

    const count = await migration.up({ context });

    expect(count).toBe(3);
    const update = calls.find((c) => /UPDATE users u/.test(c.sql));
    expect(update.options).toEqual({
      transaction: tx,
      replacements: { seededEmails: ["sys@mail.com"], superAdminRoleId: ROLE_IDS.SUPER_ADMIN },
    });
    for (const c of calls) {
      expect(c.options.transaction).toBe(tx);
    }
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^0036: flagged 3 never-signed-in account/));
  });

  it("a second run that finds nothing reports 0", async () => {
    const { context } = fakeContext({ flagged: [] });

    expect(await migration.up({ context })).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^0036: flagged 0 /));
  });

  it.each([["users"], ["sessions"], ["audit_logs"], ["tenant_settings"]])(
    "REFUSES (does not skip) when %s is missing, and flags nothing",
    async (table) => {
      const { calls, context } = fakeContext({ missingTables: [table] });

      await expect(migration.up({ context })).rejects.toThrow(new RegExp(`table\\(s\\) ${table} do not exist`));
      expect(calls.some((c) => /UPDATE/.test(c.sql))).toBe(false);
    },
  );

  it("REFUSES when 0031's must_change_password column is missing", async () => {
    const { calls, context } = fakeContext({ column: false });

    await expect(migration.up({ context })).rejects.toThrow(/Migration 0031 must run first/);
    expect(calls.some((c) => /UPDATE/.test(c.sql))).toBe(false);
  });

  it("down changes nothing (it cannot tell these flags from userCreate's)", async () => {
    const { calls, context } = fakeContext();

    await migration.down({ context });

    expect(calls).toEqual([]);
  });
});
