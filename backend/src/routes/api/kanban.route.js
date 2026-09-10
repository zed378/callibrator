/**
 * @swagger
 * tags:
 *   name: Kanban
 *   description: Project-tracker kanban boards (per-project membership, realtime, notifications)
 */

const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { validate } = require("../../middlewares/validation.middleware");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const kanban = require("../../controllers/kanban.controller");
const v = require("../../validators/kanban.validator");

router.use(auth);

/**
 * @swagger
 * /api/v1/kanban/projects:
 *   get:
 *     summary: List kanban projects (boards) the caller can access
 *     tags: [Kanban]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Projects retrieved }
 *   post:
 *     summary: Create a kanban project (board)
 *     tags: [Kanban]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Project created }
 */
router.get("/projects", kanban.listProjects);
router.post("/projects", validate(v.createProject), kanban.createProject);

/**
 * @swagger
 * /api/v1/kanban/projects/{projectId}:
 *   get:
 *     summary: Get a full board (columns, cards, labels, members)
 *     tags: [Kanban]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Project retrieved }
 *       403: { description: Insufficient access }
 *       404: { description: Not found }
 */
router.get("/projects/:projectId", validateUuid("projectId"), kanban.getProject);
router.patch(
  "/projects/:projectId",
  validateUuid("projectId"),
  validate(v.updateProject),
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
  validate(v.addMember),
  kanban.addMember,
);
router.patch(
  "/projects/:projectId/members/:memberId",
  validateUuid("projectId"),
  validateUuid("memberId"),
  validate(v.updateMember),
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
  validate(v.createSprint),
  kanban.createSprint,
);
router.post(
  "/projects/:projectId/sprints/migrate",
  validateUuid("projectId"),
  validate(v.migrateCards),
  kanban.migrateCards,
);
router.patch(
  "/projects/:projectId/sprints/:sprintId",
  validateUuid("projectId"),
  validateUuid("sprintId"),
  validate(v.updateSprint),
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
  validate(v.createColumn),
  kanban.createColumn,
);
router.post(
  "/projects/:projectId/columns/reorder",
  validateUuid("projectId"),
  validate(v.reorderColumns),
  kanban.reorderColumns,
);
router.patch(
  "/projects/:projectId/columns/:columnId",
  validateUuid("projectId"),
  validateUuid("columnId"),
  validate(v.updateColumn),
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
  validate(v.createCard),
  kanban.createCard,
);
router.patch(
  "/projects/:projectId/cards/:cardId/move",
  validateUuid("projectId"),
  validateUuid("cardId"),
  validate(v.moveCard),
  kanban.moveCard,
);
// Card relations (parent/child, blocks, relates-to, ...)
router.post(
  "/projects/:projectId/cards/:cardId/relations",
  validateUuid("projectId"),
  validateUuid("cardId"),
  validate(v.addRelation),
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
  validate(v.updateCard),
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
  validate(v.createLabel),
  kanban.createLabel,
);
router.patch(
  "/projects/:projectId/labels/:labelId",
  validateUuid("projectId"),
  validateUuid("labelId"),
  validate(v.updateLabel),
  kanban.updateLabel,
);
router.delete(
  "/projects/:projectId/labels/:labelId",
  validateUuid("projectId"),
  validateUuid("labelId"),
  kanban.deleteLabel,
);

module.exports = router;
