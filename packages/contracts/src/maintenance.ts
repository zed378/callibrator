/**
 * Maintenance work orders.
 *
 * Enums and field names are aligned with the MaintenanceWorkOrder model:
 * - `title` is a NOT NULL column and must be accepted (it was previously
 *   stripped, making creates fail the DB constraint).
 * - type enum: Preventative | Breakdown | Repair (model), not "Inspection".
 * - status enum: Open | InProgress | Completed | Cancelled (model), not "Pending".
 * - `assigneeId` is kept as the public API name; the controller/service maps
 *   it to the `assignedTo` column.
 *
 * P9-11 (ADR-093): moved to Zod.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/maintenance.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for /api/v1/maintenance work orders (create and update bodies).
 */
import { z } from "zod";
import { isoDate, numeric, optionalText, uuid } from "./fields";
import { WORK_ORDER_STATUSES } from "./states";

const TYPES = ["Preventative", "Breakdown", "Repair"] as const;
const PRIORITIES = ["Low", "Medium", "High", "Critical"] as const;
// P9-05: the one list is `states.ts`.
const STATUSES = WORK_ORDER_STATUSES;

/**
 * Q-55 (migration 0107): a cost is NUMERIC(14,2) ≥ 0 — at most 12 digits
 * before the point. More than two decimals are rounded by the column.
 */
const MAX_COST = 999_999_999_999.99;
const cost = numeric(z.number().min(0).max(MAX_COST)).nullable().optional();
/** Q-55: the column's CHECK bound. */
const MAX_RESOLUTION_NOTES = 5000;

const createWorkOrder = z.object({
  deviceId: uuid(),
  title: z.string().trim().min(1).max(255),
  vendorId: uuid().nullable().optional(),
  assigneeId: uuid().nullable().optional(),
  type: z.enum(TYPES),
  priority: z.enum(PRIORITIES).default("Medium"),
  status: z.enum(STATUSES).default("Open"),
  description: optionalText(),
  scheduledDate: isoDate().nullable().optional(),
  estimatedCost: cost,
});

const updateWorkOrder = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  vendorId: uuid().nullable().optional(),
  assigneeId: uuid().nullable().optional(),
  type: z.enum(TYPES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(STATUSES).optional(),
  description: optionalText(),
  scheduledDate: isoDate().nullable().optional(),
  completedDate: isoDate().nullable().optional(),
  estimatedCost: cost,
  actualCost: cost,
  resolutionNotes: optionalText(MAX_RESOLUTION_NOTES),
}).refine(
  // Q-55: work cannot be completed before it was scheduled — checked when the
  // same request gives both (a request giving one is compared with nothing).
  (body) => !(body.scheduledDate instanceof Date && body.completedDate instanceof Date) || body.completedDate >= body.scheduledDate,
  { path: ["completedDate"], error: "completedDate cannot be before scheduledDate" },
);

export { createWorkOrder, updateWorkOrder, MAX_COST, MAX_RESOLUTION_NOTES };
export { TYPES as WORK_ORDER_TYPES, PRIORITIES as WORK_ORDER_PRIORITIES, STATUSES as WORK_ORDER_STATUSES };

/** A work order's type, priority and status, as the API stores them. */
export type WorkOrderType = (typeof TYPES)[number];
export type WorkOrderPriority = (typeof PRIORITIES)[number];
export type WorkOrderStatus = (typeof STATUSES)[number];

// ==========================================
// RESPONSES (P9-20/21, ADR-103: what the API answers, published code-first)
// ==========================================
// The rows maintenance.service returns (`order.toJSON()`). The list carries
// `device`, `vendor` and `assignee` as their selected attributes; the detail
// carries the whole device and vendor rows; a row just created or updated
// carries no association.

const timestamp = z.iso.datetime();
const rowId = z.guid();

const workOrderFields = {
  id: rowId,
  tenantId: rowId,
  deviceId: rowId,
  title: z.string(),
  description: z.string().nullable(),
  type: z.enum(TYPES),
  status: z.enum(STATUSES),
  priority: z.enum(PRIORITIES),
  vendorId: rowId.nullable(),
  assignedTo: rowId.nullable().meta({ description: "The assignee's user id (the body's `assigneeId`)" }),
  autoScheduled: z.boolean().meta({ description: "Created by the calibration scan (W-03, W-17)" }),
  // Q-55 (migration 0107): stored since 2026-10-01.
  scheduledDate: timestamp.nullable(),
  completedDate: timestamp.nullable(),
  estimatedCost: z.number().nullable().meta({ description: "NUMERIC(14,2), read as a number (D-21)" }),
  actualCost: z.number().nullable().meta({ description: "NUMERIC(14,2), read as a number (D-21)" }),
  resolutionNotes: z.string().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: timestamp.nullable(),
};
const workOrderExample = {
  id: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
  tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
  deviceId: "7d6c5b4a-3e2f-4a1b-9c8d-7e6f5a4b3c2d",
  title: "Replace the infusion pump battery",
  description: null,
  type: "Repair",
  status: "Open",
  priority: "Medium",
  vendorId: null,
  assignedTo: null,
  autoScheduled: false,
  scheduledDate: "2026-02-01T00:00:00.000Z",
  completedDate: null,
  estimatedCost: 1250,
  actualCost: null,
  resolutionNotes: null,
  createdAt: "2026-01-15T08:30:00.000Z",
  updatedAt: "2026-01-15T08:30:00.000Z",
  deletedAt: null,
};

/** The assignee as included: `{ id, username, firstName, lastName, email }`, or null. */
const assigneeRef = z
  .object({ id: rowId, username: z.string(), firstName: z.string(), lastName: z.string(), email: z.string() })
  .nullable();

/** A work order as created or updated (no associations). */
const workOrderResponse = z
  .object(workOrderFields)
  .meta({ id: "WorkOrder", description: "A maintenance work order on a device.", example: workOrderExample });

/** A work order as listed: with the device `{ id, name, serialNumber }`, the vendor `{ id, name }` and the assignee. */
const workOrderListItem = z
  .object({
    ...workOrderFields,
    device: z.object({ id: rowId, name: z.string(), serialNumber: z.string().nullable() }).nullable(),
    vendor: z.object({ id: rowId, name: z.string() }).nullable(),
    assignee: assigneeRef,
  })
  .meta({ id: "WorkOrderListItem" });

/** A work order as fetched by id: with the whole device and vendor rows, and the assignee. */
const workOrderDetailResponse = z
  .object({
    ...workOrderFields,
    device: z.looseObject({ id: rowId, name: z.string() }).nullable().meta({ description: "The device row (soft-deleted ones included)" }),
    vendor: z.looseObject({ id: rowId, name: z.string() }).nullable().meta({ description: "The vendor row (soft-deleted ones included)" }),
    assignee: assigneeRef,
  })
  .meta({ id: "WorkOrderDetail" });

export { workOrderResponse, workOrderListItem, workOrderDetailResponse };

// The client-side (input) and handler-side (output) types of each schema.
export type CreateWorkOrderInput = z.input<typeof createWorkOrder>;
export type CreateWorkOrderBody = z.output<typeof createWorkOrder>;
export type UpdateWorkOrderInput = z.input<typeof updateWorkOrder>;
export type UpdateWorkOrderBody = z.output<typeof updateWorkOrder>;
