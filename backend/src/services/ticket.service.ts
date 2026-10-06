/**
 * Ticket Service
 *
 * A cross-tenant technical-support desk. Tenant users RAISE tickets to the
 * platform operator; the operator (super admin) and per-tenant responders work
 * the queue.
 *
 * Two points of view:
 *  - Requester (raise): any tenant user except a super admin. Sees only the
 *    tickets they are party to (raised by / assigned to them), inside their own
 *    tenant, and never sees internal notes.
 *  - Responder (response): the super admin — who spans EVERY tenant and answers
 *    the platform-wide support desk — plus per-tenant responder roles who work
 *    only their own tenant's queue and may post internal notes.
 *
 * P9-18 (ADR-087, Stage C): converted from ticket.service.js with no
 * behaviour change (its counter upsert moved to sql() first, as its own
 * change). `export =` keeps the object `require()` returned (the same keys,
 * in the same order). createTicket/updateTicket reach getTicket, and
 * assignTicket reaches updateTicket, through that object, as the `.js` did
 * through `exports`. Everything the `.js` destructured is captured at load;
 * `notificationService` and `auditService` are read at call time. The A-318
 * (sanitized rich text) and A-320 (ILIKE search) behaviour is unchanged.
 */
import { Op as LoadedOp } from "sequelize";
import type { CreationAttributes, Transaction, WhereOptions } from "sequelize";
import models from "../models";
import { AppError as LoadedAppError } from "../utils/appError.util";
// A-318: the description is rich HTML (the ticket editor), sanitized at save.
import { storedRichText as loadedStoredRichText } from "../utils/richText.util";
import notificationService from "./notification.service";
import auditService from "./audit.service";
import {
  auditEntryActor as loadedAuditEntryActor,
  actorChanges as loadedActorChanges,
} from "../utils/auditPrincipal.util";
import type { AuditActorInput } from "../utils/auditPrincipal.util";
import { DEFAULT_LIMIT as LOADED_DEFAULT_LIMIT, MAX_LIMIT as LOADED_MAX_LIMIT } from "../constants";
// P9-18: the counter upsert goes through the bind-only helper (P9-07): the
// tenant is bound as $1 (D-05), never a replacement.
import { sql as loadedSql } from "../utils/sql.util";
import type { SqlRunner } from "../utils/sql.util";
// N-01: the one super-admin predicate (utils/role.util.ts), both spellings.
import {
  isSuperAdmin as loadedIsSuperAdmin,
  SUPER_ADMIN_ROLE_NAMES as LOADED_SUPER_ADMIN_ROLE_NAMES,
} from "../utils/role.util";
import type { ModelInstance } from "../types/models";
import type { UserId } from "../types/ids";

const Op = LoadedOp;
const { Ticket, TicketComment, User, Tenant } = models;
// The models export IS the Sequelize instance; transactions/raw queries come
// off `.sequelize`.
const sequelize = models.sequelize;
// The instance sql() sends through. A plain identifier, so the D-05 scan reads the call.
const dbRunner = sequelize as unknown as SqlRunner;
const AppError = LoadedAppError;
const storedRichText = loadedStoredRichText;
const auditEntryActor = loadedAuditEntryActor;
const actorChanges = loadedActorChanges;
const DEFAULT_LIMIT = LOADED_DEFAULT_LIMIT;
const MAX_LIMIT = LOADED_MAX_LIMIT;
const sql = loadedSql;
const isSuperAdmin = loadedIsSuperAdmin;
const SUPER_ADMIN_ROLE_NAMES = LOADED_SUPER_ADMIN_ROLE_NAMES;

type TicketRow = ModelInstance<"Ticket">;
type CommentRow = ModelInstance<"TicketComment">;

/** The principal a ticket call acts for (req.user). */
interface TicketUser {
  id: string;
  tenantId: string;
  role?: { name?: string } | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  isApiKey?: boolean;
}

/** A person, as a ticket response names them. */
type Brief = { id: string; firstName: string | null; lastName: string | null; email: string } | null;

const STATUS_OPEN = "open";
const TERMINAL = { resolved: "resolvedAt", closed: "closedAt" };

// ------------------------------------------------------------------
// Access
// ------------------------------------------------------------------

// Roles that staff the "response" desk. These mirror the roles seeded with the
// `tickets-response` menu: the super admin (platform-wide) plus per-tenant
// admins/managers. A responder sees their tenant's whole queue, may post
// internal notes, and can triage. Everyone else is a "requester" who only sees
// the tickets they are party to and never sees internal notes.
const RESPONDER_ROLES = new Set([
  ...SUPER_ADMIN_ROLE_NAMES,
  "HEALTHCARE ADMIN",
  "CALIBRATOR ADMIN",
  "ENGINEERING MANAGER",
  "SUPERVISOR",
]);

const isResponder = (user: TicketUser | null | undefined): boolean => RESPONDER_ROLES.has(user?.role?.name as string);

/**
 * Rows a user may touch. The super admin is the platform operator and works the
 * support desk across EVERY tenant, so they are never constrained to a single
 * tenant_id (Postgres RLS grants the same cross-tenant reach). Everyone else is
 * confined to their own tenant.
 */
const tenantScope = (user: TicketUser): { tenantId?: string } =>
  isSuperAdmin(user) ? {} : { tenantId: user.tenantId };

/** Load a ticket the caller may reach (own tenant, or any tenant for a super admin), or 404. */
const loadTicket = async (user: TicketUser, ticketId: string, options: Record<string, unknown> = {}): Promise<TicketRow> => {
  const where: Record<string, unknown> = { id: ticketId, ...tenantScope(user) };
  const ticket = await Ticket.findOne({
    where: where as WhereOptions<TicketRow>,
    ...options,
  });
  if (!ticket) {
    throw new AppError(404, "Ticket not found");
  }
  return ticket;
};

/**
 * A-277 (ADR-094) — a ticket's assignee must be a user of the TICKET's tenant
 * (the caller's own when raising; a super admin works every tenant's queue, so
 * on an update it is the ticket's). The id used to be stored as given: another
 * tenant's user joined as `null` (A-75/ADR-048) and was notified in the wrong
 * tenant. Missing, soft-deleted and another tenant's are one 404 (A-129), and
 * the tenant predicate is explicit: a super admin's context skips the hooks.
 */
const ASSIGNEE_NOT_FOUND = "Assignee not found in this organisation";

const assertAssignee = async (tenantId: string, assignedTo: unknown, transaction?: Transaction): Promise<void> => {
  if (!assignedTo) {return;}
  // As built: `transaction` is passed as given (undefined on an update's check).
  const options: Record<string, unknown> = { where: { id: assignedTo, tenantId }, attributes: ["id"], transaction };
  const assignee = await User.findOne(options as Parameters<typeof User.findOne>[0]);
  if (!assignee) {
    throw new AppError(404, ASSIGNEE_NOT_FOUND);
  }
};

/**
 * Who may change a ticket: a super admin, the requester who raised it, or the
 * agent it is currently assigned to. Everyone else in the tenant can still read
 * and comment, but not mutate the ticket itself.
 */
const assertCanManage = (user: TicketUser, ticket: { createdBy: string | null; assignedTo: string | null }): void => {
  if (
    isSuperAdmin(user) ||
    ticket.createdBy === user.id ||
    ticket.assignedTo === user.id
  ) {
    return;
  }
  throw new AppError(403, "You do not have permission to modify this ticket");
};

// ------------------------------------------------------------------
// Serialization
// ------------------------------------------------------------------

const userBrief = (u: ModelInstance<"User"> | null | undefined): Brief =>
  u
    ? { id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email }
    : null;

const tenantBrief = (t: ModelInstance<"Tenant"> | null | undefined): { id: string; name: string } | null =>
  t ? { id: t.id, name: t.name } : null;

const serializeTicket = (ticket: TicketRow): Record<string, unknown> => ({
  id: ticket.id,
  number: ticket.number,
  ticketKey: ticket.ticketKey,
  subject: ticket.subject,
  description: ticket.description,
  status: ticket.status,
  priority: ticket.priority,
  category: ticket.category,
  tenantId: ticket.tenantId,
  createdBy: ticket.createdBy,
  assignedTo: ticket.assignedTo,
  dueDate: ticket.dueDate,
  resolvedAt: ticket.resolvedAt,
  closedAt: ticket.closedAt,
  createdAt: ticket.createdAt,
  updatedAt: ticket.updatedAt,
  // tenant is surfaced so the platform operator can tell cross-tenant tickets
  // apart on the response desk.
  tenant: tenantBrief(ticket.tenant),
  requester: userBrief(ticket.requester),
  assignee: userBrief(ticket.assignee),
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
  comments: (ticket.comments || []).map(serializeComment),
});

const serializeComment = (c: CommentRow): Record<string, unknown> => ({
  id: c.id,
  ticketId: c.ticketId,
  body: c.body,
  isInternal: c.isInternal,
  createdAt: c.createdAt,
  author: userBrief(c.author),
});

// required:false keeps the tenant/requester/assignee LEFT JOINs so an
// unassigned ticket (assignee null) is not dropped by an INNER JOIN.
const partyInclude = (): Record<string, unknown>[] => [
  {
    model: Tenant,
    as: "tenant",
    attributes: ["id", "name"],
    required: false,
  },
  {
    model: User,
    as: "requester",
    attributes: ["id", "firstName", "lastName", "email"],
    required: false,
  },
  {
    model: User,
    as: "assignee",
    attributes: ["id", "firstName", "lastName", "email"],
    required: false,
  },
];

// ------------------------------------------------------------------
// Notifications
// ------------------------------------------------------------------

/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: empty names fall through */
const actorName = (user: TicketUser): string =>
  [user.firstName, user.lastName].filter(Boolean).join(" ") ||
  user.email ||
  "Someone";
/* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

/** Notify a set of user ids (skipping the actor and blanks). */
const notify = async (
  tenantId: string,
  userIds: (string | null | undefined)[],
  actorId: string,
  { title, message, ticketId }: { title: string; message: string; ticketId: string },
): Promise<void> => {
  const targets = new Set(userIds.filter((id) => id && id !== actorId));
  const actionUrl = `/dashboard/tickets/${ticketId}`;
  await Promise.all(
    [...targets].map((userId) =>
      notificationService.emitNotification({
        tenantId,
        userId,
        type: "SYSTEM", // notifications enum has no dedicated ticket type
        title,
        message,
        actionUrl,
      }),
    ),
  );
};

// ------------------------------------------------------------------
// Per-tenant ticket key
// ------------------------------------------------------------------

/**
 * Atomically claim the next per-tenant ticket number. A single upsert both
 * creates the counter row on first use and increments it thereafter, so
 * concurrent creates can never collide or reuse a number.
 */
const nextTicketNumber = async (tenantId: string, transaction: Transaction): Promise<number> => {
  // `type: "SELECT"` (the helper's) answers the RETURNING row directly.
  const rows = await sql<{ seq: number }>(
    dbRunner,
    `INSERT INTO ticket_counters (id, tenant_id, seq, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, 1, NOW(), NOW())
     ON CONFLICT (tenant_id)
     DO UPDATE SET seq = ticket_counters.seq + 1, updated_at = NOW()
     RETURNING seq`,
    [tenantId],
    { transaction },
  );
  // The upsert always returns its row.
  return (rows[0] as { seq: number }).seq;
};

// ------------------------------------------------------------------
// Queries
// ------------------------------------------------------------------

const listTickets = async (
  user: TicketUser,
  filters: Record<string, unknown> = {},
): Promise<{ rows: Record<string, unknown>[]; meta: { total: number; page: number; limit: number; totalPages: number } }> => {
  const where: Record<string | symbol, unknown> = { ...tenantScope(user) };
  const responder = isResponder(user);

  if (filters["status"]) {where["status"] = filters["status"];}
  if (filters["priority"]) {where["priority"] = filters["priority"];}
  if (filters["category"]) {where["category"] = filters["category"];}
  // A requester is ALWAYS scoped to their own tickets (raised by or assigned to
  // them), regardless of the requested filters — they cannot browse the queue
  // or filter by another assignee. Responders get the full queue (their tenant,
  // or every tenant for a super admin) and honour the assignee/mine filters.
  if (!responder) {
    where[Op.or] = [{ createdBy: user.id }, { assignedTo: user.id }];
  } else {
    if (filters["assignedTo"]) {where["assignedTo"] = filters["assignedTo"];}
    if (filters["mine"]) {
      where[Op.or] = [{ createdBy: user.id }, { assignedTo: user.id }];
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: the query term's string form
  if (filters["q"] && String(filters["q"]).trim()) {
    // A-320: ILIKE on the term as typed (it was lower-cased under a
    // case-sensitive LIKE, so "Printer" and "TKT-7" found nothing).
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: the query term's string form
    const term = `%${String(filters["q"]).trim()}%`;
    where[Op.and] = [
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
      ...((where[Op.and] as unknown[] | undefined) || []),
      {
        [Op.or]: [
          { subject: { [Op.iLike]: term } },
          { ticketKey: { [Op.iLike]: term } },
        ],
      },
    ];
  }

  const limit = Math.min(Number(filters["limit"]) || DEFAULT_LIMIT, MAX_LIMIT);
  const page = Math.max(Number(filters["page"]) || 1, 1);
  const offset = (page - 1) * limit;

  const { count, rows } = await Ticket.findAndCountAll({
    where: where as WhereOptions<TicketRow>,
    include: partyInclude(),
    order: [["createdAt", "DESC"], ["id", "DESC"]],
    limit,
    offset,
    distinct: true,
  });

  return {
    rows: rows.map(serializeTicket),
    meta: {
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
    },
  };
};

const getTicket = async (user: TicketUser, ticketId: string): Promise<Record<string, unknown>> => {
  const where: Record<string, unknown> = { id: ticketId, ...tenantScope(user) };
  const ticket = await Ticket.findOne({
    where: where as WhereOptions<TicketRow>,
    include: [
      ...partyInclude(),
      {
        model: TicketComment,
        as: "comments",
        required: false,
        include: [
          {
            model: User,
            as: "author",
            attributes: ["id", "firstName", "lastName", "email"],
            required: false,
          },
        ],
      },
    ],
    order: [[{ model: TicketComment, as: "comments" }, "createdAt", "ASC"]],
  });
  if (!ticket) {
    throw new AppError(404, "Ticket not found");
  }

  const responder = isResponder(user);
  // A requester may only open a ticket they are party to. 404 (not 403) so the
  // existence of other users' tickets is not revealed.
  if (
    !responder &&
    ticket.createdBy !== user.id &&
    ticket.assignedTo !== user.id
  ) {
    throw new AppError(404, "Ticket not found");
  }

  // Internal notes are responder-only — strip them from a requester's view.
  if (!responder) {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
    ticket.comments = (ticket.comments || []).filter((c) => !c.isInternal);
  }

  return serializeTicket(ticket);
};

// ------------------------------------------------------------------
// Mutations
// ------------------------------------------------------------------

/** The fields of a ticket an audit row records — never the description (rich text, on the ticket). */
const AUDIT_FIELDS = ["subject", "priority", "category", "assignedTo", "dueDate", "status"];
const pickAudit = (row: TicketRow): Record<string, unknown> =>
  Object.fromEntries(AUDIT_FIELDS.map((k) => [k, (row as unknown as Record<string, unknown>)[k] ?? null]));

/**
 * P6-11 (A-41 addendum) — a ticket write commits with one audit row in its
 * transaction; a rolled-back write leaves none. The row is in the TICKET's
 * tenant (a super admin answering the desk acts across tenants, as A-165
 * records a platform operator). The actor is auditPrincipal(req); a caller
 * without one is named by `user` (the principal the service already has).
 *
 * @param transaction
 * @param actor - auditPrincipal(req)
 * @param user - req.user
 * @param tenantId - the ticket's tenant
 * @param action
 * @param resourceType - "Ticket" or "TicketComment"
 * @param resourceId
 * @param changes - { operation, before?, after? }
 */
const auditTicket = (
  transaction: Transaction,
  actor: AuditActorInput | null,
  user: TicketUser,
  tenantId: string,
  action: "CREATE" | "UPDATE" | "DELETE",
  resourceType: string,
  resourceId: string,
  changes: Record<string, unknown>,
): Promise<unknown> => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy actor means the user
  const who: AuditActorInput = actor || { userId: user.isApiKey ? null : user.id, apiKeyId: user.isApiKey ? user.id : null };
  return auditService.logAction(
    {
      tenantId,
      ...auditEntryActor(who),
      action,
      resourceType,
      resourceId,
      changes: { ...changes, ...actorChanges(who) },
    },
    { transaction },
  );
};

const createTicket = async (
  user: TicketUser,
  data: Record<string, unknown>,
  actor: AuditActorInput | null = null,
): Promise<Record<string, unknown>> => {
  // The raise desk is for tenants reaching out to the platform. A super admin
  // IS the platform — they answer tickets, they do not raise them.
  if (isSuperAdmin(user)) {
    throw new AppError(403, "Super admins answer tickets and cannot raise them");
  }

  const created = await sequelize.transaction(async (transaction) => {
    await assertAssignee(user.tenantId, data["assignedTo"], transaction);
    const number = await nextTicketNumber(user.tenantId, transaction);
    /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: empty values fall back */
    const values: Record<string, unknown> = {
      tenantId: user.tenantId,
      number,
      ticketKey: `TKT-${String(number)}`,
      subject: data["subject"],
      description: storedRichText(data["description"] as string | null | undefined),
      priority: data["priority"] || "medium",
      category: data["category"] || "support",
      assignedTo: data["assignedTo"] || null,
      dueDate: data["dueDate"] || null,
      status: STATUS_OPEN,
      createdBy: user.id,
    };
    /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
    // As built: the validated request values are stored as given.
    const ticket = await Ticket.create(values as unknown as CreationAttributes<TicketRow>, { transaction });
    await auditTicket(transaction, actor, user, ticket.tenantId, "CREATE", "Ticket", ticket.id, {
      operation: "TICKET_CREATE",
      ticketKey: ticket.ticketKey,
      after: pickAudit(ticket),
    });
    return ticket;
  });

  // A ticket assigned at creation notifies the agent.
  if (created.assignedTo) {
    await notify(created.tenantId, [created.assignedTo], user.id, {
      title: "A ticket was assigned to you",
      message: `${actorName(user)} assigned you ${String(created.ticketKey)}: "${created.subject}"`,
      ticketId: created.id,
    });
  }

  return service.getTicket(user, created.id);
};

const updateTicket = async (
  user: TicketUser,
  ticketId: string,
  data: Record<string, unknown>,
  actor: AuditActorInput | null = null,
): Promise<Record<string, unknown>> => {
  const ticket = await loadTicket(user, ticketId);
  assertCanManage(user, ticket);

  const previousAssignee = ticket.assignedTo;
  const patch: Record<string, unknown> = {};
  for (const f of ["subject", "description", "priority", "category", "dueDate"]) {
    if (data[f] !== undefined) {patch[f] = data[f];}
  }
  if (patch["description"] !== undefined) {patch["description"] = storedRichText(patch["description"] as string | null);}
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty id clears the assignee
  if (data["assignedTo"] !== undefined) {patch["assignedTo"] = data["assignedTo"] || null;}
  await assertAssignee(ticket.tenantId, patch["assignedTo"]);

  if (data["status"] !== undefined && data["status"] !== ticket.status) {
    patch["status"] = data["status"];
    // Stamp/clear the terminal timestamps as the status moves.
    patch["resolvedAt"] = data["status"] === "resolved" ? new Date() : null;
    patch["closedAt"] = data["status"] === "closed" ? new Date() : null;
  }

  const before = pickAudit(ticket);
  await sequelize.transaction(async (transaction) => {
    await ticket.update(patch, { transaction });
    await auditTicket(transaction, actor, user, ticket.tenantId, "UPDATE", "Ticket", ticket.id, {
      operation: "TICKET_UPDATE",
      ticketKey: ticket.ticketKey,
      before,
      after: pickAudit(ticket),
      descriptionChanged: patch["description"] !== undefined,
    });
  });

  // Notify a newly-assigned agent. Notifications land in the TICKET's tenant
  // (not the actor's — a super admin has none), so they reach the right desk.
  if (
    patch["assignedTo"] !== undefined &&
    patch["assignedTo"] &&
    patch["assignedTo"] !== previousAssignee
  ) {
    await notify(ticket.tenantId, [patch["assignedTo"] as string], user.id, {
      title: "A ticket was assigned to you",
      message: `${actorName(user)} assigned you ${String(ticket.ticketKey)}: "${ticket.subject}"`,
      ticketId: ticket.id,
    });
  }

  // Notify the requester when their ticket is resolved or closed.
  const newStatus = patch["status"] as string | undefined;
  if (newStatus && TERMINAL[newStatus as keyof typeof TERMINAL]) {
    await notify(ticket.tenantId, [ticket.createdBy], user.id, {
      title: `Your ticket was ${newStatus}`,
      message: `${actorName(user)} marked ${String(ticket.ticketKey)} as ${newStatus}`,
      ticketId: ticket.id,
    });
  }

  return service.getTicket(user, ticketId);
};

const assignTicket = async (
  user: TicketUser,
  ticketId: string,
  assignedTo: unknown,
  actor: AuditActorInput | null = null,
): Promise<Record<string, unknown>> => {
  // Thin wrapper so a dedicated assign endpoint reuses the same rules/notifs.
  return service.updateTicket(user, ticketId, { assignedTo }, actor);
};

const deleteTicket = async (user: TicketUser, ticketId: string, actor: AuditActorInput | null = null): Promise<{ deleted: true }> => {
  const ticket = await loadTicket(user, ticketId);
  // Deletion is stricter than editing: only the requester or a super admin.
  if (!isSuperAdmin(user) && ticket.createdBy !== user.id) {
    throw new AppError(403, "Only the requester or an admin can delete a ticket");
  }
  await sequelize.transaction(async (transaction) => {
    await ticket.destroy({ transaction }); // comments cascade
    await auditTicket(transaction, actor, user, ticket.tenantId, "DELETE", "Ticket", ticket.id, {
      operation: "TICKET_DELETE",
      ticketKey: ticket.ticketKey,
      before: pickAudit(ticket),
    });
  });
  return { deleted: true };
};

const addComment = async (
  user: TicketUser,
  ticketId: string,
  data: Record<string, unknown>,
  actor: AuditActorInput | null = null,
): Promise<Record<string, unknown>> => {
  const ticket = await loadTicket(user, ticketId);

  const responder = isResponder(user);
  // A requester may only comment on a ticket they are party to.
  if (!responder && ticket.createdBy !== user.id && ticket.assignedTo !== user.id) {
    throw new AppError(404, "Ticket not found");
  }

  const comment = await sequelize.transaction(async (transaction) => {
    const created = await TicketComment.create(
      {
        ticketId: ticket.id,
        userId: user.id as UserId,
        body: data["body"] as string,
        // Only responders can leave internal notes; a requester's message is forced
        // public.
        isInternal: responder ? !!data["isInternal"] : false,
      },
      { transaction },
    );
    // The body is the conversation, kept on the comment; the row records that it was posted.
    await auditTicket(transaction, actor, user, ticket.tenantId, "CREATE", "TicketComment", created.id, {
      operation: "TICKET_COMMENT_CREATE",
      ticketId: ticket.id,
      ticketKey: ticket.ticketKey,
      isInternal: created.isInternal,
    });
    return created;
  });

  // Public replies notify both parties; internal notes never reach the
  // requester (they are responder-only).
  const recipients = data["isInternal"]
    ? [ticket.assignedTo]
    : [ticket.createdBy, ticket.assignedTo];
  await notify(ticket.tenantId, recipients, user.id, {
    title: `New reply on ${String(ticket.ticketKey)}`,
    message: `${actorName(user)} commented on "${ticket.subject}"`,
    ticketId: ticket.id,
  });

  const full = await TicketComment.findByPk(comment.id, {
    include: [
      {
        model: User,
        as: "author",
        attributes: ["id", "firstName", "lastName", "email"],
        required: false,
      },
    ],
  });
  // The comment just created is read back.
  return serializeComment(full as CommentRow);
};

// ------------------------------------------------------------------
// Metrics
// ------------------------------------------------------------------

const getMetrics = async (user: TicketUser): Promise<Record<string, unknown>> => {
  const where: Record<string | symbol, unknown> = { ...tenantScope(user) };
  // A requester's metrics reflect only their own tickets — same scope as their
  // list — while a responder sees the whole queue (their tenant, or every
  // tenant for a super admin).
  if (!isResponder(user)) {
    where[Op.or] = [{ createdBy: user.id }, { assignedTo: user.id }];
  }
  const tickets = await Ticket.findAll({
    where: where as WhereOptions<TicketRow>,
    attributes: ["status", "priority", "category", "dueDate"],
  });

  const now = Date.now();
  const tally = (key: "status" | "priority" | "category", keys: string[]): Record<string, number> => {
    const out: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
    for (const t of tickets) {
      const v = t[key];
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- `v in out` guarantees the key
      if (v in out) {out[v]! += 1;}
    }
    return out;
  };

  const byStatus = tally("status", ["open", "in_progress", "resolved", "closed"]);
  const byPriority = tally("priority", ["low", "medium", "high", "urgent"]);
  const byCategory = tally("category", [
    "support",
    "bug",
    "feature",
    "incident",
    "question",
  ]);

  const openish = tickets.filter(
    (t) => t.status === "open" || t.status === "in_progress",
  );
  const overdue = openish.filter(
    (t) => t.dueDate && new Date(t.dueDate).getTime() < now,
  ).length;

  return {
    total: tickets.length,
    // The tally always carries these keys.
    open: (byStatus["open"] as number) + (byStatus["in_progress"] as number),
    resolved: byStatus["resolved"],
    closed: byStatus["closed"],
    overdue,
    byStatus,
    byPriority,
    byCategory,
  };
};

const service = {
  ASSIGNEE_NOT_FOUND,
  listTickets,
  getTicket,
  createTicket,
  updateTicket,
  assignTicket,
  deleteTicket,
  addComment,
  getMetrics,
  // Exposed for tests.
  _serializeTicket: serializeTicket,
  _loadTicket: loadTicket,
  _assertCanManage: assertCanManage,
  _isResponder: isResponder,
  _isSuperAdmin: isSuperAdmin,
  _tenantScope: tenantScope,
};

export = service;
