/**
 * Support tickets: `/api/v1/tickets` (index.js mounts it).
 *
 * P9-18 (ADR-087): converted from tickets.route.js. Every route and middleware
 * is in the same order as before (checked against the mounted route table). The
 * contract is code-first: tickets.openapi.ts (P9-25, ADR-103); the `@swagger`
 * JSDoc this file carried is gone.
 *
 * No route carries a menu gate: ticket.service scopes every call to the
 * raiser or a responder, and routeGateExemptions.ts records each reason.
 */
import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import ticket from "../../controllers/ticket.controller";
import {
  addComment,
  assignTicket,
  createTicket,
  updateTicket,
} from "../../validators/ticket.validator";

// `Router` is `express.Router` (the same function).
const router = Router();

router.use(auth);

router.get("/", ticket.listTickets);
router.post("/", validate(createTicket), ticket.createTicket);

// Registered before /:ticketId so "metrics" is not parsed as a uuid param.
router.get("/metrics", ticket.getMetrics);

router.get("/:ticketId", validateUuid("ticketId"), ticket.getTicket);
router.patch(
  "/:ticketId",
  validateUuid("ticketId"),
  validate(updateTicket),
  ticket.updateTicket,
);
router.delete("/:ticketId", validateUuid("ticketId"), ticket.deleteTicket);

router.post(
  "/:ticketId/assign",
  validateUuid("ticketId"),
  validate(assignTicket),
  ticket.assignTicket,
);

router.post(
  "/:ticketId/comments",
  validateUuid("ticketId"),
  validate(addComment),
  ticket.addComment,
);

export = router;
