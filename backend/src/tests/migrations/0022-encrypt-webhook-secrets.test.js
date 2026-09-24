/**
 * Migration 0022 — encrypt existing plaintext webhook secrets.
 *
 * This runs the migration against a fake QueryInterface that keeps rows in
 * memory. It proves the migration's LOGIC — which rows it touches, with which
 * tenant, what it writes, that it verifies itself and that `down` restores the
 * exact plaintext. It does NOT prove the SQL runs on PostgreSQL: that needs
 * `make migrate` against a real database and a `SELECT` afterwards.
 */
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const migration = require("../../migrations/0022-encrypt-webhook-secrets");
const { migrator } = (() => {
  // The manifest is the other half of "registered": read it as text so this
  // test does not open a database connection.
  const fs = require("fs");
  const path = require("path");
  return { migrator: fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8") };
})();
const kms = require("../../services/kms.service");

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";

/**
 * A QueryInterface stand-in over an in-memory `webhooks` table. It understands
 * exactly the statements the migration issues, and throws on anything else so
 * an unexpected query cannot pass silently.
 */
const fakeQueryInterface = ({ rows, tables = ["webhooks"], secretType = "CHARACTER VARYING(128)" }) => {
  const state = { rows: rows.map((r) => ({ ...r })), secretType, changeColumn: [] };
  const tx = { id: "tx" };
  const qi = {
    state,
    showAllTables: jest.fn(async () => tables.map((t) => ({ tableName: t }))),
    describeTable: jest.fn(async () => ({ secret: { type: state.secretType } })),
    changeColumn: jest.fn(async (table, column, spec) => {
      state.changeColumn.push({ table, column, spec });
      state.secretType = spec.type.key === "TEXT" ? "TEXT" : `CHARACTER VARYING(${spec.type._length})`;
    }),
    sequelize: {
      transaction: jest.fn(async (cb) => cb(tx)),
      query: jest.fn(async (sql, opts = {}) => {
        const s = sql.replace(/\s+/g, " ").trim();
        const r = opts.replacements || {};
        if (s.startsWith("SELECT id, tenant_id, secret FROM webhooks WHERE secret NOT LIKE")) {
          return state.rows.filter((x) => !x.secret.startsWith("v1:"));
        }
        if (s.startsWith("SELECT id, tenant_id, secret FROM webhooks WHERE secret LIKE")) {
          return state.rows.filter((x) => x.secret.startsWith("v1:"));
        }
        if (s.startsWith("SELECT COUNT(*) AS n FROM webhooks WHERE secret NOT LIKE")) {
          return [{ n: String(state.rows.filter((x) => !x.secret.startsWith("v1:")).length) }];
        }
        if (s.startsWith("SELECT COUNT(*) AS n FROM webhooks WHERE secret LIKE")) {
          return [{ n: String(state.rows.filter((x) => x.secret.startsWith("v1:")).length) }];
        }
        if (s.startsWith("UPDATE webhooks SET secret = :secret WHERE id = :id AND tenant_id = :tenantId AND secret = :previous")) {
          expect(opts.transaction).toBe(tx);
          const hit = state.rows.find((x) => x.id === r.id && x.tenant_id === r.tenantId && x.secret === r.previous);
          if (hit) {
            hit.secret = r.secret;
          }
          return [[], { rowCount: hit ? 1 : 0 }];
        }
        throw new Error(`unexpected query: ${s}`);
      }),
    },
  };
  return qi;
};

const seed = () => [
  { id: "w1", tenant_id: T1, secret: "a".repeat(48) },
  { id: "w2", tenant_id: T2, secret: "b".repeat(48) },
  // soft-deleted rows are still secrets at rest
  { id: "w3", tenant_id: T1, secret: "c".repeat(48), is_deleted: true },
  // already encrypted — must be left byte-for-byte alone
  { id: "w4", tenant_id: T2, secret: kms.encryptData(T2, "d".repeat(64)) },
];

describe("migration 0022-encrypt-webhook-secrets", () => {
  it("is registered in migrator.js with the .js suffix", () => {
    expect(migrator).toContain(
      '["0022-encrypt-webhook-secrets.js", require("../migrations/0022-encrypt-webhook-secrets")]',
    );
  });

  it("up widens the column to TEXT and encrypts every plaintext row under its own tenant", async () => {
    const qi = fakeQueryInterface({ rows: seed() });
    const w4Before = qi.state.rows[3].secret;

    await migration.up({ context: qi });

    expect(qi.state.secretType).toBe("TEXT");
    const [w1, w2, w3, w4] = qi.state.rows;
    for (const r of [w1, w2, w3, w4]) {
      expect(r.secret.startsWith("v1:")).toBe(true);
    }
    expect(kms.decryptData(T1, w1.secret)).toBe("a".repeat(48));
    expect(kms.decryptData(T2, w2.secret)).toBe("b".repeat(48));
    expect(kms.decryptData(T1, w3.secret)).toBe("c".repeat(48));
    expect(w4.secret).toBe(w4Before);
    // Tenant-bound: w1's ciphertext does not open under T2.
    expect(() => kms.decryptData(T2, w1.secret)).toThrow();
  });

  it("up is idempotent — a second run changes nothing", async () => {
    const qi = fakeQueryInterface({ rows: seed() });
    await migration.up({ context: qi });
    const after = qi.state.rows.map((r) => r.secret);
    await migration.up({ context: qi });
    expect(qi.state.rows.map((r) => r.secret)).toEqual(after);
  });

  it("up fails loudly — not recorded as applied — if a row could not be encrypted", async () => {
    const qi = fakeQueryInterface({ rows: seed() });
    // A concurrent writer changed w1 between the SELECT and the UPDATE.
    const original = qi.sequelize.query;
    qi.sequelize.query = jest.fn(async (sql, opts) => {
      if (/^\s*UPDATE/.test(sql) && opts.replacements.id === "w1") {
        return [[], { rowCount: 0 }];
      }
      return original(sql, opts);
    });
    await expect(migration.up({ context: qi })).rejects.toThrow(/0022/);
  });

  it("up does nothing, without error, when there is no webhooks table", async () => {
    const qi = fakeQueryInterface({ rows: [], tables: ["users"] });
    await migration.up({ context: qi });
    expect(qi.describeTable).not.toHaveBeenCalled();
    expect(qi.sequelize.query).not.toHaveBeenCalled();
  });

  it("up does not re-issue the column change when it is already TEXT", async () => {
    const qi = fakeQueryInterface({ rows: [], secretType: "TEXT" });
    await migration.up({ context: qi });
    expect(qi.changeColumn).not.toHaveBeenCalled();
  });

  it("down restores the exact plaintext and the original column width", async () => {
    const qi = fakeQueryInterface({ rows: seed() });
    await migration.up({ context: qi });
    await migration.down({ context: qi });

    expect(qi.state.secretType).toBe("CHARACTER VARYING(128)");
    expect(qi.state.rows.map((r) => r.secret)).toEqual([
      "a".repeat(48),
      "b".repeat(48),
      "c".repeat(48),
      "d".repeat(64),
    ]);
  });

  it("down fails loudly if a row could not be decrypted back", async () => {
    const qi = fakeQueryInterface({ rows: seed() });
    await migration.up({ context: qi });
    const original = qi.sequelize.query;
    qi.sequelize.query = jest.fn(async (sql, opts) => {
      if (/^\s*UPDATE/.test(sql)) {
        return [[], { rowCount: 0 }];
      }
      return original(sql, opts);
    });
    await expect(migration.down({ context: qi })).rejects.toThrow(/0022/);
  });

  it("down does nothing when there is no webhooks table", async () => {
    const qi = fakeQueryInterface({ rows: [], tables: [] });
    await migration.down({ context: qi });
    expect(qi.changeColumn).not.toHaveBeenCalled();
  });
});
