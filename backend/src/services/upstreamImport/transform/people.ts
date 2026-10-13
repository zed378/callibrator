/**
 * Who an imported row names (P24-02e, P24-02f; ADR-129 Am. 7, Am. 8; 07 § 3; P19-05 spec § 9.1):
 * shared by the steps that carry an upstream `id_user` — the device's registrant and the calibration
 * date's performer.
 *
 *  - `mappedTargets`: the current `id_map` targets of a source table's legacy keys, in the provider
 *    tenant or global (bound).
 *  - `peopleOf`: the imported users of the provider tenant behind upstream user ids, each with the
 *    snapshot `personSnapshotOf` prints (full name, else "Unnamed user"; role; facility, else the
 *    tenant); `unmatched` holds the ids whose mapping names no user of the tenant any more.
 *  - `numberFormerUsers` / `formerUsersOf` / `recordFormerUsers`: the per-migration number of each
 *    departed upstream user, kept in `upstream_import.former_users` (migration 0139) so that
 *    "Former upstream user #<n>" is stable across runs and never carries the upstream id.
 */
import { sql } from "../../../utils/sql.util";
import { STAGING_SCHEMA } from "../../../config/upstreamImport";
import { UNNAMED_PERSON } from "../../deviceRegister.service";
import { ID_MAP } from "./ledger";
import type { StepContext } from "./steps";

/** `upstream_import.former_users` (migration 0139). */
export const FORMER_USERS = `${STAGING_SCHEMA}.former_users`;

/** The snapshot prefix of a departed upstream user (07 § 3). */
export const FORMER_USER = "Former upstream user";

/** A person as a snapshot prints them (jsonShape `personSnapshot`). */
export interface PersonSnapshotValue {
  name: string;
  role: string | null;
  organisation: string | null;
}

/** The current mappings of `table`'s keys (legacy id → target id), in the tenant or global. */
export const mappedTargets = async (context: StepContext, table: string, keys: readonly string[]): Promise<Map<string, string>> =>
  new Map(
    (
      await sql<{ legacyId: string; targetId: string }>(
        context.runner,
        `SELECT legacy_id AS "legacyId", target_id AS "targetId" FROM ${ID_MAP}
          WHERE source_table = $1 AND legacy_id = ANY($2::text[]) AND (tenant_id = $3 OR tenant_id IS NULL)`,
        [table, [...keys], context.tenantId],
        { transaction: context.transaction },
      )
    ).map((r) => [r.legacyId, r.targetId]),
  );

/** The imported people behind upstream user ids, and the ids whose mapping names nobody of the tenant. */
export const peopleOf = async (
  context: StepContext,
  legacyIds: readonly string[],
): Promise<{ users: Map<string, { id: string; snapshot: PersonSnapshotValue }>; unmatched: Set<string> }> => {
  const userIds = await mappedTargets(context, "users", legacyIds);
  const rows = await sql<{ id: string; firstName: string | null; lastName: string | null; role: string | null; organisation: string | null }>(
    context.runner,
    `SELECT u.id, u.first_name AS "firstName", u.last_name AS "lastName", r.name AS role, coalesce(f.name, t.name) AS organisation
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN client_facilities f ON f.id = u.client_facility_id
       LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE u.tenant_id = $1 AND u.id = ANY($2::uuid[])`,
    [context.tenantId, [...new Set(userIds.values())]],
    { transaction: context.transaction },
  );
  const personOf = new Map(
    rows.map((p) => {
      const name = [p.firstName, p.lastName].filter((n): n is string => n !== null && n.trim() !== "").join(" ").trim();
      return [p.id, { name: name === "" ? UNNAMED_PERSON : name, role: p.role, organisation: p.organisation }] as const;
    }),
  );
  const users = new Map<string, { id: string; snapshot: PersonSnapshotValue }>();
  const unmatched = new Set<string>();
  for (const [legacy, id] of userIds) {
    const snapshot = personOf.get(id);
    if (snapshot === undefined) {
      unmatched.add(legacy);
    } else {
      users.set(legacy, { id, snapshot });
    }
  }
  return { users, unmatched };
};

/**
 * Number the departed users not numbered yet, in legacy id order, after the highest number given. Pure.
 * @returns every number (the given ones and the new) and the new ones alone
 */
export const numberFormerUsers = (
  existing: ReadonlyMap<string, number>,
  departed: readonly string[],
): { numbers: Map<string, number>; added: { legacyId: string; number: number }[] } => {
  const numbers = new Map(existing);
  const added: { legacyId: string; number: number }[] = [];
  let next = Math.max(0, ...numbers.values());
  for (const legacyId of [...new Set(departed)].filter((id) => !numbers.has(id)).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))) {
    next += 1;
    numbers.set(legacyId, next);
    added.push({ legacyId, number: next });
  }
  return { numbers, added };
};

/** The numbers already given (legacy id → number). */
export const formerUsersOf = async (context: StepContext): Promise<Map<string, number>> =>
  new Map(
    (await sql<{ legacyId: string; number: number }>(context.runner, `SELECT legacy_user_id AS "legacyId", number FROM ${FORMER_USERS}`, [], { transaction: context.transaction })).map(
      (f) => [f.legacyId, f.number],
    ),
  );

/** Keep the new numbers (first given in this run). */
export const recordFormerUsers = async (context: StepContext, added: readonly { legacyId: string; number: number }[]): Promise<void> => {
  if (added.length === 0) {
    return;
  }
  await sql(
    context.runner,
    `INSERT INTO ${FORMER_USERS} (legacy_user_id, number, first_import_run_id) SELECT v.legacy, v.n, $1 FROM unnest($2::text[], $3::int[]) AS v(legacy, n)`,
    [context.runId, added.map((f) => f.legacyId), added.map((f) => f.number)],
    { transaction: context.transaction },
  );
};

/** The snapshot of a departed user's number. */
export const formerSnapshot = (number: number): PersonSnapshotValue => ({ name: `${FORMER_USER} #${String(number)}`, role: null, organisation: null });
