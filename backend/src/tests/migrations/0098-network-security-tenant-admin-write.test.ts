/**
 * Migration 0098 — HEALTHCARE ADMIN gets `network-security: write` (Q-38,
 * ADR-100). Against a QueryInterface double that records its SQL: the frozen
 * role list matches the seed, an existing `write` is never lowered, a missing
 * row is created, `down` returns the role to `read`, and a failure propagates.
 * The SQL has not been run on PostgreSQL here — verify with the psql query in
 * the migration's header after `make migrate`.
 */
import * as fs from "fs";
import * as path from "path";
import type * as RoleConstants from "../../constants/roleConstants";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the migration is `export =`
const migration = require("../../migrations/0098-network-security-tenant-admin-write") as {
  SLUG: string;
  ROLE_NAMES_TO_GRANT: readonly string[];
  up: (p: { context: unknown }) => Promise<void>;
  down: (p: { context: unknown }) => Promise<void>;
};
const { ROLE_MENU_ASSIGNMENTS, MENU_SLUGS } = jest.requireActual<typeof RoleConstants>(
  "../../constants/roleConstants",
);
const SOURCE = fs.readFileSync(path.join(__dirname, "../../migrations/0098-network-security-tenant-admin-write.ts"), "utf8");
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

interface Write {
  sql: string;
  replacements: unknown;
}

const fake = (fail = false): { writes: Write[]; context: unknown } => {
  const writes: Write[] = [];
  const query = jest.fn(async (sql: string, options: { replacements?: unknown } = {}) => {
    await Promise.resolve();
    if (fail) {
      throw new Error("relation does not exist");
    }
    writes.push({ sql: sql.replace(/\s+/g, " ").trim(), replacements: options.replacements });
    return [[]];
  });
  return { writes, context: { sequelize: { query } } };
};

it("is registered under its frozen .js name", () => {
  expect(MANIFEST).toContain(
    '["0098-network-security-tenant-admin-write.js", require("../migrations/0098-network-security-tenant-admin-write")]',
  );
});

it("targets the seeded slug; its role list is the seeded writers other than the operator", () => {
  expect(migration.SLUG).toBe(MENU_SLUGS.NETWORK_SECURITY);
  const writers = ROLE_MENU_ASSIGNMENTS.filter((a) => a.menus[MENU_SLUGS.NETWORK_SECURITY] === "write").map((a) => a.roleName);
  expect(writers.filter((n) => n !== "SUPERADMIN").sort()).toEqual([...migration.ROLE_NAMES_TO_GRANT].sort());
});

it("up raises a lower grant and creates a missing one, never lowering a write", async () => {
  const { writes, context } = fake();
  await migration.up({ context });
  expect(writes).toHaveLength(2);
  expect(writes[0]?.sql).toMatch(/^UPDATE role_menu_permissions p SET permission_type = 'write'.*AND p\.permission_type <> 'write'$/);
  expect(writes[1]?.sql).toMatch(/^INSERT INTO role_menu_permissions .* NOT EXISTS/);
  expect(writes[0]?.replacements).toEqual({ slug: "network-security", roles: ["HEALTHCARE ADMIN"] });
});

it("down returns the role to read", async () => {
  const { writes, context } = fake();
  await migration.down({ context });
  expect(writes[0]?.sql).toMatch(/SET permission_type = 'read'/);
});

it("a failure propagates (no catch)", async () => {
  await expect(migration.up(fake(true))).rejects.toThrow("relation does not exist");
  await expect(migration.down(fake(true))).rejects.toThrow("relation does not exist");
  // The header says "No try/catch"; no `catch (` or `.catch(` may appear in code.
  expect(SOURCE).not.toMatch(/\bcatch\s*\(|\.catch\(/);
});
