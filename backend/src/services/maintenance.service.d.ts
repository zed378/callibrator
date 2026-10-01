/**
 * Types for `src/services/maintenance.service.js`, which is still JavaScript
 * (P9-20, ADR-087 Amendment 13; the `config/index.d.ts` precedent). It emits
 * nothing and is never copied into `dist/`. It declares exactly what the module
 * exports (`exports.x = ...`, six keys); `tests/guards/declarationDrift` holds
 * it to the module. It is deleted when maintenance.service.js converts (P9-22's
 * lane; whoever converts it keeps these types as the floor).
 *
 * Every member is typed from the code: `createAutoScheduledWorkOrders` for
 * calibrationScheduler.service, the other five for maintenance.controller.ts
 * (P9-20).
 */

/** One device's auto-scheduled work order, as the calibration scan describes it. */
interface AutoScheduledItem {
  deviceId: string;
  title: string;
  description: string;
  priority: string;
}

/** A work order as `transformWorkOrder` returns it (the fields a caller reads). */
interface CreatedWorkOrder {
  id: string;
  deviceId: string;
  [field: string]: unknown;
}

/** A service answer: the handlers forward `status`, `message` and `data`. */
interface WorkOrderResult<T> {
  success: true;
  status: number;
  message: string;
  data: T;
}

/** A work order as `transformWorkOrder` returns it: the row's JSON (with its includes on reads). */
type WorkOrderJson = Record<string, unknown>;

/** `fetchWorkOrders`' filters, as the controller passes them: straight from `req.query`, unvalidated. */
interface WorkOrderListQuery {
  tenantId: unknown;
  find?: unknown;
  page?: unknown;
  limit?: unknown;
  status?: unknown;
  type?: unknown;
  priority?: unknown;
  deviceId?: unknown;
}

declare const maintenanceService: {
  /** A page of the tenant's work orders, newest first (P9-20 typed it for maintenance.controller). */
  fetchWorkOrders(query: WorkOrderListQuery): Promise<
    WorkOrderResult<{
      rows: WorkOrderJson[];
      count: number;
      meta: { total: number; page: number; limit: number; totalPages: number };
    }>
  >;
  /** One work order with its device, vendor and assignee; a thrown `{ status: 404 }` when absent. */
  getWorkOrderById(tenantId: unknown, orderId: unknown): Promise<WorkOrderResult<WorkOrderJson | null>>;
  /** Creates one work order (the validated body; `assigneeId` is stored as `assignedTo`). */
  createWorkOrder(tenantId: unknown, data: unknown, actor?: object): Promise<WorkOrderResult<WorkOrderJson | null>>;
  /**
   * W-17 (ADR-073): one tenant's auto-scheduled work orders in ONE
   * transaction, an audit row each. `conflicted`: devices whose open
   * auto-scheduled order already exists (W-03); `missing`: devices that are
   * not this tenant's (A-220).
   */
  createAutoScheduledWorkOrders(
    tenantId: string,
    items: AutoScheduledItem[],
    actor: object,
  ): Promise<{ created: CreatedWorkOrder[]; conflicted: string[]; missing: string[] }>;
  /** Updates one work order (the validated body). */
  updateWorkOrder(tenantId: unknown, orderId: unknown, data: unknown, actor?: object): Promise<WorkOrderResult<WorkOrderJson | null>>;
  /** Soft-deletes one work order (and its attachments); the answer carries no `data`. */
  deleteWorkOrder(tenantId: unknown, orderId: unknown, actor?: object): Promise<Omit<WorkOrderResult<never>, "data">>;
};

export = maintenanceService;
