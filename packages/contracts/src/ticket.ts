/**
 * Ticket Validators.
 *
 * P9-11 (ADR-093): moved to Zod.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/ticket.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the ticket routes.
 */
import { z } from "zod";
import { booleanish, dateLike, nullableText, uuid } from "./fields";

const STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const CATEGORIES = ["support", "bug", "feature", "incident", "question"] as const;

// Rich-text HTML from the editor; length caps the payload, not the markup.
const description = nullableText(50000);

const createTicket = z.object({
  subject: z.string().trim().min(3).max(255),
  description,
  priority: z.enum(PRIORITIES).default("medium"),
  category: z.enum(CATEGORIES).default("support"),
  assignedTo: uuid().nullable().optional(),
  dueDate: dateLike().nullable().optional(),
});

const updateTicket = z
  .object({
    subject: z.string().trim().min(3).max(255).optional(),
    description,
    status: z.enum(STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    category: z.enum(CATEGORIES).optional(),
    assignedTo: uuid().nullable().optional(),
    dueDate: dateLike().nullable().optional(),
  })
  // At least one field to change.
  .refine((v) => Object.keys(v).length >= 1, { error: "Provide at least one field to update" });

const assignTicket = z.object({
  // null unassigns the ticket.
  assignedTo: uuid().nullable(),
});

const addComment = z.object({
  body: z.string().trim().min(1).max(50000),
  isInternal: booleanish().default(false),
});

export { createTicket, updateTicket, assignTicket, addComment, STATUSES, PRIORITIES, CATEGORIES };

// The client-side (input) and handler-side (output) types of each schema.
export type CreateTicketInput = z.input<typeof createTicket>;
export type CreateTicketBody = z.output<typeof createTicket>;
export type UpdateTicketInput = z.input<typeof updateTicket>;
export type UpdateTicketBody = z.output<typeof updateTicket>;
export type AssignTicketInput = z.input<typeof assignTicket>;
export type AssignTicketBody = z.output<typeof assignTicket>;
export type AddCommentInput = z.input<typeof addComment>;
export type AddCommentBody = z.output<typeof addComment>;
