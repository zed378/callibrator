/**
 * Migration 0030 — tenant and regulated-user foreign keys: NOT NULL and
 * ON DELETE RESTRICT (ADR-051 Q-16; A-88, A-122, W-20, F-6).
 *
 * Runs the migration against a fake catalog: a QueryInterface whose
 * `sequelize.query` answers the pg_constraint discovery from an in-memory list
 * of foreign keys, applies the DDL to it, and whose `transaction` rolls the
 * whole catalog back when the callback throws — as PostgreSQL does. It proves
 * the LOGIC: discovery by column not by name, the per-table action, NOT NULL
 * outside the nullable list, the refusal before any change, idempotence, and a
 * `down` that restores exactly what was there (duplicates and names included).
 *
 * The SQL itself was run on pgvector/pgvector:pg18 (18.6) against a database
 * built by the PRE-change models' sync() + migrations 0001–0029 with sample
 * data: after `up`, deleting a tenant with data and deleting the user who
 * performed a calibration are both refused by RESTRICT; a tenant holding only
 * a notification is deleted and the notification cascades; a second `up`
 * changes nothing; `down` returns the foreign-key catalog and column
 * nullability to the pre-0030 snapshot byte for byte; `up` over a NULL-tenant
 * certificate and a NULL-performer calibration refuses, naming both, and
 * changes nothing. A fresh database from the new models + migrations has the
 * same foreign keys as the migrated one.
 */
const fs = require("fs");
const path = require("path");

const migration = require("../../migrations/0030-tenant-foreign-keys-restrict");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "../../migrations/0030-tenant-foreign-keys-restrict.js"),
  "utf8",
);
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

const WORD = { r: "RESTRICT", c: "CASCADE", n: "SET NULL", a: "NO ACTION", d: "SET DEFAULT" };
const CODE = Object.fromEntries(Object.entries(WORD).map(([k, v]) => [v, k]));

/** What pg_get_constraintdef renders. */
const definitionOf = (fk) =>
  `FOREIGN KEY (${fk.column}) REFERENCES ${fk.ref}(id)` +
  (fk.upd !== "a" ? ` ON UPDATE ${WORD[fk.upd]}` : "") +
  (fk.del !== "a" ? ` ON DELETE ${WORD[fk.del]}` : "") +
  (fk.validated ? "" : " NOT VALID");

const fk = (table, column, del, { ref = "tenants", name, upd = "c", validated = true } = {}) => ({
  table,
  column,
  ref,
  name: name || `${table}_${column}_fkey`,
  del: CODE[del],
  upd,
  validated,
});

/** A catalog shaped like a database built by the pre-change models' sync(). */
const oldCatalog = () => ({
  fks: [
    fk("certificates", "tenant_id", "SET NULL"),
    fk("calibration_records", "tenant_id", "SET NULL"),
    fk("audit_logs", "tenant_id", "CASCADE"),
    fk("sessions", "tenant_id", "CASCADE"),
    fk("notifications", "tenant_id", "CASCADE"),
    fk("users", "tenant_id", "SET NULL"),
    fk("UsageMetrics", "tenantId", "CASCADE"),
    fk("signature_workflow_steps", "tenant_id", "CASCADE", { upd: "a" }),
    fk("calibration_records", "performed_by", "SET NULL", { ref: "users" }),
    fk("audit_logs", "user_id", "SET NULL", { ref: "users" }),
    fk("capas", "assigned_to", "SET NULL", { ref: "users" }), // not on the list
  ],
  notNull: new Set(["audit_logs.tenant_id", "UsageMetrics.tenantId", "signature_workflow_steps.tenant_id"]),
});

const clone = (state) => ({
  fks: state.fks.map((f) => ({ ...f })),
  notNull: new Set(state.notNull),
  stateTable: state.stateTable ? state.stateTable.map((r) => ({ ...r })) : null,
});

const fakeQueryInterface = (catalog = oldCatalog(), { nulls = {}, dangling = {} } = {}) => {
  const state = { ...clone(catalog), stateTable: null };
  const log = { ddl: [], queries: [] };

  const parseFk = (text) => {
    const m = /FOREIGN KEY \("?([^")]+)"?\) REFERENCES "?([^"( ]+)"? ?\("?id"?\)(.*)$/.exec(text);
    const del = /ON DELETE (RESTRICT|CASCADE|SET NULL|NO ACTION)/.exec(m[3]);
    const upd = /ON UPDATE (RESTRICT|CASCADE|SET NULL|NO ACTION)/.exec(m[3]);
    return {
      column: m[1],
      ref: m[2],
      del: del ? CODE[del[1]] : "a",
      upd: upd ? CODE[upd[1]] : "a",
      validated: !/NOT VALID/.test(m[3]),
    };
  };

  const query = jest.fn(async (sql, options = {}) => {
    log.queries.push({ sql, transaction: options.transaction });
    let m;
    if (/SET LOCAL lock_timeout/.test(sql)) {
      return [[]];
    }
    if (/FROM pg_constraint c/.test(sql)) {
      const refs = options.replacements.refs;
      const rows = state.fks
        .filter((f) => refs.includes(f.ref))
        .map((f) => ({
          table_name: f.table,
          column_name: f.column,
          ref_table: f.ref,
          name: f.name,
          definition: definitionOf(f),
          on_delete: f.del,
          on_update: f.upd,
          validated: f.validated,
          not_null: state.notNull.has(`${f.table}.${f.column}`),
        }))
        .sort((a, b) => `${a.table_name}.${a.column_name}.${a.name}`.localeCompare(`${b.table_name}.${b.column_name}.${b.name}`));
      return [rows];
    }
    if ((m = /FROM "([^"]+)" x\s+WHERE x\."([^"]+)" IS NULL/.exec(sql))) {
      return [[nulls[`${m[1]}.${m[2]}`] || { n: 0, sample: null }]];
    }
    if ((m = /FROM "([^"]+)" x\s+WHERE x\."([^"]+)" IS NOT NULL\s+AND NOT EXISTS/.exec(sql))) {
      return [[dangling[`${m[1]}.${m[2]}`] || { n: 0, sample: null }]];
    }
    if (/CREATE TABLE IF NOT EXISTS "migration_0030_previous_foreign_keys"/.test(sql)) {
      state.stateTable = state.stateTable || [];
      log.ddl.push("create state table");
      return [[]];
    }
    if (/INSERT INTO "migration_0030_previous_foreign_keys"/.test(sql)) {
      const r = options.replacements;
      const dup = state.stateTable.some(
        (x) => x.table_name === r.table && x.column_name === r.column && x.kind === r.kind && x.constraint_name === r.name,
      );
      if (!dup) {
        state.stateTable.push({
          table_name: r.table,
          column_name: r.column,
          kind: r.kind,
          constraint_name: r.name,
          ref_table: r.ref,
          definition: r.definition,
        });
      }
      return [[]];
    }
    if (/to_regclass/.test(sql)) {
      return [[{ present: Boolean(state.stateTable) }]];
    }
    if (/FROM "migration_0030_previous_foreign_keys"/.test(sql)) {
      return [[...state.stateTable]];
    }
    if (/^DROP TABLE "migration_0030_previous_foreign_keys"$/.test(sql)) {
      state.stateTable = null;
      log.ddl.push("drop state table");
      return [[]];
    }
    if ((m = /^ALTER TABLE "([^"]+)" DROP CONSTRAINT "([^"]+)"$/.exec(sql))) {
      state.fks = state.fks.filter((f) => !(f.table === m[1] && f.name === m[2]));
      log.ddl.push(`drop ${m[1]}.${m[2]}`);
      return [[]];
    }
    if ((m = /^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" (FOREIGN KEY .*)$/.exec(sql))) {
      state.fks.push({ table: m[1], name: m[2], ...parseFk(m[3]) });
      log.ddl.push(`add ${m[1]}.${m[2]} ${m[3]}`);
      return [[]];
    }
    if ((m = /^ALTER TABLE "([^"]+)" ALTER COLUMN "([^"]+)" (SET|DROP) NOT NULL$/.exec(sql))) {
      if (m[3] === "SET") {
        state.notNull.add(`${m[1]}.${m[2]}`);
      } else {
        state.notNull.delete(`${m[1]}.${m[2]}`);
      }
      log.ddl.push(`${m[3].toLowerCase()} not null ${m[1]}.${m[2]}`);
      return [[]];
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });

  const TX = { id: "tx" };
  const sequelize = {
    query,
    // PostgreSQL DDL is transactional: a throw rolls the whole catalog back.
    transaction: jest.fn(async (fn) => {
      const snapshot = clone(state);
      try {
        return await fn(TX);
      } catch (err) {
        Object.assign(state, clone(snapshot));
        throw err;
      }
    }),
  };
  return { qi: { sequelize }, state, log, TX };
};

const find = (state, table, column) => state.fks.filter((f) => f.table === table && f.column === column);
const catalogOf = (state) => ({
  fks: state.fks.map((f) => `${f.table}|${f.name}|${definitionOf(f)}`).sort(),
  notNull: [...state.notNull].sort(),
});

describe("migration 0030 — tenant and regulated-user foreign keys (Q-16)", () => {
  it("is registered in the static manifest under its frozen .js name, after 0029", () => {
    const line =
      '["0030-tenant-foreign-keys-restrict.js", require("../migrations/0030-tenant-foreign-keys-restrict")]';
    expect(MANIFEST).toContain(line);
    expect(MANIFEST.indexOf(line)).toBeGreaterThan(MANIFEST.indexOf("0029-audit-log-impersonator.js"));
  });

  it("discovers constraints by column from pg_constraint, never tenants.parent_id", () => {
    expect(SOURCE).toMatch(/c\.conrelid <> c\.confrelid/);
    expect(SOURCE).toMatch(/cardinality\(c\.conkey\) = 1/);
  });

  it("the allow-lists are the reviewed ones (a change here needs a new migration)", () => {
    expect([...migration.TENANT_FK_CASCADE].sort()).toEqual(
      [
        "UsageMetrics", "api_keys", "batch_jobs", "custom_domains", "document_chunks", "kanban_cards",
        "kanban_projects", "notifications", "plan_quotas", "qms_counters", "sessions", "ticket_counters",
        "usage_alerts", "webhook_deliveries", "webhooks",
      ].sort(),
    );
    expect(migration.TENANT_NULLABLE).toEqual(["users", "sessions", "data_retention_policies"]);
    for (const regulated of ["audit_logs", "certificates", "calibration_records", "e_signature_records",
      "signature_records", "signature_workflows", "users", "tenant_settings", "invoices"]) {
      expect(migration.tenantAction(regulated)).toBe("RESTRICT");
    }
  });

  describe("up on a database built by the old sync()", () => {
    it("tenant FKs: RESTRICT for regulated tables, CASCADE for the allow-list, all ON UPDATE CASCADE", async () => {
      const { qi, state } = fakeQueryInterface();
      await migration.up({ context: qi });

      for (const [table, action] of [
        ["certificates", "RESTRICT"],
        ["calibration_records", "RESTRICT"],
        ["audit_logs", "RESTRICT"], // W-20
        ["users", "RESTRICT"],
        ["signature_workflow_steps", "RESTRICT"],
        ["sessions", "CASCADE"],
        ["notifications", "CASCADE"],
      ]) {
        const column = "tenant_id";
        const [only, ...rest] = find(state, table, column);
        expect(rest).toEqual([]);
        expect(only).toMatchObject({ name: `${table}_${column}_fkey`, ref: "tenants", del: CODE[action], upd: "c" });
      }
      expect(find(state, "UsageMetrics", "tenantId")[0]).toMatchObject({ del: "c", upd: "c" });
    });

    it("NOT NULL on every tenant column except users, sessions, data_retention_policies", async () => {
      const { qi, state } = fakeQueryInterface();
      await migration.up({ context: qi });

      expect(state.notNull.has("certificates.tenant_id")).toBe(true);
      expect(state.notNull.has("calibration_records.tenant_id")).toBe(true);
      expect(state.notNull.has("notifications.tenant_id")).toBe(true);
      expect(state.notNull.has("users.tenant_id")).toBe(false);
      expect(state.notNull.has("sessions.tenant_id")).toBe(false);
    });

    it("user FKs on the list become RESTRICT (performed_by also NOT NULL, F-6); others are untouched", async () => {
      const { qi, state, log } = fakeQueryInterface();
      await migration.up({ context: qi });

      expect(find(state, "calibration_records", "performed_by")[0]).toMatchObject({ ref: "users", del: "r" });
      expect(state.notNull.has("calibration_records.performed_by")).toBe(true);
      expect(find(state, "audit_logs", "user_id")[0]).toMatchObject({ del: "r" });
      expect(state.notNull.has("audit_logs.user_id")).toBe(false); // system actor rows (Q-13)
      expect(find(state, "capas", "assigned_to")[0]).toMatchObject({ del: "n" });
      expect(log.ddl.some((d) => d.includes("capas.assigned_to") || d.includes("capas_assigned_to"))).toBe(false);
    });

    it("replaces duplicate and oddly-named constraints on one column with exactly one", async () => {
      const catalog = oldCatalog();
      catalog.fks.push(fk("certificates", "tenant_id", "CASCADE", { name: "certificates_tenant_id_fkey1" }));
      catalog.fks.push(fk("certificates", "tenant_id", "SET NULL", { name: "fk_by_hand" }));
      const { qi, state, log } = fakeQueryInterface(catalog);

      await migration.up({ context: qi });

      expect(find(state, "certificates", "tenant_id")).toEqual([
        expect.objectContaining({ name: "certificates_tenant_id_fkey", del: "r" }),
      ]);
      expect(log.ddl).toEqual(
        expect.arrayContaining([
          "drop certificates.certificates_tenant_id_fkey",
          "drop certificates.certificates_tenant_id_fkey1",
          "drop certificates.fk_by_hand",
        ]),
      );
    });

    it("runs inside ONE transaction with a lock_timeout, every statement on it", async () => {
      const { qi, log, TX } = fakeQueryInterface();
      await migration.up({ context: qi });

      expect(qi.sequelize.transaction).toHaveBeenCalledTimes(1);
      expect(log.queries[0].sql).toMatch(/^SET LOCAL lock_timeout = '\d+s'$/);
      expect(log.queries.every((q) => q.transaction === TX)).toBe(true);
    });

    it("records every dropped constraint verbatim and every column made NOT NULL", async () => {
      const { qi, state } = fakeQueryInterface();
      await migration.up({ context: qi });

      expect(state.stateTable).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            table_name: "audit_logs",
            column_name: "tenant_id",
            kind: "constraint",
            constraint_name: "audit_logs_tenant_id_fkey",
            definition: "FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE CASCADE ON DELETE CASCADE",
          }),
          expect.objectContaining({ table_name: "certificates", column_name: "tenant_id", kind: "nullable" }),
        ]),
      );
    });
  });

  describe("refuses rather than repairs", () => {
    it("names every column holding NULLs where NOT NULL is coming — before ANY change", async () => {
      const before = oldCatalog();
      const { qi, state, log } = fakeQueryInterface(before, {
        nulls: {
          "certificates.tenant_id": { n: 2, sample: ["c-1", "c-2"] },
          "calibration_records.performed_by": { n: 1, sample: ["r-9"] },
        },
      });

      const err = await migration.up({ context: qi }).catch((e) => e);

      expect(err.message).toMatch(/^Migration 0030 refused: 2 column\(s\)/);
      expect(err.message).toContain("certificates: 2 row(s) where tenant_id IS NULL — e.g. id c-1, c-2");
      expect(err.message).toContain("calibration_records: 1 row(s) where performed_by IS NULL — e.g. id r-9");
      expect(err.message).toMatch(/will not delete these rows or assign them/);
      expect(log.ddl).toEqual([]);
      expect(state.stateTable).toBeNull();
      expect(catalogOf(state)).toEqual(catalogOf({ ...before }));
    });

    it("does not check nullable-by-design tables (a tenant-less operator is not an orphan)", async () => {
      const { qi, log } = fakeQueryInterface(oldCatalog(), {
        nulls: { "users.tenant_id": { n: 1, sample: ["op"] }, "sessions.tenant_id": { n: 3, sample: [] } },
      });

      await migration.up({ context: qi });

      expect(log.queries.some((q) => /FROM "users" x\s+WHERE x\."tenant_id" IS NULL/.test(q.sql))).toBe(false);
      expect(log.ddl.length).toBeGreaterThan(0);
    });

    it("checks for dangling ids only where no validated FK vouches for them", async () => {
      const catalog = oldCatalog();
      catalog.fks = catalog.fks.map((f) =>
        f.table === "certificates" && f.column === "tenant_id" ? { ...f, validated: false } : f,
      );
      const { qi, log } = fakeQueryInterface(catalog, {
        dangling: { "certificates.tenant_id": { n: 1, sample: null } },
      });

      const err = await migration.up({ context: qi }).catch((e) => e);

      expect(err.message).toContain("certificates: 1 row(s) where tenant_id names no tenants row — e.g. id ");
      expect(log.queries.filter((q) => /NOT EXISTS/.test(q.sql))).toHaveLength(1);
    });

    it("summarises a long list", async () => {
      const catalog = { fks: [], notNull: new Set() };
      const nulls = {};
      for (let i = 0; i < 22; i++) {
        catalog.fks.push(fk(`t${String(i).padStart(2, "0")}`, "tenant_id", "SET NULL"));
        nulls[`t${String(i).padStart(2, "0")}.tenant_id`] = { n: 1, sample: [`id-${i}`] };
      }
      const { qi } = fakeQueryInterface(catalog, { nulls });

      const err = await migration.up({ context: qi }).catch((e) => e);

      expect(err.message).toContain("… and 2 more");
      expect(err.message.match(/row\(s\) where/g)).toHaveLength(20);
    });
  });

  describe("idempotent and reversible", () => {
    it("a second up changes nothing and keeps the first record", async () => {
      const { qi, state, log } = fakeQueryInterface();
      await migration.up({ context: qi });
      const ddl = log.ddl.length;
      const recorded = JSON.stringify(state.stateTable);

      await migration.up({ context: qi });

      expect(log.ddl).toHaveLength(ddl);
      expect(JSON.stringify(state.stateTable)).toBe(recorded);
    });

    it("a compliant (fresh) database: no DDL, no state table, and down has nothing to restore", async () => {
      const first = fakeQueryInterface();
      await migration.up({ context: first.qi });
      const fresh = { fks: first.state.fks, notNull: first.state.notNull };

      const { qi, state, log } = fakeQueryInterface(fresh);
      await migration.up({ context: qi });
      await migration.down({ context: qi });

      expect(log.ddl).toEqual([]);
      expect(state.stateTable).toBeNull();
    });

    it("down restores exactly the previous catalog — names, duplicates, actions, nullability", async () => {
      const before = oldCatalog();
      before.fks.push(fk("certificates", "tenant_id", "CASCADE", { name: "certificates_tenant_id_fkey1", upd: "a" }));
      const { qi, state, log } = fakeQueryInterface(before);

      await migration.up({ context: qi });
      await migration.down({ context: qi });

      expect(catalogOf(state)).toEqual(catalogOf(before));
      expect(state.stateTable).toBeNull();
      expect(log.ddl.at(-1)).toBe("drop state table");

      // a second down is a no-op
      const count = log.ddl.length;
      await migration.down({ context: qi });
      expect(log.ddl).toHaveLength(count);
    });

    it("up after down converges again", async () => {
      const { qi, state } = fakeQueryInterface();
      await migration.up({ context: qi });
      const migrated = catalogOf(state);
      await migration.down({ context: qi });

      await migration.up({ context: qi });

      expect(catalogOf(state)).toEqual(migrated);
    });
  });

  it("any failure propagates and rolls back — Umzug must not record it as applied", async () => {
    const { qi, state } = fakeQueryInterface();
    const before = catalogOf(state);
    const real = qi.sequelize.query.getMockImplementation();
    qi.sequelize.query.mockImplementation(async (sql, options) => {
      if (/ADD CONSTRAINT "calibration_records_tenant_id_fkey"/.test(sql)) {
        throw new Error("canceling statement due to lock timeout");
      }
      return real(sql, options);
    });

    await expect(migration.up({ context: qi })).rejects.toThrow("lock timeout");
    expect(catalogOf(state)).toEqual(before);
    expect(state.stateTable).toBeNull();
    expect(SOURCE).not.toMatch(/\bcatch\s*[({]/);
  });
});
