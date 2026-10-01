/**
 * Ticket fixtures shaped as backend/src/services/ticket.service.js
 * serializeTicket / serializeComment return them, and the controller's
 * `success()` envelopes: a list's rows in `data` with a top-level `meta`,
 * a single ticket as the object in `data`.
 */
import type { Ticket, TicketComment, TicketMetrics } from "@/api/services/ticket.service";

export const ana = { id: "u-ana", firstName: "Ana", lastName: "Nurse", email: "ana@h.test" };
export const budi = { id: "u-budi", firstName: "Budi", lastName: "Admin", email: "budi@h.test" };

export const tComment = (id: string, over: Partial<TicketComment> = {}): TicketComment => ({
  id,
  ticketId: "tk-1",
  body: `Reply ${id}`,
  isInternal: false,
  createdAt: "2026-09-21T09:00:00.000Z",
  author: ana,
  ...over,
});

export const ticket = (id: string, over: Partial<Ticket> = {}): Ticket => ({
  id,
  number: 7,
  ticketKey: "TKT-7",
  subject: "Autoclave calibration overdue",
  description: "<p>The <strong>autoclave</strong> in ward 3 is overdue.</p>",
  status: "open",
  priority: "high",
  category: "support",
  tenantId: "t-1",
  tenant: { id: "t-1", name: "RS Harapan" },
  createdBy: ana.id,
  assignedTo: null,
  dueDate: null,
  resolvedAt: null,
  closedAt: null,
  createdAt: "2026-09-20T08:00:00.000Z",
  updatedAt: "2026-09-20T08:00:00.000Z",
  requester: ana,
  assignee: null,
  comments: [],
  ...over,
});

export const ticketList = (rows: Ticket[]) => ({
  success: true,
  status: 200,
  message: "Tickets retrieved",
  data: rows,
  meta: { total: rows.length, page: 1, limit: 25, totalPages: 1 },
});

export const ticketOk = <T,>(data: T, message = "ok") => ({ success: true, status: 200, message, data });

export const metrics = (over: Partial<TicketMetrics> = {}): TicketMetrics => ({
  total: 12,
  open: 5,
  resolved: 4,
  closed: 3,
  overdue: 2,
  byStatus: {},
  byPriority: {},
  byCategory: {},
  ...over,
});
