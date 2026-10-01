/**
 * Migrations 0099 (access_requests), 0100 (the passkey credential's unique
 * index) and 0101 (the access-requests menu) — what each ISSUES, on both of
 * its paths, without a database. That they WORK is proven on PostgreSQL 18 by
 * accessRequest.p1005.live.test.ts and `\d` in the record; this suite pins the
 * statements, the idempotence branches and the absence of a swallowing catch
 * (a failure must propagate — CLAUDE.md).
 */
import m0099 from "../../migrations/0099-access-requests";
import m0100 from "../../migrations/0100-user-webauthn-credential-unique";
import m0101 from "../../migrations/0101-access-requests-menu";
import m0104 from "../../migrations/0104-webauthn-credentials";
import pendingDrop from "../../migrations/pending/drop-legacy-user-webauthn-columns";
import type * as ActivityLog from "../../middlewares/activityLog.middleware";

const { logger } = jest.requireActual<typeof ActivityLog>("../../middlewares/activityLog.middleware");
import * as fs from "fs";
import * as path from "path";

interface Call {
  sql: string;
  options?: Record<string, unknown>;
}

/** A QueryInterface double: records every statement; `answers` decides what a SELECT returns. */
const fakeContext = (answers: (sql: string, bind: unknown[]) => unknown[] = () => []) => {
  const calls: Call[] = [];
  const created: string[] = [];
  const sequelize = {
    query: jest.fn(async (sql: string, options: Record<string, unknown> = {}) => {
      calls.push({ sql, options });
      const bind = (options["bind"] as unknown[] | undefined) ?? (Object.values((options["replacements"] as object | undefined) ?? {}) as unknown[]);
      return Promise.resolve([answers(sql, bind), null]);
    }),
    transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn({ id: "tx" })),
  };
  const context = {
    sequelize,
    createTable: jest.fn(async (table: string) => {
      created.push(table);
      return Promise.resolve();
    }),
  };
  return { context: context as never, calls, created, sequelize };
};

const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

describe("the three are registered in the static manifest under .js names (P9-23)", () => {
  it.each([
    "0099-access-requests",
    "0100-user-webauthn-credential-unique",
    "0101-access-requests-menu",
    "0104-webauthn-credentials",
  ])("%s", (name) => {
    expect(MANIFEST).toContain(`["${name}.js", require("../migrations/${name}")]`);
  });

  it("no blanket try/catch in any of them", () => {
    for (const file of [
      "0099-access-requests.ts",
      "0100-user-webauthn-credential-unique.ts",
      "0101-access-requests-menu.ts",
      "0104-webauthn-credentials.ts",
    ]) {
      const source = fs.readFileSync(path.join(__dirname, "../../migrations", file), "utf8");
      expect(`${file}: ${String(/\btry\s*\{/.test(source))}`).toBe(`${file}: false`);
    }
  });
});

describe("0099 — access_requests", () => {
  it("on a database without the table: creates it, the CHECK, the tenant FK and every index, in one transaction", async () => {
    const f = fakeContext(() => []); // to_regclass → no row; no constraints
    await m0099.up({ context: f.context });
    expect(f.created).toEqual(["access_requests"]);
    const sql = f.calls.map((c) => c.sql);
    expect(sql).toContain(m0099.ADD_CHECK_SQL);
    expect(sql).toContain(m0099.TENANT_FK_SQL);
    for (const index of m0099.INDEX_SQL) {
      expect(sql).toContain(index);
    }
    expect(f.sequelize.transaction).toHaveBeenCalledTimes(1);
    for (const call of f.calls) {
      expect(call.options?.["transaction"]).toEqual({ id: "tx" });
    }
    expect(m0099.ADD_CHECK_SQL).toContain("CHECK ((status = 'pending') = (decided_at IS NULL))");
    expect(m0099.TENANT_FK_SQL).toContain("ON DELETE SET NULL");
    expect(m0099.INDEX_SQL.join("\n")).toContain("UNIQUE INDEX IF NOT EXISTS access_requests_invitation_token_hash_unique");
    // D-20: every foreign key has its leading index.
    for (const column of m0099.FK_COLUMNS) {
      expect(m0099.INDEX_SQL.join("\n")).toContain(`ON access_requests (${column})`);
    }
    // No unique work_email: that would be an oracle.
    expect(m0099.INDEX_SQL.join("\n")).not.toMatch(/UNIQUE[^\n]*work_email/);
  });

  it("after db.sync() made the table (and a re-run): nothing is re-created, existing constraints are not re-added", async () => {
    const f = fakeContext((sql) => (sql.includes("to_regclass") ? [{ present: true }] : sql.includes("pg_constraint") ? [{ "?column?": 1 }] : []));
    await m0099.up({ context: f.context });
    expect(f.created).toEqual([]);
    const sql = f.calls.map((c) => c.sql);
    expect(sql).not.toContain(m0099.ADD_CHECK_SQL);
    expect(sql).not.toContain(m0099.TENANT_FK_SQL);
    expect(sql).toEqual(expect.arrayContaining([...m0099.INDEX_SQL]));
  });

  it("a failing statement propagates (the migration is not recorded as applied)", async () => {
    const f = fakeContext();
    f.sequelize.query.mockRejectedValueOnce(new Error("permission denied"));
    await expect(m0099.up({ context: f.context })).rejects.toThrow("permission denied");
  });

  it("down drops the table and its four ENUM types", async () => {
    const f = fakeContext();
    await m0099.down({ context: f.context });
    expect(f.calls.map((c) => c.sql)).toEqual([
      "DROP TABLE IF EXISTS access_requests",
      ...m0099.ENUM_TYPES.map((t) => `DROP TYPE IF EXISTS "${t}"`),
    ]);
  });
});

describe("0100 — users.webauthn_credential_id unique", () => {
  it("builds the partial unique index when no credential id is shared", async () => {
    const f = fakeContext(() => [{ n: 0 }]);
    await m0100.up({ context: f.context });
    expect(f.calls.map((c) => c.sql)).toEqual([m0100.DUPLICATES_SQL, m0100.CREATE_INDEX_SQL]);
    expect(m0100.CREATE_INDEX_SQL).toContain("WHERE webauthn_credential_id IS NOT NULL");
  });

  it("refuses — without picking a winner — when a credential id is held by two accounts", async () => {
    const f = fakeContext(() => [{ n: 2 }]);
    await expect(m0100.up({ context: f.context })).rejects.toThrow("0100: 2 passkey credential id(s) are held by more than one account");
    expect(f.calls.map((c) => c.sql)).not.toContain(m0100.CREATE_INDEX_SQL);
  });

  it("an empty answer counts as none; down drops the index", async () => {
    const f = fakeContext(() => []);
    await m0100.up({ context: f.context });
    await m0100.down({ context: f.context });
    expect(f.calls.map((c) => c.sql).at(-1)).toBe(m0100.DROP_INDEX_SQL);
  });
});

describe("0101 — the access-requests menu entry", () => {
  const seeded = (existing: { slug?: boolean; idTaken?: boolean; parent?: boolean } = {}) =>
    fakeContext((sql, bind) => {
      if (sql.includes("slug = 'home'")) {
        return [{ id: "home" }];
      }
      if (sql.includes("WHERE slug = $1") && bind[0] === m0101.SLUG) {
        return existing.slug ? [{ id: "menu" }] : [];
      }
      if (sql.includes("WHERE id = $1")) {
        return existing.idTaken ? [{ id: m0101.FIXED_ID }] : [];
      }
      if (sql.includes("WHERE slug = $1") && bind[0] === m0101.PARENT_SLUG) {
        return existing.parent === false ? [] : [{ id: "parent" }];
      }
      return [];
    });

  it("does nothing on a database the seed has not run on", async () => {
    const f = fakeContext(() => []);
    await m0101.up({ context: f.context });
    expect(f.calls).toHaveLength(1);
  });

  it("creates the entry with its fixed id under Organisation, and grants SUPERADMIN write — only", async () => {
    const f = seeded();
    await m0101.up({ context: f.context });
    const insert = f.calls.find((c) => c.sql.includes("INSERT INTO menu_groups"));
    expect(insert?.options?.["bind"]).toEqual([m0101.SLUG, "parent", m0101.FIXED_ID]);
    const grant = f.calls.find((c) => c.sql.includes("INSERT INTO role_menu_permissions"));
    expect(grant?.sql).toContain("'write'");
    expect(grant?.options?.["bind"]).toEqual(["SUPERADMIN", m0101.SLUG]);
  });

  it("a taken fixed id gets a generated one; a missing parent is top level; an existing entry is only granted", async () => {
    const taken = seeded({ idTaken: true, parent: false });
    await m0101.up({ context: taken.context });
    const insert = taken.calls.find((c) => c.sql.includes("INSERT INTO menu_groups"));
    expect(insert?.sql).toContain("gen_random_uuid()");
    expect(insert?.options?.["bind"]).toEqual([m0101.SLUG, null]);

    const existing = seeded({ slug: true });
    await m0101.up({ context: existing.context });
    expect(existing.calls.some((c) => c.sql.includes("INSERT INTO menu_groups"))).toBe(false);
    expect(existing.calls.some((c) => c.sql.includes("INSERT INTO role_menu_permissions"))).toBe(true);
  });

  it("with its fixed id free but no Organisation group, the entry is created top level", async () => {
    const f = seeded({ parent: false });
    await m0101.up({ context: f.context });
    const insert = f.calls.find((c) => c.sql.includes("INSERT INTO menu_groups"));
    expect(insert?.options?.["bind"]).toEqual([m0101.SLUG, null, m0101.FIXED_ID]);
  });

  it("down removes the grants and the entry", async () => {
    const f = fakeContext();
    await m0101.down({ context: f.context });
    expect(f.calls.map((c) => c.sql.split(" ").slice(0, 3).join(" "))).toEqual([
      "DELETE FROM role_menu_permissions",
      "DELETE FROM user_menu_permissions",
      "DELETE FROM menu_groups",
    ]);
  });
});

describe("0104 — webauthn_credentials (ADR-108 Amendment 1)", () => {
  it("creates the table when absent, then indexes, moves the old passkeys and clears them — one transaction", async () => {
    const f = fakeContext(() => []);
    await m0104.up({ context: f.context });
    expect(f.created).toEqual(["webauthn_credentials"]);
    expect(f.calls.map((c) => c.sql).slice(-4)).toEqual([m0104.INDEX_SQL, m0104.BACKFILL_SQL, m0104.UNUSABLE_SQL, m0104.CLEAR_SQL]);
    expect(f.sequelize.transaction).toHaveBeenCalledTimes(1);
    // The backfill never duplicates a credential already moved.
    expect(m0104.BACKFILL_SQL).toContain("NOT EXISTS (SELECT 1 FROM webauthn_credentials c WHERE c.credential_id = u.webauthn_credential_id)");
    // `webauthn_enabled` is kept: it is the "has a passkey" flag.
    expect(m0104.CLEAR_SQL).not.toContain("webauthn_enabled");
  });

  it("after db.sync() made the table, only the index, backfill and clear run", async () => {
    const f = fakeContext((sql) => (sql.includes("to_regclass") ? [{ present: true }] : []));
    await m0104.up({ context: f.context });
    expect(f.created).toEqual([]);
  });

  it("down moves each user's oldest passkey back, then drops the table; with no table it only drops", async () => {
    const withTable = fakeContext((sql) => (sql.includes("to_regclass") ? [{ present: true }] : []));
    await m0104.down({ context: withTable.context });
    expect(withTable.calls.map((c) => c.sql).slice(-2)).toEqual([m0104.RESTORE_SQL, "DROP TABLE IF EXISTS webauthn_credentials"]);
    const without = fakeContext(() => []);
    await m0104.down({ context: without.context });
    expect(without.calls.map((c) => c.sql)).not.toContain(m0104.RESTORE_SQL);
  });
});

describe("0104 — a legacy credential without a public key (live PG18 finding, 2026-09-30)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("is dropped, not moved, and the COUNT is logged — no identifier reaches the log", async () => {
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => logger);
    const f = fakeContext((sql) => (sql === m0104.UNUSABLE_SQL ? [{ n: 2 }] : []));
    await m0104.up({ context: f.context });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/^0104: 2 legacy passkey credential\(s\) had no public key and were dropped/);
    expect(warn.mock.calls[0]).toHaveLength(1);
    expect(m0104.BACKFILL_SQL).toContain("u.webauthn_public_key IS NOT NULL");
  });

  it("says nothing when there is none", async () => {
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => logger);
    await m0104.up({ context: fakeContext((sql) => (sql === m0104.UNUSABLE_SQL ? [{ n: 0 }] : [])).context });
    await m0104.up({ context: fakeContext(() => []).context });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("PENDING — drop the legacy users.webauthn_* columns (not registered until the VM deploy is verified)", () => {
  const withDescribe = (columns: string[], held: number) => {
    const f = fakeContext((sql) => (sql === pendingDrop.STILL_HELD_SQL ? [{ n: held }] : []));
    const ctx = f.context as unknown as Record<string, unknown>;
    const removed: string[] = [];
    const added: string[] = [];
    ctx["describeTable"] = jest.fn(async () => Promise.resolve(Object.fromEntries(columns.map((c) => [c, {}]))));
    ctx["removeColumn"] = jest.fn(async (_t: string, c: string) => {
      removed.push(c);
      return Promise.resolve();
    });
    ctx["addColumn"] = jest.fn(async (_t: string, c: string) => {
      added.push(c);
      return Promise.resolve();
    });
    return { ...f, removed, added };
  };

  it("is NOT in the manifest", () => {
    expect(MANIFEST).not.toContain("drop-legacy-user-webauthn-columns");
  });

  it("drops 0100's index and the three columns when no legacy value is held", async () => {
    const f = withDescribe([...pendingDrop.COLUMNS, "webauthn_enabled"], 0);
    await pendingDrop.up({ context: f.context });
    expect(f.calls.map((c) => c.sql)).toEqual([pendingDrop.STILL_HELD_SQL, pendingDrop.DROP_INDEX_SQL]);
    expect(f.removed).toEqual([...pendingDrop.COLUMNS]);
  });

  it("refuses (and drops nothing) while a user still holds a legacy value — 0104 has not run", async () => {
    const f = withDescribe([...pendingDrop.COLUMNS], 3);
    await expect(pendingDrop.up({ context: f.context })).rejects.toThrow(/3 user\(s\) still hold a legacy passkey column/);
    expect(f.removed).toEqual([]);
  });

  it("is idempotent (columns already gone) and down re-adds them empty with the index", async () => {
    const gone = withDescribe(["webauthn_enabled"], 0);
    await pendingDrop.up({ context: gone.context });
    expect(gone.removed).toEqual([]);
    await pendingDrop.down({ context: gone.context });
    expect(gone.added).toEqual([...pendingDrop.COLUMNS]);
    expect(gone.calls.map((c) => c.sql)).toContain(pendingDrop.CREATE_INDEX_SQL);
    const present = withDescribe([...pendingDrop.COLUMNS], 0);
    await pendingDrop.down({ context: present.context });
    expect(present.added).toEqual([]);
  });
});
