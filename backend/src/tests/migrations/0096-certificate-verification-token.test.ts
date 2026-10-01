/**
 * Migration 0096 — certificates.verification_token (A-293, ADR-100).
 *
 * Runs the migration against a fake QueryInterface over an in-memory
 * certificates table. It proves the LOGIC: the column is added nullable, EVERY
 * row without a token — a paranoid-deleted one too — gets its own
 * 192-bit base64url token, only then is the column made NOT NULL and the
 * UNIQUE index built; a second run changes nothing and keeps the tokens; a
 * batch that updates nothing throws instead of looping; a failure propagates;
 * `down` drops the index and the column; no model declares the index (sync()
 * runs first, D-13).
 */
import * as fs from "fs";
import * as path from "path";

interface Migration {
  INDEX: string;
  BATCH: number;
  SET_NOT_NULL_SQL: string;
  CREATE_INDEX_SQL: string;
  DROP_INDEX_SQL: string;
  up(o: { context: unknown }): Promise<void>;
  down(o: { context: unknown }): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the migration module under test (export =)
const migration = require("../../migrations/0096-certificate-verification-token") as Migration;

const SOURCE = fs.readFileSync(
  path.join(__dirname, "../../migrations/0096-certificate-verification-token.ts"),
  "utf8",
);
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

interface CertRow {
  id: string;
  deleted_at: string | null;
  verification_token?: string | null;
}

interface FakeOptions {
  /** Rows the table holds. */
  rows?: CertRow[];
  /** The column is already there. */
  hasColumn?: boolean;
  /** UPDATEs match nothing (a stuck back-fill). */
  stuckUpdates?: boolean;
  /** A statement containing this text rejects. */
  failOn?: string;
}

const fakeQueryInterface = ({ rows = [], hasColumn = false, stuckUpdates = false, failOn }: FakeOptions = {}) => {
  const state = {
    rows: rows.map((r) => ({ ...r })),
    hasColumn,
    notNull: false,
    index: false,
    statements: [] as string[],
    added: [] as { column: string; attributes: { allowNull?: boolean } }[],
    removed: [] as string[],
  };
  const query = jest.fn((statement: string, options?: { bind?: string[] }) => {
    state.statements.push(statement);
    if (failOn !== undefined && statement.includes(failOn)) {
      return Promise.reject(new Error("canceling statement due to lock timeout"));
    }
    if (statement.startsWith("SELECT id FROM certificates WHERE verification_token IS NULL")) {
      // Raw SQL: no deleted_at filter, as PostgreSQL would answer.
      const missing = state.rows.filter((r) => r.verification_token == null).slice(0, migration.BATCH);
      return Promise.resolve([missing.map((r) => ({ id: r.id })), {}]);
    }
    if (statement.startsWith("UPDATE certificates AS c SET verification_token = v.token")) {
      const bind = options?.bind ?? [];
      const updated: { id: string }[] = [];
      if (!stuckUpdates) {
        for (let i = 0; i < bind.length; i += 2) {
          const row = state.rows.find((r) => r.id === bind[i] && r.verification_token == null);
          if (row) {
            row.verification_token = bind[i + 1] ?? null;
            updated.push({ id: row.id });
          }
        }
      }
      return Promise.resolve([updated, {}]);
    }
    if (statement === migration.SET_NOT_NULL_SQL) {
      if (state.rows.some((r) => r.verification_token == null)) {
        return Promise.reject(new Error('column "verification_token" contains null values'));
      }
      state.notNull = true;
    }
    if (statement === migration.CREATE_INDEX_SQL) {
      const tokens = state.rows.map((r) => r.verification_token);
      if (new Set(tokens).size !== tokens.length) {
        return Promise.reject(new Error("could not create unique index"));
      }
      state.index = true;
    }
    if (statement === migration.DROP_INDEX_SQL) {
      state.index = false;
    }
    return Promise.resolve([[], {}]);
  });
  const qi = {
    state,
    describeTable: jest.fn(() => Promise.resolve(state.hasColumn ? { id: {}, verification_token: {} } : { id: {} })),
    addColumn: jest.fn((_table: string, column: string, attributes: { allowNull?: boolean }) => {
      state.added.push({ column, attributes });
      state.hasColumn = true;
      for (const r of state.rows) {
        r.verification_token = null;
      }
      return Promise.resolve();
    }),
    removeColumn: jest.fn((_table: string, column: string) => {
      state.removed.push(column);
      state.hasColumn = false;
      return Promise.resolve();
    }),
    sequelize: { query },
  };
  return qi;
};

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32}$/;

describe("migration 0096 — certificates.verification_token (A-293)", () => {
  it("is registered in the static manifest under its .js name (P9-23)", () => {
    expect(MANIFEST).toContain(
      '["0096-certificate-verification-token.js", require("../migrations/0096-certificate-verification-token")]',
    );
  });

  it("has no catch: a failure fails the migration instead of recording it as applied", () => {
    expect(SOURCE).not.toMatch(/\.catch\(/);
    expect(SOURCE).not.toMatch(/\btry\s*\{/);
  });

  it("adds the column nullable, back-fills every row — soft-deleted included — then NOT NULL, then the UNIQUE index", async () => {
    const qi = fakeQueryInterface({
      rows: [
        { id: uuid(1), deleted_at: null },
        { id: uuid(2), deleted_at: "2026-09-01T00:00:00.000Z" },
        { id: uuid(3), deleted_at: null },
      ],
    });

    await migration.up({ context: qi });

    expect(qi.state.added).toHaveLength(1);
    expect(qi.state.added[0]).toMatchObject({ column: "verification_token", attributes: { allowNull: true } });
    const tokens = qi.state.rows.map((r) => r.verification_token);
    for (const token of tokens) {
      expect(token).toMatch(TOKEN_SHAPE);
      expect(Buffer.from(String(token), "base64url")).toHaveLength(24);
    }
    expect(new Set(tokens).size).toBe(3);
    expect(qi.state.notNull).toBe(true);
    expect(qi.state.index).toBe(true);
    // Order: NOT NULL only after the back-fill, the index last.
    const setNotNullAt = qi.state.statements.indexOf(migration.SET_NOT_NULL_SQL);
    const lastUpdateAt = qi.state.statements.map((s) => s.startsWith("UPDATE")).lastIndexOf(true);
    expect(setNotNullAt).toBeGreaterThan(lastUpdateAt);
    expect(qi.state.statements.at(-1)).toBe(migration.CREATE_INDEX_SQL);
    expect(migration.CREATE_INDEX_SQL).toBe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "certificates_verification_token_unique" ON certificates (verification_token)',
    );
  });

  it("back-fills in batches and binds every value (no value in the statement text)", async () => {
    const rows = Array.from({ length: migration.BATCH + 7 }, (_, i) => ({ id: uuid(i + 1), deleted_at: null }));
    const qi = fakeQueryInterface({ rows });

    await migration.up({ context: qi });

    const updates = qi.sequelize.query.mock.calls.filter(([s]) => s.startsWith("UPDATE"));
    expect(updates).toHaveLength(2);
    expect(updates[0]?.[1]?.bind).toHaveLength(2 * migration.BATCH);
    expect(updates[1]?.[1]?.bind).toHaveLength(14);
    for (const [statement] of updates) {
      expect(statement).not.toContain(uuid(1));
    }
    expect(qi.state.rows.every((r) => TOKEN_SHAPE.test(String(r.verification_token)))).toBe(true);
  });

  it("a second up adds nothing and keeps every token", async () => {
    const qi = fakeQueryInterface({ rows: [{ id: uuid(1), deleted_at: null }] });
    await migration.up({ context: qi });
    const before = qi.state.rows.map((r) => r.verification_token);

    await migration.up({ context: qi });

    expect(qi.addColumn).toHaveBeenCalledTimes(1);
    expect(qi.state.rows.map((r) => r.verification_token)).toEqual(before);
  });

  it("on a database where sync() created the column, only the missing tokens are filled", async () => {
    const qi = fakeQueryInterface({
      hasColumn: true,
      rows: [
        { id: uuid(1), deleted_at: null, verification_token: "k".repeat(32) },
        { id: uuid(2), deleted_at: null, verification_token: null },
      ],
    });

    await migration.up({ context: qi });

    expect(qi.addColumn).not.toHaveBeenCalled();
    expect(qi.state.rows[0]?.verification_token).toBe("k".repeat(32));
    expect(qi.state.rows[1]?.verification_token).toMatch(TOKEN_SHAPE);
  });

  it("a batch that updates nothing throws instead of looping, and NOT NULL is never attempted", async () => {
    const qi = fakeQueryInterface({ rows: [{ id: uuid(1), deleted_at: null }], stuckUpdates: true });

    await expect(migration.up({ context: qi })).rejects.toThrow(/updated nothing/);
    expect(qi.state.statements).not.toContain(migration.SET_NOT_NULL_SQL);
  });

  it("a failing statement propagates", async () => {
    const qi = fakeQueryInterface({ rows: [{ id: uuid(1), deleted_at: null }], failOn: "CREATE UNIQUE INDEX" });

    await expect(migration.up({ context: qi })).rejects.toThrow(/lock timeout/);
  });

  it("a failing describeTable propagates and nothing is altered", async () => {
    const qi = fakeQueryInterface();
    qi.describeTable.mockImplementationOnce(() => Promise.reject(new Error("Connection terminated unexpectedly")));

    await expect(migration.up({ context: qi })).rejects.toThrow("Connection terminated unexpectedly");
    expect(qi.addColumn).not.toHaveBeenCalled();
    expect(qi.sequelize.query).not.toHaveBeenCalled();
  });

  it("down drops the index, then the column; a second down is a no-op on the column", async () => {
    const qi = fakeQueryInterface({ rows: [{ id: uuid(1), deleted_at: null }] });
    await migration.up({ context: qi });

    await migration.down({ context: qi });
    await migration.down({ context: qi });

    expect(qi.state.index).toBe(false);
    expect(qi.state.removed).toEqual(["verification_token"]);
    expect(qi.state.statements).toContain('DROP INDEX IF EXISTS "certificates_verification_token_unique"');
  });

  it("no model declares the index this migration creates (sync() runs first; D-13)", () => {
    const models = path.join(__dirname, "../../models");
    const text = fs
      .readdirSync(models)
      .filter((f) => /\.model\.(js|ts)$/.test(f))
      .map((f) => fs.readFileSync(path.join(models, f), "utf8"))
      .join("\n");
    expect(text).not.toContain(migration.INDEX);
  });
});
