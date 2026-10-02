/**
 * Migration 0086 — TOTP seeds become KMS envelopes (S-20, ADR-080).
 *
 * Runs the migration against an in-memory `users` table double with the REAL
 * kms.service, mfa.service and keyRotation.service. It proves the LOGIC: the
 * registration, the type change, the sealing (every row re-read and opened
 * under its user id), the refusal of what it cannot seal, idempotence, and a
 * down that restores the plaintext the earlier code reads. The DDL and the
 * data on PostgreSQL 18 — fresh boot and an upgrade from plaintext rows — are
 * secretsAtRest.s20.live.test.js.
 *
 * P9-23: 0086 is TypeScript now (its recorded name is still
 * "0086-user-mfa-secrets-kms-envelope.js"); this suite reads the .ts source.
 */
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for the async sequelize: a throw inside them must be a rejection */
import * as fs from "fs";
import * as path from "path";

import migration from "../../migrations/0086-user-mfa-secrets-kms-envelope";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- kms.service is JavaScript (CommonJS)
const kms = require("../../services/kms.service") as { encryptData: (aad: string, plaintext: string) => string };
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the REAL mfa.service; its declaration leaves openSecret untyped
const mfaService = require("../../services/mfa.service") as {
  sealSecret: (userId: string, secret: string) => string;
  openSecret: (userId: string, stored: string) => string;
};

type Context = Parameters<typeof migration.up>[0]["context"];
const ctx = (fake: object): Context => fake as Context;

/** One row of the in-memory `users` table. */
interface UserRow {
  id: string;
  tenant_id: string | null;
  mfa_secret: string | null;
  mfa_pending_secret: string | null;
  [column: string]: string | null;
}
interface Replacements {
  columns?: string[];
  cursor?: string | null;
  limit?: number;
  id?: string;
  previous?: string;
  value?: string;
  next?: string;
  seed?: string;
}
interface QueryOptions {
  replacements?: Replacements;
  bind?: unknown[];
}

/**
 * The named values of a statement. 0086's own statements use `replacements`;
 * keyRotation.service#rewrapTarget's go through sql() with positional `bind`
 * values since P9-18, named here by the statement's shape.
 */
const namedValues = (s: string, options: QueryOptions): Replacements => {
  if (!options.bind) {
    return options.replacements ?? {};
  }
  const b = options.bind;
  if (s.startsWith("SELECT id::text AS id")) {
    return { limit: b[0] as number, cursor: b.length > 1 ? (b[1] as string) : null };
  }
  if (s.startsWith("UPDATE")) {
    return { next: b[0] as string, id: b[1] as string, previous: b[3] as string };
  }
  return { id: b[0] as string };
};

const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");
const SOURCE = fs.readFileSync(path.join(__dirname, "../../migrations/0086-user-mfa-secrets-kms-envelope.ts"), "utf8");

const SEED = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const SEED2 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const asV1 = (envelope: string): string => ["v1", ...envelope.split(":").slice(2)].join(":");

/** A sequelize double over one `users` table, understanding the statements 0086 and rewrapTarget issue. */
const fakeContext = ({
  rows = [],
  types = { mfa_secret: "character varying", mfa_pending_secret: "character varying" },
}: { rows?: UserRow[]; types?: Record<string, string> } = {}) => {
  const state = { rows, types: { ...types }, ddl: [] as string[], inTransaction: 0 };
  const query = jest.fn(async (sql: string, options: QueryOptions = {}): Promise<unknown> => {
    const s = sql.replace(/\s+/g, " ").trim();
    const r = namedValues(s, options);
    if (s.includes("information_schema.columns")) {
      expect(r.columns).toEqual(["mfa_secret", "mfa_pending_secret"]);
      return Object.entries(state.types).map(([column_name, data_type]) => ({ column_name, data_type }));
    }
    expect(state.inTransaction).toBe(1); // every change is inside the one transaction
    if (s.startsWith("ALTER TABLE users ALTER COLUMN")) {
      const [, column, type] = /ALTER COLUMN (\w+) TYPE (.+)$/.exec(s) as unknown as [string, string, string];
      state.ddl.push(`${column} ${type}`);
      state.types[column] = type === "TEXT" ? "text" : "character varying";
      return [[], {}];
    }
    if (s.startsWith("SELECT id::text AS id, tenant_id::text AS tenant_id")) {
      const column = (/tenant_id, (\w+) AS value/.exec(s) as RegExpExecArray)[1] as string;
      return state.rows
        .filter((row) => r.cursor === null || row.id > (r.cursor as string))
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, r.limit)
        .map((row) => ({ id: row.id, tenant_id: row.tenant_id, value: row[column] }));
    }
    if (s.startsWith("UPDATE users SET")) {
      const column = (/SET (\w+) =/.exec(s) as RegExpExecArray)[1] as string;
      const hit = state.rows.find((row) => row.id === r.id && row[column] === (r.previous ?? r.value));
      if (hit) {
        hit[column] = (r.next ?? r.seed) as string;
      }
      // sql()'s UPDATE ... RETURNING answers the written rows; 0086's own answers the driver's pair.
      if (options.bind) {
        return hit ? [{ id: hit.id }] : [];
      }
      return [[], { rowCount: hit ? 1 : 0 }];
    }
    if (/^SELECT (\w+) AS value FROM users WHERE id::text = (?::id|\$1)/.test(s)) {
      const column = (/^SELECT (\w+) AS value/.exec(s) as RegExpExecArray)[1] as string;
      return [{ value: (state.rows.find((row) => row.id === r.id) as UserRow)[column] }];
    }
    if (s.startsWith("SELECT id::text AS id, ")) {
      const column = (/SELECT id::text AS id, (\w+) AS value/.exec(s) as RegExpExecArray)[1] as string;
      return state.rows
        .filter((row) => /^v[12]:/.test(row[column] ?? ""))
        .map((row) => ({ id: row.id, value: row[column] }));
    }
    if (s.startsWith("SELECT COALESCE(max(length(")) {
      const column = (/length\((\w+)\)/.exec(s) as RegExpExecArray)[1] as string;
      const longest = Math.max(0, ...state.rows.map((row) => (row[column] ?? "").length));
      return [[{ longest: String(longest) }], {}];
    }
    throw new Error(`unexpected SQL: ${s}`);
  });
  const transaction = jest.fn(async (fn: () => Promise<unknown>) => {
    state.inTransaction += 1;
    try {
      return await fn();
    } finally {
      state.inTransaction -= 1;
    }
  });
  const sequelize = { query, transaction };
  return { state, sequelize, context: ctx({ sequelize }) };
};

const legacyRows = (): UserRow[] => [
  // the platform operator: no tenant
  { id: "u-1", tenant_id: null, mfa_secret: SEED, mfa_pending_secret: null },
  { id: "u-2", tenant_id: "t-1", mfa_secret: SEED2, mfa_pending_secret: "JBSWY3DPEHPK3PXP" },
  { id: "u-3", tenant_id: "t-1", mfa_secret: null, mfa_pending_secret: null },
];

describe("migration 0086 — users' TOTP seeds become KMS envelopes", () => {
  it("is registered in the static manifest under its frozen .js name", () => {
    expect(MANIFEST).toContain(
      '["0086-user-mfa-secrets-kms-envelope.js", require("../migrations/0086-user-mfa-secrets-kms-envelope")]',
    );
  });

  it("swallows nothing: no try/catch (D-14)", () => {
    expect(SOURCE).not.toMatch(/\btry\s*\{/);
    expect(SOURCE).not.toMatch(/\bcatch\s*[({]/);
  });

  it("widens both columns to TEXT and seals every plaintext seed under its user id", async () => {
    const { state, context } = fakeContext({ rows: legacyRows() });
    await migration.up({ context });

    expect(state.ddl).toEqual(["mfa_secret TEXT", "mfa_pending_secret TEXT"]);
    const [u1, u2, u3] = state.rows as [UserRow, UserRow, UserRow];
    for (const value of [u1.mfa_secret, u2.mfa_secret, u2.mfa_pending_secret] as string[]) {
      expect(value).toMatch(/^v2:/);
    }
    expect(mfaService.openSecret("u-1", u1.mfa_secret as string)).toBe(SEED);
    expect(mfaService.openSecret("u-2", u2.mfa_secret as string)).toBe(SEED2);
    expect(mfaService.openSecret("u-2", u2.mfa_pending_secret as string)).toBe("JBSWY3DPEHPK3PXP");
    expect(u1.mfa_pending_secret).toBeNull();
    expect(u3).toEqual({ id: "u-3", tenant_id: "t-1", mfa_secret: null, mfa_pending_secret: null });
  });

  it("is idempotent: a re-run changes no column and no row", async () => {
    const { state, context } = fakeContext({ rows: legacyRows() });
    await migration.up({ context });
    const after = JSON.stringify(state.rows);
    state.ddl = [];
    await migration.up({ context });
    expect(state.ddl).toEqual([]);
    expect(JSON.stringify(state.rows)).toBe(after);
  });

  it("re-wraps a v1 envelope on the way", async () => {
    const v1 = asV1(mfaService.sealSecret("u-1", SEED));
    const { state, context } = fakeContext({
      rows: [{ id: "u-1", tenant_id: null, mfa_secret: v1, mfa_pending_secret: null }],
      types: { mfa_secret: "text", mfa_pending_secret: "text" },
    });
    await migration.up({ context });
    const row = state.rows[0] as UserRow;
    expect(row.mfa_secret).toMatch(/^v2:/);
    expect(mfaService.openSecret("u-1", row.mfa_secret as string)).toBe(SEED);
  });

  it("REFUSES a value that is not a seed, or an envelope it cannot open — naming the user, never the value", async () => {
    const rows = legacyRows();
    (rows[1] as UserRow).mfa_pending_secret = "hunter2 is not a seed";
    (rows[2] as UserRow).mfa_secret = asV1(mfaService.sealSecret("someone-else", SEED)); // wrong AAD, needs a re-wrap
    const { context } = fakeContext({ rows });
    const error = (await migration.up({ context }).catch((e: unknown) => e)) as Error;
    expect(error.message).toMatch(/^0086: 2 MFA seed\(s\) could not be sealed \(nothing was changed\)/);
    expect(error.message).toContain("mfa_secret of user u-3: Failed to decrypt data");
    expect(error.message).toContain("mfa_pending_secret of user u-2: not a base32 TOTP seed (refusing to guess)");
    expect(error.message).not.toContain("hunter2");
  });

  it("refuses when a row changed while being sealed", async () => {
    const { state, sequelize, context } = fakeContext({ rows: legacyRows() });
    const original = sequelize.query.getMockImplementation() as (sql: string, options?: QueryOptions) => Promise<unknown>;
    sequelize.query.mockImplementation(async (sql: string, options?: QueryOptions) => {
      if (sql.includes("UPDATE users SET mfa_secret") && namedValues(sql.replace(/\s+/g, " ").trim(), options ?? {}).id === "u-1") {
        (state.rows[0] as UserRow).mfa_secret = "GEZDGNBVGY3TQOJQ"; // the application rewrote it
      }
      return original(sql, options);
    });
    await expect(migration.up({ context })).rejects.toThrow("0086: 1 row(s) changed while being sealed; restart to retry.");
  });

  it("does nothing on a database with no MFA columns (db.sync builds them as TEXT)", async () => {
    const { state, sequelize, context } = fakeContext({ types: {} });
    await migration.up({ context });
    await migration.down({ context });
    expect(sequelize.transaction).not.toHaveBeenCalled();
    expect(state.ddl).toEqual([]);
  });

  it("refuses a half-migrated schema rather than guessing", async () => {
    const { context } = fakeContext({ types: { mfa_secret: "character varying" } });
    await expect(migration.up({ context })).rejects.toThrow(
      "0086: users has no mfa_pending_secret — run the earlier migrations (0004, 0028) first.",
    );
  });

  it("down restores the plaintext seeds and VARCHAR(255) — what the pre-0086 code reads", async () => {
    const { state, context } = fakeContext({ rows: legacyRows() });
    const before = JSON.stringify(state.rows);
    await migration.up({ context });
    state.ddl = [];
    await migration.down({ context });
    expect(JSON.stringify(state.rows)).toBe(before);
    expect(state.ddl).toEqual(["mfa_secret VARCHAR(255)", "mfa_pending_secret VARCHAR(255)"]);
  });

  it("down refuses a row the key ring cannot open, and a value too long for VARCHAR(255)", async () => {
    const bad = fakeContext({
      rows: [{ id: "u-1", tenant_id: null, mfa_secret: kms.encryptData("users.mfa:other", SEED), mfa_pending_secret: null }],
      types: { mfa_secret: "text", mfa_pending_secret: "text" },
    });
    await expect(migration.down({ context: bad.context })).rejects.toThrow("Failed to decrypt data");
    expect(bad.state.ddl).toEqual([]);

    const long = fakeContext({
      rows: [{ id: "u-1", tenant_id: null, mfa_secret: "A".repeat(300), mfa_pending_secret: null }],
      types: { mfa_secret: "text", mfa_pending_secret: "text" },
    });
    await expect(migration.down({ context: long.context })).rejects.toThrow(
      "0086 down refused: users.mfa_secret holds a value of 300 characters",
    );
  });
});
