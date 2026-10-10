/**
 * P24-01 — the transform's step registry, bookkeeping and runner
 * (services/upstreamImport/transform/*), over a statement double: what each module SENDS
 * (bound values, constant identifiers) and what it does with each answer. The same statements
 * run on PostgreSQL 18 in migrations/upstreamImportTransform.p2401.live — a double proves the
 * client, the live suite the contract.
 */
import { STAGED_TABLES } from "../../../services/upstreamImport/tablePolicy";
import { TRANSFORM_STEPS, isBuilt, type StepContext, type TransformStep } from "../../../services/upstreamImport/transform/steps";
import {
  ID_MAP,
  QUARANTINE,
  checkedName,
  classifiedSql,
  classify,
  quarantineRows,
  recordMappings,
  rowHashSql,
  stagedTable,
} from "../../../services/upstreamImport/transform/ledger";
import { TransformFailure, runTransform } from "../../../services/upstreamImport/transform/runner";
import type { SqlQueryOptions, SqlRunner } from "../../../utils/sql.util";
import type { Transaction } from "sequelize";

const RUN = "a2401000-0000-4000-8000-0000000000f1";
const TX = { id: "tx" } as unknown as Transaction;

interface Call {
  text: string;
  bind: readonly unknown[];
  transaction: unknown;
}

/** A runner that records every statement and answers with the first matching rule. */
const double = (rules: [RegExp, (call: Call) => object[]][] = []): SqlRunner & { calls: Call[] } => {
  const calls: Call[] = [];
  return {
    calls,
    query: (text: string, options: SqlQueryOptions) => {
      const call = { text, bind: options.bind ?? [], transaction: options.transaction };
      calls.push(call);
      const rule = rules.find(([pattern]) => pattern.test(text));
      return Promise.resolve(rule ? rule[1](call) : []);
    },
  };
};

const context = (runner: SqlRunner): StepContext => ({ runId: RUN, runner, transaction: TX });

describe("P24-01 the step registry (05 § 3.1)", () => {
  it("every staged table is the source of exactly one step — none unclaimed, none twice", () => {
    const claimed = TRANSFORM_STEPS.flatMap((s) => s.sources.map((source) => source.table));
    expect([...claimed].sort()).toEqual([...STAGED_TABLES].sort());
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  it("the order is 05 § 3.1 as amended (facilities first, audit rows last); ids are codes", () => {
    expect(TRANSFORM_STEPS.map((s) => s.id)).toEqual([
      "client_facilities",
      "users",
      "device_types",
      "inspection_item_definitions",
      "inspection_templates",
      "vendors",
      "warehouses",
      "calibration_devices",
      "attachments",
      "calibration_records",
      "inspection_sessions",
      "inspection_results",
      "audit_logs",
    ]);
    expect(TRANSFORM_STEPS.every((s) => /^[a-z][a-z0-9_]{0,39}$/.test(s.id) && s.writes.length > 0)).toBe(true);
    expect(Object.isFrozen(TRANSFORM_STEPS) && TRANSFORM_STEPS.every((s) => Object.isFrozen(s))).toBe(true);
  });

  it("nothing is built yet (P24-02): isBuilt is false; a step with a run and every legacy key is built", () => {
    expect(isBuilt(TRANSFORM_STEPS)).toBe(false);
    const run = (): Promise<void> => Promise.resolve();
    expect(isBuilt([{ id: "a", writes: ["x"], sources: [{ table: "t", legacyId: 's."id"::text' }], run }])).toBe(true);
    expect(isBuilt([{ id: "a", writes: ["x"], sources: [{ table: "t", legacyId: null }], run }])).toBe(false);
    expect(isBuilt([])).toBe(true);
  });
});

describe("P24-01 the bookkeeping", () => {
  it("names: a staged table is the quoted stg_ table of a plain name; anything else is refused before any SQL", () => {
    expect(stagedTable("mst_faskes")).toBe('upstream_import."stg_mst_faskes"');
    expect(ID_MAP).toBe("upstream_import.id_map");
    expect(QUARANTINE).toBe("upstream_import.quarantine");
    expect(checkedName("trx_inventory")).toBe("trx_inventory");
    for (const bad of ['x"; DROP TABLE y; --', "Upper", "", "1abc", "a".repeat(64)]) {
      expect(() => checkedName(bad)).toThrow("is not a plain lower-case table name");
      expect(() => stagedTable(bad)).toThrow("is not a plain lower-case table name");
    }
  });

  it("ADR-129 Am. 2: a staged table reaches SQL text only from the staging allow-list — a plain name off it is refused", () => {
    for (const table of STAGED_TABLES) {
      expect(stagedTable(table)).toBe(`upstream_import."stg_${table}"`);
    }
    for (const off of ["t", "orphan", "id_map", "quarantine", "migrations", "auth_permissions"]) {
      expect(() => stagedTable(off)).toThrow(`"${off}" is not a staged table (tablePolicy.ts)`);
    }
    expect(() => classifiedSql({ table: "orphan", legacyId: 's."id"::text' })).toThrow("is not a staged table");
  });

  it("the row hash: SHA-256 hex over the row's JSONB, run id and row number removed, NULL members stripped; a bad alias is refused", () => {
    expect(rowHashSql("s")).toBe(
      "encode(sha256(convert_to((jsonb_strip_nulls(to_jsonb(s) - 'import_run_id' - 'source_row_number'))::text, 'UTF8')), 'hex')",
    );
    expect(() => rowHashSql("s; DROP")).toThrow("is not a plain alias");
  });

  it("classifies the run's rows (run id bound as $1, the earlier mapping joined by table and legacy key); a source with no key yet is refused", async () => {
    const text = classifiedSql({ table: "trx_inventory", legacyId: 's."id"::text' });
    expect(text).toContain('FROM upstream_import."stg_trx_inventory" s');
    expect(text).toContain("m.source_table = 'trx_inventory' AND m.legacy_id = k.legacy_id");
    expect(text).toContain("WHERE s.import_run_id = $1");
    expect(text).toContain("WHEN m.legacy_id IS NULL THEN 'new' WHEN m.source_row_hash = k.row_hash THEN 'unchanged' ELSE 'changed'");
    expect(() => classifiedSql({ table: "trx_inventory", legacyId: null })).toThrow("has no legacy key yet");
    const runner = double([[/ORDER BY s\.source_row_number/, () => [{ sourceRowNumber: "1", decision: "new" }]]]);
    expect(await classify(context(runner), { table: "trx_inventory", legacyId: 's."id"::text' })).toEqual([{ sourceRowNumber: "1", decision: "new" }]);
    expect(runner.calls[0]).toMatchObject({ bind: [RUN], transaction: TX });
  });

  it("records mappings in bound batches of 1,000 (an existing key moved to this run), and quarantines in bound batches", async () => {
    const runner = double();
    const mapping = (i: number): Parameters<typeof recordMappings>[1][number] => ({
      sourceTable: "trx_inventory",
      legacyId: String(i),
      targetTable: "calibration_devices",
      targetId: "a2401000-0000-4000-8000-000000000001",
      tenantId: "a2401000-0000-4000-8000-000000000002",
      clientFacilityId: null,
      rowHash: "a".repeat(64),
      sourceValues: i === 0 ? { sn: "-" } : null,
    });
    expect(await recordMappings(context(runner), Array.from({ length: 1001 }, (_, i) => mapping(i)))).toBe(1001);
    expect(runner.calls).toHaveLength(2);
    expect(runner.calls[0]?.text).toContain(`INSERT INTO ${ID_MAP}`);
    expect(runner.calls[0]?.text).toContain("ON CONFLICT (source_table, legacy_id) DO UPDATE SET");
    expect(runner.calls[0]?.bind).toHaveLength(9000);
    expect(runner.calls[0]?.bind.slice(0, 9)).toEqual([
      "trx_inventory",
      "0",
      "calibration_devices",
      "a2401000-0000-4000-8000-000000000001",
      "a2401000-0000-4000-8000-000000000002",
      null,
      RUN,
      "a".repeat(64),
      '{"sn":"-"}',
    ]);
    expect(runner.calls[1]?.bind).toHaveLength(9);
    expect(runner.calls.every((c) => c.transaction === TX)).toBe(true);
    expect(await recordMappings(context(runner), [])).toBe(0);
    expect(runner.calls).toHaveLength(2);
    await expect(recordMappings(context(runner), [{ ...mapping(1), targetTable: "Bad Table" }])).rejects.toThrow("is not a plain lower-case table name");

    const q = double();
    expect(await quarantineRows(context(q), [{ sourceTable: "trx_kalibrasi", sourceRowNumber: 7, legacyId: "41", reason: "future_calibration_date" }])).toBe(1);
    expect(q.calls[0]?.text).toContain(`INSERT INTO ${QUARANTINE}`);
    expect(q.calls[0]?.text).toContain("ON CONFLICT DO NOTHING");
    expect(q.calls[0]?.bind).toEqual([RUN, "trx_kalibrasi", "7", "41", "future_calibration_date"]);
  });
});

describe("P24-01 the runner", () => {
  const ROLE = "callibrator_transform";
  const order: string[] = [];
  const builtStep = (id: string, table: string | null): TransformStep => ({
    id,
    writes: ["x"],
    sources: table === null ? [] : [{ table, legacyId: 's."id"::text' }],
    run: (c: StepContext) => {
      order.push(`${id}:${c.runId}`);
      return Promise.resolve();
    },
  });
  const okRole = (): object[] => [{ currentUser: ROLE, superuser: false, canMap: true }];
  const db = { transaction: <T>(fn: (t: Transaction) => Promise<T>): Promise<T> => fn(TX) };
  const clock = (): (() => number) => {
    let t = 0;
    return () => (t += 5);
  };

  beforeEach(() => {
    order.length = 0;
  });

  it("refuses steps that are not built before opening anything (TRANSFORM_NOT_BUILT)", async () => {
    const runner = double();
    const err = (await runTransform({ runId: RUN, db, runner, role: ROLE, steps: TRANSFORM_STEPS }).catch((e: unknown) => e)) as TransformFailure;
    expect(err).toBeInstanceOf(TransformFailure);
    expect(err.code).toBe("TRANSFORM_NOT_BUILT");
    expect(runner.calls).toEqual([]);
  });

  it.each([
    ["another role", [{ currentUser: "callibrator_app", superuser: false, canMap: true }]],
    ["a superuser", [{ currentUser: ROLE, superuser: true, canMap: true }]],
    ["no INSERT on id_map", [{ currentUser: ROLE, superuser: false, canMap: false }]],
    ["no row at all", []],
  ])("refuses %s as the connection (TRANSFORM_ROLE_INVALID), after the lock, before any step", async (_label, answer) => {
    const runner = double([[/current_user/, () => answer]]);
    const err = (await runTransform({ runId: RUN, db, runner, role: ROLE, steps: [builtStep("a", "mst_faskes")] }).catch((e: unknown) => e)) as TransformFailure;
    expect(err.code).toBe("TRANSFORM_ROLE_INVALID");
    expect(runner.calls.map((c) => c.text.split("(")[0]?.trim())).toEqual(["SELECT pg_advisory_xact_lock", "SELECT current_user AS \"currentUser\", r.rolsuper AS \"superuser\",\n            has_table_privilege"]);
    expect(runner.calls[0]?.bind).toEqual(["upstream_import.transform"]);
    expect(order).toEqual([]);
  });

  it("runs every step in order in one transaction, purges the run's old quarantine first, and counts each source", async () => {
    const runner = double([
      [/current_user/, okRole],
      [/to_regclass/, (c) => [{ present: c.bind[0] !== "upstream_import.stg_trx_inventory" }]],
      [/count\(\*\)::int AS staged/, () => [{ staged: 4, mapped: 2, unchanged: 1, unaccounted: 0 }]],
      [/GROUP BY reason/, () => [{ reason: "no_device", n: 1 }]],
      [/FROM pg_tables/, () => [{ name: "stg_trx_kalibrasi" }]],
      [/stg_trx_kalibrasi/, () => [{ present: false }]],
    ]);
    const summary = await runTransform({
      runId: RUN,
      db,
      runner,
      role: ROLE,
      steps: [builtStep("first", "mst_faskes"), builtStep("derived", null), builtStep("last", "trx_inventory")],
      now: clock(),
    });
    expect(order).toEqual([`first:${RUN}`, `derived:${RUN}`, `last:${RUN}`]);
    expect(summary).toEqual({
      durationMs: 35,
      steps: [
        { step: "first", durationMs: 5, sources: [{ table: "mst_faskes", staged: 4, mapped: 2, unchanged: 1, quarantined: { no_device: 1 } }] },
        { step: "derived", durationMs: 5, sources: [] },
        { step: "last", durationMs: 5, sources: [{ table: "trx_inventory", staged: 0, mapped: 0, unchanged: 0, quarantined: {} }] },
      ],
    });
    const purge = runner.calls.find((c) => c.text.startsWith(`DELETE FROM ${QUARANTINE}`));
    expect(purge?.bind).toEqual([RUN]);
    expect(runner.calls.indexOf(purge as Call)).toBe(2);
    const count = runner.calls.find((c) => c.text.includes("AS staged"));
    expect(count?.bind).toEqual([RUN, "mst_faskes"]);
    expect(count?.text).toContain('FROM upstream_import."stg_mst_faskes" s');
    // Step 4 asks the catalogue only about the allow-listed tables no step claims (bound), sorted.
    const catalogue = runner.calls.find((c) => c.text.includes("FROM pg_tables"));
    const unclaimed = [...STAGED_TABLES].filter((t) => t !== "mst_faskes" && t !== "trx_inventory").sort();
    expect(catalogue?.bind).toEqual(["upstream_import", unclaimed.map((t) => `stg_${t}`)]);
    expect(runner.calls.find((c) => c.text.includes('"stg_trx_kalibrasi"'))?.bind).toEqual([RUN]);
    expect(count?.text).toContain('LEFT JOIN upstream_import.id_map m ON m.source_table = $2 AND m.legacy_id = (s."id"::text)');
    expect(runner.calls.every((c) => c.transaction === TX)).toBe(true);
  });

  it("an empty count answer is zero; the default clock is used when none is given", async () => {
    const runner = double([
      [/current_user/, okRole],
      [/to_regclass/, () => [{ present: true }]],
    ]);
    const summary = await runTransform({ runId: RUN, db, runner, role: ROLE, steps: [builtStep("only", "mst_faskes")] });
    expect(summary.steps[0]?.sources[0]).toEqual({ table: "mst_faskes", staged: 0, mapped: 0, unchanged: 0, quarantined: {} });
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("a staged row neither mapped nor quarantined fails the transform TRANSFORM_INCOMPLETE at its step; later steps never run", async () => {
    const runner = double([
      [/current_user/, okRole],
      [/to_regclass/, () => [{ present: true }]],
      [/AS staged/, () => [{ staged: 3, mapped: 1, unchanged: 0, unaccounted: 2 }]],
    ]);
    const err = (await runTransform({ runId: RUN, db, runner, role: ROLE, steps: [builtStep("first", "mst_faskes"), builtStep("second", "trx_kalibrasi")] }).catch(
      (e: unknown) => e,
    )) as TransformFailure;
    expect(err.code).toBe("TRANSFORM_INCOMPLETE");
    expect(err.message).toBe("step first: 2 staged row(s) of mst_faskes are neither mapped nor quarantined");
    expect(order).toEqual([`first:${RUN}`]);
  });

  it("a staged table holding rows of this run that no step accounts for fails it TRANSFORM_INCOMPLETE, naming the table", async () => {
    const runner = double([
      [/current_user/, okRole],
      [/FROM pg_tables/, () => [{ name: "stg_trx_kalibrasi" }, { name: "stg_trx_catatan" }]],
      [/stg_trx_kalibrasi/, () => [{ present: true }]],
      [/stg_trx_catatan/, () => [{ present: false }]],
    ]);
    const err = (await runTransform({ runId: RUN, db, runner, role: ROLE, steps: [builtStep("derived", null)] }).catch((e: unknown) => e)) as TransformFailure;
    expect(err.code).toBe("TRANSFORM_INCOMPLETE");
    expect(err.message).toBe("no step accounts for the staged table(s) trx_kalibrasi");
    expect(runner.calls.find((c) => c.text.includes('"stg_trx_kalibrasi"'))?.bind).toEqual([RUN]);
  });

  it("ADR-129 Am. 2: a catalogue name off the allow-list never reaches a statement; a step source off it is refused before its count", async () => {
    const runner = double([
      [/current_user/, okRole],
      [/FROM pg_tables/, () => [{ name: 'stg_x"; DROP TABLE y; --' }, { name: "stg_orphan" }]],
    ]);
    const summary = await runTransform({ runId: RUN, db, runner, role: ROLE, steps: [builtStep("derived", null)] });
    expect(summary.steps).toEqual([{ step: "derived", durationMs: expect.any(Number) as number, sources: [] }]);
    expect(runner.calls.filter((c) => /orphan|DROP/.test(c.text))).toEqual([]);

    const refused = double([[/current_user/, okRole]]);
    await expect(runTransform({ runId: RUN, db, runner: refused, role: ROLE, steps: [builtStep("off", "orphan")] })).rejects.toThrow(
      '"orphan" is not a staged table (tablePolicy.ts)',
    );
    expect(refused.calls.some((c) => c.text.includes("to_regclass"))).toBe(false);
  });

  it("a step's own error propagates unchanged (the transaction rolls back)", async () => {
    const runner = double([[/current_user/, okRole]]);
    const failing: TransformStep = { id: "boom", writes: ["x"], sources: [], run: () => Promise.reject(new Error("23503 violation")) };
    await expect(runTransform({ runId: RUN, db, runner, role: ROLE, steps: [failing] })).rejects.toThrow("23503 violation");
  });
});
