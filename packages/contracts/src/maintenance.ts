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
 * types from them. The contract for C:/Program Files/Git/api/v1/maintenance work orders (create and update bodies).
 */
import { z } from "zod";
import { isoDate, numeric, optionalText, uuid } from "./fields";

const TYPES = ["Preventative", "Breakdown", "Repair"] as const;
const PRIORITIES = ["Low", "Medium", "High", "Critical"] as const;
const STATUSES = ["Open", "InProgress", "Completed", "Cancelled"] as const;

const cost = numeric(z.number().min(0)).nullable().optional();

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
  resolutionNotes: optionalText(),
});

export { createWorkOrder, updateWorkOrder };
export { TYPES as WORK_ORDER_TYPES, PRIORITIES as WORK_ORDER_PRIORITIES, STATUSES as WORK_ORDER_STATUSES };

/** A work order's type, priority and status, as the API stores them. */
export type WorkOrderType = (typeof TYPES)[number];
export type WorkOrderPriority = (typeof PRIORITIES)[number];
export type WorkOrderStatus = (typeof STATUSES)[number];

// The client-side (input) and handler-side (output) types of each schema.
export type CreateWorkOrderInput = z.input<typeof createWorkOrder>;
export type CreateWorkOrderBody = z.output<typeof createWorkOrder>;
export type UpdateWorkOrderInput = z.input<typeof updateWorkOrder>;
export type UpdateWorkOrderBody = z.output<typeof updateWorkOrder>;
