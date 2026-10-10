/**
 * ADR-083 (agent dbD) — D-22, D-26 and D-29 against a REAL PostgreSQL 18,
 * running as the APPLICATION ROLE (DB_APP_ROLE), not the owner — except the
 * D-29 DDL, which only the owner may run and which runs first.
 *
 *  - migration 0088: `attachments.file_purged_at` is a nullable timestamptz.
 *  - D-22 sweep: the file of a row soft-deleted past the window is removed,
 *    the row marked, and one system-actor DELETE audit row written that
 *    satisfies migration 0033's actor CHECK; a live row, a row inside the
 *    window and another tenant's live row keep their files; a second run finds
 *    nothing.
 *  - D-22 type: a row stored with a free-string type before the list existed
 *    can still be soft-deleted through the model; a new one is refused.
 *  - D-22 project: deleting a kanban project soft-deletes its cards' files,
 *    one audit row each naming the card, with the project as `via`.
 *  - D-26: every model ENUM's labels equal the labels of the column's type in
 *    pg_enum, in order.
 *  - D-29: 0019's `up`, re-run against a table whose signing-key index exists
 *    only under ANOTHER name, does not create a second one.
 *
 * NEEDS a scratch database (its name contains "scratch") and
 * DB_APP_ROLE naming the application role. The suite boots the schema the way
 * backend/index.js does (fixtures/liveBoot#bootSchema: db.sync(), then every
 * migration — 0057 creates and grants DB_APP_ROLE) as the owner before it
 * switches role; on an already-booted database that applies nothing. (It used
 * to ASSUME a booted database: on a fresh one every case failed in beforeAll
 * with no message — 2026-10-08, the live-suites repair.)
 *
 *   DB_HOST=127.0.0.1 DB_PORT=55922 DB_NAME=dbd_fresh_scratch \
 *     DB_USER=postgres DB_PASS=x DB_APP_ROLE=dbd_fresh_app \
 *     npm run test:live:jest -- src/tests/services/dataLayer.dbD.live
 *
 * Every run creates its own tenants, so it can be re-run on the same database.
 */

jest.setTimeout(120000);

const startProcess = () => {
  const { db } = require("../../config");
  db.options.logging = false;
  return {
    db,
    models: require("../../models"),
    tenantStorage: require("../../middlewares/tenantContext.middleware").tenantStorage,
    dbRole: require("../../utils/dbRole.util"),
    attachments: require("../../services/attachment.service"),
    sweep: require("../../services/attachmentFileSweep.service"),
    kanban: require("../../services/kanban.service"),
    storagePath: require("../../utils/storagePath.util"),
    migration0019: require("../../migrations/0019-add-signature-crypto-fields"),
  };
};

describe("dbD — ADR-083 on live PostgreSQL 18, as the application role", () => {
  const fs = require("fs");
  const path = require("path");
  const { randomUUID } = require("crypto");
  let g;
  const A = randomUUID();
  const B = randomUUID();
  const ids = {};
  const files = [];
  let d29;

  const q = async (sql, replacements = {}) => {
    try {
      const [rows] = await g.db.query(sql, { replacements });
      return rows;
    } catch (err) {
      throw new Error(`${err.original ? err.original.message : err.message}\n${sql}`);
    }
  };
  const one = async (sql, replacements) => (await q(sql, replacements))[0];
  const inTenant = (tenantId, fn) => g.tenantStorage.run({ tenantId, isSuperAdmin: false }, fn);

  /** An attachment row with a real file on disk, deleted `ageDays` ago (or live). */
  const attachment = async (tenantId, { resourceType = "generic", resourceId = null, deletedDaysAgo = null } = {}) => {
    const fileName = `dbd-${randomUUID()}.bin`;
    const abs = g.storagePath("uploads", "attachments", fileName);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "evidence");
    files.push(abs);
    const deleted = deletedDaysAgo !== null;
    const row = await one(
      `INSERT INTO attachments (id, tenant_id, resource_type, resource_id, file_name, original_name, folder,
                                is_deleted, created_at, updated_at)
       VALUES (gen_random_uuid(), :tenantId, :resourceType, :resourceId, :fileName, 'f.pdf', 'uploads/attachments',
               :deleted, now() - interval '400 days',
               now() - (:age || ' days')::interval) RETURNING id`,
      { tenantId, resourceType, resourceId, fileName, deleted, age: String(deleted ? deletedDaysAgo : 0) },
    );
    return { id: row.id, abs };
  };

  beforeAll(async () => {
    if (!/scratch/.test(process.env.DB_NAME || "")) {
      throw new Error(`Refusing DB_NAME="${process.env.DB_NAME}": use a scratch database`);
    }
    if (!process.env.DB_APP_ROLE) {
      throw new Error("Set DB_APP_ROLE: this test runs as the application role");
    }
    g = startProcess();
    // As the owner, before anything else: sync + every migration (none pending on a booted database).
    await require("../fixtures/liveBoot").bootSchema(g.db, require("../../config/migrator").migrator);

    // D-29, as the OWNER (DDL): the signing-key index under another name only.
    const qi = g.db.getQueryInterface();
    await q("DROP INDEX IF EXISTS signature_records_signing_key_id");
    await q("CREATE INDEX IF NOT EXISTS dbd_sig_key_other_name ON signature_records (signing_key_id)");
    d29 = { shape: (await qi.showIndex("signature_records")).find((i) => i.name === "dbd_sig_key_other_name") };
    await g.migration0019.up({ context: qi });
    d29.after = (await q(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'signature_records' AND indexdef LIKE '%(signing_key_id)%' ORDER BY 1",
    )).map((r) => r.indexname);
    // Put the database back as the migration leaves it.
    await q("DROP INDEX dbd_sig_key_other_name");
    await q("CREATE INDEX signature_records_signing_key_id ON signature_records (signing_key_id)");

    await g.dbRole.enterApplicationRole({ sequelize: g.db, logger: { info() {}, warn() {} } });
    expect((await one("SELECT current_user AS u")).u).toBe(process.env.DB_APP_ROLE);

    const tag = A.slice(0, 8);
    await q(
      `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES
         (:a, 'dbD A', :sa, :ea, now(), now()), (:b, 'dbD B', :sb, :eb, now(), now())`,
      { a: A, b: B, sa: `dbd-a-${tag}`, sb: `dbd-b-${tag}`, ea: `a-${tag}@dbd.test`, eb: `b-${tag}@dbd.test` },
    );
    ids.user = (
      await one(
        `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, avatar_url,
                            status, must_change_password, is_deleted, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, :u, :e, 'x', 'D', 'D', 'default.svg', 'ACTIVE', false, false, now(), now())
         RETURNING id`,
        { t: A, u: `dbd-${tag}`, e: `dbd-${tag}@dbd.test` },
      )
    ).id;
  });

  afterAll(async () => {
    for (const abs of files) {
      fs.rmSync(abs, { force: true });
    }
    if (g) {
      await g.db.close();
    }
  });

  it("migration 0088: attachments.file_purged_at is a nullable timestamptz with no default", async () => {
    const col = await one(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_name = 'attachments' AND column_name = 'file_purged_at'`,
    );
    expect(col).toEqual({ data_type: "timestamp with time zone", is_nullable: "YES", column_default: null });
  });

  it("D-29: showIndex reports fields as {attribute}, and 0019 does not duplicate an index made under another name", () => {
    expect(d29.shape.fields.map((f) => f.attribute)).toEqual(["signing_key_id"]);
    expect(d29.after).toEqual(["dbd_sig_key_other_name"]);
  });

  it("D-22 sweep: removes the file past the window, marks and audits it as the system; keeps the rest; a re-run finds nothing", async () => {
    const old = await attachment(A, { deletedDaysAgo: 120 });
    const recent = await attachment(A, { deletedDaysAgo: 10 });
    const liveRow = await attachment(A);
    const oldB = await attachment(B, { deletedDaysAgo: 200 });
    const liveB = await attachment(B);

    const summary = await g.sweep.sweepDeletedAttachmentFiles();
    expect(summary.removed).toBeGreaterThanOrEqual(2);
    expect(summary.failed).toBe(0);

    expect(fs.existsSync(old.abs)).toBe(false);
    expect(fs.existsSync(oldB.abs)).toBe(false);
    for (const kept of [recent, liveRow, liveB]) {
      expect(fs.existsSync(kept.abs)).toBe(true);
    }
    const marks = await q("SELECT id, file_purged_at IS NOT NULL AS purged FROM attachments WHERE id IN (:list)", {
      list: [old.id, recent.id, liveRow.id, oldB.id, liveB.id],
    });
    expect(Object.fromEntries(marks.map((r) => [r.id, r.purged]))).toEqual({
      [old.id]: true,
      [recent.id]: false,
      [liveRow.id]: false,
      [oldB.id]: true,
      [liveB.id]: false,
    });

    const audit = await q(
      `SELECT tenant_id, user_id, actor_type, actor_name, action, changes FROM audit_logs
        WHERE resource_type = 'Attachment' AND resource_id IN (:list) ORDER BY tenant_id`,
      { list: [old.id, oldB.id, recent.id, liveRow.id] },
    );
    expect(audit).toHaveLength(2);
    for (const row of audit) {
      expect(row).toMatchObject({
        user_id: null,
        actor_type: "system",
        actor_name: "system:attachment-file-sweep",
        action: "DELETE",
      });
      expect(row.changes).toMatchObject({ operation: "file-purge", file: "removed", retentionDays: 90 });
    }

    const again = await g.sweep.sweepDeletedAttachmentFiles();
    const reswept = await q(
      "SELECT count(*)::int AS n FROM audit_logs WHERE resource_type = 'Attachment' AND resource_id IN (:list)",
      { list: [old.id, oldB.id] },
    );
    expect(reswept[0].n).toBe(2);
    expect(again.failed).toBe(0);
  });

  it("D-22 type: a legacy free-string row can still be soft-deleted through the model; a new one is refused", async () => {
    const legacy = await attachment(A, { resourceType: "legacy-typo" });
    await inTenant(A, () => g.attachments.deleteAttachment(A, legacy.id, { userId: ids.user }));
    expect((await one("SELECT is_deleted FROM attachments WHERE id = :id", { id: legacy.id })).is_deleted).toBe(true);

    await expect(
      inTenant(A, () =>
        g.models.Attachment.create({ tenantId: A, resourceType: "legacy-typo", fileName: "x", originalName: "x" }),
      ),
    ).rejects.toThrow('resourceType "legacy-typo" is not one of');
  });

  it("D-22 project: deleting a kanban project soft-deletes its cards' files, each audit row naming the card and the project", async () => {
    const project = (
      await one(
        `INSERT INTO kanban_projects (id, tenant_id, name, card_seq, created_by, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, 'dbD board', 0, :u, now(), now()) RETURNING id`,
        { t: A, u: ids.user },
      )
    ).id;
    const column = (
      await one(
        `INSERT INTO kanban_columns (id, project_id, name, position, is_done, created_at, updated_at)
         VALUES (gen_random_uuid(), :p, 'To Do', 0, false, now(), now()) RETURNING id`,
        { p: project },
      )
    ).id;
    const card = async (title) =>
      (
        await one(
          `INSERT INTO kanban_cards (id, tenant_id, project_id, column_id, title, position, created_at, updated_at)
           VALUES (gen_random_uuid(), :t, :p, :c, :title, 0, now(), now()) RETURNING id`,
          { t: A, p: project, c: column, title },
        )
      ).id;
    const c1 = await card("one");
    const c2 = await card("two");
    const f1 = await attachment(A, { resourceType: "KanbanCard", resourceId: c1 });
    const f2 = await attachment(A, { resourceType: "kanbancard", resourceId: c2 });
    const elsewhere = await attachment(A, { resourceType: "generic" });

    await inTenant(A, () => g.kanban.deleteProject({ id: ids.user, tenantId: A, role: { name: "TECHNICIAN" } }, project));

    const flags = await q("SELECT id, is_deleted FROM attachments WHERE id IN (:list)", {
      list: [f1.id, f2.id, elsewhere.id],
    });
    expect(Object.fromEntries(flags.map((r) => [r.id, r.is_deleted]))).toEqual({
      [f1.id]: true,
      [f2.id]: true,
      [elsewhere.id]: false,
    });
    const audit = await q(
      `SELECT resource_id, user_id, changes->'cascade' AS cascade FROM audit_logs
        WHERE resource_type = 'Attachment' AND action = 'DELETE' AND resource_id IN (:list)`,
      { list: [f1.id, f2.id] },
    );
    const byId = Object.fromEntries(audit.map((r) => [r.resource_id, r]));
    expect(byId[f1.id].cascade).toEqual({ type: "KanbanCard", id: c1, via: { type: "KanbanProject", id: project } });
    expect(byId[f2.id].cascade).toEqual({ type: "KanbanCard", id: c2, via: { type: "KanbanProject", id: project } });
    expect(byId[f1.id].user_id).toBe(ids.user);
    expect((await one("SELECT deleted_at IS NOT NULL AS gone FROM kanban_projects WHERE id = :p", { p: project })).gone).toBe(
      true,
    );
  });

  it("D-26: every model ENUM's labels equal its column type's labels in pg_enum, in order", async () => {
    const mismatches = [];
    let checked = 0;
    for (const Model of new Set(Object.values(g.models.sequelize.models))) {
      for (const [attr, def] of Object.entries(Model.getAttributes())) {
        if (!def.type || def.type.key !== "ENUM") {
          continue;
        }
        const rows = await q(
          `SELECT e.enumlabel AS label
             FROM information_schema.columns c
             JOIN pg_type t ON t.typname = c.udt_name
             JOIN pg_enum e ON e.enumtypid = t.oid
            WHERE c.table_schema = 'public' AND c.table_name = :table AND c.column_name = :column
            ORDER BY e.enumsortorder`,
          { table: Model.getTableName().tableName || Model.getTableName(), column: def.field },
        );
        checked += 1;
        const labels = rows.map((r) => r.label);
        if (JSON.stringify(labels) !== JSON.stringify([...def.type.values])) {
          mismatches.push({ enum: `${Model.name}.${attr}`, model: [...def.type.values], database: labels });
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
    expect(mismatches).toEqual([]);
  });
});
