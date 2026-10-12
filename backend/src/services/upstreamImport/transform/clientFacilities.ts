/**
 * Step 1 of the transform (P24-02a; ADR-129 Am. 3; 05 § 3.1 as amended by P19-04 § 15; 04 § 3,
 * ADR-124): the provider tenant, then `mst_faskes` → its `client_facilities`.
 *
 * THE PROVIDER TENANT is the run's `transformTenantId`, named by the super admin and created
 * beforehand through the ordinary onboarding (so it has its self facility). This step proves it
 * before anything is written: exactly one self facility, and no `id_map` row of ANOTHER tenant —
 * one upstream system is one provider's data, so a second provider would split a dump's history
 * (`PROVIDER_TENANT_INVALID`).
 *
 * THE FACILITIES (UD-11; P19-04 § 15):
 *  - the name is trimmed, inner whitespace collapsed, at most 255 characters; an empty name is
 *    quarantined `value_out_of_range`;
 *  - rows with the same name (case-insensitive) are ONE facility: the survivor is the lowest
 *    legacy id that has a device, and every member maps to it (`source_values.mergedIntoLegacyId`);
 *  - a name group with no device in this run's `trx_inventory`, and not imported before, is
 *    quarantined `facility_without_devices` (UD-11: only facilities with devices become client
 *    facilities); one imported before stays mapped;
 *  - a new survivor is INSERTED with the next free code `F-0001…` (never the legacy id), kind
 *    `other`, status `active`, `legacy_id` = the upstream id, phone (≤ 50) and address (≤ 500)
 *    trimmed, created/updated at the source's DATETIME read in the source zone (UD-7), else now;
 *    a non-self facility the operator already created under the same name is ADOPTED instead
 *    (its `legacy_id` set when empty; nothing else of it changed);
 *  - a CHANGED survivor (same legacy id, another row hash) updates the facility's name, phone and
 *    address; an UNCHANGED one is skipped; a mapping whose facility is gone is treated as new;
 *  - `img_logo` is not imported: logo files belong to the file pipeline (P24-03).
 *
 * No hook protects this (no request context, the transform connection): every statement binds
 * the provider tenant, and the database's constraints (the unique code and name per tenant, the
 * name shape, the identity trigger) are the control (P19-04 § 15). Values stay in SQL where they
 * can; the step reads back only keys, decisions and the case-folded name it groups by.
 */
import { randomUUID } from "crypto";
import { sql } from "../../../utils/sql.util";
import { TransformFailure } from "./failure";
import { ID_MAP, classifiedSql, quarantineRows, recordMappings, stagedTable, stagedTableExists, type Mapping, type QuarantineEntry } from "./ledger";
import type { StepContext, TransformSource } from "./steps";

/** The facilities' source: `mst_faskes`, keyed by its id. */
export const FACILITY_SOURCE: TransformSource = Object.freeze({ table: "mst_faskes", legacyId: 's."id"::text' });

/** The target table. */
const TARGET = "client_facilities";

/** A generated facility code's prefix and width (`F-0001`). */
const CODE_PREFIX = "F-";
const CODE_WIDTH = 4;
const CODE_PATTERN = /^F-(\d+)$/;

/** The normalised name of the staged row `s` (the facility CHECK's own shape). */
const NAME_SQL = String.raw`btrim(left(regexp_replace(btrim(coalesce(s."name_faskes"::text, '')), '\s+', ' ', 'g'), 255))`;
const PHONE_SQL = String.raw`nullif(btrim(left(regexp_replace(btrim(coalesce(s."phone"::text, '')), '\s+', ' ', 'g'), 50)), '')`;
const ADDRESS_SQL = String.raw`nullif(btrim(left(regexp_replace(btrim(coalesce(s."address"::text, '')), '\s+', ' ', 'g'), 500)), '')`;

/** One staged facility as the step decides it (keys and flags; no contact value). */
interface StagedFacility {
  sourceRowNumber: string;
  legacyId: string;
  rowHash: string;
  targetId: string | null;
  decision: "new" | "unchanged" | "changed";
  /** Whether the mapped facility still exists in the provider tenant. */
  targetPresent: boolean;
  /** lower(normalised name), '' when the name is empty. */
  nameKey: string;
  /** Whether normalising changed the name (then its raw value goes to `source_values`). */
  nameNormalised: boolean;
  /** The raw name, only when normalising changed it. */
  rawName: string | null;
  hasDevices: boolean;
}

/** One facility already in the provider tenant (snake_case: the statement stays free of quoted aliases). */
interface ExistingFacility {
  id: string;
  name_key: string;
  is_self: boolean;
  code: string;
}

/** The provider tenant check's counts. */
interface ProviderCheck {
  selfFacilities: number;
  foreignMappings: number;
}

/**
 * Prove the provider tenant: exactly one self facility, and no id-map row of another tenant.
 * @throws {TransformFailure} PROVIDER_TENANT_INVALID
 */
export const checkProviderTenant = async (context: StepContext): Promise<void> => {
  const [check] = await sql<ProviderCheck>(
    context.runner,
    `SELECT (SELECT count(*) FROM client_facilities WHERE tenant_id = $1 AND is_self)::int AS "selfFacilities",
            (SELECT count(*) FROM ${ID_MAP} WHERE tenant_id IS NOT NULL AND tenant_id <> $1)::int AS "foreignMappings"`,
    [context.tenantId],
    { transaction: context.transaction },
  );
  if (check?.selfFacilities !== 1 || check.foreignMappings !== 0) {
    throw new TransformFailure(
      "PROVIDER_TENANT_INVALID",
      check?.selfFacilities === 1
        ? `the id map already holds ${String(check.foreignMappings)} row(s) of another tenant: one upstream system is one provider's data`
        : "the provider tenant has no self facility (create it through the tenant onboarding first)",
    );
  }
};

/** The next `count` facility codes after the highest `F-<n>` already used. */
export const nextCodes = (existing: readonly string[], count: number): string[] => {
  const highest = existing.reduce((max, code) => {
    const match = CODE_PATTERN.exec(code);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return Array.from({ length: count }, (_, i) => `${CODE_PREFIX}${String(highest + i + 1).padStart(CODE_WIDTH, "0")}`);
};

/** What the step decided for one name group. */
interface GroupPlan {
  insert: { id: string; sourceRowNumber: string; code: string }[];
  adopt: { id: string; legacyId: string }[];
  update: { id: string; sourceRowNumber: string }[];
  mappings: Mapping[];
  quarantine: QuarantineEntry[];
}

const byLegacyId = (a: StagedFacility, b: StagedFacility): number => Number(a.legacyId) - Number(b.legacyId) || a.legacyId.localeCompare(b.legacyId);

/**
 * Decide every staged facility: quarantine, merge, insert, adopt, update or skip. Pure.
 * @param rows - the run's staged facilities
 * @param existing - the provider tenant's facilities now
 * @param newId - a fresh facility id
 * @param tenantId - the provider tenant
 */
export const planFacilities = (
  rows: readonly StagedFacility[],
  existing: readonly ExistingFacility[],
  newId: () => string,
  tenantId: string,
): GroupPlan => {
  const plan: GroupPlan = { insert: [], adopt: [], update: [], mappings: [], quarantine: [] };
  const groups = new Map<string, StagedFacility[]>();
  for (const row of [...rows].sort(byLegacyId)) {
    if (row.nameKey === "") {
      plan.quarantine.push({ sourceTable: FACILITY_SOURCE.table, sourceRowNumber: row.sourceRowNumber, legacyId: row.legacyId, reason: "value_out_of_range" });
      continue;
    }
    groups.set(row.nameKey, [...(groups.get(row.nameKey) ?? []), row]);
  }
  const adoptable = new Map(existing.filter((f) => !f.is_self).map((f) => [f.name_key, f]));
  const pendingCodes: { id: string; sourceRowNumber: string }[] = [];
  for (const members of groups.values()) {
    // The lowest legacy id with a device; else one already imported (a facility is never dropped
    // because a later dump shows no device for it).
    const survivor = members.find((m) => m.hasDevices) ?? members.find((m) => m.targetPresent);
    if (survivor === undefined) {
      for (const m of members) {
        plan.quarantine.push({ sourceTable: FACILITY_SOURCE.table, sourceRowNumber: m.sourceRowNumber, legacyId: m.legacyId, reason: "facility_without_devices" });
      }
      continue;
    }
    let targetId: string;
    if (survivor.targetId !== null && survivor.targetPresent) {
      targetId = survivor.targetId;
      if (survivor.decision === "changed") {
        plan.update.push({ id: targetId, sourceRowNumber: survivor.sourceRowNumber });
      }
    } else {
      const adopted = adoptable.get(survivor.nameKey);
      if (adopted === undefined) {
        targetId = newId();
        pendingCodes.push({ id: targetId, sourceRowNumber: survivor.sourceRowNumber });
      } else {
        targetId = adopted.id;
        plan.adopt.push({ id: targetId, legacyId: survivor.legacyId });
      }
    }
    for (const m of members) {
      // Unchanged and still pointing at the survivor's facility: nothing to record.
      if (m.decision === "unchanged" && m.targetId === targetId) {
        continue;
      }
      const sourceValues: Record<string, string> = {};
      if (m !== survivor) {
        sourceValues["mergedIntoLegacyId"] = survivor.legacyId;
      }
      if (m.nameNormalised && m.rawName !== null) {
        sourceValues["name_faskes"] = m.rawName;
      }
      plan.mappings.push({
        sourceTable: FACILITY_SOURCE.table,
        legacyId: m.legacyId,
        targetTable: TARGET,
        targetId,
        tenantId,
        clientFacilityId: targetId,
        rowHash: m.rowHash,
        sourceValues: Object.keys(sourceValues).length > 0 ? sourceValues : null,
      });
    }
  }
  const codes = nextCodes(
    existing.map((f) => f.code),
    pendingCodes.length,
  );
  plan.insert = pendingCodes.map((p, i) => ({ ...p, code: codes[i] as string }));
  return plan;
};

/** Step 1's `run`: the provider tenant proved, then the facilities. */
export const runClientFacilities = async (context: StepContext): Promise<void> => {
  await checkProviderTenant(context);
  const { runner, transaction, runId, tenantId, sourceZone } = context;
  if (!(await stagedTableExists(context, FACILITY_SOURCE.table))) {
    return;
  }
  const staged = stagedTable(FACILITY_SOURCE.table);
  const devices = (await stagedTableExists(context, "trx_inventory"))
    ? `EXISTS (SELECT 1 FROM ${stagedTable("trx_inventory")} i WHERE i.import_run_id = $1 AND i."id_client"::bigint = s."id"::bigint)`
    : "false";
  const rows = await sql<StagedFacility>(
    runner,
    `SELECT c."sourceRowNumber", c."legacyId", c."rowHash", c."targetId", c.decision,
            (f.id IS NOT NULL) AS "targetPresent",
            lower(${NAME_SQL}) AS "nameKey",
            (${NAME_SQL} IS DISTINCT FROM s."name_faskes"::text) AS "nameNormalised",
            CASE WHEN ${NAME_SQL} IS DISTINCT FROM s."name_faskes"::text THEN s."name_faskes"::text END AS "rawName",
            ${devices} AS "hasDevices"
       FROM (${classifiedSql(FACILITY_SOURCE)}) c
       JOIN ${staged} s ON s.import_run_id = $1 AND s.source_row_number = c."sourceRowNumber"::bigint
       LEFT JOIN client_facilities f ON f.tenant_id = $2 AND f.id = c."targetId"`,
    [runId, tenantId],
    { transaction },
  );
  const existing = await sql<ExistingFacility>(
    runner,
    "SELECT id, lower(name) AS name_key, is_self, code FROM client_facilities WHERE tenant_id = $1",
    [tenantId],
    { transaction },
  );
  const plan = planFacilities(rows, existing, randomUUID, tenantId);
  if (plan.insert.length > 0) {
    await sql(
      runner,
      `INSERT INTO client_facilities (id, tenant_id, name, code, kind, is_self, status, phone, address, legacy_id, created_at, updated_at)
       SELECT v.id, $2::uuid, ${NAME_SQL}, v.code, 'other', false, 'active', ${PHONE_SQL}, ${ADDRESS_SQL}, s."id"::int,
              coalesce(s."created_at"::timestamp AT TIME ZONE $6, now()),
              coalesce(s."updated_at"::timestamp AT TIME ZONE $6, s."created_at"::timestamp AT TIME ZONE $6, now())
         FROM unnest($3::uuid[], $4::bigint[], $5::text[]) AS v(id, rn, code)
         JOIN ${staged} s ON s.import_run_id = $1 AND s.source_row_number = v.rn
        WHERE NOT EXISTS (SELECT 1 FROM client_facilities e WHERE e.tenant_id = $2 AND e.id = v.id)`,
      [runId, tenantId, plan.insert.map((i) => i.id), plan.insert.map((i) => i.sourceRowNumber), plan.insert.map((i) => i.code), sourceZone],
      { transaction },
    );
  }
  if (plan.adopt.length > 0) {
    await sql(
      runner,
      `UPDATE client_facilities f SET legacy_id = coalesce(f.legacy_id, v.legacy), updated_at = now()
         FROM unnest($2::uuid[], $3::int[]) AS v(id, legacy)
        WHERE f.tenant_id = $1 AND f.id = v.id`,
      [tenantId, plan.adopt.map((a) => a.id), plan.adopt.map((a) => a.legacyId)],
      { transaction },
    );
  }
  if (plan.update.length > 0) {
    await sql(
      runner,
      `UPDATE client_facilities f SET name = ${NAME_SQL}, phone = ${PHONE_SQL}, address = ${ADDRESS_SQL}, updated_at = now()
         FROM unnest($3::uuid[], $4::bigint[]) AS v(id, rn)
         JOIN ${staged} s ON s.import_run_id = $1 AND s.source_row_number = v.rn
        WHERE f.tenant_id = $2 AND f.id = v.id`,
      [runId, tenantId, plan.update.map((u) => u.id), plan.update.map((u) => u.sourceRowNumber)],
      { transaction },
    );
  }
  await quarantineRows(context, plan.quarantine);
  await recordMappings(context, plan.mappings);
};
