/**
 * Migration 0130 (P22-01 landed; ADR-124 Am. 5 § 2) — the `ipm-templates` menu entry is turned on,
 * idempotently, and `down` turns it off; `ipm` and `client-facilities` are never touched; the seed
 * agrees; registered after 0129; no blanket try/catch.
 */
import * as fs from "fs";
import * as path from "path";
import m0130 from "../../migrations/0130-ipm-templates-menu-active";

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

describe("migration 0130 — the ipm-templates menu entry on", () => {
  it("up: one UPDATE by slug to true, skipping a row already active (idempotent)", async () => {
    const f = fakeContext();
    await m0130.up({ context: f.context });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.sql).toMatch(/^UPDATE menu_groups SET is_active = \$1, updated_at = now\(\) WHERE slug = \$2 AND is_active IS DISTINCT FROM \$1$/);
    expect(f.calls[0]?.bind).toEqual([true, "ipm-templates"]);
  });

  it("down: the same UPDATE to false", async () => {
    const f = fakeContext();
    await m0130.down({ context: f.context });
    expect(f.calls[0]?.bind).toEqual([false, "ipm-templates"]);
  });

  it("only ipm-templates: ipm and client-facilities stay inactive in the seed; ipm-templates is active there", () => {
    const seed = fs.readFileSync(path.join(SRC, "utils/seedMenuGroups.util.ts"), "utf8");
    const flag = (slug: string): string | undefined => new RegExp(`slug: "${slug}",[\\s\\S]*?is_active: (true|false)`).exec(seed)?.[1];
    expect([flag("ipm-templates"), flag("ipm"), flag("client-facilities")]).toEqual(["true", "false", "false"]);
    expect(m0130.SLUG).toBe("ipm-templates");
  });

  it("is registered right after 0129 and has no try/catch", () => {
    const migrator = fs.readFileSync(path.join(SRC, "config/migrator.ts"), "utf8");
    expect(migrator.indexOf('"0130-ipm-templates-menu-active.js"')).toBeGreaterThan(migrator.indexOf('"0129-attachment-purpose.js"'));
    expect(fs.readFileSync(path.join(SRC, "migrations/0130-ipm-templates-menu-active.ts"), "utf8")).not.toMatch(/\btry\s*\{/);
  });
});
