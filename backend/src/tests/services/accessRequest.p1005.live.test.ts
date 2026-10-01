/**
 * P10-05 / P10-10 / P10-07 against a REAL PostgreSQL 18: what memoryDb cannot
 * prove.
 *
 *  - The boot path (runSchemaSetup: db.sync() then every migration) leaves
 *    `access_requests` exactly as 0099 describes it — columns, ENUM types, the
 *    CHECK, the tenant foreign key (SET NULL), the indexes; 0100's unique
 *    passkey index on users; and the schema check (schemaVerify) passes.
 *  - 0099's own createTable path (down, then up with no table) builds the same
 *    shape, and `down` really drops the table and its types.
 *  - BR-P10-3 holds in the DATABASE: a decided request without `decided_at`
 *    is refused by the CHECK.
 *  - BR-P10-4: two super admins approving ONE request at the same moment —
 *    the row lock (`FOR UPDATE`) makes exactly one approval create a tenant;
 *    the other waits, then answers the 409 state explanation.
 *  - A taken tenant code rolls the whole approval back on a real transaction.
 *
 * Opt-in, on an EMPTY scratch database it rebuilds:
 *
 *   P1005_PG_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=55105 DB_NAME=callibrator_scratch_p1005 \
 *     DB_USER=postgres DB_PASS=... npm test -- src/tests/services/accessRequest.p1005.live --coverage=false
 */
import { env } from "../../config/env";

const live = env("P1005_PG_LIVE_TEST") === "1" ? describe : describe.skip;

type Row = Record<string, unknown>;
interface LiveDb {
  options: { logging: unknown };
  query(sql: string, options?: object): Promise<[Row[], unknown]>;
  close(): Promise<void>;
  getQueryInterface(): unknown;
}
interface Svc {
  submitAccessRequest: (input: object, origin: object) => Promise<string>;
  approveAccessRequest: (id: string, input: object, actor: object) => Promise<unknown>;
}
interface Graph {
  db: LiveDb;
  migrator: unknown;
  migrationLock: { runSchemaSetup(options: object): Promise<unknown> };
  schemaVerify: { verifySchema(db: LiveDb): Promise<{ problems: string[] }> };
  svc: Svc;
  m0099: { up(o: { context: unknown }): Promise<void>; down(o: { context: unknown }): Promise<void> };
  m0104: { up(o: { context: unknown }): Promise<void>; down(o: { context: unknown }): Promise<void> };
}

/* eslint-disable @typescript-eslint/no-require-imports -- the JavaScript graph, loaded after the environment is set */
const startProcess = (): Graph => {
  let graph: Graph | undefined;
  jest.isolateModules(() => {
    const db = (require("../../config") as { db: LiveDb }).db;
    db.options.logging = false;
    graph = {
      db,
      migrator: (require("../../config/migrator") as { migrator: unknown }).migrator,
      migrationLock: require("../../utils/migrationLock.util") as Graph["migrationLock"],
      schemaVerify: require("../../utils/schemaVerify.util") as Graph["schemaVerify"],
      svc: require("../../services/accessRequest.service") as Svc,
      m0099: require("../../migrations/0099-access-requests") as Graph["m0099"],
      m0104: require("../../migrations/0104-webauthn-credentials") as Graph["m0104"],
    };
  });
  if (!graph) {
    throw new Error("the module graph did not load");
  }
  return graph;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
const PLATFORM = "00000000-0000-4000-8000-000000000001";
const SUPER_A = "5a5a5a5a-0000-4000-8000-00000000005a";
const SUPER_B = "5b5b5b5b-0000-4000-8000-00000000005b";

const INPUT = {
  organisationName: "RSUD Live",
  facilityType: "hospital",
  city: "Bandung",
  deviceCountBand: "lt_100",
  contactName: "Siti Rahma",
  contactRole: null,
  workEmail: "siti@rsud-live.test",
  whatsapp: "+6281234567890",
  needs: null,
  consent: true,
  consentVersion: "2026-09-29",
  locale: "id",
  website: "",
};

live("P10-05 on live PostgreSQL 18", () => {
  let g: Graph;

  const rows = async (sql: string, replacements: object = {}): Promise<Row[]> => (await g.db.query(sql, { replacements }))[0];

  beforeAll(async () => {
    const name = env("DB_NAME") ?? "";
    if (!name.includes("scratch")) {
      throw new Error(`Refusing to rebuild DB_NAME="${name}": use a scratch database (see the header)`);
    }
    g = startProcess();
    await g.migrationLock.runSchemaSetup({ sequelize: g.db, migrator: g.migrator, logger });
    await g.db.query(
      `INSERT INTO roles (id, name, role_level, created_at, updated_at) VALUES
         ('9be20605-cc6a-4d91-8246-9756b4a1754b', 'SUPERADMIN', 10, now(), now()),
         ('cd8ce1a8-138e-4a4d-8ae2-2f52ad3a8d08', 'HEALTHCARE ADMIN', 8, now(), now())
       ON CONFLICT (id) DO NOTHING`,
    );
    for (const [id, name] of [
      [SUPER_A, "andi"],
      [SUPER_B, "budi"],
    ] as const) {
      await g.db.query(
        `INSERT INTO users (id, tenant_id, role_id, username, email, password, first_name, last_name, avatar_url,
                            status, must_change_password, is_deleted, created_at, updated_at)
         VALUES (:id, :t, '9be20605-cc6a-4d91-8246-9756b4a1754b', :name, :email, 'x', :name, 'Operator',
                 'default.svg', 'ACTIVE', false, false, now(), now())`,
        { replacements: { id, t: PLATFORM, name, email: `${name}@platform.test` } },
      );
    }
  }, 1500000);

  afterAll(async () => {
    await g.db.close();
  });

  it("the boot path leaves access_requests as 0099 describes it — columns, types, CHECK, FK, indexes", async () => {
    const columns = await rows(
      `SELECT column_name, data_type, udt_name, is_nullable FROM information_schema.columns
        WHERE table_name = 'access_requests' ORDER BY ordinal_position`,
    );
    expect(columns.map((c) => c["column_name"]).sort()).toEqual(
      [
        "id", "organisation_name", "facility_type", "city", "device_count_band", "contact_name", "contact_role",
        "work_email", "whatsapp", "needs", "locale", "consent_version", "consented_at", "status", "admin_user_id",
        "decided_by", "decided_at", "decision_note", "provisioned_tenant_id", "invitation_token_hash",
        "invitation_expires_at", "invitation_sent_at", "invitation_accepted_at", "source_ip_hash", "user_agent",
        "created_at", "updated_at",
      ].sort(),
    );
    const byName = new Map(columns.map((c) => [c["column_name"], c]));
    expect(byName.get("status")).toMatchObject({ udt_name: "enum_access_requests_status", is_nullable: "NO" });
    expect(byName.get("work_email")).toMatchObject({ is_nullable: "NO" });
    expect(byName.get("provisioned_tenant_id")).toMatchObject({ udt_name: "uuid", is_nullable: "YES" });
    // No tenant column: the global hooks never scope this table.
    expect(byName.has("tenant_id")).toBe(false);

    const constraints = await rows(
      `SELECT conname, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid WHERE t.relname = 'access_requests' ORDER BY conname`,
    );
    const defs = new Map(constraints.map((c) => [c["conname"], String(c["def"])]));
    expect(defs.get("access_requests_decided_iff_not_pending")).toMatch(/CHECK/);
    expect(defs.get("access_requests_provisioned_tenant_id_fkey")).toBe(
      "FOREIGN KEY (provisioned_tenant_id) REFERENCES tenants(id) ON UPDATE CASCADE ON DELETE SET NULL",
    );

    const indexes = await rows("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'access_requests' ORDER BY indexname");
    const names = indexes.map((i) => i["indexname"]);
    for (const index of [
      "access_requests_status_created_at",
      "access_requests_work_email",
      "access_requests_admin_user_id",
      "access_requests_decided_by",
      "access_requests_provisioned_tenant_id",
      "access_requests_invitation_token_hash_unique",
    ]) {
      expect(names).toContain(index);
    }
    expect(String(indexes.find((i) => i["indexname"] === "access_requests_invitation_token_hash_unique")?.["indexdef"])).toMatch(
      /UNIQUE INDEX .* WHERE \(invitation_token_hash IS NOT NULL\)/,
    );
    // No unique work_email (an oracle).
    expect(indexes.some((i) => String(i["indexdef"]).includes("UNIQUE") && String(i["indexdef"]).includes("work_email"))).toBe(false);
  });

  it("0100: users.webauthn_credential_id is unique (partial); the schema check passes", async () => {
    const [index] = await rows("SELECT indexdef FROM pg_indexes WHERE indexname = 'users_webauthn_credential_id_unique'");
    expect(String(index?.["indexdef"])).toMatch(/CREATE UNIQUE INDEX .* \(webauthn_credential_id\) WHERE \(webauthn_credential_id IS NOT NULL\)/);
    expect((await g.schemaVerify.verifySchema(g.db)).problems).toEqual([]);
  });

  it("BR-P10-3 in the database: a decided status without decided_at is refused by the CHECK", async () => {
    await expect(
      g.db.query(
        `INSERT INTO access_requests (id, organisation_name, facility_type, city, device_count_band, contact_name,
            work_email, whatsapp, locale, consent_version, consented_at, status, source_ip_hash, created_at, updated_at)
         VALUES (gen_random_uuid(), 'X', 'other', 'Y', 'unknown', 'Z', 'z@z.test', '+6281', 'en', 'v', now(),
                 'rejected', repeat('0', 64), now(), now())`,
      ),
    ).rejects.toThrow(/access_requests_decided_iff_not_pending/);
  });

  it("BR-P10-4: two super admins approving the same request at once create exactly ONE tenant; the other gets the 409", async () => {
    expect(await g.svc.submitAccessRequest(INPUT, { ip: "203.0.113.1", userAgent: "live" })).toBe("stored");
    const [request] = await rows("SELECT id FROM access_requests WHERE work_email = :e", { e: INPUT.workEmail });
    const id = String(request?.["id"]);
    const actor = (userId: string) => ({ userId, ipAddress: null, userAgent: null });

    const results = await Promise.allSettled([
      g.svc.approveAccessRequest(id, { id, tenantCode: "LIVE-A" }, actor(SUPER_A)),
      g.svc.approveAccessRequest(id, { id, tenantCode: "LIVE-B" }, actor(SUPER_B)),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ status: 409 });
    expect((rejected[0]?.reason as Error).message).toMatch(/^This request was already approved on /);

    const tenants = await rows("SELECT code FROM tenants WHERE code IN ('LIVE-A', 'LIVE-B')");
    expect(tenants).toHaveLength(1);
    const admins = await rows("SELECT tenant_id FROM users WHERE email = :e", { e: INPUT.workEmail });
    expect(admins).toHaveLength(1);
    const approvals = await rows("SELECT id FROM audit_logs WHERE resource_type = 'AccessRequest' AND action = 'APPROVE' AND resource_id = :id", { id });
    expect(approvals).toHaveLength(1);
  }, 60000);

  it("a taken tenant code rolls the whole approval back: the request stays pending, no user, no audit row", async () => {
    expect(await g.svc.submitAccessRequest({ ...INPUT, workEmail: "rollback@rsud-live.test" }, { ip: null, userAgent: null })).toBe("stored");
    const [request] = await rows("SELECT id FROM access_requests WHERE work_email = 'rollback@rsud-live.test'");
    const id = String(request?.["id"]);
    const auditsBefore = (await rows("SELECT count(*)::int AS n FROM audit_logs"))[0]?.["n"];
    const takenCode = String((await rows("SELECT code FROM tenants WHERE code IN ('LIVE-A', 'LIVE-B')"))[0]?.["code"]);
    await expect(
      g.svc.approveAccessRequest(id, { id, tenantCode: takenCode }, { userId: SUPER_A, ipAddress: null, userAgent: null }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await rows("SELECT status FROM access_requests WHERE id = :id", { id }))[0]?.["status"]).toBe("pending");
    expect(await rows("SELECT id FROM users WHERE email = 'rollback@rsud-live.test'")).toHaveLength(0);
    expect((await rows("SELECT count(*)::int AS n FROM audit_logs"))[0]?.["n"]).toBe(auditsBefore);
  });

  it("0104 (ADR-108 Am. 1): a one-per-user passkey on `users` moves into webauthn_credentials; the credential id is unique; down moves one back", async () => {
    // The boot path already ran 0104; put the database back to the one-per-user shape.
    await g.m0104.down({ context: g.db.getQueryInterface() });
    expect(await rows("SELECT to_regclass('webauthn_credentials') AS t").then((r) => r[0]?.["t"])).toBeNull();
    await g.db.query(
      `UPDATE users SET webauthn_enabled = true, webauthn_credential_id = 'legacy-cred', webauthn_public_key = 'pk', webauthn_sign_count = 7
        WHERE id = :id`,
      { replacements: { id: SUPER_A } },
    );
    await g.m0104.up({ context: g.db.getQueryInterface() });
    const moved = await rows("SELECT user_id, credential_id, public_key, sign_count::int AS n, name FROM webauthn_credentials");
    expect(moved).toEqual([{ user_id: SUPER_A, credential_id: "legacy-cred", public_key: "pk", n: 7, name: "Passkey" }]);
    expect(await rows("SELECT id FROM users WHERE webauthn_credential_id IS NOT NULL")).toHaveLength(0);
    expect((await rows("SELECT webauthn_enabled FROM users WHERE id = :id", { id: SUPER_A }))[0]?.["webauthn_enabled"]).toBe(true);
    // Re-running changes nothing.
    await g.m0104.up({ context: g.db.getQueryInterface() });
    expect(await rows("SELECT id FROM webauthn_credentials")).toHaveLength(1);
    // A second passkey of the same user is fine; the same credential id on another user is refused.
    await g.db.query(
      `INSERT INTO webauthn_credentials (id, user_id, credential_id, public_key, sign_count, name, created_at, updated_at)
       VALUES (gen_random_uuid(), :u, 'second-cred', 'pk2', 0, 'Phone', now(), now())`,
      { replacements: { u: SUPER_A } },
    );
    await expect(
      g.db.query(
        `INSERT INTO webauthn_credentials (id, user_id, credential_id, public_key, sign_count, name, created_at, updated_at)
         VALUES (gen_random_uuid(), :u, 'second-cred', 'pk3', 0, 'Stolen', now(), now())`,
        { replacements: { u: SUPER_B } },
      ),
    ).rejects.toMatchObject({ name: "SequelizeUniqueConstraintError" });
    const [index] = await rows("SELECT indexdef FROM pg_indexes WHERE indexname = 'webauthn_credentials_user_id'");
    expect(String(index?.["indexdef"])).toContain("(user_id)");
    // Deleting the user removes its passkeys (ON DELETE CASCADE).
    const [fk] = await rows(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'webauthn_credentials'::regclass AND contype = 'f'",
    );
    expect(String(fk?.["def"])).toContain("ON DELETE CASCADE");
    expect((await g.schemaVerify.verifySchema(g.db)).problems).toEqual([]);
  });

  it("0099 down drops the table and its four types; up with no table (its createTable path) rebuilds the same shape", async () => {
    await g.m0099.down({ context: g.db.getQueryInterface() });
    expect(await rows("SELECT to_regclass('access_requests') AS t").then((r) => r[0]?.["t"])).toBeNull();
    expect(await rows("SELECT typname FROM pg_type WHERE typname LIKE 'enum_access_requests_%'")).toHaveLength(0);
    await g.m0099.up({ context: g.db.getQueryInterface() });
    expect(await rows("SELECT typname FROM pg_type WHERE typname LIKE 'enum_access_requests_%' ORDER BY typname")).toHaveLength(4);
    expect((await g.schemaVerify.verifySchema(g.db)).problems).toEqual([]);
    const [fk] = await rows(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'access_requests_provisioned_tenant_id_fkey'",
    );
    expect(String(fk?.["def"])).toContain("ON DELETE SET NULL");
    // Re-running up is a no-op.
    await g.m0099.up({ context: g.db.getQueryInterface() });
  });
});
