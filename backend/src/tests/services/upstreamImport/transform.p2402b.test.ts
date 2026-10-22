/**
 * P24-02b — the transform's users step (services/upstreamImport/transform/users.ts) over a
 * statement double: the plan in every branch of P18-01-02 § 2.2, and what the step SENDS (every
 * value bound; the provider tenant on every write; the one unusable hash per run). The same
 * statements run on PostgreSQL 18 in migrations/upstreamTransform.p2402b.live.
 *
 * Synthetic values only.
 */
import type { Transaction } from "sequelize";
import { TRANSFORM_STEPS, type StepContext } from "../../../services/upstreamImport/transform/steps";
import { ASSIGNED_ROLES, USER_SOURCES, freeUsername, planUsers, runUsers, usernameBase, type UserPlanInput } from "../../../services/upstreamImport/transform/users";
import { comparePassword } from "../../../utils/password.util";
import type { SqlQueryOptions, SqlRunner } from "../../../utils/sql.util";

const RUN = "a2402000-0000-4000-8000-0000000000f2";
const TENANT = "a2402000-0000-4000-8000-0000000000a1";
const F1 = "a2402000-0000-4000-8000-0000000000c1";
const F2 = "a2402000-0000-4000-8000-0000000000c2";
const TX = { id: "tx" } as unknown as Transaction;
const ROLES = new Map([
  ["CALIBRATOR ADMIN", "r-ca"],
  ["TECHNICIAN", "r-t"],
  ["ROOM USER", "r-ru"],
  ["HEALTHCARE TECHNICIAN", "r-ht"],
  ["HEALTHCARE ADMIN", "r-ha"],
]);

interface Call {
  text: string;
  bind: readonly unknown[];
  transaction: unknown;
}

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

type User = UserPlanInput["users"][number];
type Link = UserPlanInput["groups"][number];
const user = (legacyId: string, values: Partial<User> = {}): User => ({
  sourceRowNumber: String(Number(legacyId) + 100),
  legacyId,
  rowHash: legacyId.padStart(64, "b"),
  targetId: null,
  decision: "new",
  targetPresent: false,
  active: true,
  createdAtMs: "1000",
  emailKey: `user${legacyId}@example.test`,
  usernameKey: `user${legacyId}`,
  ...values,
});
const link = (legacyId: string, values: Partial<Link> = {}): Link => ({
  sourceRowNumber: String(Number(legacyId.replace(/\D/g, "")) + 500),
  legacyId,
  rowHash: "c".repeat(64),
  targetId: null,
  decision: "new",
  groupName: null,
  userLegacyId: null,
  facilityId: null,
  ...values,
});
/** A membership of user `u` in group `g` (named). */
const member = (u: string, g: string, values: Partial<Link> = {}): Link => link(`${String(g.length)}:${u}`, { groupName: g, userLegacyId: u, ...values });
/** A facility mapping row of user `u`. */
const mapRow = (id: string, u: string, facilityId: string | null): Link => link(id, { userLegacyId: u, facilityId });

const ids = (): (() => string) => {
  let n = 0;
  return () => `a2402000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`;
};

const input = (values: Partial<UserPlanInput>): UserPlanInput => ({
  users: [],
  groups: [],
  memberships: [],
  mappings: [],
  roles: ROLES,
  takenUsernames: new Map(),
  takenEmails: new Map(),
  tenantId: TENANT,
  newId: ids(),
  ...values,
});

describe("P24-02b the registry and the helpers", () => {
  it("the users step is built over its four sources; the roles it assigns are the five of P18-01", () => {
    const usersStep = TRANSFORM_STEPS.find((s) => s.id === "users");
    expect(usersStep?.run).toBe(runUsers);
    expect(usersStep?.sources.map((s) => [s.table, s.legacyId])).toEqual([
      ["users", 's."id"::text'],
      ["auth_groups", 's."id"::text'],
      ["auth_groups_users", "s.\"group_id\"::text || ':' || s.\"user_id\"::text"],
      ["trx_mapping_user_client", 's."id"::text'],
    ]);
    expect([...ASSIGNED_ROLES].sort()).toEqual(["CALIBRATOR ADMIN", "HEALTHCARE ADMIN", "HEALTHCARE TECHNICIAN", "ROOM USER", "TECHNICIAN"]);
  });

  it("a username starts from upstream's, else the e-mail's local part, else upstream_<id>; a taken one gets _2, _3 …", () => {
    expect(usernameBase({ usernameKey: "Budi", emailKey: "x@example.test", legacyId: "1" })).toBe("Budi");
    expect(usernameBase({ usernameKey: "", emailKey: "sari@example.test", legacyId: "1" })).toBe("sari");
    expect(usernameBase({ usernameKey: "", emailKey: "", legacyId: "7" })).toBe("upstream_7");
    expect(freeUsername("budi", new Map(), new Set())).toBe("budi");
    expect(freeUsername("Budi", new Map([["budi", "x"]]), new Set(["budi_2"]))).toBe("Budi_3");
    expect(freeUsername("a".repeat(100), new Map([["a".repeat(100), "x"]]), new Set())).toBe(`${"a".repeat(98)}_2`);
  });
});

describe("P24-02b the users plan (P18-01-02 § 2.2)", () => {
  it("staff are unbound; the earliest active client of a facility is its HEALTHCARE ADMIN, the rest ROOM USER; teknisi_client HEALTHCARE TECHNICIAN", () => {
    const plan = planUsers(
      input({
        users: [
          user("1"),
          user("2"),
          user("3", { createdAtMs: "500", active: false }),
          user("4", { createdAtMs: "2000" }),
          user("5", { createdAtMs: null }),
          user("6"),
          user("7"),
        ],
        memberships: [
          member("1", "admin"),
          member("2", "user"),
          member("3", "client"),
          member("4", "client"),
          member("5", "client"),
          member("6", "client"),
          member("7", "teknisi_client"),
        ],
        mappings: [mapRow("11", "3", F1), mapRow("12", "4", F1), mapRow("13", "5", F1), mapRow("14", "6", F2), mapRow("15", "7", F2)],
      }),
    );
    expect(plan.insert.map((i) => [i.username, i.role, i.facilityId])).toEqual([
      ["user1", "CALIBRATOR ADMIN", null],
      ["user2", "TECHNICIAN", null],
      ["user3", "ROOM USER", F1],
      ["user4", "HEALTHCARE ADMIN", F1],
      ["user5", "ROOM USER", F1],
      ["user6", "HEALTHCARE ADMIN", F2],
      ["user7", "HEALTHCARE TECHNICIAN", F2],
    ]);
    const userMappings = plan.mappings.filter((m) => m.sourceTable === "users");
    expect(userMappings.map((m) => [m.legacyId, m.targetTable, m.tenantId, m.clientFacilityId, m.sourceValues])).toEqual([
      ["1", "users", TENANT, null, null],
      ["2", "users", TENANT, null, null],
      ["3", "users", TENANT, F1, null],
      ["4", "users", TENANT, F1, null],
      ["5", "users", TENANT, F1, null],
      ["6", "users", TENANT, F2, null],
      ["7", "users", TENANT, F2, null],
    ]);
    // Memberships and mappings follow their user, with the user's facility.
    expect(plan.mappings.filter((m) => m.sourceTable === "trx_mapping_user_client").map((m) => [m.legacyId, m.clientFacilityId])).toEqual([
      ["11", F1],
      ["12", F1],
      ["13", F1],
      ["14", F2],
      ["15", F2],
    ]);
    expect(plan.mappings.filter((m) => m.sourceTable === "auth_groups_users")).toHaveLength(7);
    expect(plan.quarantine).toEqual([]);
  });

  it("equal creation times: the lowest upstream id is the admin", () => {
    const plan = planUsers(
      input({
        users: [user("9"), user("8")],
        memberships: [member("9", "client"), member("8", "client")],
        mappings: [mapRow("21", "9", F1), mapRow("22", "8", F1)],
      }),
    );
    expect(plan.insert.map((i) => [i.username, i.role])).toEqual([
      ["user8", "HEALTHCARE ADMIN"],
      ["user9", "ROOM USER"],
    ]);
    // Numerically equal ids are ordered by their text ("07" before "7").
    const tied = planUsers(input({ users: [user("7"), user("07")], memberships: [member("7", "admin"), member("07", "admin")] }));
    expect(tied.insert.map((i) => i.username)).toEqual(["user07", "user7"]);
  });

  it("quarantines: no group, two groups, zero or two mappings, a facility not imported, an e-mail held by another account", () => {
    const plan = planUsers(
      input({
        users: [user("1"), user("2"), user("3"), user("4"), user("5"), user("6"), user("7", { targetId: "a2402000-0000-4000-8000-0000000000d7" })],
        memberships: [
          member("2", "admin"),
          member("2", "user"),
          member("3", "client"),
          member("4", "teknisi_client"),
          member("5", "client"),
          member("6", "admin"),
          member("7", "admin"),
        ],
        mappings: [mapRow("31", "4", F1), mapRow("32", "4", F2), mapRow("33", "5", null)],
        takenEmails: new Map([
          ["user6@example.test", "someone-else"],
          ["user7@example.test", "a2402000-0000-4000-8000-0000000000d7"],
        ]),
      }),
    );
    expect(plan.quarantine.filter((q) => q.sourceTable === "users").map((q) => [q.legacyId, q.reason])).toEqual([
      ["1", "user_without_group"],
      ["2", "group_conflict"],
      ["3", "facility_mapping_ambiguous"],
      ["4", "facility_mapping_ambiguous"],
      ["5", "facility_not_imported"],
      ["6", "email_in_use"],
    ]);
    // 7's e-mail is held by ITS OWN earlier target — no collision (but the target is gone: a new account).
    expect(plan.insert.map((i) => i.username)).toEqual(["user7"]);
    // Every link of a quarantined user is quarantined user_not_imported.
    expect(plan.quarantine.filter((q) => q.sourceTable !== "users").map((q) => [q.sourceTable, q.reason])).toEqual([
      ["auth_groups_users", "user_not_imported"],
      ["auth_groups_users", "user_not_imported"],
      ["auth_groups_users", "user_not_imported"],
      ["auth_groups_users", "user_not_imported"],
      ["auth_groups_users", "user_not_imported"],
      ["auth_groups_users", "user_not_imported"],
      ["trx_mapping_user_client", "user_not_imported"],
      ["trx_mapping_user_client", "user_not_imported"],
      ["trx_mapping_user_client", "user_not_imported"],
    ]);
  });

  it("groups: the four known map to their role (the client group to ROOM USER's), an unknown or unseeded one is quarantined; unchanged ones skip", () => {
    const plan = planUsers(
      input({
        groups: [
          link("1", { groupName: "admin" }),
          link("2", { groupName: "client", decision: "unchanged", targetId: "r-ru" }),
          link("3", { groupName: "auditor" }),
          link("4", { groupName: null }),
          link("5", { groupName: "user" }),
        ],
        roles: new Map([...ROLES].filter(([name]) => name !== "TECHNICIAN")),
      }),
    );
    expect(plan.mappings.map((m) => [m.sourceTable, m.legacyId, m.targetTable, m.targetId, m.tenantId])).toEqual([["auth_groups", "1", "roles", "r-ca", null]]);
    expect(plan.quarantine.map((q) => [q.legacyId, q.reason])).toEqual([
      ["3", "unknown_group"],
      ["4", "unknown_group"],
      ["5", "unknown_group"],
    ]);
  });

  it("a membership in an unknown group is quarantined unknown_group and does not count as a group; orphan links user_not_imported", () => {
    const plan = planUsers(
      input({
        users: [user("1")],
        memberships: [member("1", "admin"), member("1", "auditor"), link("x", { groupName: "admin", userLegacyId: null })],
        mappings: [link("41", { userLegacyId: null }), mapRow("42", "99", F1)],
      }),
    );
    expect(plan.insert.map((i) => i.role)).toEqual(["CALIBRATOR ADMIN"]);
    expect(plan.quarantine.map((q) => [q.sourceTable, q.legacyId, q.reason])).toEqual([
      ["auth_groups_users", "7:1", "unknown_group"],
      ["auth_groups_users", "x", "user_not_imported"],
      ["trx_mapping_user_client", "41", "user_not_imported"],
      ["trx_mapping_user_client", "42", "user_not_imported"],
    ]);
  });

  it("re-runs: an unchanged user and its links skip; a changed one updates; a vanished one is made again; usernames avoid taken and given names", () => {
    const kept = "a2402000-0000-4000-8000-0000000000d1";
    const changed = "a2402000-0000-4000-8000-0000000000d2";
    const plan = planUsers(
      input({
        users: [
          user("1", { decision: "unchanged", targetId: kept, targetPresent: true }),
          user("2", { decision: "changed", targetId: changed, targetPresent: true }),
          user("3", { decision: "unchanged", targetId: "a2402000-0000-4000-8000-0000000000d3", usernameKey: "dup" }),
          user("4", { usernameKey: "DUP" }),
        ],
        memberships: [
          member("1", "admin", { decision: "unchanged", targetId: kept }),
          member("2", "admin"),
          member("3", "user"),
          member("4", "user"),
        ],
        takenUsernames: new Map([["dup", "someone"]]),
      }),
    );
    expect(plan.update).toEqual([{ id: changed, sourceRowNumber: "102" }]);
    expect(plan.insert.map((i) => i.username)).toEqual(["dup_2", "DUP_3"]);
    expect(plan.mappings.filter((m) => m.sourceTable === "users").map((m) => m.legacyId)).toEqual(["2", "3", "4"]);
    expect(plan.mappings.filter((m) => m.sourceTable === "auth_groups_users").map((m) => m.legacyId)).toEqual(["5:2", "4:3", "4:4"]);
  });
});

describe("P24-02b the users step", () => {
  const ROLE_ROWS: [RegExp, () => object[]] = [/FROM roles WHERE name = ANY/, () => [...ROLES].map(([name, id]) => ({ id, name }))];

  it("a dump without users writes nothing", async () => {
    const runner = double([[/to_regclass/, () => [{ present: false }]]]);
    await runUsers(context(runner));
    expect(runner.calls.map((c) => c.bind)).toEqual([["upstream_import.stg_users"]]);
  });

  it("reads users, groups, memberships and mappings; checks roles and collisions; inserts with ONE unusable hash; maps — all bound", async () => {
    const runner = double([
      [/to_regclass/, () => [{ present: true }]],
      [/AS "emailKey",/, () => [user("1"), user("2", { usernameKey: "" }), user("3", { decision: "changed", targetId: "a2402000-0000-4000-8000-0000000000d3", targetPresent: true })]],
      [/AS "groupName", NULL AS "userLegacyId"/, () => [link("1", { groupName: "admin" })]],
      [/s."user_id"::text AS "userLegacyId"/, () => [member("1", "admin"), member("2", "admin"), member("3", "admin")]],
      [/s."id_user"::text AS "userLegacyId"/, () => []],
      ROLE_ROWS,
      [/AS "usernameKey", lower\(email\)/, () => [{ id: "z", usernameKey: "user1", emailKey: "other@example.test" }]],
    ]);
    await runUsers(context(runner));
    const texts = runner.calls.map((c) => c.text);
    const read = runner.calls.find((c) => c.text.includes('AS "emailKey",'));
    expect(read?.bind).toEqual([RUN, TENANT, "Asia/Jakarta"]);
    expect(read?.text).toContain("LEFT JOIN users u ON u.tenant_id = $2 AND u.id = c.\"targetId\"");
    const membershipRead = runner.calls.find((c) => c.text.includes('s."user_id"::text'));
    expect(membershipRead?.text).toContain('FROM upstream_import."stg_auth_groups" g WHERE g.import_run_id = $1');
    expect(runner.calls.find((c) => c.text.includes('s."id_user"'))?.bind).toEqual([RUN, TENANT]);
    const collisions = runner.calls.find((c) => c.text.includes('AS "usernameKey", lower(email)'));
    expect(collisions?.bind).toEqual([
      ["user1@example.test", "user2@example.test", "user3@example.test"],
      ["user1%", "user2%", "user3%"],
    ]);
    const insert = runner.calls.find((c) => c.text.startsWith("INSERT INTO users"));
    expect(insert?.bind.slice(0, 5)).toEqual([RUN, TENANT, [expect.any(String), expect.any(String)], ["101", "102"], ["CALIBRATOR ADMIN", "CALIBRATOR ADMIN"]]);
    expect(insert?.bind.slice(6)).toEqual(["Asia/Jakarta", ["user1_2", "user2"], [null, null]]);
    const hash = insert?.bind[5] as string;
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(await comparePassword("", hash)).toBe(false);
    expect(insert?.text).toContain("WHERE NOT EXISTS (SELECT 1 FROM users e WHERE e.tenant_id = $2 AND e.id = v.id)");
    expect(insert?.text).not.toMatch(/mfa|recovery|otp/);
    // P24-08 (ADR-139 § 2): every inserted account awaits its invitation — column and value aligned.
    expect(insert?.text).toMatch(/client_facility_id, facility_binding_pending,\s+awaiting_invitation, is_deleted, created_at/);
    expect(insert?.text).toContain("false, true, false, v.facility, false, true, false,");
    const update = runner.calls.find((c) => c.text.startsWith("UPDATE users"));
    expect(update?.bind).toEqual([RUN, TENANT, ["a2402000-0000-4000-8000-0000000000d3"], ["103"]]);
    expect(update?.text).not.toContain("awaiting_invitation");
    expect(update?.text).not.toMatch(/SET[^]*\b(email|username|role_id|client_facility_id|password)\s*=/);
    expect(texts.filter((t) => t.includes("INSERT INTO upstream_import.id_map"))).toHaveLength(1);
    expect(runner.calls.every((c) => c.transaction === TX)).toBe(true);
  });

  it("without groups, memberships or mappings staged: no such reads, every user quarantined user_without_group, no insert, no hash", async () => {
    const runner = double([
      [/to_regclass/, (call) => [{ present: call.bind[0] === "upstream_import.stg_users" }]],
      [/AS "emailKey",/, () => [user("1")]],
      ROLE_ROWS,
    ]);
    await runUsers(context(runner));
    expect(runner.calls.some((c) => /"groupName"|INSERT INTO users|UPDATE users/.test(c.text))).toBe(false);
    expect(runner.calls.find((c) => c.text.includes("upstream_import.quarantine"))?.bind).toEqual([RUN, "users", "101", "1", "user_without_group"]);
  });

  it("memberships without staged groups have no group name (so no user is placed)", async () => {
    const runner = double([
      [/to_regclass/, (call) => [{ present: call.bind[0] !== "upstream_import.stg_auth_groups" }]],
      [/AS "emailKey",/, () => []],
      ROLE_ROWS,
    ]);
    await runUsers(context(runner));
    expect(runner.calls.find((c) => c.text.includes('s."user_id"::text'))?.text).toContain('NULL AS "groupName"');
  });

  it("a role that is not seeded fails the step before anything is written", async () => {
    const seeded = double([
      [/to_regclass/, (call) => [{ present: call.bind[0] === "upstream_import.stg_users" }]],
      [/FROM roles WHERE name = ANY/, () => [{ id: "r-ca", name: "CALIBRATOR ADMIN" }]],
    ]);
    await expect(runUsers(context(seeded))).rejects.toThrow("the role(s) TECHNICIAN, ROOM USER, HEALTHCARE TECHNICIAN, HEALTHCARE ADMIN are not seeded");
    expect(seeded.calls.some((c) => /INSERT|UPDATE/.test(c.text))).toBe(false);
  });
});

describe("P24-02b sources", () => {
  it("are frozen and keyed as the registry declares", () => {
    expect(Object.isFrozen(USER_SOURCES) && Object.values(USER_SOURCES).every((s) => Object.isFrozen(s))).toBe(true);
  });
});
