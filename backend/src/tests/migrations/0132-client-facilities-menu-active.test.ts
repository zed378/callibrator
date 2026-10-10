/**
 * Migration 0132 (P22-09 landed; ADR-124 Am. 5 § 2) — the `client-facilities` menu entry is turned
 * on, idempotently, and `down` turns it off; the seed agrees (all three P20-06 entries active);
 * registered after 0131; no blanket try/catch.
 */
import * as fs from "fs";
import * as path from "path";
import m0132 from "../../migrations/0132-client-facilities-menu-active";

interface Call {
  sql: string;
  bind: unknown[];
}

const fakeContext = () => {
  const calls: Call[] = [];
  const sequelize = {
    query: jest.fn((sql: string, options: { bind?: unknown[] } = {}) => {
      calls.push({ sql, bind: options.bind ?? [] });
      return Promise.resolve([[], null]);
    }),
  };
  const context: unknown = { sequelize };
  return { context: context as never, calls };
};

const SRC = path.join(__dirname, "../..");

describe("migration 0132 — the client-facilities menu entry on", () => {
  it("up: one UPDATE by slug to true, skipping a row already active (idempotent)", async () => {
    const f = fakeContext();
    await m0132.up({ context: f.context });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.sql).toMatch(/^UPDATE menu_groups SET is_active = \$1, updated_at = now\(\) WHERE slug = \$2 AND is_active IS DISTINCT FROM \$1$/);
    expect(f.calls[0]?.bind).toEqual([true, "client-facilities"]);
  });

  it("down: the same UPDATE to false", async () => {
    const f = fakeContext();
    await m0132.down({ context: f.context });
    expect(f.calls[0]?.bind).toEqual([false, "client-facilities"]);
  });

  it("the seed has all three P20-06 entries active", () => {
    const seed = fs.readFileSync(path.join(SRC, "utils/seedMenuGroups.util.ts"), "utf8");
    const flag = (slug: string): string | undefined => new RegExp(`slug: "${slug}",[\\s\\S]*?is_active: (true|false)`).exec(seed)?.[1];
    expect([flag("ipm-templates"), flag("ipm"), flag("client-facilities")]).toEqual(["true", "true", "true"]);
    expect(m0132.SLUG).toBe("client-facilities");
  });

  it("is registered right after 0131 and has no try/catch", () => {
    const migrator = fs.readFileSync(path.join(SRC, "config/migrator.ts"), "utf8");
    expect(migrator.indexOf('"0132-client-facilities-menu-active.js"')).toBeGreaterThan(migrator.indexOf('"0131-ipm-menu-active.js"'));
    expect(fs.readFileSync(path.join(SRC, "migrations/0132-client-facilities-menu-active.ts"), "utf8")).not.toMatch(/\btry\s*\{/);
  });
});
