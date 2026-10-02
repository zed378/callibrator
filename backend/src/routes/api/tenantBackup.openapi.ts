/**
 * P9-21 / P9-25 (ADR-103) — the contract of `tenantBackup.route.ts`, code-first.
 *
 * Mounted on `/api/v1/tenants` beside tenant.route. Every route is
 * `rbac([SUPERADMIN, TENANT_ADMIN], { allowHigher: true })` and then
 * `abac([tenant:<action>], { checkTenant: true })`: a tenant administrator acts
 * on their OWN tenant only (another tenant's id is a 404); the published gate
 * is the rbac one (the guard reads the first gate factory). The create and
 * restore bodies are the mounted schemas
 * (`@callibrator/contracts/tenantBackup`); the list filters are read raw.
 * Only the create and restore check the ids' shape (`validateUuid`).
 * Examples are synthetic.
 */
import { z } from "zod";
import { createBackupSchema, restoreBackupSchema } from "../../validators/tenantBackup.validator";
import { tenantIdParams } from "../../docs/openapi/tenantSchemas";
import { defineRouteDocs } from "../../docs/openapi/operation";

const admins = { kind: "rbac", roles: ["SUPERADMIN", "TENANT_ADMIN"] } as const;

const backupParams = tenantIdParams.extend({
  backupId: z.guid().meta({ description: "The backup's id", example: "6f5e4d3c-2b1a-4f09-8e7d-6c5b4a3f2e1d" }),
});

const BACKUP_STATUSES = ["pending", "in_progress", "completed", "failed", "deleted"] as const;

/** A tenant_backups row as JSON (`paranoid`: a deleted backup is not answered). */
const backupRow = z
  .looseObject({
    id: z.guid(),
    tenantId: z.guid(),
    // A-363 (migration 0108): stored since; NULL on a row written before it.
    name: z.string().nullable().meta({ description: "The operator's label (NULL on backups taken before migration 0108)" }),
    description: z.string().nullable(),
    backupPath: z.string().nullable(),
    size: z.union([z.string(), z.number()]).nullable().meta({ description: "BIGINT: answered as a string" }),
    status: z.enum(BACKUP_STATUSES),
    cronExpression: z.string().nullable(),
    retentionDays: z.number().int(),
    backupType: z.string().nullable(),
    tag: z.string().nullable(),
    filePath: z.string().nullable(),
    fileSize: z.union([z.string(), z.number()]).nullable().meta({ description: "BIGINT: answered as a string" }),
    recordCount: z.number().int().nullable(),
    errorMessage: z.string().nullable(),
    restoredAt: z.iso.datetime().nullable(),
    expiresAt: z.iso.datetime().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    createdBy: z.guid().nullable(),
    deletedBy: z.guid().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    deletedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: "TenantBackup", description: "A tenant backup (the archive's record)" });

const creator = z.object({ id: z.guid(), username: z.string(), email: z.string() }).nullable();

const listQuery = z.object({
  status: z.enum(BACKUP_STATUSES).optional(),
  backupType: z.string().optional(),
  tag: z.string().optional(),
  page: z.string().optional().meta({ example: "1" }),
  limit: z.string().optional().meta({ example: "20" }),
});

export default defineRouteDocs({
  router: "api/tenantBackup.route",
  mount: "/api/v1/tenants",
  tag: "TenantBackups",
  tagDescription:
    "A tenant's backups: a ZIP of its settings, roles, users and permissions. A restore never creates an account (ADR-051 Q-09).",
  tenantScoped: true,
  operations: [
    {
      method: "post",
      path: "/:tenantId/backups",
      operationId: "createTenantBackup",
      summary: "Create a backup",
      description: "Needs `tenant:update` on the tenant (abac).",
      permission: admins,
      audited: true,
      params: tenantIdParams,
      body: createBackupSchema,
      success: { status: 201, description: "The backup, with its creator", data: backupRow.extend({ creator }) },
    },
    {
      method: "get",
      path: "/:tenantId/backups",
      operationId: "listTenantBackups",
      summary: "List a tenant's backups",
      description: "Needs `tenant:read` on the tenant (abac).",
      permission: admins,
      audited: false,
      params: tenantIdParams,
      query: listQuery,
      success: { status: 200, description: "A page of backups", list: backupRow },
    },
    {
      method: "get",
      path: "/:tenantId/backups/stats",
      operationId: "getTenantBackupStats",
      summary: "Get a tenant's backup statistics",
      description: "The PATH tenant's (never the caller's). Needs `tenant:read` on the tenant (abac).",
      permission: admins,
      audited: false,
      params: tenantIdParams,
      success: {
        status: 200,
        description: "The statistics",
        data: z.object({
          totalBackups: z.number().int(),
          completedBackups: z.number().int(),
          failedBackups: z.number().int(),
          totalSize: z.number().meta({ description: "Bytes, over the completed backups" }),
          latestBackup: backupRow.nullable(),
          hasValidBackups: z.boolean(),
        }),
      },
    },
    {
      method: "get",
      path: "/:tenantId/backups/:backupId",
      operationId: "getTenantBackup",
      summary: "Get a backup",
      description: "With its creator and tenant (LEFT joins, A-90). Needs `tenant:read` on the tenant (abac).",
      permission: admins,
      audited: false,
      params: backupParams,
      success: {
        status: 200,
        description: "The backup",
        data: backupRow.extend({ creator, tenant: z.looseObject({ id: z.guid(), name: z.string() }).nullable() }),
      },
    },
    {
      method: "get",
      path: "/:tenantId/backups/:backupId/download",
      operationId: "downloadTenantBackup",
      summary: "Download a backup",
      description: "The ZIP archive. A backup that is not completed is a 400; a missing file, a 404. Needs `tenant:read` (abac).",
      permission: admins,
      audited: false,
      params: backupParams,
      success: { status: 200, description: "The archive", file: { contentType: "application/zip" } },
    },
    {
      method: "post",
      path: "/:tenantId/backups/:backupId/restore",
      operationId: "restoreTenantBackup",
      summary: "Restore a backup",
      description:
        "Restores the tenant's data from the archive; `mergeData` keeps existing rows unchanged. Accounts are never " +
        "created: the archive's accounts that are not restored are listed with the reason (`erased`, `absent`). A backup " +
        "that is not completed is a 400. Needs `tenant:update` on the tenant (abac).",
      permission: admins,
      audited: true,
      params: backupParams,
      body: restoreBackupSchema,
      success: {
        status: 200,
        description: "What the restore did",
        // P9-25 item 11: exactly what tenantBackup.service#restoreBackup
        // answers (the reconcile outcome spread in, A-156's notRestored).
        data: z.object({
          tenantId: z.guid(),
          recordsProcessed: z.number().int(),
          updated: z.number().int().meta({ description: "Matched accounts whose profile was updated from the backup" }),
          unchanged: z.number().int().meta({ description: "Matched accounts left untouched (merge mode)" }),
          skippedDeleted: z.number().int().meta({ description: "Matched accounts deleted in the tenant, not revived" }),
          retained: z.number().int().meta({ description: "Live accounts not in the archive, left alone" }),
          notRestored: z.array(
            z.object({
              entry: z.number().int().meta({ description: "The account's index in the archive" }),
              username: z.string(),
              reason: z.enum(["erased", "absent"]),
            }),
          ),
          restoredAt: z.iso.datetime(),
        }),
      },
    },
    {
      method: "delete",
      path: "/:tenantId/backups/:backupId",
      operationId: "deleteTenantBackup",
      summary: "Delete a backup",
      description: "Deletes the archive and soft-deletes the record. Needs `tenant:delete` on the tenant (abac).",
      permission: admins,
      audited: true,
      params: backupParams,
      success: { status: 200, description: "Deleted", empty: true },
    },
  ],
});
