import { api } from "../client";
import { PaginatedResponse } from "@/types";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";
export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type TicketCategory =
  | "support"
  | "bug"
  | "feature"
  | "incident"
  | "question";

export interface TicketUser {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email: string;
}

export interface TicketComment {
  id: string;
  ticketId: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  author: TicketUser | null;
}

export interface TicketTenant {
  id: string;
  name: string;
}

export interface Ticket {
  id: string;
  number?: number | null;
  ticketKey?: string | null;
  subject: string;
  description?: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;
  tenantId?: string | null;
  // Present on the response desk so the platform operator can tell cross-tenant
  // tickets apart.
  tenant?: TicketTenant | null;
  createdBy?: string | null;
  assignedTo?: string | null;
  dueDate?: string | null;
  resolvedAt?: string | null;
  closedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  requester: TicketUser | null;
  assignee: TicketUser | null;
  comments?: TicketComment[];
}

export interface TicketMetrics {
  total: number;
  open: number;
  resolved: number;
  closed: number;
  overdue: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byCategory: Record<string, number>;
}

export interface CreateTicketInput {
  subject: string;
  description?: string | null;
  priority?: TicketPriority;
  category?: TicketCategory;
  assignedTo?: string | null;
  dueDate?: string | null;
}

export interface UpdateTicketInput {
  subject?: string;
  description?: string | null;
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: TicketCategory;
  assignedTo?: string | null;
  dueDate?: string | null;
}

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

type Env<T> = { success: boolean; message?: string; data: T };
type ListEnv<T> = {
  success: boolean;
  message?: string;
  data: T[];
  meta?: { total: number; page: number; limit: number; totalPages: number };
};

const unwrap = <T,>(r: Env<T>): T => r.data;
const base = "/api/v1/tickets";

// ------------------------------------------------------------------
// Service
// ------------------------------------------------------------------

export const ticketService = {
  list: async (filters: TicketFilters = {}): Promise<PaginatedResponse<Ticket>> => {
    const params: Record<string, string | number | boolean> = {};
    if (filters.status) params.status = filters.status;
    if (filters.priority) params.priority = filters.priority;
    if (filters.category) params.category = filters.category;
    if (filters.assignedTo) params.assignedTo = filters.assignedTo;
    if (filters.mine) params.mine = true;
    if (filters.q) params.q = filters.q;
    params.page = filters.page ?? 1;
    params.limit = filters.limit ?? 25;

    const res = await api.get<ListEnv<Ticket>>(base, { params });
    return {
      success: res.success,
      message: res.message,
      data: res.data,
      meta: res.meta ?? {
        total: res.data.length,
        page: params.page as number,
        limit: params.limit as number,
        totalPages: 1,
      },
    };
  },

  getMetrics: async (): Promise<TicketMetrics> =>
    unwrap(await api.get<Env<TicketMetrics>>(`${base}/metrics`)),

  get: async (ticketId: string): Promise<Ticket> =>
    unwrap(await api.get<Env<Ticket>>(`${base}/${ticketId}`)),

  create: async (data: CreateTicketInput): Promise<Ticket> =>
    unwrap(await api.post<Env<Ticket>>(base, data)),

  update: async (ticketId: string, data: UpdateTicketInput): Promise<Ticket> =>
    unwrap(await api.patch<Env<Ticket>>(`${base}/${ticketId}`, data)),

  assign: async (ticketId: string, assignedTo: string | null): Promise<Ticket> =>
    unwrap(
      await api.post<Env<Ticket>>(`${base}/${ticketId}/assign`, { assignedTo }),
    ),

  remove: async (ticketId: string): Promise<void> => {
    await api.delete(`${base}/${ticketId}`);
  },

  addComment: async (
    ticketId: string,
    data: { body: string; isInternal?: boolean },
  ): Promise<TicketComment> =>
    unwrap(
      await api.post<Env<TicketComment>>(`${base}/${ticketId}/comments`, data),
    ),
};

export default ticketService;
