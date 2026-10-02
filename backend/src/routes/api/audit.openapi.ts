/**
 * P9-18 / P9-25 (ADR-103) — the contract of `audit.route.ts`, code-first.
 *
 * One read behind `auth` and the `audit` read gate with `checkTenant`. The
 * trail read is the caller's HOME tenant; `scope=platform` reads the PLATFORM
 * tenant's trail (platform operations, ADR-051 Q-14) and only a super admin
 * may ask for it (403 otherwise, A-125). Rows are immutable (FDA 21 CFR Part
 * 11). Examples are synthetic.
 */
import { z } from "zod";
import { defineRouteDocs } from "../../docs/openapi/operation";

/** A user an audit row names (the list's `user` / `impersonator` includes). */
const person = z.object({
  id: z.guid(),
  username: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
});

const AuditLog = z
  .object({
    // audit_logs.id is a UUID and tenant_id NOT NULL (auditLog.model.ts).
    id: z.guid(),
    tenantId: z.guid(),
    userId: z.guid().nullable(),
    actorType: z.enum(["user", "system", "unknown"]).optional(),
    action: z.string(),
    resourceType: z.string(),
    resourceId: z.string().nullable(),
    changes: z.object({}).loose().nullable(),
    ipAddress: z.string().nullable().optional(),
    createdAt: z.iso.datetime(),
    // P9-25 (2026-10-02): the rest of the row, and the two includes audit.service's list reads.
    actorName: z.string().nullable().meta({ description: "A system row's job (e.g. `system:retention-purge`); null on a user row" }),
    userAgent: z.string().nullable(),
    impersonatorId: z.guid().nullable().meta({ description: "F-8: the super admin who acted through an impersonation token" }),
    user: person.nullable().meta({
      description: "null while `userId` is set: the user is outside the reader's tenant (a platform operator) or removed",
    }),
    impersonator: person.nullable().meta({ description: "null for a tenant reader: the operator is not a member of the tenant" }),
  })
  .loose()
  .meta({
    id: "AuditLogEntry",
    description: "One immutable audit row. Secrets in `changes` are redacted before they are written.",
    example: {
      id: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
      tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
      userId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      actorType: "user",
      action: "UPDATE",
      resourceType: "CalibrationDevice",
      resourceId: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
      changes: { operation: "DEVICE_UPDATE", before: { status: "active" }, after: { status: "retired" } },
      ipAddress: "192.0.2.10",
      createdAt: "2030-01-15T09:00:00.000Z",
      actorName: null,
      userAgent: "Mozilla/5.0",
      impersonatorId: null,
      user: {
        id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
        username: "a.admin",
        firstName: "Ada",
        lastName: "Admin",
        email: "a.admin@hospital.example",
      },
      impersonator: null,
    },
  });

export default defineRouteDocs({
  router: "api/audit.route",
  mount: "/api/v1/audit",
  tag: "Audit & Compliance",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/",
      operationId: "listAuditLogs",
      summary: "Read the audit trail",
      description:
        "Paginated, immutable audit rows of the caller's tenant (FDA 21 CFR Part 11). `scope=platform` reads the platform tenant's trail: super admin only (403 otherwise); any other scope is a 400. An `actorType` outside the column's values is a 400.",
      permission: { kind: "dynamicAccess", resource: "audit", action: "read" },
      audited: false,
      query: z.object({
        scope: z.enum(["platform"]).optional().meta({ description: "Super admin only: the platform tenant's trail" }),
        page: z.coerce.number().int().min(1).optional().meta({ example: 1 }),
        limit: z.coerce.number().int().min(1).optional().meta({ example: 25 }),
        userId: z.guid().optional(),
        actorType: z.enum(["user", "system", "unknown"]).optional(),
        action: z.string().optional().meta({ example: "UPDATE" }),
        resourceType: z.string().optional().meta({ example: "CalibrationDevice" }),
        resourceId: z.string().optional(),
        startDate: z.iso.datetime().optional(),
        endDate: z.iso.datetime().optional(),
      }),
      success: {
        status: 200,
        description: "A page of audit rows; pagination in the top-level `meta`",
        // The house envelope, with the meta audit.service writes (P8-04, ADR-096).
        body: z.object({
          success: z.literal(true),
          status: z.literal(200),
          message: z.string(),
          data: z.array(AuditLog),
          meta: z.object({
            total: z.number().int().meta({ description: "At most 10,000; see `totalIsCapped`" }),
            totalIsCapped: z.boolean().meta({ description: "More rows match than are counted; `total` is a lower bound" }),
            page: z.number().int(),
            limit: z.number().int(),
            totalPages: z.number().int(),
            window: z
              .object({ from: z.iso.datetime().nullable(), to: z.iso.datetime().nullable(), defaulted: z.boolean() })
              .meta({ description: "The date window read; with no dates and no resource, the last 90 days (`defaulted`)" }),
          }),
        }),
      },
    },
  ],
});
