/**
 * Migration 0107 — work-order schedule, costs and resolution (Q-55).
 *
 * The LOGIC, over a fake sequelize that records every statement: the columns
 * are the model's (field names and SQL types), registered in the manifest
 * after 0106, idempotent (a column or CHECK already there is not added again),
 * every CHECK validated, a missing table FAILS (it is never recorded as applied
 * having done nothing), and down drops exactly what up adds. No index is
 * created (ADR-100 Am. 3). The DDL on PostgreSQL 18 is checked live, up/down/up
 * with psql (MEMORY/records/2026-09-29-p9-22-contracts.md, round 6).
 */
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for async sequelize calls */
import * as fs from "fs";
import * as path from "path";
import { Sequelize } from "sequelize";

import migration from "../../migrations/0107-work-order-schedule-cost";
import defineWorkOrder from "../../models/maintenanceWorkOrder.model";

type Context = Parameters<typeof migration.up>[0]["context"];

const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");
const WorkOrder = defineWorkOrder(new Sequelize({ dialect: "postgres", logging: false }));
const attributes: Record<string, { field: string; type: { toSql: () => string } } | undefined> =
  WorkOrder.getAttributes() as unknown as Record<string, { field: string; type: { toSql: () => string } }>;

/** A fake sequelize over a set of columns and CHECKs; records each statement. */
const fake = ({ table = true, columns = [] as string[], checks = [] as string[] } = {}) => {
  const state = { columns: new Set(columns), checks: new Set(checks), statements: [] as string[] };
  const sequelize = {
    transaction: async (fn: (t: object) => Promise<void>) => fn({}),
    query: jest.fn(async (sql: string) => {
      if (sql.includes("to_regclass")) {
        return [[{ present: table }], null];
      }
      if (sql.includes("information_schema.columns")) {
        return [[...state.columns].map((c) => ({ column_name: c })), null];
      }
      if (sql.includes("pg_constraint")) {
        return [[...state.checks].map((c) => ({ conname: c })), null];
      }
      state.statements.push(sql);
      const added = /ADD COLUMN (\w+)/.exec(sql);
      if (added?.[1]) {
        state.columns.add(added[1]);
      }
      const check = /ADD CONSTRAINT (\w+)/.exec(sql);
      if (check?.[1]) {
        state.checks.add(check[1]);
      }
      return [[], null];
    }),
  };
  return { state, context: { sequelize } as unknown as Context };
};

describe("migration 0107 — work-order schedule, costs and resolution (Q-55)", () => {
  it("is registered in the static manifest under a .js name, after 0106", () => {
    const entry = '["0107-work-order-schedule-cost.js", require("../migrations/0107-work-order-schedule-cost")]';
    expect(MANIFEST).toContain(entry);
    expect(MANIFEST.indexOf(entry)).toBeGreaterThan(MANIFEST.indexOf('"0106-'));
  });

  it("adds exactly the columns the model maps the five attributes to, with the model's SQL types", () => {
    const fromModel: Record<string, string> = {};
    for (const name of ["scheduledDate", "completedDate", "estimatedCost", "actualCost", "resolutionNotes"]) {
      const attr = attributes[name];
      // PostgreSQL's DECIMAL is NUMERIC (the same type); the migration spells it NUMERIC.
      fromModel[attr?.field ?? name] = attr?.type.toSql().replace(/^DECIMAL/, "NUMERIC") ?? "missing";
    }
    expect(migration.COLUMNS).toEqual(fromModel);
  });

  it("up adds every column and CHECK, validates each CHECK, and creates no index", async () => {
    const { state, context } = fake();
    await migration.up({ context });
    expect([...state.columns].sort()).toEqual(Object.keys(migration.COLUMNS).sort());
    expect([...state.checks].sort()).toEqual(Object.keys(migration.CHECKS).sort());
    for (const name of Object.keys(migration.CHECKS)) {
      expect(state.statements).toContain(`ALTER TABLE maintenance_work_orders VALIDATE CONSTRAINT ${name}`);
    }
    expect(state.statements.some((s) => /INDEX/i.test(s))).toBe(false);
  });

  it("is idempotent: on a sync()'d table (columns present) it adds only the CHECKs; a second run adds nothing", async () => {
    const { state, context } = fake({ columns: Object.keys(migration.COLUMNS) });
    await migration.up({ context });
    expect(state.statements.filter((s) => s.includes("ADD COLUMN"))).toEqual([]);
    expect(state.statements.filter((s) => s.includes("ADD CONSTRAINT"))).toHaveLength(3);
    state.statements.length = 0;
    await migration.up({ context });
    expect(state.statements.filter((s) => /ADD (COLUMN|CONSTRAINT)/.test(s))).toEqual([]);
  });

  it("FAILS when the table is missing, rather than being recorded as applied with nothing done", async () => {
    const { context } = fake({ table: false });
    await expect(migration.up({ context })).rejects.toThrow(/does not exist/);
  });

  it("down drops exactly the CHECKs and the columns up adds (and is a no-op without the table)", async () => {
    const { state, context } = fake({ columns: Object.keys(migration.COLUMNS) });
    await migration.down({ context });
    expect(state.statements.filter((s) => s.includes("DROP CONSTRAINT IF EXISTS")).length).toBe(3);
    expect(state.statements.filter((s) => s.includes("DROP COLUMN IF EXISTS")).length).toBe(5);
    const none = fake({ table: false });
    await migration.down({ context: none.context });
    expect(none.state.statements.filter((s) => s.includes("DROP"))).toEqual([]);
  });
});
