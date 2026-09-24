/**
 * Migration 0047 — drop `data_retention_policies` (A-137, ADR-051 Q-10).
 *
 * Runs the migration against a fake QueryInterface. It proves the LOGIC: the
 * table is dropped only when empty, under a lock, inside one transaction; a
 * row refuses the migration naming the count and the tenant, and drops
 * nothing; a missing table is a no-op; a real failure propagates (0008/0013/
 * 0014); `down` recreates the table only when absent. It does not prove the
 * DDL runs on PostgreSQL — that was checked on PostgreSQL 18.6 (A-137 in
 * TASKS/AUDIT-2026-09-REMEDIATION.md).
 *
 * It also pins the removal of the model: nothing may bring the table back
 * through db.sync().
 */
const fs = require("fs");
const path = require("path");

const migration = require("../../migrations/0047-drop-data-retention-policies");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "../../migrations/0047-drop-data-retention-policies.js"),
  "utf8",
);
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");
const MODELS_DIR = path.join(__dirname, "../../models");

const TENANT = "7b0e8f7e-6a54-4a7c-9d6b-3d1f0f6b8a11";

const fakeQueryInterface = ({ present = true, groups = [], failOn = null } = {}) => {
  const state = { present, queries: [], transactions: 0 };
  const TX = { id: "tx" };
  const qi = {
    state,
    showAllTables: jest.fn(async (options) => {
      expect(options).toEqual({ transaction: TX });
      return state.present ? ["tenants", { tableName: "DATA_RETENTION_POLICIES" }] : ["tenants"];
    }),
    sequelize: {
      transaction: jest.fn(async (cb) => {
        state.transactions += 1;
        return cb(TX);
      }),
      query: jest.fn(async (sql, options) => {
        expect(options).toEqual({ transaction: TX });
        state.queries.push(sql);
        if (failOn && failOn.test(sql)) {throw new Error("connection reset");}
        if (/^SELECT tenant_id, COUNT/.test(sql)) {return [groups, groups.length];}
        if (/^DROP TABLE/.test(sql)) {state.present = false;}
        if (/^CREATE TABLE/.test(sql)) {state.present = true;}
        return [[], 0];
      }),
    },
  };
  return qi;
};

describe("migration 0047 — drop data_retention_policies (A-137)", () => {
  it("is registered in the static manifest under its frozen .js name", () => {
    expect(MANIFEST).toContain(
      '["0047-drop-data-retention-policies.js", require("../migrations/0047-drop-data-retention-policies")]',
    );
  });

  it("has no try/catch to swallow a failure", () => {
    expect(SOURCE).not.toMatch(/\btry\s*\{/);
    expect(SOURCE).not.toMatch(/\.catch\(/);
  });

  describe("up", () => {
    it("on an empty table: locks, counts, then drops — in one transaction, without CASCADE", async () => {
      const qi = fakeQueryInterface();

      await migration.up({ context: qi });

      expect(qi.state.transactions).toBe(1);
      expect(qi.state.queries).toEqual([
        "LOCK TABLE data_retention_policies IN ACCESS EXCLUSIVE MODE",
        expect.stringMatching(/^SELECT tenant_id, COUNT\(\*\)::int AS n FROM data_retention_policies GROUP BY tenant_id/),
        "DROP TABLE data_retention_policies",
      ]);
      expect(qi.state.present).toBe(false);
    });

    it("REFUSES when a row exists, naming the count and tenants, and drops nothing", async () => {
      const qi = fakeQueryInterface({
        groups: [
          { tenant_id: TENANT, n: 2 },
          { tenant_id: null, n: 1 },
        ],
      });

      const run = migration.up({ context: qi });

      await expect(run).rejects.toThrow(/Migration 0047 refused: data_retention_policies has 3 row\(s\)/);
      await expect(run).rejects.toThrow(new RegExp(`tenant ${TENANT}: 2 row\\(s\\)`));
      await expect(run).rejects.toThrow(/tenant \(none — a global row\): 1 row\(s\)/);
      expect(qi.state.queries.some((sql) => /DROP/.test(sql))).toBe(false);
      expect(qi.state.present).toBe(true);
    });

    it("summarises beyond 20 tenants in the refusal", async () => {
      const groups = Array.from({ length: 23 }, (_, i) => ({ tenant_id: `t-${i}`, n: "1" }));
      const qi = fakeQueryInterface({ groups });

      await expect(migration.up({ context: qi })).rejects.toThrow(
        /has 23 row\(s\)[\s\S]*tenant t-19: 1 row\(s\)\n {2}… and 3 more tenant\(s\)/,
      );
    });

    it("is a no-op when the table is absent (fresh install, or a second run)", async () => {
      const qi = fakeQueryInterface({ present: false });

      await migration.up({ context: qi });

      expect(qi.state.queries).toEqual([]);
    });

    it("is idempotent: a second run after a drop does nothing", async () => {
      const qi = fakeQueryInterface();

      await migration.up({ context: qi });
      await migration.up({ context: qi });

      expect(qi.state.queries.filter((sql) => /^DROP/.test(sql))).toHaveLength(1);
    });

    it("propagates a real failure instead of recording itself as applied", async () => {
      const qi = fakeQueryInterface({ failOn: /^LOCK/ });

      await expect(migration.up({ context: qi })).rejects.toThrow("connection reset");
      expect(qi.state.present).toBe(true);
    });
  });

  describe("down", () => {
    it("recreates the table sync() built: columns, defaults, PK, both indexes, the RESTRICT tenant FK", async () => {
      const qi = fakeQueryInterface({ present: false });

      await migration.down({ context: qi });

      expect(qi.state.transactions).toBe(1);
      expect(qi.state.queries).toEqual(migration.CREATE_SQL);
      const [create, ...indexes] = qi.state.queries;
      const normalized = create.replace(/\s+/g, " ");
      for (const column of [
        "id uuid NOT NULL",
        "tenant_id uuid,", // nullable, as 0030 left it
        "entity_type character varying(100) NOT NULL",
        "retention_days integer DEFAULT 365 NOT NULL",
        "is_active boolean DEFAULT true NOT NULL",
        "created_at timestamp with time zone NOT NULL",
        "updated_at timestamp with time zone NOT NULL",
      ]) {
        expect(normalized).toContain(column);
      }
      expect(normalized).toContain("CONSTRAINT data_retention_policies_pkey PRIMARY KEY (id)");
      expect(normalized).toContain(
        "CONSTRAINT data_retention_policies_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE CASCADE ON DELETE RESTRICT",
      );
      expect(indexes).toEqual([
        "CREATE INDEX data_retention_policies_tenant_id ON data_retention_policies USING btree (tenant_id)",
        "CREATE INDEX data_retention_policies_is_active ON data_retention_policies USING btree (is_active)",
      ]);
    });

    it("is a no-op when the table already exists", async () => {
      const qi = fakeQueryInterface({ present: true });

      await migration.down({ context: qi });

      expect(qi.state.queries).toEqual([]);
    });

    it("round-trips: up, down, up", async () => {
      const qi = fakeQueryInterface();

      await migration.up({ context: qi });
      await migration.down({ context: qi });
      expect(qi.state.present).toBe(true);
      await migration.up({ context: qi });
      expect(qi.state.present).toBe(false);
    });
  });

  describe("the model is gone, so db.sync() cannot recreate the table", () => {
    it("no model file defines data_retention_policies", () => {
      expect(fs.existsSync(path.join(MODELS_DIR, "dataRetentionPolicy.model.js"))).toBe(false);
      for (const file of fs.readdirSync(MODELS_DIR)) {
        const text = fs.readFileSync(path.join(MODELS_DIR, file), "utf8");
        expect(`${file}: ${/data_retention_policies|DataRetentionPolic/.test(text)}`).toBe(
          `${file}: false`,
        );
      }
    });
  });
});
