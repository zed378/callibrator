/**
 * Kanban boards, `/api/v1/kanban`.
 *
 * P9-18 (ADR-087): converted from kanban.controller.js, behaviour unchanged.
 * Each handler passes `req.user`, the path parameters, the body and
 * `auditPrincipal(req)` to the service as the JavaScript did. The casts are
 * typing only: `req.user` is read without a guard (`auth` runs first on every
 * route), and the body arrives already validated (`validate(schema)` on the
 * route). The service is read through its module object at each call, as
 * before; the three utilities are captured at load, as the `.js` destructured
 * them. `export =` keeps the exact object `require()` returned (the same keys,
 * in the same order).
 */
import type { Request, Response } from "express";
import kanbanService from "../services/kanban.service";
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";

const auditPrincipal = loadedAuditPrincipal;
const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;

type Service = typeof kanbanService;
/** The service method's N-th parameter (what the handler passes it). */
type Arg<K extends keyof Service, N extends number> = Service[K] extends (...args: infer A) => unknown ? A[N] : never;

// ---- Projects ----

const listProjects = asyncHandler(async (req: Request, res: Response) => {
  const projects = await kanbanService.listProjects(req.user as Arg<"listProjects", 0>);
  success(res, projects, null, "Projects retrieved");
});

const createProject = asyncHandler(async (req: Request, res: Response) => {
  const project = await kanbanService.createProject(req.user as Arg<"createProject", 0>, req.body as Arg<"createProject", 1>, auditPrincipal(req));
  success(res, project, null, "Project created", 201);
});

const getProject = asyncHandler(async (req: Request, res: Response) => {
  const project = await kanbanService.getProject(
    req.user as Arg<"getProject", 0>,
    req.params["projectId"] as string,
    { sprintId: req.query["sprintId"] as string | undefined },
  );
  success(res, project, null, "Project retrieved");
});

const updateProject = asyncHandler(async (req: Request, res: Response) => {
  const project = await kanbanService.updateProject(
    req.user as Arg<"updateProject", 0>,
    req.params["projectId"] as string,
    req.body as Arg<"updateProject", 2>,
    auditPrincipal(req),
  );
  success(res, project, null, "Project updated");
});

const deleteProject = asyncHandler(async (req: Request, res: Response) => {
  const result = await kanbanService.deleteProject(
    req.user as Arg<"deleteProject", 0>,
    req.params["projectId"] as string,
    auditPrincipal(req),
  );
  success(res, result, null, "Project deleted");
});

// ---- Members ----

const addMember = asyncHandler(async (req: Request, res: Response) => {
  const result = await kanbanService.addMember(
    req.user as Arg<"addMember", 0>,
    req.params["projectId"] as string,
    req.body as Arg<"addMember", 2>,
    auditPrincipal(req),
  );
  success(res, result, null, "Member added", 201);
});

const updateMember = asyncHandler(async (req: Request, res: Response) => {
  const members = await kanbanService.updateMember(
    req.user as Arg<"updateMember", 0>,
    req.params["projectId"] as string,
    req.params["memberId"] as string,
    req.body as Arg<"updateMember", 3>,
    auditPrincipal(req),
  );
  success(res, members, null, "Member updated");
});

const removeMember = asyncHandler(async (req: Request, res: Response) => {
  const result = await kanbanService.removeMember(
    req.user as Arg<"removeMember", 0>,
    req.params["projectId"] as string,
    req.params["memberId"] as string,
    auditPrincipal(req),
  );
  success(res, result, null, "Member removed");
});

// ---- Columns ----

const createColumn = asyncHandler(async (req: Request, res: Response) => {
  const column = await kanbanService.createColumn(
    req.user as Arg<"createColumn", 0>,
    req.params["projectId"] as string,
    req.body as Arg<"createColumn", 2>,
    auditPrincipal(req),
  );
  success(res, column, null, "Column created", 201);
});

const updateColumn = asyncHandler(async (req: Request, res: Response) => {
  const column = await kanbanService.updateColumn(
    req.user as Arg<"updateColumn", 0>,
    req.params["projectId"] as string,
    req.params["columnId"] as string,
    req.body as Arg<"updateColumn", 3>,
    auditPrincipal(req),
  );
  success(res, column, null, "Column updated");
});

const deleteColumn = asyncHandler(async (req: Request, res: Response) => {
  const result = await kanbanService.deleteColumn(
    req.user as Arg<"deleteColumn", 0>,
    req.params["projectId"] as string,
    req.params["columnId"] as string,
    auditPrincipal(req),
  );
  success(res, result, null, "Column deleted");
});

const reorderColumns = asyncHandler(async (req: Request, res: Response) => {
  const columns = await kanbanService.reorderColumns(
    req.user as Arg<"reorderColumns", 0>,
    req.params["projectId"] as string,
    (req.body as { order: Arg<"reorderColumns", 2> }).order,
    auditPrincipal(req),
  );
  success(res, columns, null, "Columns reordered");
});

// ---- Sprints ----

const listSprints = asyncHandler(async (req: Request, res: Response) => {
  const result = await kanbanService.listSprints(req.user as Arg<"listSprints", 0>, req.params["projectId"] as string);
  success(res, result, null, "Sprints retrieved");
});

const createSprint = asyncHandler(async (req: Request, res: Response) => {
  const sprint = await kanbanService.createSprint(
    req.user as Arg<"createSprint", 0>,
    req.params["projectId"] as string,
    req.body as Arg<"createSprint", 2>,
    auditPrincipal(req),
  );
  success(res, sprint, null, "Sprint created", 201);
});

const updateSprint = asyncHandler(async (req: Request, res: Response) => {
  const sprint = await kanbanService.updateSprint(
    req.user as Arg<"updateSprint", 0>,
    req.params["projectId"] as string,
    req.params["sprintId"] as string,
    req.body as Arg<"updateSprint", 3>,
    auditPrincipal(req),
  );
  success(res, sprint, null, "Sprint updated");
});

const deleteSprint = asyncHandler(async (req: Request, res: Response) => {
  const result = await kanbanService.deleteSprint(
    req.user as Arg<"deleteSprint", 0>,
    req.params["projectId"] as string,
    req.params["sprintId"] as string,
    auditPrincipal(req),
  );
  success(res, result, null, "Sprint deleted");
});

const migrateCards = asyncHandler(async (req: Request, res: Response) => {
  const result = await kanbanService.migrateCards(
    req.user as Arg<"migrateCards", 0>,
    req.params["projectId"] as string,
    req.body as Arg<"migrateCards", 2>,
    auditPrincipal(req),
  );
  success(res, result, null, "Cards migrated");
});

// ---- Metrics ----

const getMetrics = asyncHandler(async (req: Request, res: Response) => {
  const metrics = await kanbanService.getMetrics(
    req.user as Arg<"getMetrics", 0>,
    req.params["projectId"] as string,
    { sprintId: req.query["sprintId"] as string | undefined },
  );
  success(res, metrics, null, "Metrics retrieved");
});

// ---- Cards ----

const getCard = asyncHandler(async (req: Request, res: Response) => {
  const card = await kanbanService.getCard(
    req.user as Arg<"getCard", 0>,
    req.params["projectId"] as string,
    req.params["cardId"] as string,
  );
  success(res, card, null, "Card retrieved");
});

const createCard = asyncHandler(async (req: Request, res: Response) => {
  const card = await kanbanService.createCard(
    req.user as Arg<"createCard", 0>,
    req.params["projectId"] as string,
    req.body as Arg<"createCard", 2>,
    auditPrincipal(req),
  );
  success(res, card, null, "Card created", 201);
});

const updateCard = asyncHandler(async (req: Request, res: Response) => {
  const card = await kanbanService.updateCard(
    req.user as Arg<"updateCard", 0>,
    req.params["projectId"] as string,
    req.params["cardId"] as string,
    req.body as Arg<"updateCard", 3>,
    auditPrincipal(req),
  );
  success(res, card, null, "Card updated");
});

const moveCard = asyncHandler(async (req: Request, res: Response) => {
  const card = await kanbanService.moveCard(
    req.user as Arg<"moveCard", 0>,
    req.params["projectId"] as string,
    req.params["cardId"] as string,
    req.body as Arg<"moveCard", 3>,
    auditPrincipal(req),
  );
  success(res, card, null, "Card moved");
});

const deleteCard = asyncHandler(async (req: Request, res: Response) => {
  const result = await kanbanService.deleteCard(
    req.user as Arg<"deleteCard", 0>,
    req.params["projectId"] as string,
    req.params["cardId"] as string,
    auditPrincipal(req),
  );
  success(res, result, null, "Card deleted");
});

// ---- Card relations ----

const addRelation = asyncHandler(async (req: Request, res: Response) => {
  const relations = await kanbanService.addRelation(
    req.user as Arg<"addRelation", 0>,
    req.params["projectId"] as string,
    req.params["cardId"] as string,
    req.body as Arg<"addRelation", 3>,
    auditPrincipal(req),
  );
  success(res, relations, null, "Relation added", 201);
});

const removeRelation = asyncHandler(async (req: Request, res: Response) => {
  const relations = await kanbanService.removeRelation(
    req.user as Arg<"removeRelation", 0>,
    req.params["projectId"] as string,
    req.params["cardId"] as string,
    req.params["relationId"] as string,
    auditPrincipal(req),
  );
  success(res, relations, null, "Relation removed");
});

// ---- Labels ----

const createLabel = asyncHandler(async (req: Request, res: Response) => {
  const label = await kanbanService.createLabel(
    req.user as Arg<"createLabel", 0>,
    req.params["projectId"] as string,
    req.body as Arg<"createLabel", 2>,
    auditPrincipal(req),
  );
  success(res, label, null, "Label created", 201);
});

const updateLabel = asyncHandler(async (req: Request, res: Response) => {
  const label = await kanbanService.updateLabel(
    req.user as Arg<"updateLabel", 0>,
    req.params["projectId"] as string,
    req.params["labelId"] as string,
    req.body as Arg<"updateLabel", 3>,
    auditPrincipal(req),
  );
  success(res, label, null, "Label updated");
});

const deleteLabel = asyncHandler(async (req: Request, res: Response) => {
  const result = await kanbanService.deleteLabel(
    req.user as Arg<"deleteLabel", 0>,
    req.params["projectId"] as string,
    req.params["labelId"] as string,
    auditPrincipal(req),
  );
  success(res, result, null, "Label deleted");
});

const controller = {
  listProjects,
  createProject,
  getProject,
  updateProject,
  deleteProject,
  addMember,
  updateMember,
  removeMember,
  createColumn,
  updateColumn,
  deleteColumn,
  reorderColumns,
  listSprints,
  createSprint,
  updateSprint,
  deleteSprint,
  migrateCards,
  getMetrics,
  getCard,
  createCard,
  updateCard,
  moveCard,
  deleteCard,
  addRelation,
  removeRelation,
  createLabel,
  updateLabel,
  deleteLabel,
};

export = controller;
