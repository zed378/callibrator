/**
 * Step 2 of the transform (P24-02b; ADR-129 Am. 4; P18-01-02 spec § 2, 04 § 6, 05 § 5, ADR-124):
 * `users` × `auth_groups` × `auth_groups_users` × `trx_mapping_user_client` → `users` of the
 * provider tenant.
 *
 * THE ROLE (P18-01 § 2.1, § 2.2), from the user's ONE known group:
 *  - `admin` → CALIBRATOR ADMIN, `user` → TECHNICIAN: unbound provider staff;
 *  - `client` → bound to the facility of its ONE mapping row: the earliest-created ACTIVE `client`
 *    of each facility (ties: the lowest upstream id) is HEALTHCARE ADMIN, every other ROOM USER;
 *  - `teknisi_client` → bound HEALTHCARE TECHNICIAN.
 *
 * QUARANTINED, never imported unbound or guessed:
 *  - no known group `user_without_group`; two or more `group_conflict` (rule 6);
 *  - a facility user with zero or several mapping rows `facility_mapping_ambiguous` (rule 2, AM-27);
 *    one whose facility was not imported (step 1 quarantined it) `facility_not_imported`;
 *  - an e-mail an existing account already holds (case-insensitive; e-mail is globally unique)
 *    `email_in_use` — the operator decides whose it is;
 *  - a group whose name is none of the four `unknown_group`; a membership or mapping row of a user
 *    that was not imported `user_not_imported` (the user's own row carries the specific reason).
 *
 * THE ACCOUNT (UD-5, 05 § 5): no password hash is imported (staging never holds one). Every
 * imported user gets the SAME unusable bcrypt hash of a random secret generated for this run and
 * discarded, `must_change_password`, e-mail not verified, `awaiting_invitation` (ADR-139 § 2: the
 * e-mail-code reset and SSO refuse it) — the invitation (P24-09, P30-04, after the pre-invitation
 * gate) is the only way in. Inactive upstream accounts are imported inactive and
 * never invited (rule 3). The e-mail is lower-cased (0063); a username already taken anywhere gets
 * `_2`, `_3` …; an empty one is derived from the e-mail's local part. `fullname` is split on its
 * last space (first ≤ 100, last ≤ 100); an empty name takes the username as first name.
 *
 * A CHANGED user (another row hash) has its names and active flag updated; its e-mail, username,
 * role and binding are never changed by a re-run (identity and binding have their own audited
 * operations). `id_map.source_values` is never written for users (its CHECK refuses it).
 *
 * Memberships, mappings and groups are USE-ONLY (07 § 2.1): a used row maps to the user (or, for a
 * group, the role) it decided; the audit step writes rows only for tables it wrote, so a role is
 * never audited as created.
 */
import { randomBytes, randomUUID } from "crypto";
import { sql } from "../../../utils/sql.util";
import { hashPassword } from "../../../utils/password.util";
import { ROLE_NAMES } from "../../../constants/roleConstants";
import { ID_MAP, classifiedSql, quarantineRows, recordMappings, stagedTable, stagedTableExists, type Mapping, type QuarantineEntry } from "./ledger";
import type { StepContext, TransformSource } from "./steps";

/** The four staged sources, keyed (a membership has no id: its pair is its key). */
export const USER_SOURCES = Object.freeze({
  users: Object.freeze({ table: "users", legacyId: 's."id"::text' }),
  groups: Object.freeze({ table: "auth_groups", legacyId: 's."id"::text' }),
  memberships: Object.freeze({ table: "auth_groups_users", legacyId: "s.\"group_id\"::text || ':' || s.\"user_id\"::text" }),
  mappings: Object.freeze({ table: "trx_mapping_user_client", legacyId: 's."id"::text' }),
} satisfies Record<string, TransformSource>);

/** An upstream group's role and whether it is bound to a facility. */
const GROUP_ROLES: Readonly<Record<string, { role: string; bound: boolean }>> = Object.freeze({
  admin: { role: ROLE_NAMES.CALIBRATOR_ADMIN, bound: false },
  user: { role: ROLE_NAMES.TECHNICIAN, bound: false },
  client: { role: ROLE_NAMES.ROOM_USER, bound: true },
  teknisi_client: { role: ROLE_NAMES.HEALTHCARE_TECHNICIAN, bound: true },
});

/** The username column's length. */
const USERNAME_MAX = 100;

/** The roles the step assigns (all seeded; a missing one fails the transform rather than dropping a user). */
export const ASSIGNED_ROLES: readonly string[] = Object.freeze([...new Set([...Object.values(GROUP_ROLES).map((g) => g.role), ROLE_NAMES.HEALTCARE_ADMIN])]);

type Decision = "new" | "unchanged" | "changed";

/** One staged user, as the step decides it. */
interface StagedUser {
  sourceRowNumber: string;
  legacyId: string;
  rowHash: string;
  targetId: string | null;
  decision: Decision;
  targetPresent: boolean;
  active: boolean;
  /** Milliseconds since the epoch of `created_at` (read in the source zone), or null. */
  createdAtMs: string | null;
  emailKey: string;
  usernameKey: string;
}

/** One staged group, membership or mapping row. */
interface StagedLink {
  sourceRowNumber: string;
  legacyId: string;
  rowHash: string;
  targetId: string | null;
  decision: Decision;
  /** groups: the lower-cased name; memberships: the group's lower-cased name; mappings: unused. */
  groupName: string | null;
  /** memberships, mappings: the upstream user id. */
  userLegacyId: string | null;
  /** mappings: the client facility step 1 decided for `id_client`, or null. */
  facilityId: string | null;
}

/** What the plan writes. */
export interface UserPlan {
  insert: { id: string; sourceRowNumber: string; role: string; facilityId: string | null; username: string }[];
  update: { id: string; sourceRowNumber: string }[];
  mappings: Mapping[];
  quarantine: QuarantineEntry[];
}

/** What the plan needs besides the staged rows. */
export interface UserPlanInput {
  readonly users: readonly StagedUser[];
  readonly groups: readonly StagedLink[];
  readonly memberships: readonly StagedLink[];
  readonly mappings: readonly StagedLink[];
  /** role name → role id (the roles the plan may assign). */
  readonly roles: ReadonlyMap<string, string>;
  /** Lower-cased usernames and e-mails already held, with the holder's id. */
  readonly takenUsernames: ReadonlyMap<string, string>;
  readonly takenEmails: ReadonlyMap<string, string>;
  readonly tenantId: string;
  readonly newId: () => string;
}

const numeric = (a: { legacyId: string }, b: { legacyId: string }): number => Number(a.legacyId) - Number(b.legacyId) || a.legacyId.localeCompare(b.legacyId);

/** The username a new account starts from: upstream's, else the e-mail's local part, else `upstream_<id>`. */
export const usernameBase = (row: Pick<StagedUser, "usernameKey" | "emailKey" | "legacyId">): string =>
  (row.usernameKey !== "" ? row.usernameKey : row.emailKey.replace(/@.*$/, "")) || `upstream_${row.legacyId}`;

/**
 * The first of `base`, `base_2`, `base_3` … that neither an existing account (`taken`) nor this
 * plan (`given`) holds, case-insensitively. Terminates: both sets are finite.
 */
export const freeUsername = (base: string, taken: ReadonlyMap<string, string>, given: ReadonlySet<string>): string => {
  for (let n = 1; ; n += 1) {
    const suffix = n === 1 ? "" : `_${String(n)}`;
    const candidate = `${base.slice(0, USERNAME_MAX - suffix.length)}${suffix}`;
    if (!taken.has(candidate.toLowerCase()) && !given.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
};

/**
 * Decide every staged user, group, membership and mapping. Pure.
 * @returns what to insert, update, map and quarantine
 */
export const planUsers = (input: UserPlanInput): UserPlan => {
  const plan: UserPlan = { insert: [], update: [], mappings: [], quarantine: [] };
  const quarantine = (table: string, row: { sourceRowNumber: string; legacyId: string }, reason: QuarantineEntry["reason"]): void => {
    plan.quarantine.push({ sourceTable: table, sourceRowNumber: row.sourceRowNumber, legacyId: row.legacyId, reason });
  };

  // The groups, and each user's known groups.
  const known = new Set(Object.keys(GROUP_ROLES));
  for (const group of input.groups) {
    const role = group.groupName !== null && known.has(group.groupName) ? input.roles.get((GROUP_ROLES[group.groupName] as { role: string }).role) : undefined;
    if (role === undefined) {
      quarantine(USER_SOURCES.groups.table, group, "unknown_group");
    } else if (!(group.decision === "unchanged" && group.targetId === role)) {
      plan.mappings.push({ sourceTable: USER_SOURCES.groups.table, legacyId: group.legacyId, targetTable: "roles", targetId: role, tenantId: null, clientFacilityId: null, rowHash: group.rowHash, sourceValues: null });
    }
  }
  const groupsOf = new Map<string, Set<string>>();
  for (const m of input.memberships) {
    if (m.userLegacyId !== null && m.groupName !== null && known.has(m.groupName)) {
      groupsOf.set(m.userLegacyId, (groupsOf.get(m.userLegacyId) ?? new Set()).add(m.groupName));
    }
  }
  const facilitiesOf = new Map<string, StagedLink[]>();
  for (const m of input.mappings) {
    if (m.userLegacyId !== null) {
      facilitiesOf.set(m.userLegacyId, [...(facilitiesOf.get(m.userLegacyId) ?? []), m]);
    }
  }

  // Each user's role and facility, or its quarantine reason.
  interface Placed {
    row: StagedUser;
    group: string;
    facilityId: string | null;
  }
  const placed: Placed[] = [];
  for (const row of [...input.users].sort(numeric)) {
    const groups = [...(groupsOf.get(row.legacyId) ?? [])];
    if (groups.length === 0) {
      quarantine(USER_SOURCES.users.table, row, "user_without_group");
      continue;
    }
    if (groups.length > 1) {
      quarantine(USER_SOURCES.users.table, row, "group_conflict");
      continue;
    }
    const group = groups[0] as string;
    let facilityId: string | null = null;
    if ((GROUP_ROLES[group] as { bound: boolean }).bound) {
      const links = facilitiesOf.get(row.legacyId) ?? [];
      if (links.length !== 1) {
        quarantine(USER_SOURCES.users.table, row, "facility_mapping_ambiguous");
        continue;
      }
      facilityId = (links[0] as StagedLink).facilityId;
      if (facilityId === null) {
        quarantine(USER_SOURCES.users.table, row, "facility_not_imported");
        continue;
      }
    }
    const emailHolder = input.takenEmails.get(row.emailKey);
    if (emailHolder !== undefined && emailHolder !== row.targetId) {
      quarantine(USER_SOURCES.users.table, row, "email_in_use");
      continue;
    }
    placed.push({ row, group, facilityId });
  }

  // Rule 1: one HEALTHCARE ADMIN per facility — the earliest-created ACTIVE client, then the lowest id.
  const admins = new Map<string, Placed>();
  const earliest = (p: Placed): number => (p.row.createdAtMs === null ? Number.MAX_SAFE_INTEGER : Number(p.row.createdAtMs));
  for (const p of placed) {
    if (p.group !== "client" || !p.row.active) {
      continue;
    }
    // A client is bound: its facility was decided above.
    const facility = p.facilityId as string;
    const current = admins.get(facility);
    if (current === undefined || earliest(p) < earliest(current)) {
      admins.set(facility, p);
    }
  }

  // Insert, update or skip each placed user; then map it.
  const given = new Set<string>();
  const userTarget = new Map<string, { id: string; facilityId: string | null }>();
  for (const p of placed) {
    const { row } = p;
    let targetId: string;
    if (row.targetId !== null && row.targetPresent) {
      targetId = row.targetId;
      if (row.decision === "changed") {
        plan.update.push({ id: targetId, sourceRowNumber: row.sourceRowNumber });
      }
    } else {
      const username = freeUsername(usernameBase(row), input.takenUsernames, given);
      given.add(username.toLowerCase());
      targetId = input.newId();
      const role = admins.get(p.facilityId ?? "") === p ? ROLE_NAMES.HEALTCARE_ADMIN : (GROUP_ROLES[p.group] as { role: string }).role;
      plan.insert.push({ id: targetId, sourceRowNumber: row.sourceRowNumber, role, facilityId: p.facilityId, username });
    }
    userTarget.set(row.legacyId, { id: targetId, facilityId: p.facilityId });
    if (!(row.decision === "unchanged" && row.targetId === targetId)) {
      plan.mappings.push({
        sourceTable: USER_SOURCES.users.table,
        legacyId: row.legacyId,
        targetTable: "users",
        targetId,
        tenantId: input.tenantId,
        clientFacilityId: p.facilityId,
        rowHash: row.rowHash,
        sourceValues: null,
      });
    }
  }

  // Memberships and mappings follow their user.
  for (const [source, rows] of [
    [USER_SOURCES.memberships.table, input.memberships],
    [USER_SOURCES.mappings.table, input.mappings],
  ] as const) {
    for (const link of rows) {
      const user = link.userLegacyId === null ? undefined : userTarget.get(link.userLegacyId);
      if (source === USER_SOURCES.memberships.table && (link.groupName === null || !known.has(link.groupName))) {
        quarantine(source, link, "unknown_group");
      } else if (user === undefined) {
        quarantine(source, link, "user_not_imported");
      } else if (!(link.decision === "unchanged" && link.targetId === user.id)) {
        plan.mappings.push({ sourceTable: source, legacyId: link.legacyId, targetTable: "users", targetId: user.id, tenantId: input.tenantId, clientFacilityId: user.facilityId, rowHash: link.rowHash, sourceValues: null });
      }
    }
  }
  return plan;
};

/** No rows (a dump without the table). */
const EMPTY_LINKS: readonly StagedLink[] = Object.freeze([]);

/** Step 2's `run`. */
export const runUsers = async (context: StepContext): Promise<void> => {
  const { runner, transaction, runId, tenantId, sourceZone } = context;
  if (!(await stagedTableExists(context, USER_SOURCES.users.table))) {
    return;
  }
  const users = stagedTable(USER_SOURCES.users.table);
  const userRows = await sql<StagedUser>(
    runner,
    `SELECT c."sourceRowNumber", c."legacyId", c."rowHash", c."targetId", c.decision,
            (u.id IS NOT NULL) AS "targetPresent",
            coalesce(s."active"::int, 0) <> 0 AS active,
            (extract(epoch FROM (s."created_at"::timestamp AT TIME ZONE $3)) * 1000)::bigint::text AS "createdAtMs",
            lower(btrim(coalesce(s."email"::text, ''))) AS "emailKey",
            btrim(coalesce(s."username"::text, '')) AS "usernameKey"
       FROM (${classifiedSql(USER_SOURCES.users)}) c
       JOIN ${users} s ON s.import_run_id = $1 AND s.source_row_number = c."sourceRowNumber"::bigint
       LEFT JOIN users u ON u.tenant_id = $2 AND u.id = c."targetId"`,
    [runId, tenantId, sourceZone],
    { transaction },
  );
  const hasGroups = await stagedTableExists(context, USER_SOURCES.groups.table);
  const groups = hasGroups
    ? await sql<StagedLink>(
      runner,
      `SELECT c."sourceRowNumber", c."legacyId", c."rowHash", c."targetId", c.decision,
              lower(btrim(s."name"::text)) AS "groupName", NULL AS "userLegacyId", NULL AS "facilityId"
         FROM (${classifiedSql(USER_SOURCES.groups)}) c
         JOIN ${stagedTable(USER_SOURCES.groups.table)} s ON s.import_run_id = $1 AND s.source_row_number = c."sourceRowNumber"::bigint`,
      [runId],
      { transaction },
    )
    : EMPTY_LINKS;
  const memberships = (await stagedTableExists(context, USER_SOURCES.memberships.table))
    ? await sql<StagedLink>(
      runner,
      `SELECT c."sourceRowNumber", c."legacyId", c."rowHash", c."targetId", c.decision,
              ${hasGroups ? `(SELECT lower(btrim(g."name"::text)) FROM ${stagedTable(USER_SOURCES.groups.table)} g WHERE g.import_run_id = $1 AND g."id"::bigint = s."group_id"::bigint LIMIT 1)` : "NULL"} AS "groupName",
              s."user_id"::text AS "userLegacyId", NULL AS "facilityId"
         FROM (${classifiedSql(USER_SOURCES.memberships)}) c
         JOIN ${stagedTable(USER_SOURCES.memberships.table)} s ON s.import_run_id = $1 AND s.source_row_number = c."sourceRowNumber"::bigint`,
      [runId],
      { transaction },
    )
    : EMPTY_LINKS;
  const mappings = (await stagedTableExists(context, USER_SOURCES.mappings.table))
    ? await sql<StagedLink>(
      runner,
      `SELECT c."sourceRowNumber", c."legacyId", c."rowHash", c."targetId", c.decision,
              NULL AS "groupName", s."id_user"::text AS "userLegacyId", f.target_id AS "facilityId"
         FROM (${classifiedSql(USER_SOURCES.mappings)}) c
         JOIN ${stagedTable(USER_SOURCES.mappings.table)} s ON s.import_run_id = $1 AND s.source_row_number = c."sourceRowNumber"::bigint
         LEFT JOIN ${ID_MAP} f ON f.source_table = 'mst_faskes' AND f.legacy_id = s."id_client"::text AND f.tenant_id = $2`,
      [runId, tenantId],
      { transaction },
    )
    : EMPTY_LINKS;
  const roleRows = await sql<{ id: string; name: string }>(runner, "SELECT id, name FROM roles WHERE name = ANY($1::text[])", [ASSIGNED_ROLES], {
    transaction,
  });
  const missing = ASSIGNED_ROLES.filter((name) => !roleRows.some((r) => r.name === name));
  if (missing.length > 0) {
    throw new Error(`upstream transform: the role(s) ${missing.join(", ")} are not seeded`);
  }
  // Both keys are globally unique: the check spans tenants on purpose and reads only the candidates' keys.
  const taken = await sql<{ id: string; usernameKey: string; emailKey: string }>(
    runner,
    `SELECT id, lower(username) AS "usernameKey", lower(email) AS "emailKey" FROM users
      WHERE lower(email) = ANY($1::text[]) OR lower(username) LIKE ANY($2::text[])`,
    [userRows.map((u) => u.emailKey), userRows.map((u) => `${usernameBase(u).toLowerCase().replace(/[\\%_]/g, "\\$&")}%`)],
    { transaction },
  );
  const plan = planUsers({
    users: userRows,
    groups,
    memberships,
    mappings,
    roles: new Map(roleRows.map((r) => [r.name, r.id])),
    takenUsernames: new Map(taken.map((t) => [t.usernameKey, t.id])),
    takenEmails: new Map(taken.map((t) => [t.emailKey, t.id])),
    tenantId,
    newId: randomUUID,
  });
  if (plan.insert.length > 0) {
    // UD-5: one unusable hash per run, of a secret nobody keeps.
    const unusable = await hashPassword(randomBytes(32).toString("base64url"));
    await sql(
      runner,
      `INSERT INTO users (id, tenant_id, role_id, username, email, password, first_name, last_name, avatar_url, is_active, status,
                          is_email_verified, must_change_password, password_one_time, client_facility_id, facility_binding_pending,
                          awaiting_invitation, is_deleted, created_at, updated_at)
       SELECT v.id, $2::uuid, r.id, v.username, lower(btrim(s."email"::text)), $6,
              left(coalesce(nullif(n.first, ''), v.username), 100), left(coalesce(n.last, ''), 100), 'default.svg',
              coalesce(s."active"::int, 0) <> 0, CASE WHEN coalesce(s."active"::int, 0) <> 0 THEN 'ACTIVE' ELSE 'INACTIVE' END,
              false, true, false, v.facility, false, true, false,
              coalesce(s."created_at"::timestamp AT TIME ZONE $7, now()),
              coalesce(s."updated_at"::timestamp AT TIME ZONE $7, s."created_at"::timestamp AT TIME ZONE $7, now())
         FROM unnest($3::uuid[], $4::bigint[], $5::text[], $8::text[], $9::uuid[]) AS v(id, rn, role, username, facility)
         JOIN ${users} s ON s.import_run_id = $1 AND s.source_row_number = v.rn
         JOIN roles r ON r.name = v.role
         CROSS JOIN LATERAL (SELECT btrim(regexp_replace(coalesce(s."fullname"::text, ''), '\\s+', ' ', 'g')) AS full) f
         CROSS JOIN LATERAL (SELECT CASE WHEN position(' ' IN f.full) > 0 THEN regexp_replace(f.full, ' [^ ]*$', '') ELSE f.full END AS first,
                                    CASE WHEN position(' ' IN f.full) > 0 THEN regexp_replace(f.full, '^.* ', '') ELSE '' END AS last) n
        WHERE NOT EXISTS (SELECT 1 FROM users e WHERE e.tenant_id = $2 AND e.id = v.id)`,
      [
        runId,
        tenantId,
        plan.insert.map((i) => i.id),
        plan.insert.map((i) => i.sourceRowNumber),
        plan.insert.map((i) => i.role),
        unusable,
        sourceZone,
        plan.insert.map((i) => i.username),
        plan.insert.map((i) => i.facilityId),
      ],
      { transaction },
    );
  }
  if (plan.update.length > 0) {
    await sql(
      runner,
      `UPDATE users u SET first_name = left(coalesce(nullif(n.first, ''), u.username), 100), last_name = left(coalesce(n.last, ''), 100),
              is_active = coalesce(s."active"::int, 0) <> 0,
              status = CASE WHEN coalesce(s."active"::int, 0) <> 0 THEN 'ACTIVE' ELSE 'INACTIVE' END, updated_at = now()
         FROM unnest($3::uuid[], $4::bigint[]) AS v(id, rn)
         JOIN ${users} s ON s.import_run_id = $1 AND s.source_row_number = v.rn
         CROSS JOIN LATERAL (SELECT btrim(regexp_replace(coalesce(s."fullname"::text, ''), '\\s+', ' ', 'g')) AS full) f
         CROSS JOIN LATERAL (SELECT CASE WHEN position(' ' IN f.full) > 0 THEN regexp_replace(f.full, ' [^ ]*$', '') ELSE f.full END AS first,
                                    CASE WHEN position(' ' IN f.full) > 0 THEN regexp_replace(f.full, '^.* ', '') ELSE '' END AS last) n
        WHERE u.tenant_id = $2 AND u.id = v.id`,
      [runId, tenantId, plan.update.map((u) => u.id), plan.update.map((u) => u.sourceRowNumber)],
      { transaction },
    );
  }
  await quarantineRows(context, plan.quarantine);
  await recordMappings(context, plan.mappings);
};
