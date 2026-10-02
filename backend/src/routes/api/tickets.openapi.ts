/**
 * P9-18 / P9-25 (ADR-103) — the contract of `tickets.route.ts`, code-first.
 *
 * Every route sits behind `router.use(auth)` and carries no menu gate:
 * ticket.service scopes every call. A raiser sees and manages their own
 * tickets; a responder role (RESPONDER_ROLES) sees the tenant's queue; a super
 * admin is a cross-tenant responder who cannot raise. A ticket the caller may
 * not see answers 404, like one that does not exist. Request bodies are the
 * contract's own schemas (`@callibrator/contracts/ticket`). Examples are
 * synthetic.
 */
import { z } from "zod";
import { defineRouteDocs, type Permission } from "../../docs/openapi/operation";
import {
  CATEGORIES,
  PRIORITIES,
  STATUSES,
  addComment,
  assignTicket,
  createTicket,
  updateTicket,
} from "../../validators/ticket.validator";

/** The contract's schemas, by the names the operations use. */
const v = { CATEGORIES, PRIORITIES, STATUSES, addComment, assignTicket, createTicket, updateTicket };

const timestamp = z.iso.datetime();
const TICKET = "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";
const person = z.object({ id: z.guid(), firstName: z.string().nullable(), lastName: z.string().nullable(), email: z.string() }).loose();

const TicketComment = z
  .object({ id: z.guid(), ticketId: z.guid(), body: z.string(), isInternal: z.boolean(), createdAt: timestamp, author: person.nullable() })
  .meta({ id: "TicketComment", description: "A reply on a ticket. An internal note is visible to responders only." });

const Ticket = z
  .object({
    id: z.guid(),
    number: z.number().int(),
    ticketKey: z.string(),
    subject: z.string(),
    description: z.string().nullable().meta({ description: "Sanitized rich text (A-318)" }),
    status: z.enum(v.STATUSES),
    priority: z.enum(v.PRIORITIES),
    category: z.enum(v.CATEGORIES),
    tenantId: z.guid(),
    createdBy: z.guid().nullable(),
    assignedTo: z.guid().nullable(),
    dueDate: z.string().nullable(),
    resolvedAt: timestamp.nullable(),
    closedAt: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
    tenant: z.object({ id: z.guid(), name: z.string() }).loose().nullable(),
    requester: person.nullable(),
    assignee: person.nullable(),
    comments: z.array(TicketComment),
  })
  .meta({
    id: "Ticket",
    example: {
      id: TICKET,
      number: 42,
      ticketKey: "TKT-42",
      subject: "Printer for certificates is offline",
      description: "<p>The label printer in lab 2 does not respond.</p>",
      status: "open",
      priority: "medium",
      category: "support",
      tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
      createdBy: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      assignedTo: null,
      dueDate: null,
      resolvedAt: null,
      closedAt: null,
      createdAt: "2030-01-15T09:00:00.000Z",
      updatedAt: "2030-01-15T09:00:00.000Z",
      tenant: { id: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f", name: "Example Hospital" },
      requester: { id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", firstName: "Ana", lastName: "Lab", email: "ana@example.test" },
      assignee: null,
      comments: [],
    },
  });

const tally = z.record(z.string(), z.number().int());
const TicketMetrics = z
  .object({
    total: z.number().int(),
    open: z.number().int(),
    resolved: z.number().int(),
    closed: z.number().int(),
    overdue: z.number().int(),
    byStatus: tally,
    byPriority: tally,
    byCategory: tally,
  })
  .meta({ id: "TicketMetrics", description: "Counts over the tickets the caller may see." });

const PERMISSION: Permission = {
  kind: "authenticated",
  reason: "Scoped inside ticket.service: a raiser their own tickets, a responder role the tenant's queue, a super admin every tenant's (routeGateExemptions.ts).",
};
const params = z.object({ ticketId: z.guid().meta({ description: "The ticket", example: TICKET }) });

export default defineRouteDocs({
  router: "api/tickets.route",
  mount: "/api/v1/tickets",
  tag: "Tickets",
  tagDescription: "Support / help-desk tickets (raise, triage, assign, discuss, resolve)",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/",
      operationId: "listTickets",
      summary: "List the tickets the caller may see (filterable)",
      permission: PERMISSION,
      audited: false,
      query: z.object({
        status: z.enum(v.STATUSES).optional(),
        priority: z.enum(v.PRIORITIES).optional(),
        category: z.enum(v.CATEGORIES).optional(),
        assignedTo: z.guid().optional(),
        mine: z.enum(["true", "false"]).optional().meta({ description: "Only tickets the caller raised or is assigned" }),
        q: z.string().optional().meta({ description: "Case-insensitive text in the subject or key (A-320)", example: "printer" }),
        page: z.coerce.number().int().min(1).optional().meta({ example: 1 }),
        limit: z.coerce.number().int().min(1).optional().meta({ example: 20 }),
      }),
      success: { status: 200, description: "A page of tickets; pagination in the top-level `meta`", list: Ticket },
    },
    {
      method: "post",
      path: "/",
      operationId: "createTicket",
      summary: "Raise a ticket",
      description: "A super admin cannot raise one (403). An assignee must be a user of the caller's tenant (A-277).",
      permission: PERMISSION,
      audited: true,
      body: v.createTicket,
      success: { status: 201, description: "The ticket", data: Ticket },
    },
    {
      method: "get",
      path: "/metrics",
      operationId: "getTicketMetrics",
      summary: "Ticket counts",
      permission: PERMISSION,
      audited: false,
      success: { status: 200, description: "The counts", data: TicketMetrics },
    },
    {
      method: "get",
      path: "/:ticketId",
      operationId: "getTicket",
      summary: "Get a ticket with its comment thread",
      description: "Internal notes are included for a responder only.",
      permission: PERMISSION,
      audited: false,
      params,
      success: { status: 200, description: "The ticket", data: Ticket },
    },
    {
      method: "patch",
      path: "/:ticketId",
      operationId: "updateTicket",
      summary: "Update a ticket",
      description: "The raiser or a responder. An assignee must be a user of the ticket's tenant (A-277).",
      permission: PERMISSION,
      audited: true,
      params,
      body: v.updateTicket,
      success: { status: 200, description: "The ticket", data: Ticket },
    },
    {
      method: "delete",
      path: "/:ticketId",
      operationId: "deleteTicket",
      summary: "Delete a ticket",
      description: "The raiser or a responder.",
      permission: PERMISSION,
      audited: true,
      params,
      success: { status: 200, description: "Deleted", data: z.object({ deleted: z.literal(true) }) },
    },
    {
      method: "post",
      path: "/:ticketId/assign",
      operationId: "assignTicket",
      summary: "Assign a ticket",
      description: "Responders only (403 otherwise). The assignee must be a user of the ticket's tenant (A-277).",
      permission: PERMISSION,
      audited: true,
      params,
      body: v.assignTicket,
      success: { status: 200, description: "The ticket", data: Ticket },
    },
    {
      method: "post",
      path: "/:ticketId/comments",
      operationId: "addTicketComment",
      summary: "Reply on a ticket",
      description: "An internal note (`isInternal`) is for responders only and never reaches the requester.",
      permission: PERMISSION,
      audited: true,
      params,
      body: v.addComment,
      success: { status: 201, description: "The comment", data: TicketComment },
    },
  ],
});
