/**
 * Tests for ticket.service.js
 */

// ================================================================
// MOCKS
// ================================================================

jest.mock("sequelize", () => ({
  Op: {
    or: Symbol("or"),
    and: Symbol("and"),
    like: Symbol("like"),
  },
}));

jest.mock("../../models", () => {
  const model = () => ({
    findOne: jest.fn(),
    findByPk: jest.fn(),
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
  });
  return {
    Ticket: model(),
    TicketComment: model(),
    User: {},
    Tenant: {},
    sequelize: {
      transaction: jest.fn(async (cb) => cb("txn")),
      query: jest.fn(),
    },
  };
});

jest.mock("../../services/notification.service", () => ({
  emitNotification: jest.fn(),
}));

jest.mock("../../constants", () => ({
  DEFAULT_LIMIT: 25,
  MAX_LIMIT: 100,
}));

jest.mock("../../utils/appError.util", () => {
  class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.name = "AppError";
      this.status = status;
    }
  }
  return { AppError };
});

// ================================================================
// IMPORTS (after mocks)
// ================================================================
const { Op } = require("sequelize");
const models = require("../../models");
const { Ticket, TicketComment, sequelize } = models;
const notificationService = require("../../services/notification.service");
const svc = require("../../services/ticket.service");

const TID = "tenant-1";

// The platform operator: works the support desk across EVERY tenant (no
// tenant_id constraint) and cannot raise tickets.
const superAdmin = {
  id: "sa",
  tenantId: null,
  role: { name: "SUPER_ADMIN" },
  firstName: "Super",
  lastName: "Admin",
  email: "sa@x.c",
};

// A per-tenant responder: works only their own tenant's queue, may post
// internal notes.
const responder = {
  id: "resp1",
  tenantId: TID,
  role: { name: "HEALTHCARE ADMIN" },
  firstName: "Res",
  lastName: "Ponder",
  email: "resp@x.c",
};

// A plain requester: sees only the tickets they are party to, no internal notes.
const requester = {
  id: "req1",
  tenantId: TID,
  role: { name: "USER" },
  email: "req@x.c",
};

const makeTicket = (over = {}) => ({
  id: "t1",
  number: 1,
  ticketKey: "TKT-1",
  subject: "Subject",
  description: "d",
  status: "open",
  priority: "medium",
  category: "support",
  tenantId: TID,
  createdBy: "creator",
  assignedTo: null,
  dueDate: null,
  resolvedAt: null,
  closedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  requester: { id: "creator", firstName: "Cre", lastName: "Ator", email: "c@x.c" },
  assignee: null,
  comments: [],
  update: jest.fn().mockResolvedValue(),
  destroy: jest.fn().mockResolvedValue(),
  ...over,
});

const makeComment = (over = {}) => ({
  id: "cm1",
  ticketId: "t1",
  body: "hello",
  isInternal: false,
  createdAt: new Date(),
  author: { id: "u1", firstName: "A", lastName: "B", email: "a@b.c" },
  ...over,
});

const expectReject = async (promise, message) => {
  await expect(promise).rejects.toThrow(message);
};

beforeEach(() => {
  jest.resetAllMocks();
  sequelize.transaction.mockImplementation(async (cb) => cb("txn"));
  sequelize.query.mockResolvedValue([[{ seq: 1 }]]);
  Ticket.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
  Ticket.findAll.mockResolvedValue([]);
  Ticket.findOne.mockResolvedValue(makeTicket());
  Ticket.create.mockResolvedValue(makeTicket());
  TicketComment.create.mockResolvedValue({ id: "cm1" });
  TicketComment.findByPk.mockResolvedValue(makeComment());
});

// ================================================================
// listTickets
// ================================================================
describe("listTickets", () => {
  it("applies every filter and the search term, with explicit page/limit", async () => {
    Ticket.findAndCountAll.mockResolvedValueOnce({
      count: 3,
      rows: [makeTicket()],
    });
    const res = await svc.listTickets(superAdmin, {
      status: "open",
      priority: "high",
      category: "bug",
      assignedTo: "agent",
      mine: true,
      q: "  Hello  ",
      page: 2,
      limit: 10,
    });
    const arg = Ticket.findAndCountAll.mock.calls[0][0];
    expect(arg.where.status).toBe("open");
    expect(arg.where.priority).toBe("high");
    expect(arg.where.category).toBe("bug");
    expect(arg.where.assignedTo).toBe("agent");
    expect(arg.where[Op.or]).toEqual([
      { createdBy: "sa" },
      { assignedTo: "sa" },
    ]);
    expect(arg.where[Op.and]).toBeDefined();
    expect(arg.limit).toBe(10);
    expect(arg.offset).toBe(10);
    expect(res.rows).toHaveLength(1);
    expect(res.meta).toEqual({ total: 3, page: 2, limit: 10, totalPages: 1 });
  });

  it("omits absent filters, ignores a whitespace-only q, and defaults page/limit", async () => {
    const res = await svc.listTickets(superAdmin, { q: "   " });
    const arg = Ticket.findAndCountAll.mock.calls[0][0];
    expect(arg.where.status).toBeUndefined();
    expect(arg.where[Op.or]).toBeUndefined();
    expect(arg.where[Op.and]).toBeUndefined();
    expect(arg.limit).toBe(25);
    expect(arg.offset).toBe(0);
    expect(res.meta.page).toBe(1);
    expect(res.meta.limit).toBe(25);
  });

  it("clamps the limit to MAX_LIMIT", async () => {
    await svc.listTickets(superAdmin, { limit: 500 });
    expect(Ticket.findAndCountAll.mock.calls[0][0].limit).toBe(100);
  });

  it("uses default filters when none are supplied", async () => {
    const res = await svc.listTickets(superAdmin);
    expect(res.rows).toEqual([]);
    expect(res.meta.limit).toBe(25);
  });
});

// ================================================================
// getTicket
// ================================================================
describe("getTicket", () => {
  it("returns a serialized ticket when found", async () => {
    Ticket.findOne.mockResolvedValueOnce(
      makeTicket({ comments: [makeComment()] }),
    );
    const res = await svc.getTicket(superAdmin, "t1");
    expect(res.id).toBe("t1");
    expect(res.requester.id).toBe("creator");
    expect(res.assignee).toBeNull();
    expect(res.comments).toHaveLength(1);
  });

  it("throws 404 when the ticket is missing", async () => {
    Ticket.findOne.mockResolvedValueOnce(null);
    await expectReject(svc.getTicket(superAdmin, "t1"), "Ticket not found");
  });
});

// ================================================================
// createTicket
// ================================================================
describe("createTicket", () => {
  it("blocks a super admin from raising a ticket", async () => {
    await expectReject(
      svc.createTicket(superAdmin, { subject: "x" }),
      "cannot raise",
    );
    expect(Ticket.create).not.toHaveBeenCalled();
  });

  it("creates a ticket with all fields and notifies the assignee", async () => {
    Ticket.create.mockResolvedValueOnce(
      makeTicket({
        id: "t9",
        assignedTo: "agent",
        ticketKey: "TKT-9",
        createdBy: "req1",
      }),
    );
    // The trailing getTicket runs as the requester, who must be party to it.
    Ticket.findOne.mockResolvedValueOnce(
      makeTicket({ id: "t9", createdBy: "req1", assignedTo: "agent" }),
    );
    const dueDate = new Date();
    const res = await svc.createTicket(requester, {
      subject: "Broken",
      description: "desc",
      priority: "high",
      category: "bug",
      assignedTo: "agent",
      dueDate,
    });
    const createArg = Ticket.create.mock.calls[0][0];
    expect(createArg).toEqual(
      expect.objectContaining({
        subject: "Broken",
        description: "desc",
        priority: "high",
        category: "bug",
        assignedTo: "agent",
        dueDate,
        status: "open",
        ticketKey: "TKT-1",
        number: 1,
        createdBy: "req1",
      }),
    );
    expect(notificationService.emitNotification).toHaveBeenCalledTimes(1);
    expect(res.id).toBe("t9");
  });

  it("applies fallbacks and does not notify when unassigned", async () => {
    Ticket.create.mockResolvedValueOnce(
      makeTicket({ assignedTo: null, createdBy: "req1" }),
    );
    Ticket.findOne.mockResolvedValueOnce(makeTicket({ createdBy: "req1" }));
    await svc.createTicket(requester, { subject: "Only subject" });
    expect(Ticket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        description: null,
        priority: "medium",
        category: "support",
        assignedTo: null,
        dueDate: null,
      }),
      { transaction: "txn" },
    );
    expect(notificationService.emitNotification).not.toHaveBeenCalled();
  });
});

// ================================================================
// updateTicket
// ================================================================
describe("updateTicket", () => {
  it("throws 404 when the ticket is missing", async () => {
    Ticket.findOne.mockResolvedValueOnce(null);
    await expectReject(
      svc.updateTicket(superAdmin, "t1", { subject: "x" }),
      "Ticket not found",
    );
  });

  it("throws 403 when the caller may not manage the ticket", async () => {
    Ticket.findOne.mockResolvedValueOnce(
      makeTicket({ createdBy: "creator", assignedTo: "agent" }),
    );
    await expectReject(
      svc.updateTicket({ id: "other", tenantId: TID }, "t1", { subject: "x" }),
      "do not have permission",
    );
  });

  it("patches every field, reassigns to a new agent and resolves (notifies both)", async () => {
    const ticket = makeTicket({
      createdBy: "creator",
      assignedTo: "oldAgent",
      status: "open",
    });
    Ticket.findOne.mockResolvedValueOnce(ticket);
    Ticket.findOne.mockResolvedValueOnce(makeTicket());
    const dueDate = new Date();
    await svc.updateTicket(superAdmin, "t1", {
      subject: "S2",
      description: "D2",
      priority: "urgent",
      category: "incident",
      dueDate,
      assignedTo: "newAgent",
      status: "resolved",
    });
    const patch = ticket.update.mock.calls[0][0];
    expect(patch).toEqual(
      expect.objectContaining({
        subject: "S2",
        description: "D2",
        priority: "urgent",
        category: "incident",
        dueDate,
        assignedTo: "newAgent",
        status: "resolved",
      }),
    );
    expect(patch.resolvedAt).toBeInstanceOf(Date);
    expect(patch.closedAt).toBeNull();
    // newAgent + requester(creator); actor is the super admin
    expect(notificationService.emitNotification).toHaveBeenCalledTimes(2);
  });

  it("stamps closedAt when moving to closed", async () => {
    const ticket = makeTicket({ status: "open" });
    Ticket.findOne.mockResolvedValueOnce(ticket);
    Ticket.findOne.mockResolvedValueOnce(makeTicket());
    await svc.updateTicket(superAdmin, "t1", { status: "closed" });
    const patch = ticket.update.mock.calls[0][0];
    expect(patch.status).toBe("closed");
    expect(patch.closedAt).toBeInstanceOf(Date);
    expect(patch.resolvedAt).toBeNull();
    // requester notified (terminal), no assignment change
    expect(notificationService.emitNotification).toHaveBeenCalledTimes(1);
  });

  it("does not stamp or notify a requester for a non-terminal status", async () => {
    const ticket = makeTicket({ status: "open", assignedTo: null });
    Ticket.findOne.mockResolvedValueOnce(ticket);
    Ticket.findOne.mockResolvedValueOnce(makeTicket());
    await svc.updateTicket(superAdmin, "t1", { status: "in_progress" });
    const patch = ticket.update.mock.calls[0][0];
    expect(patch.status).toBe("in_progress");
    expect(patch.resolvedAt).toBeNull();
    expect(patch.closedAt).toBeNull();
    expect(notificationService.emitNotification).not.toHaveBeenCalled();
  });

  it("skips the status patch when the status is unchanged", async () => {
    const ticket = makeTicket({ status: "open" });
    Ticket.findOne.mockResolvedValueOnce(ticket);
    Ticket.findOne.mockResolvedValueOnce(makeTicket());
    await svc.updateTicket(superAdmin, "t1", { status: "open" });
    const patch = ticket.update.mock.calls[0][0];
    expect(patch.status).toBeUndefined();
    expect(notificationService.emitNotification).not.toHaveBeenCalled();
  });

  it("clears the assignee to null without notifying", async () => {
    const ticket = makeTicket({ assignedTo: "oldAgent" });
    Ticket.findOne.mockResolvedValueOnce(ticket);
    Ticket.findOne.mockResolvedValueOnce(makeTicket());
    await svc.updateTicket(superAdmin, "t1", { assignedTo: null });
    expect(ticket.update.mock.calls[0][0].assignedTo).toBeNull();
    expect(notificationService.emitNotification).not.toHaveBeenCalled();
  });

  it("does not notify when the assignee is unchanged", async () => {
    const ticket = makeTicket({ assignedTo: "sameAgent" });
    Ticket.findOne.mockResolvedValueOnce(ticket);
    Ticket.findOne.mockResolvedValueOnce(makeTicket());
    await svc.updateTicket(superAdmin, "t1", { assignedTo: "sameAgent" });
    expect(notificationService.emitNotification).not.toHaveBeenCalled();
  });

  it("allows the creator to manage the ticket", async () => {
    const ticket = makeTicket({ createdBy: "creator" });
    Ticket.findOne.mockResolvedValueOnce(ticket);
    Ticket.findOne.mockResolvedValueOnce(makeTicket());
    await svc.updateTicket({ id: "creator", tenantId: TID }, "t1", {
      subject: "x",
    });
    expect(ticket.update).toHaveBeenCalled();
  });

  it("allows the current assignee to manage the ticket", async () => {
    const ticket = makeTicket({ createdBy: "creator", assignedTo: "agent" });
    Ticket.findOne.mockResolvedValueOnce(ticket);
    // The trailing getTicket runs as the same actor ("agent"), who must be a
    // party to the ticket it re-reads or it 404s.
    Ticket.findOne.mockResolvedValueOnce(
      makeTicket({ createdBy: "creator", assignedTo: "agent" }),
    );
    await svc.updateTicket({ id: "agent", tenantId: TID }, "t1", {
      subject: "x",
    });
    expect(ticket.update).toHaveBeenCalled();
  });
});

// ================================================================
// assignTicket
// ================================================================
describe("assignTicket", () => {
  it("delegates to updateTicket with the new assignee", async () => {
    const ticket = makeTicket({ assignedTo: "oldAgent" });
    Ticket.findOne.mockResolvedValueOnce(ticket);
    Ticket.findOne.mockResolvedValueOnce(makeTicket());
    await svc.assignTicket(superAdmin, "t1", "newAgent");
    expect(ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({ assignedTo: "newAgent" }),
    );
    expect(notificationService.emitNotification).toHaveBeenCalledTimes(1);
  });
});

// ================================================================
// deleteTicket
// ================================================================
describe("deleteTicket", () => {
  it("lets a super admin delete", async () => {
    const ticket = makeTicket({ createdBy: "creator" });
    Ticket.findOne.mockResolvedValueOnce(ticket);
    const res = await svc.deleteTicket(superAdmin, "t1");
    expect(ticket.destroy).toHaveBeenCalled();
    expect(res).toEqual({ deleted: true });
  });

  it("lets the requester delete", async () => {
    const ticket = makeTicket({ createdBy: "creator" });
    Ticket.findOne.mockResolvedValueOnce(ticket);
    const res = await svc.deleteTicket({ id: "creator", tenantId: TID }, "t1");
    expect(ticket.destroy).toHaveBeenCalled();
    expect(res).toEqual({ deleted: true });
  });

  it("forbids the assignee (or anyone else) from deleting", async () => {
    const ticket = makeTicket({ createdBy: "creator", assignedTo: "agent" });
    Ticket.findOne.mockResolvedValueOnce(ticket);
    await expectReject(
      svc.deleteTicket({ id: "agent", tenantId: TID }, "t1"),
      "Only the requester or an admin",
    );
    expect(ticket.destroy).not.toHaveBeenCalled();
  });
});

// ================================================================
// addComment
// ================================================================
describe("addComment", () => {
  it("public comment notifies both parties and returns the serialized comment", async () => {
    Ticket.findOne.mockResolvedValueOnce(
      makeTicket({ createdBy: "creator", assignedTo: "agent" }),
    );
    TicketComment.create.mockResolvedValueOnce({ id: "cm1" });
    TicketComment.findByPk.mockResolvedValueOnce(makeComment());
    const res = await svc.addComment(superAdmin, "t1", { body: "hi" });
    expect(TicketComment.create).toHaveBeenCalledWith(
      expect.objectContaining({ isInternal: false, body: "hi" }),
    );
    expect(notificationService.emitNotification).toHaveBeenCalledTimes(2);
    expect(res.author.id).toBe("u1");
  });

  it("internal comment notifies only the assignee and coerces isInternal", async () => {
    Ticket.findOne.mockResolvedValueOnce(
      makeTicket({ createdBy: "creator", assignedTo: "agent" }),
    );
    TicketComment.create.mockResolvedValueOnce({ id: "cm1" });
    TicketComment.findByPk.mockResolvedValueOnce(makeComment({ author: null }));
    const res = await svc.addComment(superAdmin, "t1", {
      body: "note",
      isInternal: 1,
    });
    expect(TicketComment.create).toHaveBeenCalledWith(
      expect.objectContaining({ isInternal: true }),
    );
    expect(notificationService.emitNotification).toHaveBeenCalledTimes(1);
    expect(res.author).toBeNull();
  });

  it("excludes the actor and null recipients from notifications", async () => {
    // creator === actor, assignee null -> both recipients drop out
    Ticket.findOne.mockResolvedValueOnce(
      makeTicket({ createdBy: "u1", assignedTo: null }),
    );
    TicketComment.create.mockResolvedValueOnce({ id: "cm1" });
    TicketComment.findByPk.mockResolvedValueOnce(makeComment());
    await svc.addComment({ id: "u1", tenantId: TID }, "t1", { body: "hi" });
    expect(notificationService.emitNotification).not.toHaveBeenCalled();
  });

  it("builds the actor label from the email when names are absent", async () => {
    Ticket.findOne.mockResolvedValueOnce(
      makeTicket({ createdBy: "u1", assignedTo: "agent" }),
    );
    TicketComment.create.mockResolvedValueOnce({ id: "cm1" });
    TicketComment.findByPk.mockResolvedValueOnce(makeComment());
    await svc.addComment(
      { id: "u1", tenantId: TID, email: "u1@x.c" },
      "t1",
      { body: "hi" },
    );
    const call = notificationService.emitNotification.mock.calls[0][0];
    expect(call.message).toContain("u1@x.c");
  });

  it("falls back to 'Someone' when the actor has no name or email", async () => {
    Ticket.findOne.mockResolvedValueOnce(
      makeTicket({ createdBy: "u1", assignedTo: "agent" }),
    );
    TicketComment.create.mockResolvedValueOnce({ id: "cm1" });
    TicketComment.findByPk.mockResolvedValueOnce(makeComment());
    await svc.addComment({ id: "u1", tenantId: TID }, "t1", { body: "hi" });
    const call = notificationService.emitNotification.mock.calls[0][0];
    expect(call.message).toContain("Someone");
  });
});

// ================================================================
// getMetrics
// ================================================================
describe("getMetrics", () => {
  it("tallies every bucket and counts only non-terminal overdue tickets", async () => {
    const past = new Date(Date.now() - 86400000);
    const future = new Date(Date.now() + 86400000);
    Ticket.findAll.mockResolvedValueOnce([
      { status: "open", priority: "low", category: "support", dueDate: past },
      { status: "in_progress", priority: "medium", category: "bug", dueDate: null },
      { status: "resolved", priority: "high", category: "feature", dueDate: past },
      { status: "closed", priority: "urgent", category: "incident", dueDate: null },
      { status: "open", priority: "low", category: "question", dueDate: future },
      // unknown enum values exercise the `v in out` miss branch
      { status: "archived", priority: "trivial", category: "misc", dueDate: null },
    ]);
    const res = await svc.getMetrics(superAdmin);
    expect(res.total).toBe(6);
    expect(res.byStatus).toEqual({
      open: 2,
      in_progress: 1,
      resolved: 1,
      closed: 1,
    });
    expect(res.byPriority).toEqual({ low: 2, medium: 1, high: 1, urgent: 1 });
    expect(res.byCategory).toEqual({
      support: 1,
      bug: 1,
      feature: 1,
      incident: 1,
      question: 1,
    });
    expect(res.open).toBe(3);
    expect(res.resolved).toBe(1);
    expect(res.closed).toBe(1);
    // only the open+past ticket is overdue (resolved-past & future excluded)
    expect(res.overdue).toBe(1);
  });
});

// ================================================================
// Helpers
// ================================================================
describe("helpers", () => {
  it("_loadTicket returns the ticket when found", async () => {
    const ticket = makeTicket();
    Ticket.findOne.mockResolvedValueOnce(ticket);
    const res = await svc._loadTicket(superAdmin, "t1");
    expect(res).toBe(ticket);
  });

  it("_loadTicket throws 404 when missing", async () => {
    Ticket.findOne.mockResolvedValueOnce(null);
    await expectReject(svc._loadTicket(superAdmin, "t1"), "Ticket not found");
  });

  it("_assertCanManage allows a SUPERADMIN (alt spelling)", () => {
    expect(() =>
      svc._assertCanManage(
        { id: "x", role: { name: "SUPERADMIN" } },
        makeTicket(),
      ),
    ).not.toThrow();
  });

  it("_assertCanManage allows the creator", () => {
    expect(() =>
      svc._assertCanManage({ id: "creator" }, makeTicket({ createdBy: "creator" })),
    ).not.toThrow();
  });

  it("_assertCanManage allows the assignee", () => {
    expect(() =>
      svc._assertCanManage({ id: "agent" }, makeTicket({ assignedTo: "agent" })),
    ).not.toThrow();
  });

  it("_assertCanManage throws 403 for anyone else (no role object)", () => {
    expect(() =>
      svc._assertCanManage(
        { id: "nobody" },
        makeTicket({ createdBy: "creator", assignedTo: "agent" }),
      ),
    ).toThrow("do not have permission");
  });

  it("_serializeTicket maps comments and a present requester", () => {
    const out = svc._serializeTicket(
      makeTicket({ comments: [makeComment()] }),
    );
    expect(out.requester.email).toBe("c@x.c");
    expect(out.assignee).toBeNull();
    expect(out.comments[0].author.id).toBe("u1");
  });

  it("_serializeTicket surfaces the tenant when present", () => {
    const out = svc._serializeTicket(
      makeTicket({ tenant: { id: TID, name: "Acme" } }),
    );
    expect(out.tenantId).toBe(TID);
    expect(out.tenant).toEqual({ id: TID, name: "Acme" });
  });

  it("_serializeTicket defaults missing comments and tenant to empty/null", () => {
    const out = svc._serializeTicket(
      makeTicket({ comments: undefined, assignee: { id: "agent", firstName: "Ag", lastName: "Ent", email: "ag@x.c" } }),
    );
    expect(out.comments).toEqual([]);
    expect(out.assignee.id).toBe("agent");
    expect(out.tenant).toBeNull();
  });

  it("_isSuperAdmin and _tenantScope confine everyone but the super admin", () => {
    expect(svc._isSuperAdmin(superAdmin)).toBe(true);
    expect(svc._isSuperAdmin(responder)).toBe(false);
    // Super admin spans every tenant; a tenant user is pinned to their own.
    expect(svc._tenantScope(superAdmin)).toEqual({});
    expect(svc._tenantScope(responder)).toEqual({ tenantId: TID });
  });
});

// ================================================================
// Point of view: requester vs responder (and platform-wide super admin)
// ================================================================
describe("requester vs responder point of view", () => {
  it("_isResponder classifies responder roles and requesters", () => {
    expect(svc._isResponder({ role: { name: "SUPERADMIN" } })).toBe(true);
    expect(svc._isResponder({ role: { name: "HEALTHCARE ADMIN" } })).toBe(true);
    expect(svc._isResponder({ role: { name: "SUPERVISOR" } })).toBe(true);
    expect(svc._isResponder({ role: { name: "USER" } })).toBe(false);
    expect(svc._isResponder({})).toBe(false);
  });

  it("lets a super admin span every tenant (no tenant_id filter)", async () => {
    await svc.listTickets(superAdmin, {});
    const arg = Ticket.findAndCountAll.mock.calls[0][0];
    expect(arg.where.tenantId).toBeUndefined();
    expect(arg.where[Op.or]).toBeUndefined();
  });

  it("confines a tenant responder to their own tenant's whole queue", async () => {
    await svc.listTickets(responder, {});
    const arg = Ticket.findAndCountAll.mock.calls[0][0];
    expect(arg.where.tenantId).toBe(TID);
    // A responder is not narrowed to their own tickets.
    expect(arg.where[Op.or]).toBeUndefined();
  });

  it("scopes a requester's list to their own tickets and ignores an assignee filter", async () => {
    await svc.listTickets(requester, { assignedTo: "someone-else", mine: false });
    const arg = Ticket.findAndCountAll.mock.calls[0][0];
    expect(arg.where.tenantId).toBe(TID);
    expect(arg.where[Op.or]).toEqual([
      { createdBy: "req1" },
      { assignedTo: "req1" },
    ]);
    // A requester cannot browse the queue by another agent's assignment.
    expect(arg.where.assignedTo).toBeUndefined();
  });

  it("hides internal notes from a requester who is a party", async () => {
    Ticket.findOne.mockResolvedValueOnce(
      makeTicket({
        createdBy: "req1",
        comments: [
          makeComment({ id: "pub", isInternal: false }),
          makeComment({ id: "int", isInternal: true }),
        ],
      }),
    );
    const res = await svc.getTicket(requester, "t1");
    expect(res.comments).toHaveLength(1);
    expect(res.comments[0].id).toBe("pub");
  });

  it("404s a requester opening a ticket they are not party to", async () => {
    Ticket.findOne.mockResolvedValueOnce(
      makeTicket({ createdBy: "someone", assignedTo: "other" }),
    );
    await expectReject(svc.getTicket(requester, "t1"), "Ticket not found");
  });

  it("handles a requester's ticket with no comments", async () => {
    Ticket.findOne.mockResolvedValueOnce(
      makeTicket({ createdBy: "req1", comments: undefined }),
    );
    const res = await svc.getTicket(requester, "t1");
    expect(res.comments).toEqual([]);
  });

  it("forces a requester's comment to public even when isInternal is set", async () => {
    Ticket.findOne.mockResolvedValueOnce(
      makeTicket({ createdBy: "req1", assignedTo: "agent" }),
    );
    await svc.addComment(requester, "t1", { body: "hi", isInternal: true });
    expect(TicketComment.create.mock.calls[0][0].isInternal).toBe(false);
  });

  it("404s a requester commenting on a ticket they are not party to", async () => {
    Ticket.findOne.mockResolvedValueOnce(
      makeTicket({ createdBy: "x", assignedTo: "y" }),
    );
    await expectReject(
      svc.addComment(requester, "t1", { body: "hi" }),
      "Ticket not found",
    );
  });

  it("scopes a requester's metrics to their own tickets", async () => {
    Ticket.findAll.mockResolvedValueOnce([]);
    await svc.getMetrics(requester);
    const arg = Ticket.findAll.mock.calls[0][0];
    expect(arg.where[Op.or]).toEqual([
      { createdBy: "req1" },
      { assignedTo: "req1" },
    ]);
  });
});
