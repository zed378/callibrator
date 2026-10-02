// src/api/services/ticket.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client. Every call is typed by
// `paths` (src/api/generated/schema.d.ts, `npm run api:types`, generated from
// backend/src/routes/api/tickets.openapi.ts), and so are the request and
// response types below: a ticket, its comments and the metrics are the
// contract's own schemas, not a hand-written copy. The service's interface
// (ticketService.*, the exported type names) is unchanged, so no caller changed.
import { typedApi, unwrap, type DataOf, type JsonBody, type Op, type QueryOf, type components } from "../typed";
import { PaginatedResponse } from "@/types";

// ------------------------------------------------------------------
// Types — from the contract
// ------------------------------------------------------------------

export type Ticket = components["schemas"]["Ticket"];
export type TicketComment = components["schemas"]["TicketComment"];
export type TicketMetrics = components["schemas"]["TicketMetrics"];
export type TicketStatus = Ticket["status"];
export type TicketPriority = Ticket["priority"];
export type TicketCategory = Ticket["category"];
/** A person on a ticket (requester, assignee, comment author). */
export type TicketUser = NonNullable<Ticket["requester"]>;
export type TicketTenant = NonNullable<Ticket["tenant"]>;

export type CreateTicketInput = JsonBody<Op<"/api/v1/tickets", "post">>;
export type UpdateTicketInput = JsonBody<Op<"/api/v1/tickets/{ticketId}", "patch">>;
type ListQuery = QueryOf<Op<"/api/v1/tickets", "get">>;
type CommentInput = JsonBody<Op<"/api/v1/tickets/{ticketId}/comments", "post">>;

/** The list's filters as the UI holds them (`mine` a boolean; the query carries "true"). */
export interface TicketFilters {
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: TicketCategory;
  assignedTo?: string;
  mine?: boolean;
  q?: string;
  page?: number;
  limit?: number;
}

// ------------------------------------------------------------------
// Service
// ------------------------------------------------------------------

export const ticketService = {
  list: async (filters: TicketFilters = {}): Promise<PaginatedResponse<Ticket>> => {
    // Only the filters that are set are sent, as before.
    const query: ListQuery = { page: filters.page ?? 1, limit: filters.limit ?? 25 };
    if (filters.status) query.status = filters.status;
    if (filters.priority) query.priority = filters.priority;
    if (filters.category) query.category = filters.category;
    if (filters.assignedTo) query.assignedTo = filters.assignedTo;
    if (filters.mine) query.mine = "true";
    if (filters.q) query.q = filters.q;

    const res = await typedApi.GET("/api/v1/tickets", { params: { query } }).then(unwrap);
    return {
      success: res.success,
      message: res.message,
      data: res.data,
      meta: res.meta ?? {
        total: res.data.length,
        page: query.page ?? 1,
        limit: query.limit ?? 25,
        totalPages: 1,
      },
    };
  },

  getMetrics: async (): Promise<TicketMetrics> =>
    (await typedApi.GET("/api/v1/tickets/metrics").then(unwrap)).data,

  get: async (ticketId: string): Promise<Ticket> =>
    (await typedApi.GET("/api/v1/tickets/{ticketId}", { params: { path: { ticketId } } }).then(unwrap)).data,

  create: async (data: CreateTicketInput): Promise<Ticket> =>
    (await typedApi.POST("/api/v1/tickets", { body: data }).then(unwrap)).data,

  update: async (ticketId: string, data: UpdateTicketInput): Promise<Ticket> =>
    (await typedApi.PATCH("/api/v1/tickets/{ticketId}", { params: { path: { ticketId } }, body: data }).then(unwrap)).data,

  assign: async (ticketId: string, assignedTo: string | null): Promise<Ticket> =>
    (
      await typedApi
        .POST("/api/v1/tickets/{ticketId}/assign", {
          params: { path: { ticketId } },
          // The contract's body; `null` unassigns, as before.
          body: { assignedTo } as JsonBody<Op<"/api/v1/tickets/{ticketId}/assign", "post">>,
        })
        .then(unwrap)
    ).data,

  remove: async (ticketId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/tickets/{ticketId}", { params: { path: { ticketId } } });
  },

  addComment: async (ticketId: string, data: CommentInput): Promise<DataOf<Op<"/api/v1/tickets/{ticketId}/comments", "post">>> =>
    (await typedApi.POST("/api/v1/tickets/{ticketId}/comments", { params: { path: { ticketId } }, body: data }).then(unwrap)).data,
};

export default ticketService;
