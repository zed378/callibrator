/**
 * Support tickets, `/api/v1/tickets`.
 *
 * P9-18 (ADR-087): converted from ticket.controller.js, behaviour unchanged.
 * Each handler passes `req.user`, the path parameter, the body and
 * `auditPrincipal(req)` to the service as the JavaScript did. The casts are
 * typing only: `req.user` is read without a guard (`auth` runs first on every
 * route), the bodies arrive already validated (`validate(schema)` on the
 * route), and the list filters are passed raw (the service coerces them). The
 * service is read through its module object at each call, as before; the three
 * utilities are captured at load, as the `.js` destructured them. `export =`
 * keeps the exact object `require()` returned (the same keys, in the same
 * order).
 */
import type { Request, Response } from "express";
import ticketService from "../services/ticket.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const auditPrincipal = loadedAuditPrincipal;

type Service = typeof ticketService;
/** The service method's N-th parameter (what the handler passes it). */
type Arg<K extends keyof Service, N extends number> = Service[K] extends (...args: infer A) => unknown ? A[N] : never;

const listTickets = asyncHandler(async (req: Request, res: Response) => {
  // The filters are passed raw, as before (the service coerces them).
  const { status, priority, category, assignedTo, mine, q, page, limit } =
    req.query as Record<string, unknown>;
  const result = await ticketService.listTickets(req.user as Arg<"listTickets", 0>, {
    status,
    priority,
    category,
    assignedTo,
    mine: mine === "true" || mine === true,
    q,
    page,
    limit,
  });
  success(res, result.rows, result.meta, "Tickets retrieved");
});

const getMetrics = asyncHandler(async (req: Request, res: Response) => {
  const metrics = await ticketService.getMetrics(req.user as Arg<"getMetrics", 0>);
  success(res, metrics, null, "Ticket metrics retrieved");
});

const getTicket = asyncHandler(async (req: Request, res: Response) => {
  const ticket = await ticketService.getTicket(req.user as Arg<"getTicket", 0>, req.params["ticketId"] as string);
  success(res, ticket, null, "Ticket retrieved");
});

const createTicket = asyncHandler(async (req: Request, res: Response) => {
  const ticket = await ticketService.createTicket(req.user as Arg<"createTicket", 0>, req.body as Arg<"createTicket", 1>, auditPrincipal(req));
  success(res, ticket, null, "Ticket created", 201);
});

const updateTicket = asyncHandler(async (req: Request, res: Response) => {
  const ticket = await ticketService.updateTicket(
    req.user as Arg<"updateTicket", 0>,
    req.params["ticketId"] as string,
    req.body as Arg<"updateTicket", 2>,
    auditPrincipal(req),
  );
  success(res, ticket, null, "Ticket updated");
});

const assignTicket = asyncHandler(async (req: Request, res: Response) => {
  const ticket = await ticketService.assignTicket(
    req.user as Arg<"assignTicket", 0>,
    req.params["ticketId"] as string,
    (req.body as { assignedTo: Arg<"assignTicket", 2> }).assignedTo,
    auditPrincipal(req),
  );
  success(res, ticket, null, "Ticket assigned");
});

const deleteTicket = asyncHandler(async (req: Request, res: Response) => {
  const result = await ticketService.deleteTicket(req.user as Arg<"deleteTicket", 0>, req.params["ticketId"] as string, auditPrincipal(req));
  success(res, result, null, "Ticket deleted");
});

const addComment = asyncHandler(async (req: Request, res: Response) => {
  const comment = await ticketService.addComment(
    req.user as Arg<"addComment", 0>,
    req.params["ticketId"] as string,
    req.body as Arg<"addComment", 2>,
    auditPrincipal(req),
  );
  success(res, comment, null, "Comment added", 201);
});

const controller = {
  listTickets,
  getMetrics,
  getTicket,
  createTicket,
  updateTicket,
  assignTicket,
  deleteTicket,
  addComment,
};

export = controller;
