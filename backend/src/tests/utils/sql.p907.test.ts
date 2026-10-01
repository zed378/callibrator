/**
 * P9-07 — the bind-only SQL helper (utils/sql.util).
 *
 * Proves: rows pass through typed; `bind` and `transaction` reach Sequelize only
 * when given (so a migrated call makes the SAME query as before); `replacements`
 * is refused; a statement naming `$n` without its value is refused BEFORE it
 * reaches the database (the ADR-039 defect: `$1` sent as a replacement read all
 * usage as zero); a `$1` inside a string literal is not a placeholder; and a
 * tenant predicate is bound, never interpolated — the bound value is asserted.
 */
import type { Transaction } from "sequelize";
import {
  highestPlaceholder,
  sql,
  type SqlQueryOptions,
  type SqlRunner,
} from "../../utils/sql.util";

const runnerReturning = (
  rows: unknown,
): { runner: SqlRunner; calls: [string, SqlQueryOptions][] } => {
  const calls: [string, SqlQueryOptions][] = [];
  const runner: SqlRunner = {
    query: (text, options) => {
      calls.push([text, options]);
      return Promise.resolve(rows);
    },
  };
  return { runner, calls };
};

describe("P9-07 — sql(): bind parameters only", () => {
  it("resolves with the rows and passes exactly { type: 'SELECT' } when there is nothing to bind", async () => {
    const { runner, calls } = runnerReturning([
      { name: "ADMIN", role_level: 90 },
    ]);
    const rows = await sql<{ name: string; role_level: number }>(
      runner,
      "SELECT name, role_level FROM roles",
    );
    expect(rows).toEqual([{ name: "ADMIN", role_level: 90 }]);
    expect(calls).toEqual([
      ["SELECT name, role_level FROM roles", { type: "SELECT" }],
    ]);
  });

  it("binds the tenant predicate as a VALUE ($1), never into the statement", async () => {
    const tenantId = "11111111-1111-4111-8111-111111111111";
    const { runner, calls } = runnerReturning([]);
    await sql(
      runner,
      "SELECT id FROM usage_alerts WHERE tenant_id = $1 AND metric_name = $2",
      [tenantId, "api_calls"],
    );
    const [text, options] = calls[0] ?? ["", { type: "SELECT" }];
    expect(text).not.toContain(tenantId);
    expect(options.bind).toEqual([tenantId, "api_calls"]);
    expect(options.bind?.[0]).toBe(tenantId);
  });

  it("passes the transaction when one is given", async () => {
    const transaction = { id: "tx" } as unknown as Transaction;
    const { runner, calls } = runnerReturning([]);
    await sql(
      runner,
      "UPDATE kanban_projects SET card_seq = card_seq + 1 WHERE id = $1 AND tenant_id = $2 RETURNING card_seq",
      ["p", "t"],
      { transaction },
    );
    expect(calls[0]?.[1]).toEqual({
      type: "SELECT",
      bind: ["p", "t"],
      transaction,
    });
  });

  it("refuses `replacements` (a JavaScript caller can pass it; TypeScript cannot)", async () => {
    const { runner, calls } = runnerReturning([]);
    const jsOptions = { replacements: { tenantId: "t" } } as unknown as Record<
      string,
      never
    >;
    await expect(
      sql(runner, "SELECT 1 WHERE $1 = $1", ["t"], jsOptions),
    ).rejects.toThrow(/replacements.*cannot be passed/);
    expect(calls).toEqual([]);
  });

  it("refuses a statement that names $n with no bound value — before it reaches the database (ADR-039)", async () => {
    const { runner, calls } = runnerReturning([]);
    await expect(
      sql(runner, "SELECT count(*) FROM usage_metrics WHERE tenant_id = $1"),
    ).rejects.toThrow(/names \$1 but 0 bind value/);
    await expect(sql(runner, "SELECT $3::int", [1, 2])).rejects.toThrow(
      /names \$3 but 2 bind value/,
    );
    expect(calls).toEqual([]);
  });

  it("a $n inside a string literal is not a placeholder; $$-quoting and :: casts are not either", () => {
    expect(highestPlaceholder("SELECT '$9' AS x, 'it''s $4' AS y")).toBe(0);
    expect(highestPlaceholder("SELECT $2::bigint, $1")).toBe(2);
    expect(highestPlaceholder("DO $$ BEGIN END $$")).toBe(0);
    expect(highestPlaceholder("SELECT 1")).toBe(0);
  });

  it("rejects when the database does, with the driver's error", async () => {
    const runner: SqlRunner = {
      query: () => Promise.reject(new Error("relation does not exist")),
    };
    await expect(sql(runner, "SELECT * FROM nope")).rejects.toThrow(
      "relation does not exist",
    );
  });
});

// Compile-time: `sql<any>` is a lint error (no-explicit-any), and Row must be an object type.
export const typeChecks = async (runner: SqlRunner): Promise<unknown[]> => {
  // @ts-expect-error -- Row must be an object type (a row), not a primitive
  const primitives = await sql<string>(runner, "SELECT 1");
  // @ts-expect-error -- there is no `replacements` option
  const replaced = await sql(runner, "SELECT 1", [], { replacements: {} });
  return [primitives, replaced];
};
