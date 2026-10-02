/**
 * P9-21 / P9-25 (ADR-103) — the contract of `maintenance.route.ts`, code-first.
 *
 * Bodies are the objects `validate()` mounts (`validators/maintenance.validator`
 * → `@callibrator/contracts/maintenance`). The list reads its filters RAW from
 * `req.query` (no schema) and is documented as the service reads them.
 * Responses are the contract's work-order rows. Examples are synthetic.
 *
 * Q-55 (migration 0107, ADR-097 Am. 4): `scheduledDate`, `completedDate`,
 * `estimatedCost`, `actualCost` and `resolutionNotes` are stored (they were
 * accepted and dropped before), with their bounds in the contract.
 */
import { z } from "zod";
import { createWorkOrder, updateWorkOrder } from "../../validators/maintenance.validator";
import {
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_STATUSES,
  WORK_ORDER_TYPES,
  workOrderDetailResponse,
  workOrderListItem,
  workOrderResponse,
} from "@callibrator/contracts/maintenance";
import { defineRouteDocs } from "../../docs/openapi/operation";

/** `:orderId`, checked by `validateUuid` (the SHAPE: `z.guid()`). */
const params = z.object({
  orderId: z.guid().meta({ description: "The work order's id", example: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f" }),
});

/** The filters `maintenance.service#fetchWorkOrders` reads, raw from `req.query`. */
const listQuery = z.object({
  find: z.string().optional().meta({ description: "Substring of the title (case-insensitive)" }),
  page: z.coerce.number().int().min(1).optional().meta({ description: "1-based page", example: 1 }),
  limit: z.coerce.number().int().min(1).optional().meta({ description: "Rows per page (capped by the server)", example: 25 }),
  status: z.enum(WORK_ORDER_STATUSES).optional(),
  type: z.enum(WORK_ORDER_TYPES).optional(),
  priority: z.enum(WORK_ORDER_PRIORITIES).optional(),
  deviceId: z.guid().optional(),
});

const access = (action: string) => ({ kind: "dynamicAccess", resource: "maintenance", action }) as const;
const SCHEDULE_AND_COST =
  "The schedule, costs and resolution are stored (Q-55): a cost is a decimal ≥ 0 with two places " +
  "(NUMERIC(14,2)), resolution notes are at most 5000 characters, and `completedDate` cannot be before " +
  "`scheduledDate` when both are sent. The audit row records the dates and costs, and the notes' length only.";

export default defineRouteDocs({
  router: "api/maintenance.route",
  mount: "/api/v1/maintenance",
  tag: "Maintenance",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/",
      operationId: "listWorkOrders",
      summary: "List work orders",
      description: "The caller's tenant's work orders, newest first, with the device, vendor and assignee.",
      permission: access("read"),
      audited: false,
      query: listQuery,
      success: { status: 200, description: "A page of work orders; pagination in the top-level `meta`", list: workOrderListItem },
    },
    {
      method: "get",
      path: "/:orderId",
      operationId: "getWorkOrder",
      summary: "Get a work order",
      permission: access("read"),
      audited: false,
      params,
      success: { status: 200, description: "The work order with its device, vendor and assignee", data: workOrderDetailResponse },
    },
    {
      method: "post",
      path: "/",
      operationId: "createWorkOrder",
      summary: "Create a work order",
      description: `The device, vendor and assignee must be the caller's tenant's. ${SCHEDULE_AND_COST}`,
      permission: access("create"),
      audited: true,
      body: createWorkOrder,
      success: { status: 201, description: "The created work order", data: workOrderResponse },
      conflict: "the device already has an open auto-scheduled calibration work order (W-03).",
    },
    {
      method: "patch",
      path: "/:orderId",
      operationId: "updateWorkOrder",
      summary: "Update a work order",
      description: SCHEDULE_AND_COST,
      permission: access("update"),
      audited: true,
      params,
      body: updateWorkOrder,
      success: { status: 200, description: "The updated work order", data: workOrderResponse },
    },
    {
      method: "delete",
      path: "/:orderId",
      operationId: "deleteWorkOrder",
      summary: "Delete a work order",
      description: "Soft delete; its attachments go with it (D-22).",
      permission: access("delete"),
      audited: true,
      params,
      success: { status: 200, description: "Deleted; `data` is null", empty: true },
    },
  ],
});
