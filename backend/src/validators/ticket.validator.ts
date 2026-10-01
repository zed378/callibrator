/**
 * ticket request schemas.
 *
 * P9-11 (ADR-093): moved to Zod. P9-22 (ADR-097): the schemas live in
 * `@callibrator/contracts/ticket` (packages/contracts/src/ticket.ts), shared with the
 * frontend. The same objects are re-exported here under the same names, so
 * every importer and test is unchanged.
 */
export {
  createTicket,
  updateTicket,
  assignTicket,
  addComment,
  STATUSES,
  PRIORITIES,
  CATEGORIES,
} from "@callibrator/contracts/ticket";
