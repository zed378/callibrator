/**
 * P9-18 / P9-25 (ADR-103) — the contract of `notifications.route.ts`,
 * code-first.
 *
 * Every route sits behind `auth` and acts on the caller's OWN inbox (their
 * notifications and the tenant-wide broadcasts they can see); there is no
 * menu gate, because every role has an inbox. The one exception is the test
 * emitter's tenant broadcast (`scope: "tenant"`), which needs `notifications`
 * write (A-251). Examples are synthetic.
 */
import { z } from "zod";
import { defineRouteDocs, type Permission } from "../../docs/openapi/operation";
import { deleteManySchema } from "../../validators/notification.validator";

const NOTE = "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b";
const OWN: Permission = { kind: "authenticated", reason: "The caller's own inbox: their notifications and the tenant-wide broadcasts they can see." };
const params = z.object({ notificationId: z.guid().meta({ description: "The notification", example: NOTE }) });

const Notification = z
  .object({
    id: z.guid(),
    tenantId: z.guid().nullable(),
    userId: z.guid().nullable().meta({ description: "Null for a tenant-wide broadcast" }),
    type: z.string(),
    title: z.string(),
    message: z.string(),
    actionUrl: z.string().nullable(),
    isRead: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .loose()
  .meta({
    id: "Notification",
    example: {
      id: NOTE,
      tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
      userId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      type: "SYSTEM",
      title: "Calibration due",
      message: "Infusion pump SN-0001 is due in 7 days.",
      actionUrl: "/dashboard/calibration",
      isRead: false,
      createdAt: "2030-01-15T09:00:00.000Z",
    },
  });
const Deleted = z.object({ deleted: z.number().int() });
/** P9-25: deleteNotifications answers both counts (notification.service#deleteNotifications). */
const DeletedOf = z.object({
  deleted: z.number().int(),
  requested: z.number().int().meta({ description: "How many ids were sent; `deleted` is lower when some were not the caller's" }),
});

export default defineRouteDocs({
  router: "api/notifications.route",
  mount: "/api/v1/notifications",
  tag: "Notifications",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/",
      operationId: "listNotifications",
      summary: "The caller's notifications",
      permission: OWN,
      audited: false,
      query: z.object({
        page: z.coerce.number().int().min(1).optional().meta({ example: 1 }),
        limit: z.coerce.number().int().min(1).optional().meta({ example: 20 }),
        isRead: z.enum(["true", "false"]).optional(),
        type: z.string().optional().meta({ example: "SYSTEM" }),
      }),
      success: {
        status: 200,
        description: "A page of notifications; pagination (with the unread count) in the top-level `meta`",
        // The house envelope, with the meta notification.service writes (P9-25: `unread` named).
        body: z.object({
          success: z.literal(true),
          status: z.literal(200),
          message: z.string(),
          data: z.array(Notification),
          meta: z.object({
            total: z.number().int(),
            unread: z.number().int().meta({ description: "Unread notifications in the caller's whole inbox" }),
            page: z.number().int(),
            limit: z.number().int(),
            totalPages: z.number().int(),
          }),
        }),
      },
    },
    {
      method: "post",
      path: "/test",
      operationId: "sendTestNotification",
      summary: "Emit a test notification (diagnostic: verifies realtime delivery)",
      description: "To the caller by default. `scope: \"tenant\"` broadcasts to every user of the tenant and needs `notifications` write (A-251); without it, 403.",
      permission: { kind: "authenticated", reason: "The caller's own test notification; the tenant broadcast is gated inside the chain on `notifications` write (A-251)." },
      audited: false,
      body: z
        .object({
          scope: z
            .enum(["user", "tenant"])
            .optional()
            .meta({ description: "`tenant` broadcasts; anything else (the default) targets the caller" }),
          title: z.string().optional(),
          message: z.string().optional(),
          type: z.string().optional().meta({ example: "SYSTEM" }),
        })
        .meta({ description: "Read by the controller; not validated by a schema on the route." }),
      success: { status: 201, description: "The notification", data: Notification.nullable() },
    },
    {
      method: "patch",
      path: "/read-all",
      operationId: "markAllNotificationsRead",
      summary: "Mark all of the caller's notifications as read",
      permission: OWN,
      audited: false,
      success: { status: 200, description: "Marked", empty: true },
    },
    {
      method: "patch",
      path: "/:notificationId/read",
      operationId: "markNotificationRead",
      summary: "Mark a notification as read",
      permission: OWN,
      audited: false,
      params,
      success: { status: 200, description: "The notification", data: Notification },
    },
    {
      method: "delete",
      path: "/all",
      operationId: "deleteAllNotifications",
      summary: "Delete all of the caller's notifications",
      permission: OWN,
      audited: false,
      success: { status: 200, description: "How many were deleted", data: Deleted },
    },
    {
      method: "delete",
      path: "/bulk",
      operationId: "deleteNotifications",
      summary: "Delete selected notifications",
      description: "Ids outside the caller's inbox are ignored.",
      permission: OWN,
      audited: false,
      body: deleteManySchema,
      success: { status: 200, description: "How many were deleted, of how many asked", data: DeletedOf },
    },
    {
      method: "delete",
      path: "/:notificationId",
      operationId: "deleteNotification",
      summary: "Delete a notification",
      permission: OWN,
      audited: false,
      params,
      success: { status: 200, description: "Deleted", empty: true },
    },
  ],
});
