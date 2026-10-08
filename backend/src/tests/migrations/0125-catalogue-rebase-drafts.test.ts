/**
 * Migration 0125 (P21-01, ADR-125 Am. 3) — the one-open-draft index leaves out a base rebase's
 * version. Pins what it ISSUES, without a database (the index's behaviour — a second operator draft
 * refused, a rebase draft beside an open one allowed, a base publish through the real service — is
 * proved on PostgreSQL 18 by inspectionCatalogue.p2101.live): one transaction; refuses without
 * 0112's table; up rebuilds the index with the rebase exclusion under the SAME name (schemaVerify
 * names it); down restores 0112's predicate; registered right after 0124; no blanket try/catch.
 */
import * as fs from "fs";
import * as path from "path";
import m0125 from "../../migrations/0125-catalogue-rebase-drafts";

const fakeContext = (present = true) => {
  const statements: string[] = [];
  let transactions = 0;
  const sequelize = {
    transaction: jest.fn(async (work: (t: unknown) => Promise<void>) => {
      transactions += 1;
      await work({ id: "tx" });
    }),
    query: jest.fn(async (sql: string, options: { transaction?: unknown } = {}) => {
      expect(options.transaction).toEqual({ id: "tx" });
      if (sql.startsWith("SELECT to_regclass")) {
        return Promise.resolve([[{ present }], null]);
      }
      statements.push(sql);
      return Promise.resolve([[], null]);
    }),
  };
  const context: unknown = { sequelize };
  return { context: context as never, statements, transactions: (): number => transactions };
};

describe("migration 0125 — a rebase draft is not an operator draft", () => {
  it("up: in one transaction, drops and rebuilds the index under the same name with the rebase exclusion", async () => {
    const f = fakeContext();
    await m0125.up({ context: f.context });
    expect(f.transactions()).toBe(1);
    expect(f.statements).toEqual([
      "DROP INDEX IF EXISTS inspection_template_versions_one_draft",
      "CREATE UNIQUE INDEX inspection_template_versions_one_draft ON inspection_template_versions (template_id) WHERE status = 'draft' AND rebased_from_version_id IS NULL",
    ]);
  });

  it("down: restores 0112's predicate", async () => {
    const f = fakeContext();
    await m0125.down({ context: f.context });
    expect(f.statements[1]).toBe("CREATE UNIQUE INDEX inspection_template_versions_one_draft ON inspection_template_versions (template_id) WHERE status = 'draft'");
  });

  it("refuses (throws, applies nothing) without 0112's table", async () => {
    const f = fakeContext(false);
    await expect(m0125.up({ context: f.context })).rejects.toThrow(/migration 0112 must run first/);
    expect(f.statements).toEqual([]);
  });

  it("is registered right after 0124, and has no try/catch", () => {
    const manifest = fs.readFileSync(path.join(__dirname, "..", "..", "config", "migrator.ts"), "utf8");
    expect(manifest.indexOf('"0125-catalogue-rebase-drafts.js"')).toBeGreaterThan(manifest.indexOf('"0124-ipm-menus-technician-calibration.js"'));
    const source = fs.readFileSync(path.join(__dirname, "..", "..", "migrations", "0125-catalogue-rebase-drafts.ts"), "utf8");
    expect(source).not.toMatch(/\btry\s*\{/);
  });
});
