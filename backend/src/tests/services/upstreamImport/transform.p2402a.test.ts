/**
 * P24-02a — the transform's first built steps (services/upstreamImport/transform/clientFacilities.ts,
 * auditRows.ts, failure.ts, ledger.ts#stagedTableExists) over a statement double: what each sends
 * (every value bound, the provider tenant in every statement naming an application table) and
 * what it decides from each answer. The same statements run on PostgreSQL 18 in
 * migrations/upstreamTransform.p2402a.live — a double proves the client, the live suite the contract.
 *
 * Synthetic values only.
 */
import type { Transaction } from "sequelize";
import { TRANSFORM_STEPS, isBuilt, type StepContext } from "../../../services/upstreamImport/transform/steps";
import {
  FACILITY_SOURCE,
  checkProviderTenant,
  nextCodes,
  planFacilities,
  runClientFacilities,
} from "../../../services/upstreamImport/transform/clientFacilities";
import { RESOURCE_TYPES, STEP_AUDITED, runAuditRows } from "../../../services/upstreamImport/transform/auditRows";
import { TransformFailure } from "../../../services/upstreamImport/transform/failure";
import { TransformFailure as RunnerTransformFailure } from "../../../services/upstreamImport/transform/runner";
import { stagedTableExists } from "../../../services/upstreamImport/transform/ledger";
import { DEFAULT_SOURCE_TIME_ZONE, sourceTimeZone } from "../../../config/upstreamImport";
import { PLATFORM_TENANT_ID } from "../../../constants/platformTenant";
import type { SqlQueryOptions, SqlRunner } from "../../../utils/sql.util";

const RUN = "a2402000-0000-4000-8000-0000000000f1";
const TENANT = "a2402000-0000-4000-8000-0000000000a1";
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

const context = (runner: SqlRunner): StepContext => ({ runId: RUN, runner, transaction: TX, tenantId: TENANT, sourceZone: "Asia/Jakarta" });

type Staged = Parameters<typeof planFacilities>[0][number];
const staged = (legacyId: string, values: Partial<Staged> = {}): Staged => ({
  sourceRowNumber: String(Number(legacyId) + 100),
  legacyId,
  rowHash: legacyId.padStart(64, "a"),
  targetId: null,
  decision: "new",
  targetPresent: false,
  nameKey: `facility ${legacyId}`,
  nameNormalised: false,
  rawName: null,
  hasDevices: true,
  ...values,
});

const ids = (): (() => string) => {
  let n = 0;
  return () => `a2402000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`;
};

const PROVIDER_OK: [RegExp, () => object[]] = [/AS "selfFacilities"/, () => [{ selfFacilities: 1, foreignMappings: 0 }]];

describe("P24-02a the registry", () => {
  it("the facilities step and the audit step are built, with the facilities' legacy key; the rest is not yet, so the transform is not available", () => {
    const facilities = TRANSFORM_STEPS.find((s) => s.id === "client_facilities");
    const audit = TRANSFORM_STEPS.find((s) => s.id === "audit_logs");
    expect(facilities?.run).toBe(runClientFacilities);
    expect(facilities?.sources).toEqual([FACILITY_SOURCE]);
    expect(FACILITY_SOURCE).toEqual({ table: "mst_faskes", legacyId: 's."id"::text' });
    expect(audit?.run).toBe(runAuditRows);
    expect(isBuilt(TRANSFORM_STEPS)).toBe(false);
  });

  it("every table a step writes has an audit resource type", () => {
    const written = TRANSFORM_STEPS.flatMap((s) => s.writes).filter((t) => t !== "audit_logs");
    expect(written.filter((t) => !(t in RESOURCE_TYPES))).toEqual([]);
    expect(Object.keys(RESOURCE_TYPES).sort()).toEqual([...new Set(written)].sort());
  });

  it("the runner re-exports the one TransformFailure", () => {
    expect(RunnerTransformFailure).toBe(TransformFailure);
    const failure = new TransformFailure("PROVIDER_TENANT_INVALID", "why");
    expect({ name: failure.name, code: failure.code, message: failure.message }).toEqual({
      name: "TransformFailure",
      code: "PROVIDER_TENANT_INVALID",
      message: "why",
    });
  });
});

describe("P24-02a the source zone (UD-7)", () => {
  it("Asia/Jakarta by default; a named IANA zone is kept; anything else is refused, never defaulted", () => {
    expect(DEFAULT_SOURCE_TIME_ZONE).toBe("Asia/Jakarta");
    expect(sourceTimeZone(undefined)).toBe("Asia/Jakarta");
    expect(sourceTimeZone("")).toBe("Asia/Jakarta");
    expect(sourceTimeZone("UTC")).toBe("UTC");
    expect(() => sourceTimeZone("Mars/Olympus")).toThrow('UPSTREAM_SOURCE_TIMEZONE "Mars/Olympus" is not an IANA time zone');
  });
});

describe("P24-02a the provider tenant check", () => {
  it("one self facility and no other tenant's mapping passes; the tenant is bound", async () => {
    const runner = double([PROVIDER_OK]);
    await checkProviderTenant(context(runner));
    expect(runner.calls[0]?.bind).toEqual([TENANT]);
    expect(runner.calls[0]?.text).toContain("FROM client_facilities WHERE tenant_id = $1 AND is_self");
    expect(runner.calls[0]?.text).toContain("FROM upstream_import.id_map WHERE tenant_id IS NOT NULL AND tenant_id <> $1");
    expect(runner.calls[0]?.transaction).toBe(TX);
  });

  it.each([
    ["no self facility", [{ selfFacilities: 0, foreignMappings: 0 }], "the provider tenant has no self facility (create it through the tenant onboarding first)"],
    ["no answer", [], "the provider tenant has no self facility (create it through the tenant onboarding first)"],
    ["another tenant's mappings", [{ selfFacilities: 1, foreignMappings: 3 }], "the id map already holds 3 row(s) of another tenant: one upstream system is one provider's data"],
  ])("%s → PROVIDER_TENANT_INVALID", async (_label, answer, message) => {
    const err = (await checkProviderTenant(context(double([[/AS "selfFacilities"/, () => answer]]))).catch((e: unknown) => e)) as TransformFailure;
    expect(err).toBeInstanceOf(TransformFailure);
    expect({ code: err.code, message: err.message }).toEqual({ code: "PROVIDER_TENANT_INVALID", message });
  });
});

describe("P24-02a the facility codes", () => {
  it("continue after the highest F-<n>; other codes are ignored; four digits at least", () => {
    expect(nextCodes(["SELF", "F-0007", "F-0002", "X-0099", "F-12A"], 3)).toEqual(["F-0008", "F-0009", "F-0010"]);
    expect(nextCodes([], 2)).toEqual(["F-0001", "F-0002"]);
    expect(nextCodes(["F-9999"], 1)).toEqual(["F-10000"]);
    expect(nextCodes(["F-0001"], 0)).toEqual([]);
  });
});

describe("P24-02a the facilities plan", () => {
  const existing = [
    { id: "a2402000-0000-4000-8000-0000000000e0", name_key: "provider", is_self: true, code: "SELF" },
    { id: "a2402000-0000-4000-8000-0000000000e1", name_key: "pre-made", is_self: false, code: "F-0004" },
  ];

  it("a new facility per name group with devices, coded after the highest code, in legacy-id order", () => {
    const plan = planFacilities([staged("12"), staged("3")], existing, ids(), TENANT);
    expect(plan.insert).toEqual([
      { id: "a2402000-0000-4000-8000-000000000001", sourceRowNumber: "103", code: "F-0005" },
      { id: "a2402000-0000-4000-8000-000000000002", sourceRowNumber: "112", code: "F-0006" },
    ]);
    expect(plan.mappings).toEqual([
      {
        sourceTable: "mst_faskes",
        legacyId: "3",
        targetTable: "client_facilities",
        targetId: "a2402000-0000-4000-8000-000000000001",
        tenantId: TENANT,
        clientFacilityId: "a2402000-0000-4000-8000-000000000001",
        rowHash: staged("3").rowHash,
        sourceValues: null,
      },
      expect.objectContaining({ legacyId: "12", targetId: "a2402000-0000-4000-8000-000000000002" }),
    ]);
    expect([plan.adopt, plan.update, plan.quarantine]).toEqual([[], [], []]);
  });

  it("an empty name is quarantined value_out_of_range; a group with no device and no earlier import facility_without_devices", () => {
    const plan = planFacilities(
      [staged("1", { nameKey: "" }), staged("2", { hasDevices: false, nameKey: "dup" }), staged("5", { hasDevices: false, nameKey: "dup" })],
      [],
      ids(),
      TENANT,
    );
    expect(plan.quarantine).toEqual([
      { sourceTable: "mst_faskes", sourceRowNumber: "101", legacyId: "1", reason: "value_out_of_range" },
      { sourceTable: "mst_faskes", sourceRowNumber: "102", legacyId: "2", reason: "facility_without_devices" },
      { sourceTable: "mst_faskes", sourceRowNumber: "105", legacyId: "5", reason: "facility_without_devices" },
    ]);
    expect([plan.insert, plan.mappings]).toEqual([[], []]);
  });

  it("duplicates merge into the lowest legacy id WITH a device; members carry mergedIntoLegacyId, a normalised name its raw value", () => {
    const plan = planFacilities(
      [
        staged("9", { nameKey: "rs one", nameNormalised: true, rawName: "  RS  One" }),
        staged("4", { nameKey: "rs one", hasDevices: false }),
        staged("6", { nameKey: "rs one" }),
        // Equal numerically: the tie is broken by the text ("06" before "6").
        staged("06", { nameKey: "rs one", sourceRowNumber: "120" }),
      ],
      [],
      ids(),
      TENANT,
    );
    const target = "a2402000-0000-4000-8000-000000000001";
    expect(plan.insert).toEqual([{ id: target, sourceRowNumber: "120", code: "F-0001" }]);
    expect(plan.mappings.map((m) => [m.legacyId, m.targetId, m.sourceValues])).toEqual([
      ["4", target, { mergedIntoLegacyId: "06" }],
      ["06", target, null],
      ["6", target, { mergedIntoLegacyId: "06" }],
      ["9", target, { mergedIntoLegacyId: "06", name_faskes: "  RS  One" }],
    ]);
  });

  it("a facility the operator already made under the name is adopted; the self facility never is", () => {
    const plan = planFacilities([staged("7", { nameKey: "pre-made" }), staged("8", { nameKey: "provider" })], existing, ids(), TENANT);
    expect(plan.adopt).toEqual([{ id: "a2402000-0000-4000-8000-0000000000e1", legacyId: "7" }]);
    expect(plan.insert).toEqual([{ id: "a2402000-0000-4000-8000-000000000001", sourceRowNumber: "108", code: "F-0005" }]);
    expect(plan.mappings.map((m) => m.targetId)).toEqual(["a2402000-0000-4000-8000-0000000000e1", "a2402000-0000-4000-8000-000000000001"]);
  });

  it("re-runs: unchanged rows skip, a changed survivor updates its facility, a vanished facility is made again, an imported one stays without devices", () => {
    const kept = "a2402000-0000-4000-8000-0000000000d1";
    const changed = "a2402000-0000-4000-8000-0000000000d2";
    const gone = "a2402000-0000-4000-8000-0000000000d3";
    const quiet = "a2402000-0000-4000-8000-0000000000d4";
    const plan = planFacilities(
      [
        staged("1", { nameKey: "kept", decision: "unchanged", targetId: kept, targetPresent: true }),
        staged("2", { nameKey: "changed", decision: "changed", targetId: changed, targetPresent: true }),
        staged("3", { nameKey: "gone", decision: "unchanged", targetId: gone, targetPresent: false }),
        staged("4", { nameKey: "quiet", decision: "unchanged", targetId: quiet, targetPresent: true, hasDevices: false }),
        staged("5", { nameKey: "kept", decision: "new" }),
      ],
      [],
      ids(),
      TENANT,
    );
    expect(plan.update).toEqual([{ id: changed, sourceRowNumber: "102" }]);
    expect(plan.insert).toEqual([{ id: "a2402000-0000-4000-8000-000000000001", sourceRowNumber: "103", code: "F-0001" }]);
    expect(plan.mappings.map((m) => [m.legacyId, m.targetId])).toEqual([
      ["5", kept],
      ["2", changed],
      ["3", "a2402000-0000-4000-8000-000000000001"],
    ]);
    expect(plan.quarantine).toEqual([]);
  });
});

describe("P24-02a the facilities step", () => {
  it("proves the tenant first; a dump without mst_faskes writes nothing", async () => {
    const runner = double([PROVIDER_OK, [/to_regclass/, () => [{ present: false }]]]);
    await runClientFacilities(context(runner));
    expect(runner.calls.map((c) => c.bind)).toEqual([[TENANT], ["upstream_import.stg_mst_faskes"]]);
  });

  it("reads the run's staged facilities with their decisions, then inserts, adopts, updates, quarantines and maps — every value bound", async () => {
    const changedTarget = "a2402000-0000-4000-8000-0000000000d2";
    const answers: object[] = [
      staged("1"),
      staged("2", { nameKey: "pre-made" }),
      staged("3", { decision: "changed", targetId: changedTarget, targetPresent: true }),
      staged("4", { nameKey: "" }),
    ];
    const runner = double([
      PROVIDER_OK,
      [/to_regclass/, () => [{ present: true }]],
      [/AS "nameKey"/, () => answers],
      [/AS name_key/, () => [{ id: "a2402000-0000-4000-8000-0000000000e1", name_key: "pre-made", is_self: false, code: "F-0003" }]],
    ]);
    await runClientFacilities(context(runner));
    const [check, hasFaskes, hasInventory, read, existingRead, insert, adopt, update, quarantine, mappings, ...rest] = runner.calls;
    expect(rest).toEqual([]);
    expect(check?.bind).toEqual([TENANT]);
    expect([hasFaskes?.bind, hasInventory?.bind]).toEqual([["upstream_import.stg_mst_faskes"], ["upstream_import.stg_trx_inventory"]]);
    expect(read?.bind).toEqual([RUN, TENANT]);
    expect(read?.text).toContain('EXISTS (SELECT 1 FROM upstream_import."stg_trx_inventory" i WHERE i.import_run_id = $1 AND i."id_client"::bigint = s."id"::bigint)');
    expect(read?.text).toContain('JOIN upstream_import."stg_mst_faskes" s ON s.import_run_id = $1');
    expect(read?.text).toContain("LEFT JOIN client_facilities f ON f.tenant_id = $2");
    expect(existingRead?.bind).toEqual([TENANT]);
    expect(insert?.text).toMatch(/^INSERT INTO client_facilities \(id, tenant_id, name, code, kind, is_self, status, phone, address, legacy_id, created_at, updated_at\)/);
    expect(insert?.text).toContain("AT TIME ZONE $6");
    expect(insert?.bind).toEqual([RUN, TENANT, [expect.any(String)], ["101"], ["F-0004"], "Asia/Jakarta"]);
    expect(adopt?.text).toContain("SET legacy_id = coalesce(f.legacy_id, v.legacy)");
    expect(adopt?.bind).toEqual([TENANT, ["a2402000-0000-4000-8000-0000000000e1"], ["2"]]);
    expect(update?.text).toContain("WHERE f.tenant_id = $2 AND f.id = v.id");
    expect(update?.bind).toEqual([RUN, TENANT, [changedTarget], ["103"]]);
    expect(quarantine?.text).toContain("INSERT INTO upstream_import.quarantine");
    expect(quarantine?.bind).toEqual([RUN, "mst_faskes", "104", "4", "value_out_of_range"]);
    expect(mappings?.text).toContain("INSERT INTO upstream_import.id_map");
    expect(mappings?.bind.filter((v) => v === "client_facilities")).toHaveLength(3);
    expect(runner.calls.every((c) => c.transaction === TX)).toBe(true);
  });

  it("without a staged register no facility has a device: all quarantined, nothing written but the quarantine", async () => {
    const runner = double([
      PROVIDER_OK,
      [/to_regclass/, (call) => [{ present: call.bind[0] === "upstream_import.stg_mst_faskes" }]],
      [/AS "nameKey"/, () => [staged("1", { hasDevices: false })]],
    ]);
    await runClientFacilities(context(runner));
    const read = runner.calls.find((c) => c.text.includes('AS "nameKey"'));
    expect(read?.text).toContain('false AS "hasDevices"');
    expect(runner.calls.filter((c) => /^\s*(INSERT INTO client_facilities|UPDATE)/.test(c.text))).toEqual([]);
    expect(runner.calls.find((c) => c.text.includes("upstream_import.quarantine"))?.bind).toEqual([RUN, "mst_faskes", "101", "1", "facility_without_devices"]);
  });
});

describe("P24-02a the audit step", () => {
  it("one INSERT … SELECT over this transaction's id-map rows: the run, the tenant, the platform tenant, the actor and the type map bound", async () => {
    const runner = double();
    await runAuditRows(context(runner));
    const [call, ...rest] = runner.calls;
    expect(rest).toEqual([]);
    expect(call?.text).toMatch(/^INSERT INTO audit_logs \(id, tenant_id, user_id, actor_type, actor_name, action, resource_type, resource_id,/);
    expect(call?.text).toContain("WHERE m.import_run_id = $1 AND m.updated_at = now() AND (m.tenant_id = $2 OR m.tenant_id IS NULL)");
    expect(call?.text).toContain("CASE WHEN bool_or(m.imported_at = now()) THEN 'CREATE' ELSE 'UPDATE' END");
    expect(call?.text).not.toMatch(/legacy_id|source_values/);
    // P24-02d: the template tables write their own audit rows (templates.ts); step 13 skips them.
    const tables = Object.keys(RESOURCE_TYPES).filter((t) => !STEP_AUDITED.has(t));
    expect(tables).not.toContain("inspection_template_items");
    expect(call?.bind).toEqual([RUN, TENANT, PLATFORM_TENANT_ID, "system:upstream-transform", tables, tables.map((t) => RESOURCE_TYPES[t])]);
    expect(call?.transaction).toBe(TX);
  });
});

describe("P24-02a ledger: whether a staged table exists", () => {
  it("binds the qualified name; a missing answer is false; a bad name is refused before any SQL", async () => {
    const yes = double([[/to_regclass/, () => [{ present: true }]]]);
    expect(await stagedTableExists(context(yes), "trx_kalibrasi")).toBe(true);
    expect(yes.calls[0]?.bind).toEqual(["upstream_import.stg_trx_kalibrasi"]);
    expect(await stagedTableExists(context(double()), "trx_kalibrasi")).toBe(false);
    const refused = double();
    await expect(stagedTableExists(context(refused), "Bad Name")).rejects.toThrow("is not a plain lower-case table name");
    expect(refused.calls).toEqual([]);
  });
});
