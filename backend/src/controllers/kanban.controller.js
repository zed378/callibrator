const kanbanService = require("../services/kanban.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");

// ---- Projects ----

exports.listProjects = asyncHandler(async (req, res) => {
  const projects = await kanbanService.listProjects(req.user);
  success(res, projects, null, "Projects retrieved");
});

exports.createProject = asyncHandler(async (req, res) => {
  const project = await kanbanService.createProject(req.user, req.body);
  success(res, project, null, "Project created", 201);
});

exports.getProject = asyncHandler(async (req, res) => {
  const project = await kanbanService.getProject(
    req.user,
    req.params.projectId,
    { sprintId: req.query.sprintId },
  );
  success(res, project, null, "Project retrieved");
});

exports.updateProject = asyncHandler(async (req, res) => {
  const project = await kanbanService.updateProject(
    req.user,
    req.params.projectId,
    req.body,
  );
  success(res, project, null, "Project updated");
});

exports.deleteProject = asyncHandler(async (req, res) => {
  const result = await kanbanService.deleteProject(
    req.user,
    req.params.projectId,
  );
  success(res, result, null, "Project deleted");
});

// ---- Members ----

exports.addMember = asyncHandler(async (req, res) => {
  const result = await kanbanService.addMember(
    req.user,
    req.params.projectId,
    req.body,
  );
  success(res, result, null, "Member added", 201);
});

exports.updateMember = asyncHandler(async (req, res) => {
  const members = await kanbanService.updateMember(
    req.user,
    req.params.projectId,
    req.params.memberId,
    req.body,
  );
  success(res, members, null, "Member updated");
});

exports.removeMember = asyncHandler(async (req, res) => {
  const result = await kanbanService.removeMember(
    req.user,
    req.params.projectId,
    req.params.memberId,
  );
  success(res, result, null, "Member removed");
});

// ---- Columns ----

exports.createColumn = asyncHandler(async (req, res) => {
  const column = await kanbanService.createColumn(
    req.user,
    req.params.projectId,
    req.body,
  );
  success(res, column, null, "Column created", 201);
});

exports.updateColumn = asyncHandler(async (req, res) => {
  const column = await kanbanService.updateColumn(
    req.user,
    req.params.projectId,
    req.params.columnId,
    req.body,
  );
  success(res, column, null, "Column updated");
});

exports.deleteColumn = asyncHandler(async (req, res) => {
  const result = await kanbanService.deleteColumn(
    req.user,
    req.params.projectId,
    req.params.columnId,
  );
  success(res, result, null, "Column deleted");
});

exports.reorderColumns = asyncHandler(async (req, res) => {
  const columns = await kanbanService.reorderColumns(
    req.user,
    req.params.projectId,
    req.body.order,
  );
  success(res, columns, null, "Columns reordered");
});

// ---- Sprints ----

exports.listSprints = asyncHandler(async (req, res) => {
  const result = await kanbanService.listSprints(req.user, req.params.projectId);
  success(res, result, null, "Sprints retrieved");
});

exports.createSprint = asyncHandler(async (req, res) => {
  const sprint = await kanbanService.createSprint(
    req.user,
    req.params.projectId,
    req.body,
  );
  success(res, sprint, null, "Sprint created", 201);
});

exports.updateSprint = asyncHandler(async (req, res) => {
  const sprint = await kanbanService.updateSprint(
    req.user,
    req.params.projectId,
    req.params.sprintId,
    req.body,
  );
  success(res, sprint, null, "Sprint updated");
});

exports.deleteSprint = asyncHandler(async (req, res) => {
  const result = await kanbanService.deleteSprint(
    req.user,
    req.params.projectId,
    req.params.sprintId,
  );
  success(res, result, null, "Sprint deleted");
});

exports.migrateCards = asyncHandler(async (req, res) => {
  const result = await kanbanService.migrateCards(
    req.user,
    req.params.projectId,
    req.body,
  );
  success(res, result, null, "Cards migrated");
});

// ---- Metrics ----

exports.getMetrics = asyncHandler(async (req, res) => {
  const metrics = await kanbanService.getMetrics(
    req.user,
    req.params.projectId,
    { sprintId: req.query.sprintId },
  );
  success(res, metrics, null, "Metrics retrieved");
});

// ---- Cards ----

exports.getCard = asyncHandler(async (req, res) => {
  const card = await kanbanService.getCard(
    req.user,
    req.params.projectId,
    req.params.cardId,
  );
  success(res, card, null, "Card retrieved");
});

exports.createCard = asyncHandler(async (req, res) => {
  const card = await kanbanService.createCard(
    req.user,
    req.params.projectId,
    req.body,
  );
  success(res, card, null, "Card created", 201);
});

exports.updateCard = asyncHandler(async (req, res) => {
  const card = await kanbanService.updateCard(
    req.user,
    req.params.projectId,
    req.params.cardId,
    req.body,
  );
  success(res, card, null, "Card updated");
});

exports.moveCard = asyncHandler(async (req, res) => {
  const card = await kanbanService.moveCard(
    req.user,
    req.params.projectId,
    req.params.cardId,
    req.body,
  );
  success(res, card, null, "Card moved");
});

exports.deleteCard = asyncHandler(async (req, res) => {
  const result = await kanbanService.deleteCard(
    req.user,
    req.params.projectId,
    req.params.cardId,
  );
  success(res, result, null, "Card deleted");
});

// ---- Card relations ----

exports.addRelation = asyncHandler(async (req, res) => {
  const relations = await kanbanService.addRelation(
    req.user,
    req.params.projectId,
    req.params.cardId,
    req.body,
  );
  success(res, relations, null, "Relation added", 201);
});

exports.removeRelation = asyncHandler(async (req, res) => {
  const relations = await kanbanService.removeRelation(
    req.user,
    req.params.projectId,
    req.params.cardId,
    req.params.relationId,
  );
  success(res, relations, null, "Relation removed");
});

// ---- Labels ----

exports.createLabel = asyncHandler(async (req, res) => {
  const label = await kanbanService.createLabel(
    req.user,
    req.params.projectId,
    req.body,
  );
  success(res, label, null, "Label created", 201);
});

exports.updateLabel = asyncHandler(async (req, res) => {
  const label = await kanbanService.updateLabel(
    req.user,
    req.params.projectId,
    req.params.labelId,
    req.body,
  );
  success(res, label, null, "Label updated");
});

exports.deleteLabel = asyncHandler(async (req, res) => {
  const result = await kanbanService.deleteLabel(
    req.user,
    req.params.projectId,
    req.params.labelId,
  );
  success(res, result, null, "Label deleted");
});
