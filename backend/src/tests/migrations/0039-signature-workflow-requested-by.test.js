/**
 * Migration 0039 — signature_workflows.requested_by (A-170).
 *
 * Runs the migration against a fake QueryInterface over an in-memory table
 * description. It proves the LOGIC: the column it adds and under which name
 * (taken from the MODEL's field mapping, so a camelCase column cannot pass),
 * the foreign key's action, that it is idempotent and reversible, that the
 * backfill carries its tenant predicate and touches only NULL rows, and that
 * a real failure is NOT swallowed and recorded as applied (0008/0013/0014).
 * It does not prove the DDL runs on PostgreSQL — check
 * `\d signature_workflows` after `make migrate`.
 */
const fs = require("fs");
const path = require("path");
const { Sequelize, DataTypes } = require("sequelize");

const migration = require("../../migrations/0039-signature-workflow-requested-by");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "../../migrations/0039-signature-workflow-requested-by.js"),
  "utf8",
);
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

/** The REAL SignatureWorkflow model on an unconnected PostgreSQL-dialect Sequelize. */
const SignatureWorkflow = require("../../models/signatureWorkflow.model")(
  new Sequelize({ dialect: "postgres", logging: false }),
  DataTypes,
);

const BASE_COLUMNS = ["id", "tenant_id", "document_id", "status", "created_at"];

const fakeQueryInterface = ({ columns = BASE_COLUMNS, indexes = [], describeError = null } = {}) => {
  const state = { columns: new Set(columns), indexes: new Set(indexes), added: [], removed: [], queries: [] };
  const qi = {
    state,
    sequelize: {
      Sequelize,
      query: jest.fn(async (sql) => {
        state.queries.push(sql);
        return [[], 0];
      }),
    },
    describeTable: jest.fn(async (table) => {
      expect(table).toBe("signature_workflows");
      if (describeError) {throw describeError;}
      return Object.fromEntries([...state.columns].map((c) => [c, { type: "X" }]));
    }),
    addColumn: jest.fn(async (table, column, spec) => {
      expect(table).toBe("signature_workflows");
      if (state.columns.has(column)) {throw new Error(`column "${column}" already exists`);}
      state.columns.add(column);
      state.added.push({ column, spec });
    }),
    removeColumn: jest.fn(async (table, column) => {
      state.columns.delete(column);
      state.removed.push(column);
    }),
    showIndex: jest.fn(async () => [...state.indexes].map((name) => ({ name }))),
    addIndex: jest.fn(async (table, fields, { name }) => {
      if (state.indexes.has(name)) {throw new Error(`relation "${name}" already exists`);}
      for (const f of fields) {
        if (!state.columns.has(f)) {throw new Error(`column "${f}" does not exist`);}
      }
      state.indexes.add(name);
    }),
    removeIndex: jest.fn(async (table, name) => {
      state.indexes.delete(name);
    }),
  };
  return qi;
};

describe("migration 0039 — signature_workflows.requested_by", () => {
  it("is registered in the static manifest under its frozen .js name", () => {
    expect(MANIFEST).toContain(
      '["0039-signature-workflow-requested-by.js", require("../migrations/0039-signature-workflow-requested-by")]',
    );
  });

  it("adds the column the model maps requestedBy to, with the model's type and foreign key", () => {
    const attribute = SignatureWorkflow.getAttributes().requestedBy;
    expect(migration.COLUMN).toBe(attribute.field);
    expect(migration.COLUMN).toBe("requested_by");
    const spec = migration.columnSpec(DataTypes);
    expect(spec.type.key).toBe(attribute.type.key);
    // Nullable: workflows from before the deploy may have no known requester.
    expect(spec.allowNull).toBe(true);
    expect(attribute.allowNull).toBe(true);
    expect(spec.references).toEqual({ model: "users", key: "id" });
    expect(attribute.references).toEqual({ model: "users", key: "id" });
    expect(spec.onDelete).toBe("RESTRICT");
    expect(attribute.onDelete).toBe("RESTRICT");
  });

  it("the index is the migration's alone — the model does not declare it, so sync() on an existing database cannot fail on the missing column", () => {
    // Boot runs sync() BEFORE the migrations. A model index on requested_by
    // made sync() fail with `column "requested_by" does not exist` on every
    // database created before 0039 (found by the A-148 and A-137 PG18 runs).
    const modelIndexes = SignatureWorkflow.options.indexes.map((i) => i.fields.join(","));
    expect(modelIndexes).not.toContain("requested_by");
    expect(migration.INDEX).toBe("signature_workflows_requested_by");
  });

  it("up adds the column and its index, then backfills", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: qi });

    expect(qi.state.added.map((a) => a.column)).toEqual(["requested_by"]);
    expect(qi.addIndex).toHaveBeenCalledWith("signature_workflows", ["requested_by"], {
      name: "signature_workflows_requested_by",
    });
    expect(qi.state.queries).toEqual([migration.BACKFILL_SQL]);
  });

  describe("the backfill", () => {
    const sql = migration.BACKFILL_SQL.replace(/\s+/g, " ");

    it("reads the workflow's CREATE audit row, and never writes audit_logs", () => {
      expect(sql).toContain("a.resource_type = 'SignatureWorkflow'");
      expect(sql).toContain("a.action = 'CREATE'");
      expect(sql).toContain("src.resource_id = w.id::text");
      expect(sql).toMatch(/^ ?UPDATE signature_workflows AS w /);
      expect(sql).not.toMatch(/UPDATE audit_logs|DELETE|INSERT/i);
    });

    it("carries the tenant predicate explicitly (raw SQL bypasses the tenant hooks)", () => {
      expect(sql).toContain("src.tenant_id = w.tenant_id");
    });

    it("touches only rows with no requester, so a re-run changes nothing", () => {
      expect(sql).toContain("w.requested_by IS NULL");
    });

    it("names only a user who still exists (the foreign key would refuse anyone else)", () => {
      expect(sql).toContain("a.user_id IS NOT NULL");
      expect(sql).toContain("EXISTS (SELECT 1 FROM users AS u WHERE u.id = src.user_id)");
    });

    it("takes the earliest CREATE row when there is more than one", () => {
      expect(sql).toContain("DISTINCT ON (a.resource_id, a.tenant_id)");
      expect(sql).toContain("ORDER BY a.resource_id, a.tenant_id, a.created_at ASC");
    });
  });

  it("up is idempotent — a second run (or a fresh db.sync()'d table) adds nothing", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });
    qi.addColumn.mockClear();
    qi.addIndex.mockClear();

    await migration.up({ context: qi });

    expect(qi.addColumn).not.toHaveBeenCalled();
    expect(qi.addIndex).not.toHaveBeenCalled();
  });

  it("up skips cleanly when the table does not exist yet", async () => {
    const qi = fakeQueryInterface({ describeError: new Error('No description found for "signature_workflows" table.') });

    await expect(migration.up({ context: qi })).resolves.toBeUndefined();
    expect(qi.addColumn).not.toHaveBeenCalled();
    expect(qi.sequelize.query).not.toHaveBeenCalled();
  });

  it("up does NOT swallow any other failure — Umzug must not record it as applied", async () => {
    const qi = fakeQueryInterface({ describeError: new TypeError("context.describeTable is not a function") });

    await expect(migration.up({ context: qi })).rejects.toThrow("describeTable is not a function");
  });

  it("an error with no message is a failure, not a missing table", async () => {
    const qi = fakeQueryInterface({ describeError: new Error() });

    await expect(migration.up({ context: qi })).rejects.toThrow(Error);
    expect(qi.addColumn).not.toHaveBeenCalled();
  });

  it("an addColumn failure propagates", async () => {
    const qi = fakeQueryInterface();
    qi.addColumn.mockRejectedValueOnce(new Error("permission denied for table signature_workflows"));

    await expect(migration.up({ context: qi })).rejects.toThrow("permission denied");
  });

  it("a backfill failure propagates", async () => {
    const qi = fakeQueryInterface();
    qi.sequelize.query.mockRejectedValueOnce(new Error('relation "audit_logs" does not exist'));

    await expect(migration.up({ context: qi })).rejects.toThrow('relation "audit_logs" does not exist');
  });

  it("down removes the index and the column, and is idempotent", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });

    await migration.down({ context: qi });
    expect(qi.state.removed).toEqual(["requested_by"]);
    expect(qi.state.indexes.size).toBe(0);
    expect([...qi.state.columns].sort()).toEqual([...BASE_COLUMNS].sort());

    qi.removeColumn.mockClear();
    qi.removeIndex.mockClear();
    await migration.down({ context: qi });
    expect(qi.removeColumn).not.toHaveBeenCalled();
    expect(qi.removeIndex).not.toHaveBeenCalled();
  });

  it("down skips when the table is absent, and propagates anything else", async () => {
    await expect(
      migration.down({ context: fakeQueryInterface({ describeError: new Error('relation "signature_workflows" does not exist') }) }),
    ).resolves.toBeUndefined();
    await expect(
      migration.down({ context: fakeQueryInterface({ describeError: new Error("connection reset") }) }),
    ).rejects.toThrow("connection reset");
  });

  describe("no blanket catch (CLAUDE.md traps table)", () => {
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    it("has no `catch {` — a catch that cannot even look at what it caught", () => {
      expect(code).not.toMatch(/catch\s*\{/);
    });

    it("has exactly one catch, and it re-throws what it does not recognise", () => {
      const catches = [...code.matchAll(/catch\s*\(\s*(\w+)\s*\)/g)];
      expect(catches).toHaveLength(1);
      const [match, name] = catches[0];
      const start = code.indexOf(match);
      const body = code.slice(start, code.indexOf("\n};", start));
      expect(body).toContain(`throw ${name};`);
    });
  });
});
