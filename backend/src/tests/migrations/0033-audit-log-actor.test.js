/**
 * Migration 0033 — audit_logs.actor_type / actor_name (A-124, ADR-051 Q-13).
 *
 * Runs the migration against a fake `sequelize.query` that answers the
 * catalog queries from an in-memory table state and records every statement.
 * It proves the LOGIC: the backfill statements and their order, the CHECK,
 * refusal of a mismatched type, refusal (not a skip) of a missing table,
 * idempotence and reversibility. It does not prove the DDL runs on
 * PostgreSQL — that was verified on pgvector/pgvector:pg18 (\d audit_logs,
 * backfill counts, CHECK probes), recorded in the A-124 change record.
 */
const fs = require("fs");
const path = require("path");
const migration = require("../../migrations/0033-audit-log-actor");

const SOURCE = fs.readFileSync(path.join(__dirname, "../../migrations/0033-audit-log-actor.js"), "utf8");
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

const fakeContext = ({
  table = true,
  labels = null,
  columns = { user_id: "YES", changes: "YES", created_at: "NO" },
  constraint = false,
  index = false,
} = {}) => {
  const state = { table, labels, columns: { ...columns }, constraint, index, statements: [] };
  const query = jest.fn(async (sql) => {
    state.statements.push(sql.replace(/\s+/g, " ").trim());
    if (/to_regclass.*:table/.test(sql)) {return [[{ present: state.table }]];}
    if (/to_regclass.*:index/.test(sql)) {return [[{ present: state.index }]];}
    if (/FROM pg_type/.test(sql)) {return [(state.labels || []).map((label) => ({ label }))];}
    if (/information_schema\.columns/.test(sql)) {
      return [Object.entries(state.columns).map(([column_name, is_nullable]) => ({ column_name, is_nullable }))];
    }
    if (/FROM pg_constraint/.test(sql)) {return [[{ n: state.constraint ? 1 : 0 }]];}
    if (/to_char\(now\(\)/.test(sql)) {return [[{ cutoff: "2026-09-24T00:00:00.000000Z" }]];}
    if (/^CREATE TYPE/.test(sql)) {state.labels = [...migration.ACTOR_TYPES];}
    if (/ADD COLUMN actor_type/.test(sql)) {state.columns.actor_type = "YES";}
    if (/ADD COLUMN actor_name/.test(sql)) {state.columns.actor_name = "YES";}
    if (/SET NOT NULL/.test(sql)) {state.columns.actor_type = "NO";}
    if (/ADD CONSTRAINT/.test(sql)) {state.constraint = true;}
    if (/^CREATE INDEX/.test(sql)) {state.index = true;}
    return [[]];
  });
  const sequelize = { query, transaction: async (fn) => fn({ id: "tx" }) };
  return { state, context: { sequelize } };
};

const ran = (state, re) => state.statements.filter((s) => re.test(s));

describe("migration 0033 — audit_logs actor columns", () => {
  it("is registered in the static manifest under its frozen .js name, after 0032", () => {
    const line = '["0033-audit-log-actor.js", require("../migrations/0033-audit-log-actor")]';
    expect(MANIFEST).toContain(line);
    expect(MANIFEST.indexOf(line)).toBeGreaterThan(MANIFEST.indexOf("0032-"));
  });

  it("has no try/catch — a failure must fail the migration, never be recorded as applied", () => {
    expect(SOURCE).not.toMatch(/\btry\s*\{/);
    expect(SOURCE).not.toMatch(/\.catch\(/);
  });

  it("on a pre-0033 table: creates the type and columns, backfills honestly, then NOT NULL, CHECK, index", async () => {
    const { state, context } = fakeContext();

    await migration.up({ context });

    const order = [
      /^LOCK TABLE audit_logs/,
      /^CREATE TYPE enum_audit_logs_actor_type AS ENUM \('user', 'system', 'unknown'\)/,
      /ADD COLUMN actor_type enum_audit_logs_actor_type$/,
      /ADD COLUMN actor_name VARCHAR\(100\)/,
      /SET actor_type = 'user'.*WHERE actor_type IS NULL AND user_id IS NOT NULL/,
      /SET actor_type = 'system', actor_name = changes->>'actor'.*user_id IS NULL.*LIKE 'system:%'/,
      /SET actor_type = 'unknown', actor_name = NULL WHERE actor_type IS NULL$/,
      /ALTER COLUMN actor_type SET NOT NULL/,
      /ADD CONSTRAINT audit_logs_actor_check CHECK/,
      /^CREATE INDEX audit_logs_actor_type_actor_name ON audit_logs \(actor_type, actor_name\)/,
    ];
    const positions = order.map((re) => state.statements.findIndex((s) => re.test(s)));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // No DEFAULT: an insert that names no actor must fail.
    expect(state.statements.join("\n")).not.toMatch(/DEFAULT/);
  });

  it("the CHECK ties the columns together and dates 'unknown' to the migration's own clock", () => {
    const expr = migration.checkExpression("2026-09-24T00:00:00.000000Z");
    expect(expr).toContain("actor_type = 'user' AND user_id IS NOT NULL AND actor_name IS NULL");
    expect(expr).toContain("actor_type = 'system' AND user_id IS NULL AND actor_name LIKE 'system:%'");
    expect(expr).toContain(
      "actor_type = 'unknown' AND user_id IS NULL AND actor_name IS NULL AND created_at <= '2026-09-24T00:00:00.000000Z'::timestamptz",
    );
  });

  it("is idempotent — a second run (or a db.sync()'d table) changes nothing", async () => {
    const { state, context } = fakeContext({
      labels: [...migration.ACTOR_TYPES],
      columns: { user_id: "YES", actor_type: "NO", actor_name: "YES" },
      constraint: true,
      index: true,
    });

    await migration.up({ context });

    expect(ran(state, /^(CREATE|ALTER TABLE audit_logs (ADD|ALTER))/)).toEqual([]);
    // The backfill UPDATEs only touch rows still NULL — none after the first run.
    expect(ran(state, /^UPDATE/).every((s) => s.includes("actor_type IS NULL"))).toBe(true);
  });

  it("REFUSES a missing table instead of skipping (a skip would be recorded as applied without the CHECK)", async () => {
    const { state, context } = fakeContext({ table: false });

    await expect(migration.up({ context })).rejects.toThrow(/audit_logs" does not exist/);
    expect(ran(state, /^(CREATE|ALTER|UPDATE)/)).toEqual([]);
  });

  it("REFUSES an existing type with other labels", async () => {
    const { state, context } = fakeContext({ labels: ["user", "system", "api_key"] });

    await expect(migration.up({ context })).rejects.toThrow(/Refusing to guess/);
    expect(ran(state, /^(ALTER|UPDATE)/)).toEqual([]);
  });

  it("down drops the constraint, index, columns and type", async () => {
    const { state, context } = fakeContext();

    await migration.down({ context });

    expect(ran(state, /DROP CONSTRAINT IF EXISTS audit_logs_actor_check/)).toHaveLength(1);
    expect(ran(state, /DROP INDEX IF EXISTS audit_logs_actor_type_actor_name/)).toHaveLength(1);
    expect(ran(state, /DROP COLUMN IF EXISTS actor_name/)).toHaveLength(1);
    expect(ran(state, /DROP COLUMN IF EXISTS actor_type/)).toHaveLength(1);
    expect(ran(state, /DROP TYPE IF EXISTS enum_audit_logs_actor_type/)).toHaveLength(1);
  });

  it("down on a database without the table does nothing", async () => {
    const { state, context } = fakeContext({ table: false });

    await migration.down({ context });

    expect(ran(state, /DROP/)).toEqual([]);
  });
});
