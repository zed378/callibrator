/**
 * Migration 0143 — `users.awaiting_invitation` and the transform role's INSERT on it (P24-08,
 * ADR-139 § 2). Pins what it ISSUES, without a database; the column and the grant are proved on
 * PostgreSQL 18 as the transform role in tests/migrations/upstreamTransform.p2402b.live.test.ts.
 */
import { DataTypes } from "sequelize";
import m0143 from "../../migrations/0143-users-awaiting-invitation";
import { environment } from "../../config/env";

const penv = environment();

interface World {
  column: boolean;
  transformRole: boolean;
  awaiting: boolean;
}

const fakeContext = (world: Partial<World> = {}) => {
  const w: World = { column: false, transformRole: true, awaiting: false, ...world };
  const sqls: string[] = [];
  const yes = (v: boolean) => Promise.resolve([[{ yes: v }], null]);
  const sequelize = {
    Sequelize: { DataTypes },
    query: jest.fn((sql: string) => {
      sqls.push(sql);
      if (sql.includes("FROM pg_roles WHERE rolname")) {
        return yes(w.transformRole);
      }
      if (sql.includes("FROM users WHERE awaiting_invitation")) {
        return yes(w.awaiting);
      }
      return Promise.resolve([[], null]);
    }),
    transaction: jest.fn((fn: (t: object) => Promise<void>) => fn({})),
  };
  const context = {
    sequelize,
    describeTable: jest.fn(() => Promise.resolve(w.column ? { awaiting_invitation: {} } : {})),
    addColumn: jest.fn(() => Promise.resolve()),
    removeColumn: jest.fn(() => Promise.resolve()),
  };
  return { context: context as unknown as Parameters<typeof m0143.up>[0]["context"], raw: context, sqls };
};

afterEach(() => {
  delete penv["UPSTREAM_TRANSFORM_DB_ROLE"];
});

describe("0143 up", () => {
  it("adds the column NOT NULL DEFAULT false, then grants INSERT on it only", async () => {
    const { context, raw, sqls } = fakeContext();
    await m0143.up({ context });
    expect(sqls[0]).toBe("SET LOCAL lock_timeout = '10s'");
    expect(raw.addColumn).toHaveBeenCalledWith("users", "awaiting_invitation", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, { transaction: {} });
    expect(sqls.filter((s) => /^(GRANT|REVOKE)/.test(s))).toEqual(["GRANT INSERT (awaiting_invitation) ON users TO callibrator_transform"]);
  });

  it("on a fresh database (db.sync made the column) only grants", async () => {
    const { context, raw, sqls } = fakeContext({ column: true });
    await m0143.up({ context });
    expect(raw.addColumn).not.toHaveBeenCalled();
    expect(sqls).toContain("GRANT INSERT (awaiting_invitation) ON users TO callibrator_transform");
  });

  it("grants to a configured transform role", async () => {
    penv["UPSTREAM_TRANSFORM_DB_ROLE"] = "etl_transform";
    const { context, sqls } = fakeContext();
    await m0143.up({ context });
    expect(sqls).toContain("GRANT INSERT (awaiting_invitation) ON users TO etl_transform");
  });

  it("refuses (never skips) without the transform role", async () => {
    const { context, raw } = fakeContext({ transformRole: false });
    await expect(m0143.up({ context })).rejects.toThrow('0143: the transform role "callibrator_transform" does not exist');
    expect(raw.addColumn).not.toHaveBeenCalled();
  });
});

describe("0143 down", () => {
  it("revokes and drops the column when no account awaits its invitation", async () => {
    const { context, raw, sqls } = fakeContext({ column: true });
    await m0143.down({ context });
    expect(sqls).toContain("REVOKE INSERT (awaiting_invitation) ON users FROM callibrator_transform");
    expect(raw.removeColumn).toHaveBeenCalledWith("users", "awaiting_invitation", { transaction: {} });
  });

  it("refuses while an account awaits its invitation: dropping the column would reopen it", async () => {
    const { context, raw, sqls } = fakeContext({ column: true, awaiting: true });
    await expect(m0143.down({ context })).rejects.toThrow("0143 down: an account is awaiting its invitation");
    expect(raw.removeColumn).not.toHaveBeenCalled();
    expect(sqls.some((s) => s.startsWith("REVOKE"))).toBe(false);
  });

  it("does nothing when the column is already gone", async () => {
    const { context, raw, sqls } = fakeContext({ column: false });
    await m0143.down({ context });
    expect(raw.removeColumn).not.toHaveBeenCalled();
    expect(sqls.some((s) => s.startsWith("REVOKE"))).toBe(false);
  });

  it("refuses without the transform role", async () => {
    const { context } = fakeContext({ column: true, transformRole: false });
    await expect(m0143.down({ context })).rejects.toThrow("0143: the transform role");
  });
});

it("exports its table, column and spec", () => {
  expect([m0143.TABLE, m0143.COLUMN]).toEqual(["users", "awaiting_invitation"]);
  expect(m0143.columnSpec(DataTypes)).toEqual({ type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
});
