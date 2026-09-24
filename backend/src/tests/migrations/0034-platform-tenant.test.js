/**
 * Migration 0034 — the reserved PLATFORM tenant row (A-125, ADR-051 Q-14).
 *
 * Fake `sequelize.query` over an in-memory `tenants` table. Proves the logic:
 * insert when absent, leave a well-formed row alone, REFUSE a collision
 * rather than guess, refuse (not skip) a missing table, and a `down` that
 * refuses while audit rows reference the row. Verified on PostgreSQL 18 too.
 */
const fs = require("fs");
const path = require("path");
const migration = require("../../migrations/0034-platform-tenant");
const { PLATFORM_TENANT } = require("../../constants/platformTenant");

const SOURCE = fs.readFileSync(path.join(__dirname, "../../migrations/0034-platform-tenant.js"), "utf8");
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

const fakeContext = ({ table = true, rows = [], refs = { audit: 0, users: 0 } } = {}) => {
  const state = { rows: rows.map((r) => ({ ...r })), inserted: [], deleted: [] };
  const query = jest.fn(async (sql, { replacements } = {}) => {
    if (/to_regclass/.test(sql)) {return [[{ present: table }]];}
    if (/^\s*SELECT id, code, subdomain, deleted_at/.test(sql)) {
      return [
        state.rows.filter(
          (r) =>
            r.id === replacements.id || r.subdomain === replacements.subdomain || r.code === replacements.code,
        ),
      ];
    }
    if (/^\s*INSERT INTO tenants/.test(sql)) {
      state.inserted.push({ ...replacements });
      state.rows.push({ ...replacements, deleted_at: null });
      return [[]];
    }
    if (/count\(\*\) FROM audit_logs/.test(sql)) {return [[refs]];}
    if (/^DELETE FROM tenants/.test(sql)) {
      state.deleted.push(replacements.id);
      return [[]];
    }
    throw new Error(`unexpected: ${sql}`);
  });
  return { state, context: { sequelize: { query, transaction: async (fn) => fn({}) } } };
};

describe("migration 0034 — the PLATFORM tenant", () => {
  it("is registered in the static manifest under its frozen .js name, after 0033", () => {
    const line = '["0034-platform-tenant.js", require("../migrations/0034-platform-tenant")]';
    expect(MANIFEST).toContain(line);
    expect(MANIFEST.indexOf(line)).toBeGreaterThan(MANIFEST.indexOf("0033-audit-log-actor.js"));
  });

  it("has no try/catch", () => {
    expect(SOURCE).not.toMatch(/\btry\s*\{/);
  });

  it("inserts the PLATFORM row when absent, with the fixed id and reserved code", async () => {
    const { state, context } = fakeContext({ rows: [{ id: "h-1", code: "HOSP", subdomain: "hosp", deleted_at: null }] });

    await migration.up({ context });

    expect(state.inserted).toEqual([expect.objectContaining({ ...PLATFORM_TENANT })]);
  });

  it("leaves a present, well-formed PLATFORM row alone (a second run, or the seed got there first)", async () => {
    const { state, context } = fakeContext({ rows: [{ ...PLATFORM_TENANT, deleted_at: null }] });

    await migration.up({ context });

    expect(state.inserted).toEqual([]);
  });

  it.each([
    ["the reserved code", { id: "x-1", code: "PLATFORM", subdomain: "other" }],
    ["the reserved subdomain", { id: "x-1", code: "OTHER", subdomain: PLATFORM_TENANT.subdomain }],
  ])("REFUSES when another tenant already uses %s", async (_label, row) => {
    const { state, context } = fakeContext({ rows: [{ ...row, deleted_at: null }] });

    await expect(migration.up({ context })).rejects.toThrow(/already used by tenant x-1/);
    expect(state.inserted).toEqual([]);
  });

  it.each([
    ["another code", { ...PLATFORM_TENANT, code: "IMPOSTOR", deleted_at: null }],
    ["a soft-deleted row", { ...PLATFORM_TENANT, deleted_at: new Date("2026-01-01") }],
  ])("REFUSES a row that holds the reserved id but is not the PLATFORM tenant: %s", async (_label, row) => {
    const { context } = fakeContext({ rows: [row] });

    await expect(migration.up({ context })).rejects.toThrow(/Refusing to overwrite/);
  });

  it("REFUSES a missing tenants table instead of skipping", async () => {
    const { context } = fakeContext({ table: false });

    await expect(migration.up({ context })).rejects.toThrow(/tenants" does not exist/);
  });

  it("down deletes an unreferenced PLATFORM row", async () => {
    const { state, context } = fakeContext();

    await migration.down({ context });

    expect(state.deleted).toEqual([PLATFORM_TENANT.id]);
  });

  it("down REFUSES while audit rows reference it — audit rows are permanent", async () => {
    const { state, context } = fakeContext({ refs: { audit: 3, users: 0 } });

    await expect(migration.down({ context })).rejects.toThrow(/referenced by 3 audit row/);
    expect(state.deleted).toEqual([]);
  });

  it("down without the table does nothing", async () => {
    const { state, context } = fakeContext({ table: false });

    await migration.down({ context });

    expect(state.deleted).toEqual([]);
  });
});
