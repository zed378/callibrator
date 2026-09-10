const ticketService = require("../services/ticket.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");

exports.listTickets = asyncHandler(async (req, res) => {
  const { status, priority, category, assignedTo, mine, q, page, limit } =
    req.query;
  const result = await ticketService.listTickets(req.user, {
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

exports.getMetrics = asyncHandler(async (req, res) => {
  const metrics = await ticketService.getMetrics(req.user);
  success(res, metrics, null, "Ticket metrics retrieved");
});

exports.getTicket = asyncHandler(async (req, res) => {
  const ticket = await ticketService.getTicket(req.user, req.params.ticketId);
  success(res, ticket, null, "Ticket retrieved");
});

exports.createTicket = asyncHandler(async (req, res) => {
  const ticket = await ticketService.createTicket(req.user, req.body);
  success(res, ticket, null, "Ticket created", 201);
});

exports.updateTicket = asyncHandler(async (req, res) => {
  const ticket = await ticketService.updateTicket(
    req.user,
    req.params.ticketId,
    req.body,
  );
  success(res, ticket, null, "Ticket updated");
});

exports.assignTicket = asyncHandler(async (req, res) => {
  const ticket = await ticketService.assignTicket(
    req.user,
    req.params.ticketId,
    req.body.assignedTo,
  );
  success(res, ticket, null, "Ticket assigned");
});

exports.deleteTicket = asyncHandler(async (req, res) => {
  const result = await ticketService.deleteTicket(req.user, req.params.ticketId);
  success(res, result, null, "Ticket deleted");
});

exports.addComment = asyncHandler(async (req, res) => {
  const comment = await ticketService.addComment(
    req.user,
    req.params.ticketId,
    req.body,
  );
  success(res, comment, null, "Comment added", 201);
});
