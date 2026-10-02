// src/api/services/maintenance.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client; the types are the
// contract's (backend/src/routes/api/maintenance.openapi.ts →
// @callibrator/contracts/maintenance), which replaced the interim `z.input`
// types (ADR-097 Am. 1). The exported names are unchanged.
import { typedApi, unwrap, type JsonBody, type Op, type QueryOf, type components } from "../typed";
import { PaginatedResponse } from "@/types";

type ById = "/api/v1/maintenance/{orderId}";
type ListItem = components["schemas"]["WorkOrderListItem"];
type CreateBody = JsonBody<Op<"/api/v1/maintenance", "post">>;
type UpdateBody = JsonBody<Op<ById, "patch">>;
type ListQuery = QueryOf<Op<"/api/v1/maintenance", "get">>;
type ListItemMeta = components["schemas"]["PaginationMeta"];

export type WorkOrderType = ListItem["type"];
export type WorkOrderStatus = ListItem["status"];
export type WorkOrderPriority = ListItem["priority"];

export type WorkOrderDevice = NonNullable<ListItem["device"]>;
export type WorkOrderVendor = NonNullable<ListItem["vendor"]>;
export type WorkOrderAssignee = NonNullable<ListItem["assignee"]>;

/**
 * A work-order row. A list read also carries its device, vendor and assignee
 * (WorkOrderListItem); a write's answer is the bare row.
 *
 * Q-55 (migration 0107): the schedule, costs and resolution are stored since
 * 2026-10-01. A cost is NUMERIC(14,2), read as a number by the model's getter
 * (D-21), on a list read and on a write's answer alike.
 */
export type WorkOrder = components["schemas"]["WorkOrder"] &
  Partial<Pick<ListItem, "device" | "vendor" | "assignee">>;

/**
 * The create and update bodies. A cost is published as a number; the form
 * sends what was typed (a numeric string), which the validator's `numeric()`
 * accepts and converts — so the input types also take a string (as built).
 */
type CostInput = { estimatedCost?: number | string | null };
export type WorkOrderCreateInput = Omit<CreateBody, "estimatedCost"> & CostInput;

export type WorkOrderUpdateInput = Omit<UpdateBody, "estimatedCost" | "actualCost"> &
  CostInput & {
    actualCost?: number | string | null;
    id: string;
  };

export interface WorkOrderListParams {
  page?: number;
  limit?: number;
  find?: string;
  status?: string;
  type?: string;
  priority?: string;
  deviceId?: string;
}

const byId = (orderId: string) => ({ params: { path: { orderId } } });

export const maintenanceService = {
  getAll: async (
    params: WorkOrderListParams = {},
  ): Promise<PaginatedResponse<WorkOrder>> => {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const response = await typedApi
      .GET("/api/v1/maintenance", {
        // The page's filter selects offer only the contract's enum values.
        params: { query: { ...params, page, limit } as ListQuery },
      })
      .then(unwrap);

    // Defensive: `data` may be null and `meta` may be missing.
    const rows: WorkOrder[] = Array.isArray(response?.data)
      ? response.data
      : [];
    const meta = response?.meta as ListItemMeta | undefined;
    const total = meta?.total ?? rows.length;
    const lim = meta?.limit ?? limit;

    return {
      success: response?.success ?? true,
      message: response?.message ?? "",
      data: rows,
      meta: {
        total,
        page: meta?.page ?? page,
        limit: lim,
        totalPages: meta?.totalPages ?? Math.max(1, Math.ceil(total / lim)),
      },
    };
  },

  getById: async (orderId: string): Promise<components["schemas"]["WorkOrderDetail"]> =>
    (await typedApi.GET("/api/v1/maintenance/{orderId}", byId(orderId)).then(unwrap)).data,

  create: async (data: WorkOrderCreateInput): Promise<WorkOrder> =>
    // As built: a cost may be the typed numeric string (see WorkOrderCreateInput).
    (await typedApi.POST("/api/v1/maintenance", { body: data as CreateBody }).then(unwrap)).data,

  update: async (data: WorkOrderUpdateInput): Promise<WorkOrder> => {
    const { id, ...rest } = data;
    return (
      await typedApi
        // As built: a cost may be the typed numeric string (see WorkOrderUpdateInput).
        .PATCH("/api/v1/maintenance/{orderId}", { ...byId(id), body: rest as UpdateBody })
        .then(unwrap)
    ).data;
  },

  delete: async (orderId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/maintenance/{orderId}", byId(orderId));
  },
};
