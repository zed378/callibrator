/**
 * Migration 0037 — every other association foreign key (A-148, A-149).
 *
 * Runs the migration against a fake catalog, as the 0030 test does: a
 * QueryInterface whose `sequelize.query` answers the pg_constraint and
 * pg_attribute discovery from an in-memory catalog, applies the DDL to it, and
 * whose `transaction` rolls the whole catalog back when the callback throws —
 * as PostgreSQL does. It proves the LOGIC: discovery by column, the per-column
 * decision, NOT NULL exactly where the model declares it, the A-149 keys added
 * from nothing, the refusal before any change, idempotence, and a `down` that
 * restores exactly what was there.
 *
 * The starting catalog is the one PostgreSQL 18 reported for a database built
 * by the pre-change models' sync() + migrations 0001–0034: every A-148 column
 * nullable, SET NULL except the join rows (CASCADE), no key on the two A-149
 * columns. The SQL itself was run there (pgvector/pgvector:pg18): see the
 * header of tests/models/associationForeignKeys.a148.test.js.
 */
const fs = require("fs");
const path = require("path");

const migration = require("../../migrations/0037-association-foreign-keys");

const { TARGETS, STATE_TABLE, fkName } = migration;
const SOURCE = fs.readFileSync(path.join(__dirname, "../../migrations/0037-association-foreign-keys.js"), "utf8");
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

const WORD = { r: "RESTRICT", c: "CASCADE", n: "SET NULL", a: "NO ACTION" };
const CODE = Object.fromEntries(Object.entries(WORD).map(([k, v]) => [v, k]));
const key = (table, column) => `${table}.${column}`;

/** Columns that were CASCADE on a database built by the old sync(). */
const CASCADE_TODAY = new Set([
  "asset_finances.device_id",
  "kanban_card_assignees.card_id",
  "kanban_card_assignees.user_id",
  "kanban_card_labels.card_id",
  "kanban_card_labels.label_id",
  "kanban_project_members.project_id",
  "kanban_sprints.project_id",
  "role_menu_permissions.role_id",
  "role_menu_permissions.menu_group_id",
  "ticket_comments.ticket_id",
  "user_menu_permissions.user_id",
  "user_menu_permissions.menu_group_id",
]);
const A149 = new Set(["signature_records.revoked_by", "signature_workflow_steps.signer_id"]);

/** What pg_get_constraintdef renders. */
const definitionOf = (f) =>
  `FOREIGN KEY (${f.column}) REFERENCES ${f.ref}(id)` +
  (f.upd !== "a" ? ` ON UPDATE ${WORD[f.upd]}` : "") +
  (f.del !== "a" ? ` ON DELETE ${WORD[f.del]}` : "") +
  (f.validated ? "" : " NOT VALID");

const fk = (table, column, ref, del, { name, upd = "c", validated = true } = {}) => ({
  table,
  column,
  ref,
  name: name || `${table}_${column}_fkey`,
  del: CODE[del],
  upd,
  validated,
});

/** The catalog of a database built by the pre-change models (PostgreSQL 18). */
const oldCatalog = () => ({
  fks: TARGETS.filter((t) => !A149.has(key(t.table, t.column))).map((t) =>
    fk(t.table, t.column, t.ref, CASCADE_TODAY.has(key(t.table, t.column)) ? "CASCADE" : "SET NULL"),
  ),
  columns: new Set(TARGETS.map((t) => key(t.table, t.column))),
  notNull: new Set(),
});

/** The catalog a fresh sync() of the corrected models builds. */
const freshCatalog = () => ({
  fks: TARGETS.map((t) => fk(t.table, t.column, t.ref, t.action)),
  columns: new Set(TARGETS.map((t) => key(t.table, t.column))),
  notNull: new Set(TARGETS.filter((t) => t.notNull).map((t) => key(t.table, t.column))),
});

const clone = (s) => ({
  fks: s.fks.map((f) => ({ ...f })),
  columns: new Set(s.columns),
  notNull: new Set(s.notNull),
  stateTable: s.stateTable ? s.stateTable.map((r) => ({ ...r })) : null,
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
      const keys = options.replacements.keys;
      const rows = state.fks
        .filter((f) => keys.includes(key(f.table, f.column)))
        .map((f) => ({
          table_name: f.table,
          column_name: f.column,
          ref_table: f.ref,
          name: f.name,
          definition: definitionOf(f),
          on_delete: f.del,
          on_update: f.upd,
          validated: f.validated,
        }));
      return [rows];
    }
    if (/FROM pg_attribute a/.test(sql)) {
      const keys = options.replacements.keys;
      const rows = [...state.columns]
        .filter((k) => keys.includes(k))
        .map((k) => {
          const [table_name, column_name] = k.split(".");
          return { table_name, column_name, not_null: state.notNull.has(k) };
        });
      return [rows];
    }
    if ((m = /FROM "([^"]+)" r\s+WHERE r\."([^"]+)" IS NULL/.exec(sql))) {
      return [[nulls[key(m[1], m[2])] || { n: 0, sample: null }]];
    }
    if ((m = /FROM "([^"]+)" r\s+WHERE r\."([^"]+)" IS NOT NULL\s+AND NOT EXISTS/.exec(sql))) {
      return [[dangling[key(m[1], m[2])] || { n: 0, sample: null }]];
    }
    if (sql.includes(`CREATE TABLE IF NOT EXISTS "${STATE_TABLE}"`)) {
      state.stateTable = state.stateTable || [];
      log.ddl.push("create state table");
      return [[]];
    }
    if (sql.includes(`INSERT INTO "${STATE_TABLE}"`)) {
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
          definition: r.definition,
        });
      }
      return [[]];
    }
    if (/to_regclass/.test(sql)) {
      return [[{ present: Boolean(state.stateTable) }]];
    }
    if (sql.includes(`FROM "${STATE_TABLE}"`)) {
      return [[...state.stateTable]];
    }
    if (sql === `DROP TABLE "${STATE_TABLE}"`) {
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
      log.ddl.push(`add ${m[1]}.${m[2]}`);
      return [[]];
    }
    if ((m = /^ALTER TABLE "([^"]+)" ALTER COLUMN "([^"]+)" (SET|DROP) NOT NULL$/.exec(sql))) {
      if (m[3] === "SET") {
        state.notNull.add(key(m[1], m[2]));
      } else {
        state.notNull.delete(key(m[1], m[2]));
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
const catalogOf = (s) => ({
  fks: s.fks.map((f) => `${f.table}|${f.name}|${definitionOf(f)}`).sort(),
  notNull: [...s.notNull].sort(),
});
const target = (table, column) => TARGETS.find((t) => t.table === table && t.column === column);

describe("migration 0037 — association foreign keys (A-148, A-149)", () => {
  it("is registered in the static manifest under its frozen .js name, after 0036", () => {
    const line = '["0037-association-foreign-keys.js", require("../migrations/0037-association-foreign-keys")]';
    expect(MANIFEST).toContain(line);
    expect(MANIFEST.indexOf(line)).toBeGreaterThan(MANIFEST.indexOf("0036-flag-never-signed-in-admin-passwords.js"));
  });

  it("has no try/catch: every failure propagates (CLAUDE.md)", () => {
    expect(SOURCE).not.toMatch(/\btry\s*\{/);
    expect(SOURCE).not.toMatch(/\.catch\(/);
  });

  describe("the reviewed decisions", () => {
    it("covers the 64 A-148 columns and the 2 A-149 columns, each once", () => {
      expect(TARGETS).toHaveLength(66);
      expect(new Set(TARGETS.map((t) => key(t.table, t.column))).size).toBe(66);
      for (const k of A149) {
        const [table, column] = k.split(".");
        expect(target(table, column)).toMatchObject({ ref: "users", action: "RESTRICT", notNull: false });
      }
    });

    it("never pairs NOT NULL with SET NULL (the action would violate the column)", () => {
      expect(TARGETS.filter((t) => t.notNull && t.action === "SET NULL")).toEqual([]);
    });

    it("uses only RESTRICT, CASCADE and SET NULL, each with a reason", () => {
      for (const t of TARGETS) {
        expect(["RESTRICT", "CASCADE", "SET NULL"]).toContain(t.action);
        expect(t.reason.length).toBeGreaterThan(5);
      }
    });

    it("regulated links are RESTRICT, not the CASCADE the models used to declare", () => {
      for (const [table, column] of [
        ["calibration_records", "device_id"],
        ["certificates", "device_id"],
        ["certificates", "calibration_record_id"],
        ["capas", "nc_id"],
        ["signature_records", "workflow_id"],
        ["signature_workflow_steps", "workflow_id"],
        ["sop_training_acknowledgments", "document_id"],
        ["consent_records", "user_id"],
        ["dsar_requests", "user_id"],
      ]) {
        expect(target(table, column).action).toBe("RESTRICT");
      }
    });
  });

  describe("up on a database built by the old sync()", () => {
    it("leaves every TARGETS column with exactly one foreign key: the decision, ON UPDATE CASCADE", async () => {
      const { qi, state } = fakeQueryInterface();
      await migration.up({ context: qi });

      for (const t of TARGETS) {
        expect(find(state, t.table, t.column)).toEqual([
          expect.objectContaining({ name: fkName(t.table, t.column), ref: t.ref, del: CODE[t.action], upd: "c" }),
        ]);
        expect(state.notNull.has(key(t.table, t.column))).toBe(t.notNull);
      }
    });

    it("converges to exactly what a fresh sync() of the corrected models builds", async () => {
      const { qi, state } = fakeQueryInterface();
      await migration.up({ context: qi });

      expect(catalogOf(state)).toEqual(catalogOf(freshCatalog()));
    });

    it("does not touch a key whose action is already right; only makes it NOT NULL where due", async () => {
      const { qi, log } = fakeQueryInterface();
      await migration.up({ context: qi });

      // Nullable and SET NULL today and in the decision: nothing at all.
      expect(log.ddl.filter((d) => d.includes("capas.capas_assigned_to") || d.includes("capas.assigned_to"))).toEqual([]);
      // CASCADE today and in the decision, NOT NULL now: only the column.
      expect(log.ddl.filter((d) => d.includes("asset_finances") && d.includes("device_id"))).toEqual([
        "set not null asset_finances.device_id",
      ]);
    });

    it("A-149: adds the foreign key where there was none, and records that it did", async () => {
      const { qi, state } = fakeQueryInterface();
      await migration.up({ context: qi });

      expect(find(state, "signature_workflow_steps", "signer_id")[0]).toMatchObject({ ref: "users", del: "r" });
      expect(find(state, "signature_records", "revoked_by")[0]).toMatchObject({ ref: "users", del: "r" });
      expect(state.stateTable).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ table_name: "signature_records", column_name: "revoked_by", kind: "replaced" }),
        ]),
      );
      expect(state.notNull.has("signature_workflow_steps.signer_id")).toBe(false);
    });

    it("replaces duplicate, oddly-named, wrongly-targeted and NOT VALID constraints with exactly one", async () => {
      const catalog = oldCatalog();
      catalog.fks.push(fk("calibration_records", "device_id", "calibration_devices", "CASCADE", { name: "by_hand" }));
      catalog.fks.push(fk("certificates", "device_id", "warehouses", "RESTRICT", { name: "wrong_ref" }));
      catalog.fks = catalog.fks.filter((f) => !(f.table === "certificates" && f.name === "certificates_device_id_fkey"));
      catalog.fks.push(fk("capas", "nc_id", "non_conformances", "RESTRICT", { validated: false }));
      catalog.fks = catalog.fks.filter((f) => !(f.table === "capas" && f.del === "n" && f.column === "nc_id"));
      const { qi, state, log } = fakeQueryInterface(catalog);

      await migration.up({ context: qi });

      expect(find(state, "calibration_records", "device_id")).toEqual([
        expect.objectContaining({ name: "calibration_records_device_id_fkey", del: "r" }),
      ]);
      expect(find(state, "certificates", "device_id")).toEqual([
        expect.objectContaining({ ref: "calibration_devices", del: "r" }),
      ]);
      expect(find(state, "capas", "nc_id")).toEqual([expect.objectContaining({ del: "r", validated: true })]);
      expect(log.ddl).toEqual(expect.arrayContaining(["drop calibration_records.by_hand", "drop certificates.wrong_ref"]));
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
            table_name: "calibration_records",
            column_name: "device_id",
            kind: "constraint",
            constraint_name: "calibration_records_device_id_fkey",
            definition:
              "FOREIGN KEY (device_id) REFERENCES calibration_devices(id) ON UPDATE CASCADE ON DELETE SET NULL",
          }),
          expect.objectContaining({ table_name: "calibration_records", column_name: "device_id", kind: "nullable" }),
        ]),
      );
    });
  });

  describe("on a database already right", () => {
    it("a fresh database from the corrected models: nothing changes, nothing is recorded", async () => {
      const { qi, state, log } = fakeQueryInterface(freshCatalog());
      await migration.up({ context: qi });

      expect(log.ddl).toEqual([]);
      expect(state.stateTable).toBeNull();
    });

    it("down after that is a no-op", async () => {
      const { qi, log } = fakeQueryInterface(freshCatalog());
      await migration.down({ context: qi });

      expect(log.ddl).toEqual([]);
      expect(log.queries.map((q) => q.sql).join("\n")).not.toMatch(/lock_timeout/);
    });
  });

  describe("refuses rather than repairs", () => {
    it("names every column holding NULLs where NOT NULL is coming — before ANY change", async () => {
      const before = oldCatalog();
      const { qi, state, log } = fakeQueryInterface(before, {
        nulls: {
          "calibration_records.device_id": { n: 2, sample: ["r-1", "r-2"] },
          "capas.nc_id": { n: 1, sample: null },
        },
      });

      const err = await migration.up({ context: qi }).catch((e) => e);

      expect(err.message).toMatch(/^Migration 0037 refused: 2 column\(s\)/);
      expect(err.message).toContain("calibration_records: 2 row(s) where device_id IS NULL — e.g. id r-1, r-2");
      expect(err.message).toContain("capas: 1 row(s) where nc_id IS NULL — e.g. id ");
      expect(err.message).toMatch(/will not delete these rows or point them at another row/);
      expect(log.ddl).toEqual([]);
      expect(state.stateTable).toBeNull();
      expect(catalogOf(state)).toEqual(catalogOf(before));
    });

    it("never checks a column that stays nullable for NULLs (NULL is allowed there)", async () => {
      const { qi, log } = fakeQueryInterface(oldCatalog(), {
        nulls: { "capas.assigned_to": { n: 5, sample: [] } },
      });

      await migration.up({ context: qi });

      expect(log.queries.some((q) => /FROM "capas" r\s+WHERE r\."assigned_to" IS NULL/.test(q.sql))).toBe(false);
    });

    it("A-149: refuses on a signer or revoker id that names no user", async () => {
      const { qi, log } = fakeQueryInterface(oldCatalog(), {
        dangling: {
          "signature_workflow_steps.signer_id": { n: 1, sample: ["s-1"] },
          "signature_records.revoked_by": { n: 3, sample: null },
        },
      });

      const err = await migration.up({ context: qi }).catch((e) => e);

      expect(err.message).toContain("signature_workflow_steps: 1 row(s) where signer_id names no users row — e.g. id s-1");
      expect(err.message).toContain("signature_records: 3 row(s) where revoked_by names no users row — e.g. id ");
      expect(log.ddl).toEqual([]);
    });

    it("checks for dangling ids only where no validated key to the right table vouches for them", async () => {
      const { qi, log } = fakeQueryInterface();
      await migration.up({ context: qi });

      const checked = log.queries
        .filter((q) => /AND NOT EXISTS/.test(q.sql))
        .map((q) => /FROM "([^"]+)" r\s+WHERE r\."([^"]+)"/.exec(q.sql).slice(1).join("."));
      expect(checked.sort()).toEqual([...A149].sort());
    });

    it("refuses when a column it must constrain does not exist — never a silent skip", async () => {
      const catalog = oldCatalog();
      catalog.columns.delete("signature_records.revoked_by");
      const { qi, log } = fakeQueryInterface(catalog);

      const err = await migration.up({ context: qi }).catch((e) => e);

      expect(err.message).toMatch(/^Migration 0037 refused: 1 column\(s\) it must constrain do not exist: signature_records\.revoked_by/);
      expect(log.ddl).toEqual([]);
    });

    it("summarises a long list", async () => {
      const nulls = {};
      for (const t of TARGETS.filter((x) => x.notNull)) {
        nulls[key(t.table, t.column)] = { n: 1, sample: ["x"] };
      }
      const { qi } = fakeQueryInterface(oldCatalog(), { nulls });

      const err = await migration.up({ context: qi }).catch((e) => e);

      const over = TARGETS.filter((x) => x.notNull).length - 20;
      expect(err.message).toContain(`… and ${over} more`);
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

    it("down restores the previous catalog exactly — A-149 keys removed, duplicates and names back", async () => {
      const before = oldCatalog();
      before.fks.push(fk("calibration_records", "device_id", "calibration_devices", "CASCADE", { name: "by_hand" }));
      const { qi, state } = fakeQueryInterface(before);

      await migration.up({ context: qi });
      expect(catalogOf(state)).not.toEqual(catalogOf(before));

      await migration.down({ context: qi });

      expect(catalogOf(state)).toEqual(catalogOf(before));
      expect(find(state, "signature_records", "revoked_by")).toEqual([]);
      expect(state.stateTable).toBeNull();
    });

    it("down runs in one transaction with a lock_timeout", async () => {
      const { qi, log, TX } = fakeQueryInterface();
      await migration.up({ context: qi });
      log.queries.length = 0;

      await migration.down({ context: qi });

      expect(log.queries.some((q) => /SET LOCAL lock_timeout/.test(q.sql))).toBe(true);
      expect(log.queries.every((q) => q.transaction === TX)).toBe(true);
    });
  });
});
