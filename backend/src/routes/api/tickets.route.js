/**
 * @swagger
 * tags:
 *   name: Tickets
 *   description: Support / help-desk tickets (raise, triage, assign, discuss, resolve)
 */

const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { validate } = require("../../middlewares/validation.middleware");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const ticket = require("../../controllers/ticket.controller");
const v = require("../../validators/ticket.validator");

router.use(auth);

/**
 * @swagger
 * /api/v1/tickets:
 *   get:
 *     summary: List tickets in the caller's tenant (filterable)
 *     tags: [Tickets]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Tickets retrieved }
 *   post:
 *     summary: Raise a new ticket
 *     tags: [Tickets]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Ticket created }
 */
router.get("/", ticket.listTickets);
router.post("/", validate(v.createTicket), ticket.createTicket);

// Registered before /:ticketId so "metrics" is not parsed as a uuid param.
router.get("/metrics", ticket.getMetrics);

/**
 * @swagger
 * /api/v1/tickets/{ticketId}:
 *   get:
 *     summary: Get a ticket with its comment thread
 *     tags: [Tickets]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Ticket retrieved }
 *       404: { description: Not found }
 */
router.get("/:ticketId", validateUuid("ticketId"), ticket.getTicket);
router.patch(
  "/:ticketId",
  validateUuid("ticketId"),
  validate(v.updateTicket),
  ticket.updateTicket,
);
router.delete("/:ticketId", validateUuid("ticketId"), ticket.deleteTicket);

router.post(
  "/:ticketId/assign",
  validateUuid("ticketId"),
  validate(v.assignTicket),
  ticket.assignTicket,
);

router.post(
  "/:ticketId/comments",
  validateUuid("ticketId"),
  validate(v.addComment),
  ticket.addComment,
);

module.exports = router;
