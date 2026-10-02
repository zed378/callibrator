/**
 * Kanban boards: `/api/v1/kanban` (index.js mounts it).
 *
 * P9-18 (ADR-087): converted from kanban.route.js. Every route and middleware
 * is in the same order as before (checked against the mounted route table).
 * The contract is code-first: kanban.openapi.ts (P9-25, ADR-103); the
 * `@swagger` JSDoc this file carried is gone.
 *
 * No route carries a menu gate: a board is gated per project inside the
 * service (owner / editor / viewer, by user or by role; a caller with no access
 * gets 404), and routeGateExemptions.ts records why.
 */
import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import kanban from "../../controllers/kanban.controller";
import {
  addMember,
  addRelation,
  createCard,
  createColumn,
  createLabel,
  createProject,
  createSprint,
  migrateCards,
  moveCard,
  reorderColumns,
  updateCard,
  updateColumn,
  updateLabel,
  updateMember,
  updateProject,
  updateSprint,
} from "../../validators/kanban.validator";

// `Router` is `express.Router` (the same function).
const router = Router();

router.use(auth);

router.get("/projects", kanban.listProjects);
router.post("/projects", validate(createProject), kanban.createProject);

router.get("/projects/:projectId", validateUuid("projectId"), kanban.getProject);
router.patch(
  "/projects/:projectId",
  validateUuid("projectId"),
  validate(updateProject),
  kanban.updateProject,
);
router.delete(
  "/projects/:projectId",
  validateUuid("projectId"),
  kanban.deleteProject,
);

// ---- Members ----
router.post(
  "/projects/:projectId/members",
  validateUuid("projectId"),
  validate(addMember),
  kanban.addMember,
);
router.patch(
  "/projects/:projectId/members/:memberId",
  validateUuid("projectId"),
  validateUuid("memberId"),
  validate(updateMember),
  kanban.updateMember,
);
router.delete(
  "/projects/:projectId/members/:memberId",
  validateUuid("projectId"),
  validateUuid("memberId"),
  kanban.removeMember,
);

// ---- Sprints ----
router.get(
  "/projects/:projectId/sprints",
  validateUuid("projectId"),
  kanban.listSprints,
);
router.post(
  "/projects/:projectId/sprints",
  validateUuid("projectId"),
  validate(createSprint),
  kanban.createSprint,
);
router.post(
  "/projects/:projectId/sprints/migrate",
  validateUuid("projectId"),
  validate(migrateCards),
  kanban.migrateCards,
);
router.patch(
  "/projects/:projectId/sprints/:sprintId",
  validateUuid("projectId"),
  validateUuid("sprintId"),
  validate(updateSprint),
  kanban.updateSprint,
);
router.delete(
  "/projects/:projectId/sprints/:sprintId",
  validateUuid("projectId"),
  validateUuid("sprintId"),
  kanban.deleteSprint,
);

// ---- Metrics / KPIs ----
router.get(
  "/projects/:projectId/metrics",
  validateUuid("projectId"),
  kanban.getMetrics,
);

// ---- Columns ----
router.post(
  "/projects/:projectId/columns",
  validateUuid("projectId"),
  validate(createColumn),
  kanban.createColumn,
);
router.post(
  "/projects/:projectId/columns/reorder",
  validateUuid("projectId"),
  validate(reorderColumns),
  kanban.reorderColumns,
);
router.patch(
  "/projects/:projectId/columns/:columnId",
  validateUuid("projectId"),
  validateUuid("columnId"),
  validate(updateColumn),
  kanban.updateColumn,
);
router.delete(
  "/projects/:projectId/columns/:columnId",
  validateUuid("projectId"),
  validateUuid("columnId"),
  kanban.deleteColumn,
);

// ---- Cards ----
router.post(
  "/projects/:projectId/cards",
  validateUuid("projectId"),
  validate(createCard),
  kanban.createCard,
);
router.patch(
  "/projects/:projectId/cards/:cardId/move",
  validateUuid("projectId"),
  validateUuid("cardId"),
  validate(moveCard),
  kanban.moveCard,
);
// Card relations (parent/child, blocks, relates-to, ...)
router.post(
  "/projects/:projectId/cards/:cardId/relations",
  validateUuid("projectId"),
  validateUuid("cardId"),
  validate(addRelation),
  kanban.addRelation,
);
router.delete(
  "/projects/:projectId/cards/:cardId/relations/:relationId",
  validateUuid("projectId"),
  validateUuid("cardId"),
  validateUuid("relationId"),
  kanban.removeRelation,
);
router.get(
  "/projects/:projectId/cards/:cardId",
  validateUuid("projectId"),
  validateUuid("cardId"),
  kanban.getCard,
);
router.patch(
  "/projects/:projectId/cards/:cardId",
  validateUuid("projectId"),
  validateUuid("cardId"),
  validate(updateCard),
  kanban.updateCard,
);
router.delete(
  "/projects/:projectId/cards/:cardId",
  validateUuid("projectId"),
  validateUuid("cardId"),
  kanban.deleteCard,
);

// ---- Labels ----
router.post(
  "/projects/:projectId/labels",
  validateUuid("projectId"),
  validate(createLabel),
  kanban.createLabel,
);
router.patch(
  "/projects/:projectId/labels/:labelId",
  validateUuid("projectId"),
  validateUuid("labelId"),
  validate(updateLabel),
  kanban.updateLabel,
);
router.delete(
  "/projects/:projectId/labels/:labelId",
  validateUuid("projectId"),
  validateUuid("labelId"),
  kanban.deleteLabel,
);

export = router;
