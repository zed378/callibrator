/**
 * Tests for ticket.controller.ts
 */
import type { Request, Response, NextFunction } from "express";

jest.mock("../../services/ticket.service", () => ({
  listTickets: jest.fn(),
  getMetrics: jest.fn(),
  getTicket: jest.fn(),
  createTicket: jest.fn(),
  updateTicket: jest.fn(),
  assignTicket: jest.fn(),
  deleteTicket: jest.fn(),
  addComment: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

interface TicketServiceDouble {
  listTickets: jest.Mock;
  getMetrics: jest.Mock;
  getTicket: jest.Mock;
  createTicket: jest.Mock;
  updateTicket: jest.Mock;
  assignTicket: jest.Mock;
  deleteTicket: jest.Mock;
  addComment: jest.Mock;
}

interface ResponseDouble {
  success: jest.Mock;
  error: jest.Mock;
}

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

interface TicketControllerDouble {
  listTickets: Handler;
  getMetrics: Handler;
  getTicket: Handler;
  createTicket: Handler;
  updateTicket: Handler;
  assignTicket: Handler;
  deleteTicket: Handler;
  addComment: Handler;
}

interface FakeRes {
  status: ((code: number) => FakeRes) & jest.Mock;
  json: jest.Mock;
  headersSent: boolean;
}

interface MockReq {
  body: Record<string, unknown> | undefined;
  query: Record<string, unknown>;
  params: Record<string, string | undefined>;
  user?: { id: string; tenantId: string } | undefined;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ticket = require("../../controllers/ticket.controller") as TicketControllerDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ticketService = require("../../services/ticket.service") as TicketServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { success, error } = require("../../utils/response.util") as ResponseDouble;

describe("ticketController", () => {
  let req: MockReq;
  let res: FakeRes;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    next = jest.fn();
    req = {
      body: {},
      query: {},
      params: {},
      user: { id: "user-1", tenantId: "tenant-1" },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      headersSent: false,
    };
  });

  it("listTickets forwards query filters and coerces mine='true'", async () => {
    req.query = {
      status: "open",
      priority: "high",
      category: "bug",
      assignedTo: "a1",
      mine: "true",
      q: "term",
      page: "2",
      limit: "10",
    };
    ticketService.listTickets.mockResolvedValueOnce({
      rows: [{ id: "t1" }],
      meta: { total: 1 },
    });
    await ticket.listTickets(req as unknown as Request, res as unknown as Response, next);
    expect(ticketService.listTickets).toHaveBeenCalledWith(req.user, {
      status: "open",
      priority: "high",
      category: "bug",
      assignedTo: "a1",
      mine: true,
      q: "term",
      page: "2",
      limit: "10",
    });
    expect(success).toHaveBeenCalledWith(
      res,
      [{ id: "t1" }],
      { total: 1 },
      "Tickets retrieved",
    );
  });

  it("listTickets accepts a real boolean mine=true", async () => {
    req.query = { mine: true };
    ticketService.listTickets.mockResolvedValueOnce({ rows: [], meta: {} });
    await ticket.listTickets(req as unknown as Request, res as unknown as Response, next);
    const firstCall = ticketService.listTickets.mock.calls[0] as [unknown, { mine?: boolean }];
    expect(firstCall[1].mine).toBe(true);
  });

  it("listTickets defaults mine to false when absent", async () => {
    ticketService.listTickets.mockResolvedValueOnce({ rows: [], meta: {} });
    await ticket.listTickets(req as unknown as Request, res as unknown as Response, next);
    const firstCall = ticketService.listTickets.mock.calls[0] as [unknown, { mine?: boolean }];
    expect(firstCall[1].mine).toBe(false);
  });

  it("getMetrics", async () => {
    ticketService.getMetrics.mockResolvedValueOnce({ total: 5 });
    await ticket.getMetrics(req as unknown as Request, res as unknown as Response, next);
    expect(ticketService.getMetrics).toHaveBeenCalledWith(req.user);
    expect(success).toHaveBeenCalledWith(
      res,
      { total: 5 },
      null,
      "Ticket metrics retrieved",
    );
  });

  it("getTicket", async () => {
    req.params = { ticketId: "t1" };
    ticketService.getTicket.mockResolvedValueOnce({ id: "t1" });
    await ticket.getTicket(req as unknown as Request, res as unknown as Response, next);
    expect(ticketService.getTicket).toHaveBeenCalledWith(req.user, "t1");
    expect(success).toHaveBeenCalledWith(res, { id: "t1" }, null, "Ticket retrieved");
  });

  it("createTicket", async () => {
    req.body = { subject: "S" };
    ticketService.createTicket.mockResolvedValueOnce({ id: "t1" });
    await ticket.createTicket(req as unknown as Request, res as unknown as Response, next);
    expect(ticketService.createTicket).toHaveBeenCalledWith(req.user, { subject: "S" }, expect.objectContaining({ apiKeyId: null }));
    expect(success).toHaveBeenCalledWith(res, { id: "t1" }, null, "Ticket created", 201);
  });

  it("updateTicket", async () => {
    req.params = { ticketId: "t1" };
    req.body = { subject: "S2" };
    ticketService.updateTicket.mockResolvedValueOnce({ id: "t1" });
    await ticket.updateTicket(req as unknown as Request, res as unknown as Response, next);
    expect(ticketService.updateTicket).toHaveBeenCalledWith(req.user, "t1", {
      subject: "S2",
    }, expect.objectContaining({ apiKeyId: null }));
    expect(success).toHaveBeenCalledWith(res, { id: "t1" }, null, "Ticket updated");
  });

  it("assignTicket", async () => {
    req.params = { ticketId: "t1" };
    req.body = { assignedTo: "agent" };
    ticketService.assignTicket.mockResolvedValueOnce({ id: "t1" });
    await ticket.assignTicket(req as unknown as Request, res as unknown as Response, next);
    expect(ticketService.assignTicket).toHaveBeenCalledWith(req.user, "t1", "agent", expect.objectContaining({ apiKeyId: null }));
    expect(success).toHaveBeenCalledWith(res, { id: "t1" }, null, "Ticket assigned");
  });

  it("deleteTicket", async () => {
    req.params = { ticketId: "t1" };
    ticketService.deleteTicket.mockResolvedValueOnce({ deleted: true });
    await ticket.deleteTicket(req as unknown as Request, res as unknown as Response, next);
    expect(ticketService.deleteTicket).toHaveBeenCalledWith(req.user, "t1", expect.objectContaining({ apiKeyId: null }));
    expect(success).toHaveBeenCalledWith(res, { deleted: true }, null, "Ticket deleted");
  });

  it("addComment", async () => {
    req.params = { ticketId: "t1" };
    req.body = { body: "hi" };
    ticketService.addComment.mockResolvedValueOnce({ id: "cm1" });
    await ticket.addComment(req as unknown as Request, res as unknown as Response, next);
    expect(ticketService.addComment).toHaveBeenCalledWith(req.user, "t1", { body: "hi" }, expect.objectContaining({ apiKeyId: null }));
    expect(success).toHaveBeenCalledWith(res, { id: "cm1" }, null, "Comment added", 201);
  });

  it("routes a thrown service error through response.util.error", async () => {
    req.params = { ticketId: "t1" };
    const boom = Object.assign(new Error("Ticket not found"), { status: 404 });
    ticketService.getTicket.mockRejectedValueOnce(boom);
    await ticket.getTicket(req as unknown as Request, res as unknown as Response, next);
    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(res, "Ticket not found", 404, expect.anything() as unknown);
    expect(next).toHaveBeenCalledWith(boom);
  });
});
