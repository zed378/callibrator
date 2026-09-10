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
 */
const { Op } = require("sequelize");
const models = require("../models");
const { Ticket, TicketComment, User, Tenant } = models;
// The models export IS the Sequelize instance; transactions/raw queries come
// off `.sequelize`.
const sequelize = models.sequelize;
const { AppError } = require("../utils/appError.util");
const notificationService = require("../services/notification.service");
const { DEFAULT_LIMIT, MAX_LIMIT } = require("../constants");

const STATUS_OPEN = "open";
const TERMINAL = { resolved: "resolvedAt", closed: "closedAt" };

// ------------------------------------------------------------------
// Access
// ------------------------------------------------------------------

const isSuperAdmin = (user) => {
  const name = user?.role?.name;
  return name === "SUPER_ADMIN" || name === "SUPERADMIN";
};

// Roles that staff the "response" desk. These mirror the roles seeded with the
// `tickets-response` menu: the super admin (platform-wide) plus per-tenant
// admins/managers. A responder sees their tenant's whole queue, may post
// internal notes, and can triage. Everyone else is a "requester" who only sees
// the tickets they are party to and never sees internal notes.
const RESPONDER_ROLES = new Set([
  "SUPER_ADMIN",
  "SUPERADMIN",
  "HEALTHCARE ADMIN",
  "CALIBRATOR ADMIN",
  "ENGINEERING MANAGER",
  "SUPERVISOR",
]);

const isResponder = (user) => RESPONDER_ROLES.has(user?.role?.name);

/**
 * Rows a user may touch. The super admin is the platform operator and works the
 * support desk across EVERY tenant, so they are never constrained to a single
 * tenant_id (Postgres RLS grants the same cross-tenant reach). Everyone else is
 * confined to their own tenant.
 */
const tenantScope = (user) =>
  isSuperAdmin(user) ? {} : { tenantId: user.tenantId };

/** Load a ticket the caller may reach (own tenant, or any tenant for a super admin), or 404. */
const loadTicket = async (user, ticketId, options = {}) => {
  const ticket = await Ticket.findOne({
    where: { id: ticketId, ...tenantScope(user) },
    ...options,
  });
  if (!ticket) {
    throw new AppError(404, "Ticket not found");
  }
  return ticket;
};

/**
 * Who may change a ticket: a super admin, the requester who raised it, or the
 * agent it is currently assigned to. Everyone else in the tenant can still read
 * and comment, but not mutate the ticket itself.
 */
const assertCanManage = (user, ticket) => {
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

const userBrief = (u) =>
  u
    ? { id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email }
    : null;

const tenantBrief = (t) => (t ? { id: t.id, name: t.name } : null);

const serializeTicket = (ticket) => ({
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
  comments: (ticket.comments || []).map(serializeComment),
});

const serializeComment = (c) => ({
  id: c.id,
  ticketId: c.ticketId,
  body: c.body,
  isInternal: c.isInternal,
  createdAt: c.createdAt,
  author: userBrief(c.author),
});

// required:false keeps the tenant/requester/assignee LEFT JOINs so an
// unassigned ticket (assignee null) is not dropped by an INNER JOIN.
const partyInclude = () => [
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

const actorName = (user) =>
  [user.firstName, user.lastName].filter(Boolean).join(" ") ||
  user.email ||
  "Someone";

/** Notify a set of user ids (skipping the actor and blanks). */
const notify = async (tenantId, userIds, actorId, { title, message, ticketId }) => {
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
const nextTicketNumber = async (tenantId, transaction) => {
  const result = await sequelize.query(
    `INSERT INTO ticket_counters (id, tenant_id, seq, created_at, updated_at)
     VALUES (gen_random_uuid(), :tenantId, 1, NOW(), NOW())
     ON CONFLICT (tenant_id)
     DO UPDATE SET seq = ticket_counters.seq + 1, updated_at = NOW()
     RETURNING seq`,
    { replacements: { tenantId }, transaction },
  );
  return result[0][0].seq;
};

// ------------------------------------------------------------------
// Queries
// ------------------------------------------------------------------

exports.listTickets = async (user, filters = {}) => {
  const where = { ...tenantScope(user) };
  const responder = isResponder(user);

  if (filters.status) where.status = filters.status;
  if (filters.priority) where.priority = filters.priority;
  if (filters.category) where.category = filters.category;
  // A requester is ALWAYS scoped to their own tickets (raised by or assigned to
  // them), regardless of the requested filters — they cannot browse the queue
  // or filter by another assignee. Responders get the full queue (their tenant,
  // or every tenant for a super admin) and honour the assignee/mine filters.
  if (!responder) {
    where[Op.or] = [{ createdBy: user.id }, { assignedTo: user.id }];
  } else {
    if (filters.assignedTo) where.assignedTo = filters.assignedTo;
    if (filters.mine) {
      where[Op.or] = [{ createdBy: user.id }, { assignedTo: user.id }];
    }
  }
  if (filters.q && String(filters.q).trim()) {
    const term = `%${String(filters.q).trim().toLowerCase()}%`;
    where[Op.and] = [
      ...(where[Op.and] || []),
      {
        [Op.or]: [
          { subject: { [Op.like]: term } },
          { ticketKey: { [Op.like]: term } },
        ],
      },
    ];
  }

  const limit = Math.min(Number(filters.limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const page = Math.max(Number(filters.page) || 1, 1);
  const offset = (page - 1) * limit;

  const { count, rows } = await Ticket.findAndCountAll({
    where,
    include: partyInclude(),
    order: [["createdAt", "DESC"]],
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

exports.getTicket = async (user, ticketId) => {
  const ticket = await Ticket.findOne({
    where: { id: ticketId, ...tenantScope(user) },
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
    ticket.comments = (ticket.comments || []).filter((c) => !c.isInternal);
  }

  return serializeTicket(ticket);
};

// ------------------------------------------------------------------
// Mutations
// ------------------------------------------------------------------

exports.createTicket = async (user, data) => {
  // The raise desk is for tenants reaching out to the platform. A super admin
  // IS the platform — they answer tickets, they do not raise them.
  if (isSuperAdmin(user)) {
    throw new AppError(403, "Super admins answer tickets and cannot raise them");
  }

  const created = await sequelize.transaction(async (transaction) => {
    const number = await nextTicketNumber(user.tenantId, transaction);
    return Ticket.create(
      {
        tenantId: user.tenantId,
        number,
        ticketKey: `TKT-${number}`,
        subject: data.subject,
        description: data.description || null,
        priority: data.priority || "medium",
        category: data.category || "support",
        assignedTo: data.assignedTo || null,
        dueDate: data.dueDate || null,
        status: STATUS_OPEN,
        createdBy: user.id,
      },
      { transaction },
    );
  });

  // A ticket assigned at creation notifies the agent.
  if (created.assignedTo) {
    await notify(created.tenantId, [created.assignedTo], user.id, {
      title: "A ticket was assigned to you",
      message: `${actorName(user)} assigned you ${created.ticketKey}: "${created.subject}"`,
      ticketId: created.id,
    });
  }

  return exports.getTicket(user, created.id);
};

exports.updateTicket = async (user, ticketId, data) => {
  const ticket = await loadTicket(user, ticketId);
  assertCanManage(user, ticket);

  const previousAssignee = ticket.assignedTo;
  const patch = {};
  for (const f of ["subject", "description", "priority", "category", "dueDate"]) {
    if (data[f] !== undefined) patch[f] = data[f];
  }
  if (data.assignedTo !== undefined) patch.assignedTo = data.assignedTo || null;

  if (data.status !== undefined && data.status !== ticket.status) {
    patch.status = data.status;
    // Stamp/clear the terminal timestamps as the status moves.
    patch.resolvedAt = data.status === "resolved" ? new Date() : null;
    patch.closedAt = data.status === "closed" ? new Date() : null;
  }

  await ticket.update(patch);

  // Notify a newly-assigned agent. Notifications land in the TICKET's tenant
  // (not the actor's — a super admin has none), so they reach the right desk.
  if (
    patch.assignedTo !== undefined &&
    patch.assignedTo &&
    patch.assignedTo !== previousAssignee
  ) {
    await notify(ticket.tenantId, [patch.assignedTo], user.id, {
      title: "A ticket was assigned to you",
      message: `${actorName(user)} assigned you ${ticket.ticketKey}: "${ticket.subject}"`,
      ticketId: ticket.id,
    });
  }

  // Notify the requester when their ticket is resolved or closed.
  if (patch.status && TERMINAL[patch.status]) {
    await notify(ticket.tenantId, [ticket.createdBy], user.id, {
      title: `Your ticket was ${patch.status}`,
      message: `${actorName(user)} marked ${ticket.ticketKey} as ${patch.status}`,
      ticketId: ticket.id,
    });
  }

  return exports.getTicket(user, ticketId);
};

exports.assignTicket = async (user, ticketId, assignedTo) => {
  // Thin wrapper so a dedicated assign endpoint reuses the same rules/notifs.
  return exports.updateTicket(user, ticketId, { assignedTo });
};

exports.deleteTicket = async (user, ticketId) => {
  const ticket = await loadTicket(user, ticketId);
  // Deletion is stricter than editing: only the requester or a super admin.
  if (!isSuperAdmin(user) && ticket.createdBy !== user.id) {
    throw new AppError(403, "Only the requester or an admin can delete a ticket");
  }
  await ticket.destroy(); // comments cascade
  return { deleted: true };
};

exports.addComment = async (user, ticketId, data) => {
  const ticket = await loadTicket(user, ticketId);

  const responder = isResponder(user);
  // A requester may only comment on a ticket they are party to.
  if (!responder && ticket.createdBy !== user.id && ticket.assignedTo !== user.id) {
    throw new AppError(404, "Ticket not found");
  }

  const comment = await TicketComment.create({
    ticketId: ticket.id,
    userId: user.id,
    body: data.body,
    // Only responders can leave internal notes; a requester's message is forced
    // public.
    isInternal: responder ? !!data.isInternal : false,
  });

  // Public replies notify both parties; internal notes never reach the
  // requester (they are responder-only).
  const recipients = data.isInternal
    ? [ticket.assignedTo]
    : [ticket.createdBy, ticket.assignedTo];
  await notify(ticket.tenantId, recipients, user.id, {
    title: `New reply on ${ticket.ticketKey}`,
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
  return serializeComment(full);
};

// ------------------------------------------------------------------
// Metrics
// ------------------------------------------------------------------

exports.getMetrics = async (user) => {
  const where = { ...tenantScope(user) };
  // A requester's metrics reflect only their own tickets — same scope as their
  // list — while a responder sees the whole queue (their tenant, or every
  // tenant for a super admin).
  if (!isResponder(user)) {
    where[Op.or] = [{ createdBy: user.id }, { assignedTo: user.id }];
  }
  const tickets = await Ticket.findAll({
    where,
    attributes: ["status", "priority", "category", "dueDate"],
  });

  const now = Date.now();
  const tally = (key, keys) => {
    const out = Object.fromEntries(keys.map((k) => [k, 0]));
    for (const t of tickets) {
      const v = t[key];
      if (v in out) out[v] += 1;
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
    open: byStatus.open + byStatus.in_progress,
    resolved: byStatus.resolved,
    closed: byStatus.closed,
    overdue,
    byStatus,
    byPriority,
    byCategory,
  };
};

// Exposed for tests.
exports._serializeTicket = serializeTicket;
exports._loadTicket = loadTicket;
exports._assertCanManage = assertCanManage;
exports._isResponder = isResponder;
exports._isSuperAdmin = isSuperAdmin;
exports._tenantScope = tenantScope;
