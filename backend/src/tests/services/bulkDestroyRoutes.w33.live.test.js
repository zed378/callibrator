/**
 * W-33 against a REAL PostgreSQL 18 — which REQUEST routes answered 500
 * because the tenant hook named the attribute `tenantId` in a bulk DELETE.
 *
 * `Model.destroy({ where })` maps attribute names to columns BEFORE it runs
 * `beforeBulkDestroy`. Until the W-33 fix the tenant hook then added
 * `{ tenantId: ctx }` verbatim, and PostgreSQL answered
 * `column "tenantId" does not exist` for every bulk destroy of a model whose
 * tenant attribute is `tenantId` (column `tenant_id`) — inside a TENANT
 * context only. No context, a system task, a super admin and
 * `skipTenantScope` all skip the hook, so they never saw it. Instance
 * `destroy()` fires `beforeDestroy`, not `beforeBulkDestroy`, so it never did
 * either.
 *
 * Each test drives the service function a route reaches, through the real
 * hooks, inside the context that route's middleware builds
 * (tenantContext.middleware: `{ tenantId, isSuperAdmin, isSystemTask: false }`):
 *  - it succeeds;
 *  - it deletes only the calling tenant's rows — tenant B's are left alone;
 *  - for an :id route, tenant B's id deletes nothing and takes the 404 path.
 *
 * The super-admin-only routes are driven in a super-admin context. They pass
 * with and without the fix: that is the evidence they were NOT broken.
 *
 * OPT-IN — needs a database built by db.sync() of the current models plus
 * every migration (migrator.up()):
 *
 *   W33_PG_LIVE_TEST=1 DB_HOST=... DB_PORT=... DB_NAME=... DB_USER=... DB_PASS=... \
 *     npm test -- src/tests/services/bulkDestroyRoutes.w33.live --coverage=false
 *
 * It creates two tenants with fixed ids and removes everything it wrote.
 * Run on PostgreSQL 18 (pgvector/pgvector:pg18) on 2026-09-25; at beb0c4b's
 * tenantScope.util.js the five tenant-user success tests (kanban delete,
 * notification delete by id / bulk / all, storage settings clear) fail with
 * `column "tenantId" does not exist`; the 404 tests and the super-admin
 * tests pass there too.
 */
const live = process.env.W33_PG_LIVE_TEST === "1" ? describe : describe.skip;

const A = "a33a33a3-0000-4000-8000-0000000000a1";
const B = "b33b33b3-0000-4000-8000-0000000000b1";
const USER_A = "a33a33a3-0000-4000-8000-0000000000e1";
const USER_B = "b33b33b3-0000-4000-8000-0000000000e2";
const PROJECT_A = "a33a33a3-0000-4000-8000-0000000000c1";
const PROJECT_B = "b33b33b3-0000-4000-8000-0000000000c2";

live("W-33 — bulk destroys reached by request routes, on live PostgreSQL", () => {
  jest.setTimeout(60000);
  let db;
  let tenantStorage;

  const q = async (sql, replacements = {}) => (await db.query(sql, { replacements }))[0];
  const n = async (sql, replacements) => Number((await q(sql, replacements))[0].n);

  /** The context auth + tenantContext.middleware build for a tenant user. */
  const asTenantUser = (tenantId, fn) =>
    tenantStorage.run({ tenantId, isSuperAdmin: false, isSystemTask: false }, fn);
  /** ...and for the super admin (its own tenant, or an x-tenant-id override). */
  const asSuperAdmin = (tenantId, fn) =>
    tenantStorage.run({ tenantId, isSuperAdmin: true, isSystemTask: false }, fn);

  const userA = { id: USER_A, tenantId: A, role: { name: "TENANT_ADMIN" } };

  const cleanup = async () => {
    const t = [A, B];
    for (const table of ["audit_logs", "notifications", "tenant_settings", "kanban_projects"]) {
      await q(`DELETE FROM ${table} WHERE tenant_id IN (:t)`, { t });
    }
    await q("DELETE FROM users WHERE id IN (:u)", { u: [USER_A, USER_B] });
    await q("DELETE FROM tenants WHERE id IN (:t)", { t });
  };

  const setting = (tenantId, key, value = "x") =>
    q(
      `INSERT INTO tenant_settings (id, tenant_id, key, value, created_at, updated_at)
       VALUES (gen_random_uuid(), :tenantId, :key, :value, now(), now())`,
      { tenantId, key, value },
    );
  const settings = (tenantId, keys) =>
    n("SELECT count(*)::int AS n FROM tenant_settings WHERE tenant_id = :tenantId AND key IN (:keys)", {
      tenantId,
      keys,
    });

  const notification = async (tenantId, userId, title) => {
    const [row] = await q(
      `INSERT INTO notifications (id, tenant_id, user_id, type, title, message, created_at, updated_at)
       VALUES (gen_random_uuid(), :tenantId, :userId, 'SYSTEM', :title, 'w33', now(), now())
       RETURNING id`,
      { tenantId, userId, title },
    );
    return row.id;
  };
  const notifications = (tenantId) =>
    n("SELECT count(*)::int AS n FROM notifications WHERE tenant_id = :tenantId AND message = 'w33'", { tenantId });

  beforeAll(async () => {
    ({ db } = require("../../config"));
    db.options.logging = false;
    require("../../models");
    ({ tenantStorage } = require("../../middlewares/tenantContext.middleware"));
    await cleanup();
    for (const [id, sub] of [
      [A, "w33-live-a"],
      [B, "w33-live-b"],
    ]) {
      await q(
        `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at)
         VALUES (:id, :sub, :sub, :email, now(), now())`,
        { id, sub, email: `${sub}@example.test` },
      );
    }
    for (const [id, tenantId, name] of [
      [USER_A, A, "w33a"],
      [USER_B, B, "w33b"],
    ]) {
      await q(
        `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, created_at, updated_at)
         VALUES (:id, :tenantId, :name, :email, 'x', 'W', '33', now(), now())`,
        { id, tenantId, name, email: `${name}@example.test` },
      );
    }
  });

  beforeEach(async () => {
    await q("DELETE FROM notifications WHERE tenant_id IN (:t)", { t: [A, B] });
    await q("DELETE FROM tenant_settings WHERE tenant_id IN (:t)", { t: [A, B] });
    await q("DELETE FROM kanban_projects WHERE tenant_id IN (:t)", { t: [A, B] });
  });

  afterAll(async () => {
    if (db) {
      await cleanup();
      await db.close();
    }
  });

  describe("DELETE /api/v1/kanban/projects/:projectId — kanban.deleteProject (paranoid KanbanProject)", () => {
    const seedProjects = async () => {
      for (const [id, tenantId, userId] of [
        [PROJECT_A, A, USER_A],
        [PROJECT_B, B, USER_B],
      ]) {
        await q(
          `INSERT INTO kanban_projects (id, tenant_id, name, created_by, created_at, updated_at)
           VALUES (:id, :tenantId, 'W-33 board', :userId, now(), now())`,
          { id, tenantId, userId },
        );
      }
    };
    const deletedAt = async (id) =>
      (await q("SELECT deleted_at FROM kanban_projects WHERE id = :id", { id }))[0].deleted_at;

    it("a tenant user deletes their own project: it succeeds, and tenant B's project is untouched", async () => {
      await seedProjects();
      const kanban = require("../../services/kanban.service");

      await expect(asTenantUser(A, () => kanban.deleteProject(userA, PROJECT_A))).resolves.toEqual({
        deleted: true,
      });

      expect(await deletedAt(PROJECT_A)).not.toBeNull();
      expect(await deletedAt(PROJECT_B)).toBeNull();
    });

    it("the same shape through beforeBulkUpdate is NOT affected: PATCH /projects/:projectId updates only A's row", async () => {
      // Model.update runs beforeBulkUpdate BEFORE mapOptionFieldNames, so the
      // attribute `tenantId` the hook adds is mapped to tenant_id afterwards.
      await seedProjects();
      const kanban = require("../../services/kanban.service");

      await asTenantUser(A, () => kanban.updateProject(userA, PROJECT_A, { name: "renamed" }));

      const names = await q("SELECT id, name FROM kanban_projects WHERE id IN (:ids) ORDER BY id", {
        ids: [PROJECT_A, PROJECT_B],
      });
      expect(names).toEqual([
        { id: PROJECT_A, name: "renamed" },
        { id: PROJECT_B, name: "W-33 board" },
      ]);
    });

    it("tenant B's project id answers 404 and deletes nothing", async () => {
      await seedProjects();
      const kanban = require("../../services/kanban.service");

      await expect(asTenantUser(A, () => kanban.deleteProject(userA, PROJECT_B))).rejects.toMatchObject({
        status: 404,
      });

      expect(await deletedAt(PROJECT_B)).toBeNull();
      expect(await deletedAt(PROJECT_A)).toBeNull();
    });
  });

  describe("DELETE /api/v1/notifications/* — notification.service (Notification)", () => {
    it("DELETE /:notificationId removes the caller's personal notification, and tenant B's are untouched", async () => {
      const service = require("../../services/notification.service");
      const mine = await notification(A, USER_A, "mine");
      await notification(B, USER_B, "theirs");

      const result = await asTenantUser(A, () => service.deleteNotification(A, USER_A, mine));

      expect(result).toMatchObject({ success: true, status: 200 });
      expect(await notifications(A)).toBe(0);
      expect(await notifications(B)).toBe(1);
    });

    it("DELETE /:notificationId with tenant B's id answers 404 and deletes nothing", async () => {
      const service = require("../../services/notification.service");
      await notification(A, USER_A, "mine");
      const theirs = await notification(B, USER_B, "theirs");

      await expect(asTenantUser(A, () => service.deleteNotification(A, USER_A, theirs))).rejects.toMatchObject({
        status: 404,
      });

      expect(await notifications(A)).toBe(1);
      expect(await notifications(B)).toBe(1);
    });

    it("DELETE /bulk deletes the caller's ids and ignores tenant B's", async () => {
      const service = require("../../services/notification.service");
      const mine = await notification(A, USER_A, "mine");
      const theirs = await notification(B, USER_B, "theirs");

      const result = await asTenantUser(A, () => service.deleteManyNotifications(A, USER_A, [mine, theirs]));

      expect(result.data).toEqual({ deleted: 1, requested: 2 });
      expect(await notifications(A)).toBe(0);
      expect(await notifications(B)).toBe(1);
    });

    it("DELETE /bulk naming only tenant B's ids answers 404 and deletes nothing", async () => {
      const service = require("../../services/notification.service");
      const theirs = await notification(B, USER_B, "theirs");

      await expect(asTenantUser(A, () => service.deleteManyNotifications(A, USER_A, [theirs]))).rejects.toMatchObject({
        status: 404,
      });

      expect(await notifications(B)).toBe(1);
    });

    it("DELETE /all removes every personal notification of the caller, and none of tenant B's", async () => {
      const service = require("../../services/notification.service");
      await notification(A, USER_A, "one");
      await notification(A, USER_A, "two");
      await notification(B, USER_B, "theirs");

      const result = await asTenantUser(A, () => service.deleteAllNotifications(A, USER_A));

      expect(result.data).toEqual({ deleted: 2 });
      expect(await notifications(A)).toBe(0);
      expect(await notifications(B)).toBe(1);
    });
  });

  describe("DELETE /api/v1/storage/settings — storageSettings.clearSettings (TenantSettings, tenant admin)", () => {
    const KEYS = ["storage_config", "storage_credentials"];

    it("a tenant admin reverts to the platform default: A's two rows go, B's stay", async () => {
      const storageSettings = require("../../services/storageSettings.service");
      for (const tenantId of [A, B]) {
        await setting(tenantId, "storage_config", JSON.stringify({ provider: "local" }));
        await setting(tenantId, "storage_credentials", "{}");
      }

      await expect(asTenantUser(A, () => storageSettings.clearSettings(A))).resolves.toBeDefined();

      expect(await settings(A, KEYS)).toBe(0);
      expect(await settings(B, KEYS)).toBe(2);
    });
  });

  describe("super-admin-only routes: the hook is skipped, so these were NOT broken", () => {
    it("DELETE /api/v1/feature-flags/:tenantId/:flagKey — featureFlag.resetTenantFlag", async () => {
      const featureFlags = require("../../services/featureFlag.service");
      await setting(A, "feature_flag_w33", "true");
      await setting(B, "feature_flag_w33", "true");

      const result = await asSuperAdmin(A, () => featureFlags.resetTenantFlag(A, "w33"));

      expect(result.reset).toBe(true);
      expect(await settings(A, ["feature_flag_w33"])).toBe(0);
      expect(await settings(B, ["feature_flag_w33"])).toBe(1);
    });

    it("DELETE /api/v1/oidc/clients/:clientId — oidcProvider.deleteClient", async () => {
      const oidc = require("../../services/oidcProvider.service");
      await setting(A, "oidc_rp_w33", "{}");
      await setting(B, "oidc_rp_w33", "{}");

      await expect(asSuperAdmin(A, () => oidc.deleteClient(A, "w33"))).resolves.toEqual({ deleted: true });

      expect(await settings(A, ["oidc_rp_w33"])).toBe(0);
      expect(await settings(B, ["oidc_rp_w33"])).toBe(1);
    });

    it("DELETE /api/v1/data-retention/:tenantId/legal-hold — dataRetention.disableLegalHold", async () => {
      const retention = require("../../services/dataRetention.service");
      const KEYS = ["legal_hold_enabled", "legal_hold_reason", "legal_hold_enabled_by"];
      for (const tenantId of [A, B]) {
        await setting(tenantId, "legal_hold_enabled", "true");
        await setting(tenantId, "legal_hold_reason", "w33");
        await setting(tenantId, "legal_hold_enabled_by", USER_A);
      }

      await asSuperAdmin(A, () => retention.disableLegalHold(A, { userId: USER_A }));

      expect(await settings(A, KEYS)).toBe(0);
      expect(await settings(B, KEYS)).toBe(3);
    });
  });
});
