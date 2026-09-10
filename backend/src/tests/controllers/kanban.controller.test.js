/**
 * Tests for Kanban Controller
 */

jest.mock("../../services/kanban.service", () => ({
  listProjects: jest.fn(),
  createProject: jest.fn(),
  getProject: jest.fn(),
  updateProject: jest.fn(),
  deleteProject: jest.fn(),
  addMember: jest.fn(),
  updateMember: jest.fn(),
  removeMember: jest.fn(),
  createColumn: jest.fn(),
  updateColumn: jest.fn(),
  deleteColumn: jest.fn(),
  reorderColumns: jest.fn(),
  listSprints: jest.fn(),
  createSprint: jest.fn(),
  updateSprint: jest.fn(),
  deleteSprint: jest.fn(),
  migrateCards: jest.fn(),
  getMetrics: jest.fn(),
  getCard: jest.fn(),
  createCard: jest.fn(),
  updateCard: jest.fn(),
  moveCard: jest.fn(),
  deleteCard: jest.fn(),
  addRelation: jest.fn(),
  removeRelation: jest.fn(),
  createLabel: jest.fn(),
  updateLabel: jest.fn(),
  deleteLabel: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const kanban = require("../../controllers/kanban.controller");
const kanbanService = require("../../services/kanban.service");
const { success, error } = require("../../utils/response.util");

describe("kanbanController", () => {
  let req;
  let res;
  let next;

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

  // ---- Projects ----

  it("listProjects", async () => {
    kanbanService.listProjects.mockResolvedValueOnce([{ id: "p1" }]);
    await kanban.listProjects(req, res, next);
    expect(kanbanService.listProjects).toHaveBeenCalledWith(req.user);
    expect(success).toHaveBeenCalledWith(res, [{ id: "p1" }], null, "Projects retrieved");
  });

  it("createProject", async () => {
    req.body = { name: "B" };
    kanbanService.createProject.mockResolvedValueOnce({ id: "p1" });
    await kanban.createProject(req, res, next);
    expect(kanbanService.createProject).toHaveBeenCalledWith(req.user, { name: "B" });
    expect(success).toHaveBeenCalledWith(res, { id: "p1" }, null, "Project created", 201);
  });

  it("getProject reads sprintId from query", async () => {
    req.params = { projectId: "p1" };
    req.query = { sprintId: "backlog" };
    kanbanService.getProject.mockResolvedValueOnce({ id: "p1" });
    await kanban.getProject(req, res, next);
    expect(kanbanService.getProject).toHaveBeenCalledWith(req.user, "p1", {
      sprintId: "backlog",
    });
    expect(success).toHaveBeenCalledWith(res, { id: "p1" }, null, "Project retrieved");
  });

  it("updateProject", async () => {
    req.params = { projectId: "p1" };
    req.body = { name: "N" };
    kanbanService.updateProject.mockResolvedValueOnce({ id: "p1" });
    await kanban.updateProject(req, res, next);
    expect(kanbanService.updateProject).toHaveBeenCalledWith(req.user, "p1", { name: "N" });
    expect(success).toHaveBeenCalledWith(res, { id: "p1" }, null, "Project updated");
  });

  it("deleteProject", async () => {
    req.params = { projectId: "p1" };
    kanbanService.deleteProject.mockResolvedValueOnce({ deleted: true });
    await kanban.deleteProject(req, res, next);
    expect(kanbanService.deleteProject).toHaveBeenCalledWith(req.user, "p1");
    expect(success).toHaveBeenCalledWith(res, { deleted: true }, null, "Project deleted");
  });

  // ---- Members ----

  it("addMember", async () => {
    req.params = { projectId: "p1" };
    req.body = { userId: "u2" };
    kanbanService.addMember.mockResolvedValueOnce({ memberId: "m1" });
    await kanban.addMember(req, res, next);
    expect(kanbanService.addMember).toHaveBeenCalledWith(req.user, "p1", { userId: "u2" });
    expect(success).toHaveBeenCalledWith(res, { memberId: "m1" }, null, "Member added", 201);
  });

  it("updateMember", async () => {
    req.params = { projectId: "p1", memberId: "m1" };
    req.body = { accessLevel: "editor" };
    kanbanService.updateMember.mockResolvedValueOnce([{ id: "m1" }]);
    await kanban.updateMember(req, res, next);
    expect(kanbanService.updateMember).toHaveBeenCalledWith(req.user, "p1", "m1", {
      accessLevel: "editor",
    });
    expect(success).toHaveBeenCalledWith(res, [{ id: "m1" }], null, "Member updated");
  });

  it("removeMember", async () => {
    req.params = { projectId: "p1", memberId: "m1" };
    kanbanService.removeMember.mockResolvedValueOnce({ removed: true });
    await kanban.removeMember(req, res, next);
    expect(kanbanService.removeMember).toHaveBeenCalledWith(req.user, "p1", "m1");
    expect(success).toHaveBeenCalledWith(res, { removed: true }, null, "Member removed");
  });

  // ---- Columns ----

  it("createColumn", async () => {
    req.params = { projectId: "p1" };
    req.body = { name: "C" };
    kanbanService.createColumn.mockResolvedValueOnce({ id: "c1" });
    await kanban.createColumn(req, res, next);
    expect(kanbanService.createColumn).toHaveBeenCalledWith(req.user, "p1", { name: "C" });
    expect(success).toHaveBeenCalledWith(res, { id: "c1" }, null, "Column created", 201);
  });

  it("updateColumn", async () => {
    req.params = { projectId: "p1", columnId: "c1" };
    req.body = { name: "C2" };
    kanbanService.updateColumn.mockResolvedValueOnce({ id: "c1" });
    await kanban.updateColumn(req, res, next);
    expect(kanbanService.updateColumn).toHaveBeenCalledWith(req.user, "p1", "c1", {
      name: "C2",
    });
    expect(success).toHaveBeenCalledWith(res, { id: "c1" }, null, "Column updated");
  });

  it("deleteColumn", async () => {
    req.params = { projectId: "p1", columnId: "c1" };
    kanbanService.deleteColumn.mockResolvedValueOnce({ deleted: true });
    await kanban.deleteColumn(req, res, next);
    expect(kanbanService.deleteColumn).toHaveBeenCalledWith(req.user, "p1", "c1");
    expect(success).toHaveBeenCalledWith(res, { deleted: true }, null, "Column deleted");
  });

  it("reorderColumns", async () => {
    req.params = { projectId: "p1" };
    req.body = { order: ["c1", "c2"] };
    kanbanService.reorderColumns.mockResolvedValueOnce([{ id: "c1" }]);
    await kanban.reorderColumns(req, res, next);
    expect(kanbanService.reorderColumns).toHaveBeenCalledWith(req.user, "p1", ["c1", "c2"]);
    expect(success).toHaveBeenCalledWith(res, [{ id: "c1" }], null, "Columns reordered");
  });

  // ---- Sprints ----

  it("listSprints", async () => {
    req.params = { projectId: "p1" };
    kanbanService.listSprints.mockResolvedValueOnce({ sprints: [] });
    await kanban.listSprints(req, res, next);
    expect(kanbanService.listSprints).toHaveBeenCalledWith(req.user, "p1");
    expect(success).toHaveBeenCalledWith(res, { sprints: [] }, null, "Sprints retrieved");
  });

  it("createSprint", async () => {
    req.params = { projectId: "p1" };
    req.body = { name: "S1" };
    kanbanService.createSprint.mockResolvedValueOnce({ id: "s1" });
    await kanban.createSprint(req, res, next);
    expect(kanbanService.createSprint).toHaveBeenCalledWith(req.user, "p1", { name: "S1" });
    expect(success).toHaveBeenCalledWith(res, { id: "s1" }, null, "Sprint created", 201);
  });

  it("updateSprint", async () => {
    req.params = { projectId: "p1", sprintId: "s1" };
    req.body = { status: "active" };
    kanbanService.updateSprint.mockResolvedValueOnce({ id: "s1" });
    await kanban.updateSprint(req, res, next);
    expect(kanbanService.updateSprint).toHaveBeenCalledWith(req.user, "p1", "s1", {
      status: "active",
    });
    expect(success).toHaveBeenCalledWith(res, { id: "s1" }, null, "Sprint updated");
  });

  it("deleteSprint", async () => {
    req.params = { projectId: "p1", sprintId: "s1" };
    kanbanService.deleteSprint.mockResolvedValueOnce({ deleted: true });
    await kanban.deleteSprint(req, res, next);
    expect(kanbanService.deleteSprint).toHaveBeenCalledWith(req.user, "p1", "s1");
    expect(success).toHaveBeenCalledWith(res, { deleted: true }, null, "Sprint deleted");
  });

  it("migrateCards", async () => {
    req.params = { projectId: "p1" };
    req.body = { allNotDone: true, targetSprintId: "backlog" };
    kanbanService.migrateCards.mockResolvedValueOnce({ migrated: 3 });
    await kanban.migrateCards(req, res, next);
    expect(kanbanService.migrateCards).toHaveBeenCalledWith(req.user, "p1", {
      allNotDone: true,
      targetSprintId: "backlog",
    });
    expect(success).toHaveBeenCalledWith(res, { migrated: 3 }, null, "Cards migrated");
  });

  // ---- Metrics ----

  it("getMetrics reads sprintId from query", async () => {
    req.params = { projectId: "p1" };
    req.query = { sprintId: "sp1" };
    kanbanService.getMetrics.mockResolvedValueOnce({ view: "sp1" });
    await kanban.getMetrics(req, res, next);
    expect(kanbanService.getMetrics).toHaveBeenCalledWith(req.user, "p1", {
      sprintId: "sp1",
    });
    expect(success).toHaveBeenCalledWith(res, { view: "sp1" }, null, "Metrics retrieved");
  });

  // ---- Cards ----

  it("getCard", async () => {
    req.params = { projectId: "p1", cardId: "cd1" };
    kanbanService.getCard.mockResolvedValueOnce({ id: "cd1" });
    await kanban.getCard(req, res, next);
    expect(kanbanService.getCard).toHaveBeenCalledWith(req.user, "p1", "cd1");
    expect(success).toHaveBeenCalledWith(res, { id: "cd1" }, null, "Card retrieved");
  });

  it("createCard", async () => {
    req.params = { projectId: "p1" };
    req.body = { title: "T", columnId: "c1" };
    kanbanService.createCard.mockResolvedValueOnce({ id: "cd1" });
    await kanban.createCard(req, res, next);
    expect(kanbanService.createCard).toHaveBeenCalledWith(req.user, "p1", {
      title: "T",
      columnId: "c1",
    });
    expect(success).toHaveBeenCalledWith(res, { id: "cd1" }, null, "Card created", 201);
  });

  it("updateCard", async () => {
    req.params = { projectId: "p1", cardId: "cd1" };
    req.body = { title: "T2" };
    kanbanService.updateCard.mockResolvedValueOnce({ id: "cd1" });
    await kanban.updateCard(req, res, next);
    expect(kanbanService.updateCard).toHaveBeenCalledWith(req.user, "p1", "cd1", {
      title: "T2",
    });
    expect(success).toHaveBeenCalledWith(res, { id: "cd1" }, null, "Card updated");
  });

  it("moveCard", async () => {
    req.params = { projectId: "p1", cardId: "cd1" };
    req.body = { columnId: "c2", position: 0 };
    kanbanService.moveCard.mockResolvedValueOnce({ id: "cd1" });
    await kanban.moveCard(req, res, next);
    expect(kanbanService.moveCard).toHaveBeenCalledWith(req.user, "p1", "cd1", {
      columnId: "c2",
      position: 0,
    });
    expect(success).toHaveBeenCalledWith(res, { id: "cd1" }, null, "Card moved");
  });

  it("deleteCard", async () => {
    req.params = { projectId: "p1", cardId: "cd1" };
    kanbanService.deleteCard.mockResolvedValueOnce({ deleted: true });
    await kanban.deleteCard(req, res, next);
    expect(kanbanService.deleteCard).toHaveBeenCalledWith(req.user, "p1", "cd1");
    expect(success).toHaveBeenCalledWith(res, { deleted: true }, null, "Card deleted");
  });

  // ---- Card relations ----

  it("addRelation", async () => {
    req.params = { projectId: "p1", cardId: "cd1" };
    req.body = { targetCardId: "cd2", type: "blocks" };
    kanbanService.addRelation.mockResolvedValueOnce([{ id: "r1" }]);
    await kanban.addRelation(req, res, next);
    expect(kanbanService.addRelation).toHaveBeenCalledWith(req.user, "p1", "cd1", {
      targetCardId: "cd2",
      type: "blocks",
    });
    expect(success).toHaveBeenCalledWith(res, [{ id: "r1" }], null, "Relation added", 201);
  });

  it("removeRelation", async () => {
    req.params = { projectId: "p1", cardId: "cd1", relationId: "r1" };
    kanbanService.removeRelation.mockResolvedValueOnce([]);
    await kanban.removeRelation(req, res, next);
    expect(kanbanService.removeRelation).toHaveBeenCalledWith(req.user, "p1", "cd1", "r1");
    expect(success).toHaveBeenCalledWith(res, [], null, "Relation removed");
  });

  // ---- Labels ----

  it("createLabel", async () => {
    req.params = { projectId: "p1" };
    req.body = { name: "bug" };
    kanbanService.createLabel.mockResolvedValueOnce({ id: "l1" });
    await kanban.createLabel(req, res, next);
    expect(kanbanService.createLabel).toHaveBeenCalledWith(req.user, "p1", { name: "bug" });
    expect(success).toHaveBeenCalledWith(res, { id: "l1" }, null, "Label created", 201);
  });

  it("updateLabel", async () => {
    req.params = { projectId: "p1", labelId: "l1" };
    req.body = { name: "feat" };
    kanbanService.updateLabel.mockResolvedValueOnce({ id: "l1" });
    await kanban.updateLabel(req, res, next);
    expect(kanbanService.updateLabel).toHaveBeenCalledWith(req.user, "p1", "l1", {
      name: "feat",
    });
    expect(success).toHaveBeenCalledWith(res, { id: "l1" }, null, "Label updated");
  });

  it("deleteLabel", async () => {
    req.params = { projectId: "p1", labelId: "l1" };
    kanbanService.deleteLabel.mockResolvedValueOnce({ deleted: true });
    await kanban.deleteLabel(req, res, next);
    expect(kanbanService.deleteLabel).toHaveBeenCalledWith(req.user, "p1", "l1");
    expect(success).toHaveBeenCalledWith(res, { deleted: true }, null, "Label deleted");
  });

  // ---- Error path (asyncHandler catch -> error) ----

  it("routes a thrown service error through response.util.error", async () => {
    req.params = { projectId: "p1" };
    const boom = Object.assign(new Error("Requires owner access"), { status: 403 });
    kanbanService.deleteProject.mockRejectedValueOnce(boom);

    await kanban.deleteProject(req, res, next);

    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(res, "Requires owner access", 403, expect.anything());
    expect(next).toHaveBeenCalledWith(boom);
  });
});
