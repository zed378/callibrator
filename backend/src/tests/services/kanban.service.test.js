/**
 * Tests for kanban.service.js
 */

// ================================================================
// MOCKS
// ================================================================

jest.mock("sequelize", () => ({
  Op: {
    or: Symbol("or"),
    in: Symbol("in"),
    notIn: Symbol("notIn"),
    ne: Symbol("ne"),
  },
}));

jest.mock("../../models", () => {
  const model = () => ({
    findOne: jest.fn(),
    findAll: jest.fn(),
    findByPk: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
    bulkCreate: jest.fn(),
  });
  return {
    KanbanProject: model(),
    KanbanProjectMember: model(),
    KanbanColumn: model(),
    KanbanCard: model(),
    KanbanLabel: model(),
    KanbanCardAssignee: model(),
    KanbanCardLabel: model(),
    KanbanSprint: model(),
    KanbanCardRelation: model(),
    User: model(),
    Role: model(),
    sequelize: { transaction: jest.fn(), query: jest.fn() },
  };
});

jest.mock("../../config/socket", () => ({
  emitToBoard: jest.fn(),
  getIo: jest.fn(),
}));

jest.mock("../../services/notification.service", () => ({
  emitNotification: jest.fn(),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock("../../utils/appError.util", () => {
  class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.name = "AppError";
      this.status = status;
    }
  }
  return { AppError };
});

// ================================================================
// IMPORTS (after mocks)
// ================================================================
const models = require("../../models");
const {
  KanbanProject,
  KanbanProjectMember,
  KanbanColumn,
  KanbanCard,
  KanbanLabel,
  KanbanCardAssignee,
  KanbanCardLabel,
  KanbanSprint,
  KanbanCardRelation,
  sequelize,
} = models;
const { emitToBoard } = require("../../config/socket");
const notificationService = require("../../services/notification.service");
const svc = require("../../services/kanban.service");

const TID = "tenant-1";
const PID = "proj-1";

const superAdmin = { id: "sa", tenantId: TID, role: { name: "SUPER_ADMIN" } };

const baseProject = () => ({
  id: PID,
  tenantId: TID,
  createdBy: "someone-else",
  code: "MGT",
  name: "Board",
  description: "d",
  color: "#fff",
  createdAt: new Date(),
});

const makeCard = (over = {}) => ({
  id: "cd1",
  projectId: PID,
  tenantId: TID,
  columnId: "col1",
  sprintId: null,
  number: 1,
  cardKey: "MGT-1",
  title: "Card",
  description: null,
  position: 0,
  priority: null,
  dueDate: null,
  createdBy: "u1",
  createdAt: new Date(),
  updatedAt: new Date(),
  assignees: [],
  labels: [],
  getAssignees: jest.fn().mockResolvedValue([]),
  getLabels: jest.fn().mockResolvedValue([]),
  update: jest.fn().mockResolvedValue(),
  save: jest.fn().mockResolvedValue(),
  destroy: jest.fn().mockResolvedValue(),
  ...over,
});

const expectReject = async (promise, message) => {
  await expect(promise).rejects.toThrow(message);
};

const ALL_MODELS = [
  KanbanProject,
  KanbanProjectMember,
  KanbanColumn,
  KanbanCard,
  KanbanLabel,
  KanbanCardAssignee,
  KanbanCardLabel,
  KanbanSprint,
  KanbanCardRelation,
];

beforeEach(() => {
  jest.resetAllMocks();
  sequelize.transaction.mockImplementation(async (cb) => cb("txn"));
  sequelize.query.mockResolvedValue([[{ card_seq: 1 }]]);
  for (const m of ALL_MODELS) {
    m.findAll.mockResolvedValue([]);
    m.count.mockResolvedValue(0);
    m.bulkCreate.mockResolvedValue([]);
    m.create.mockResolvedValue({ id: "new-id" });
    m.update.mockResolvedValue([0]);
    m.destroy.mockResolvedValue(0);
  }
  // Default project for resolveAccess lookups.
  KanbanProject.findOne.mockResolvedValue(baseProject());
});

// ================================================================
// Access control
// ================================================================
describe("resolveAccess / assertAccess", () => {
  it("throws 404 when the project does not exist", async () => {
    KanbanProject.findOne.mockResolvedValueOnce(null);
    await expectReject(svc._resolveAccess(superAdmin, PID), "Project not found");
  });

  it("treats SUPER_ADMIN as owner", async () => {
    const res = await svc._resolveAccess(superAdmin, PID);
    expect(res.level).toBe("owner");
  });

  it("treats SUPERADMIN as owner", async () => {
    const res = await svc._resolveAccess(
      { id: "sa", tenantId: TID, role: { name: "SUPERADMIN" } },
      PID,
    );
    expect(res.level).toBe("owner");
  });

  it("treats the creator as owner", async () => {
    KanbanProject.findOne.mockResolvedValueOnce({
      ...baseProject(),
      createdBy: "creator",
    });
    const res = await svc._resolveAccess({ id: "creator", tenantId: TID }, PID);
    expect(res.level).toBe("owner");
  });

  it("resolves the highest membership level (with role id)", async () => {
    KanbanProjectMember.findAll.mockResolvedValueOnce([
      { accessLevel: "editor" },
      { accessLevel: "bogus" },
    ]);
    const res = await svc._resolveAccess(
      { id: "u", tenantId: TID, role: { id: "r1", name: "USER" } },
      PID,
    );
    expect(res.level).toBe("editor");
  });

  it("resolves membership via a bare roleId (no role object)", async () => {
    KanbanProjectMember.findAll.mockResolvedValueOnce([{ accessLevel: "viewer" }]);
    const res = await svc._resolveAccess({ id: "u", tenantId: TID, roleId: "r2" }, PID);
    expect(res.level).toBe("viewer");
  });

  it("returns null level when membership grants nothing", async () => {
    KanbanProjectMember.findAll.mockResolvedValueOnce([]);
    const res = await svc._resolveAccess({ id: "u", tenantId: TID }, PID);
    expect(res.level).toBeNull();
  });

  it("assertAccess throws 404 when the user has no access at all", async () => {
    KanbanProjectMember.findAll.mockResolvedValueOnce([]);
    await expectReject(
      svc.assertAccess({ id: "u", tenantId: TID }, PID, "viewer"),
      "Project not found",
    );
  });

  it("assertAccess throws 403 when the level is below the minimum", async () => {
    KanbanProjectMember.findAll.mockResolvedValueOnce([{ accessLevel: "viewer" }]);
    await expectReject(
      svc.assertAccess({ id: "u", tenantId: TID, role: { id: "r1" } }, PID, "owner"),
      "Requires owner access",
    );
  });

  it("assertAccess returns project + level on success", async () => {
    const res = await svc.assertAccess(superAdmin, PID, "owner");
    expect(res.level).toBe("owner");
    expect(res.project.id).toBe(PID);
  });

  it("assertAccess defaults minLevel to viewer", async () => {
    const res = await svc.assertAccess(superAdmin, PID);
    expect(res.level).toBe("owner");
  });
});

// ================================================================
// Projects
// ================================================================
describe("listProjects", () => {
  it("lists all projects for a super admin", async () => {
    KanbanProject.findAll.mockResolvedValueOnce([baseProject()]);
    KanbanCard.count.mockResolvedValueOnce(3);
    const res = await svc.listProjects(superAdmin);
    expect(res).toHaveLength(1);
    expect(res[0].cardCount).toBe(3);
    expect(res[0].myAccess).toBe("owner");
  });

  it("lists member projects (with role id) and swallows resolveAccess errors", async () => {
    const user = { id: "u", tenantId: TID, role: { id: "r1", name: "USER" } };
    KanbanProjectMember.findAll.mockResolvedValueOnce([{ projectId: PID }]);
    KanbanProject.findAll.mockResolvedValueOnce([baseProject()]);
    // resolveAccess inside the loop fails -> caught -> myAccess null
    KanbanProject.findOne.mockResolvedValueOnce(null);
    const res = await svc.listProjects(user);
    expect(res[0].myAccess).toBeNull();
  });

  it("lists member projects when the user has no role id", async () => {
    const user = { id: "u", tenantId: TID };
    KanbanProjectMember.findAll.mockResolvedValueOnce([]);
    KanbanProject.findAll.mockResolvedValueOnce([baseProject()]);
    const res = await svc.listProjects(user);
    expect(res[0].myAccess).toBe(null); // no membership -> null
  });
});

describe("createProject", () => {
  it("creates a board, its members, columns and initial sprint", async () => {
    KanbanProject.create.mockResolvedValueOnce({ id: PID, tenantId: TID });
    const res = await svc.createProject(superAdmin, {
      name: "Board",
      code: "mgt",
      description: "d",
      color: "#fff",
      members: [{ userId: "u2", accessLevel: "editor" }, { roleId: "r2" }, {}],
    });
    expect(KanbanProject.create).toHaveBeenCalledWith(
      expect.objectContaining({ code: "MGT" }),
      expect.any(Object),
    );
    // creator + 3 supplied members
    expect(KanbanProjectMember.create).toHaveBeenCalledTimes(4);
    expect(KanbanColumn.bulkCreate).toHaveBeenCalled();
    expect(KanbanSprint.create).toHaveBeenCalled();
    expect(res.id).toBe(PID);
  });

  it("creates a board without a code", async () => {
    KanbanProject.create.mockResolvedValueOnce({ id: PID, tenantId: TID });
    await svc.createProject(superAdmin, { name: "Board" });
    expect(KanbanProject.create).toHaveBeenCalledWith(
      expect.objectContaining({ code: null }),
      expect.any(Object),
    );
  });
});

describe("getProject sprint selection", () => {
  const fullBoardMocks = () => {
    KanbanColumn.findAll.mockResolvedValueOnce([
      { id: "col1", name: "To Do", position: 0, wipLimit: null, isDone: false },
    ]);
    KanbanCard.findAll.mockResolvedValueOnce([
      makeCard({
        assignees: [{ id: "u2", firstName: "A", lastName: "B", email: "a@b.c" }],
        labels: [{ id: "l1", name: "bug", color: "#f00" }],
        relations: undefined,
      }),
    ]);
    KanbanLabel.findAll.mockResolvedValueOnce([{ id: "l1", name: "bug", color: "#f00" }]);
    KanbanProjectMember.findAll.mockResolvedValueOnce([
      {
        id: "m1",
        accessLevel: "owner",
        user: { id: "u2", firstName: "A", lastName: "B", email: "a@b.c" },
        role: { id: "r1", name: "USER" },
      },
      { id: "m2", accessLevel: "viewer", user: null, role: null },
    ]);
  };

  it("defaults to the active sprint", async () => {
    KanbanSprint.findAll.mockResolvedValueOnce([
      { id: "sp1", status: "active", position: 0 },
    ]);
    fullBoardMocks();
    const res = await svc.getProject(superAdmin, PID);
    expect(res.activeSprintId).toBe("sp1");
    expect(res.cards).toHaveLength(1);
    expect(res.members[1].user).toBeNull();
  });

  it("falls back to backlog when there is no active sprint", async () => {
    KanbanSprint.findAll.mockResolvedValueOnce([{ id: "sp1", status: "planned" }]);
    fullBoardMocks();
    const res = await svc.getProject(superAdmin, PID);
    expect(res.activeSprintId).toBe("backlog");
  });

  it("honours an explicit backlog selection", async () => {
    fullBoardMocks();
    const res = await svc.getProject(superAdmin, PID, { sprintId: "backlog" });
    expect(res.activeSprintId).toBe("backlog");
  });

  it("honours an explicit all selection", async () => {
    fullBoardMocks();
    const res = await svc.getProject(superAdmin, PID, { sprintId: "all" });
    expect(res.activeSprintId).toBe("all");
  });

  it("honours a specific sprint id", async () => {
    fullBoardMocks();
    const res = await svc.getProject(superAdmin, PID, { sprintId: "sp9" });
    expect(res.activeSprintId).toBe("sp9");
  });
});

describe("updateProject", () => {
  const stubGetProject = () => {
    KanbanSprint.findAll.mockResolvedValue([]);
    KanbanColumn.findAll.mockResolvedValue([]);
    KanbanCard.findAll.mockResolvedValue([]);
    KanbanLabel.findAll.mockResolvedValue([]);
    KanbanProjectMember.findAll.mockResolvedValue([]);
  };

  it("updates every field and archives", async () => {
    stubGetProject();
    await svc.updateProject(superAdmin, PID, {
      name: "N",
      code: "xy",
      description: "dd",
      color: "cc",
      archived: true,
    });
    expect(KanbanProject.update).toHaveBeenCalledWith(
      expect.objectContaining({ code: "XY", archivedAt: expect.any(Date) }),
      { where: { id: PID } },
    );
    expect(emitToBoard).toHaveBeenCalledWith(
      PID,
      "kanban:project:updated",
      expect.any(Object),
    );
  });

  it("clears the code and un-archives", async () => {
    stubGetProject();
    await svc.updateProject(superAdmin, PID, { code: null, archived: false });
    expect(KanbanProject.update).toHaveBeenCalledWith(
      expect.objectContaining({ code: null, archivedAt: null }),
      { where: { id: PID } },
    );
  });

  it("patches only the provided field (code/archived omitted)", async () => {
    stubGetProject();
    await svc.updateProject(superAdmin, PID, { name: "N" });
    expect(KanbanProject.update).toHaveBeenCalledWith({ name: "N" }, { where: { id: PID } });
  });
});

describe("deleteProject", () => {
  it("destroys the project and emits", async () => {
    const res = await svc.deleteProject(superAdmin, PID);
    expect(KanbanProject.destroy).toHaveBeenCalledWith({ where: { id: PID } });
    expect(res).toEqual({ deleted: true });
  });
});

// ================================================================
// Members
// ================================================================
describe("members", () => {
  const stubGetProject = () => {
    KanbanProjectMember.findAll.mockResolvedValue([]);
  };

  it("addMember rejects when neither userId nor roleId given", async () => {
    await expectReject(svc.addMember(superAdmin, PID, {}), "userId or roleId is required");
  });

  it("addMember creates a member", async () => {
    stubGetProject();
    KanbanProjectMember.create.mockResolvedValueOnce({ id: "m1" });
    const res = await svc.addMember(superAdmin, PID, { userId: "u2" });
    expect(res.memberId).toBe("m1");
  });

  it("addMember creates a role-based member with an explicit level", async () => {
    stubGetProject();
    KanbanProjectMember.create.mockResolvedValueOnce({ id: "m2" });
    await svc.addMember(superAdmin, PID, { roleId: "r2", accessLevel: "editor" });
    expect(KanbanProjectMember.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, roleId: "r2", accessLevel: "editor" }),
    );
  });

  it("updateMember 404s when the member is missing", async () => {
    KanbanProjectMember.findOne.mockResolvedValueOnce(null);
    await expectReject(
      svc.updateMember(superAdmin, PID, "m1", { accessLevel: "editor" }),
      "Member not found",
    );
  });

  it("updateMember updates the access level", async () => {
    stubGetProject();
    const member = { update: jest.fn().mockResolvedValue() };
    KanbanProjectMember.findOne.mockResolvedValueOnce(member);
    await svc.updateMember(superAdmin, PID, "m1", { accessLevel: "editor" });
    expect(member.update).toHaveBeenCalledWith({ accessLevel: "editor" });
  });

  it("removeMember 404s when missing", async () => {
    KanbanProjectMember.findOne.mockResolvedValueOnce(null);
    await expectReject(svc.removeMember(superAdmin, PID, "m1"), "Member not found");
  });

  it("removeMember rejects removing the last owner", async () => {
    KanbanProjectMember.findOne.mockResolvedValueOnce({ accessLevel: "owner" });
    KanbanProjectMember.count.mockResolvedValueOnce(1);
    await expectReject(
      svc.removeMember(superAdmin, PID, "m1"),
      "must keep at least one owner",
    );
  });

  it("removeMember removes an owner when others remain", async () => {
    stubGetProject();
    const member = { accessLevel: "owner", destroy: jest.fn().mockResolvedValue() };
    KanbanProjectMember.findOne.mockResolvedValueOnce(member);
    KanbanProjectMember.count.mockResolvedValueOnce(2);
    const res = await svc.removeMember(superAdmin, PID, "m1");
    expect(member.destroy).toHaveBeenCalled();
    expect(res).toEqual({ removed: true });
  });

  it("removeMember removes a non-owner directly", async () => {
    stubGetProject();
    const member = { accessLevel: "viewer", destroy: jest.fn().mockResolvedValue() };
    KanbanProjectMember.findOne.mockResolvedValueOnce(member);
    await svc.removeMember(superAdmin, PID, "m1");
    expect(member.destroy).toHaveBeenCalled();
  });
});

// ================================================================
// Columns
// ================================================================
describe("columns", () => {
  it("createColumn inserts before the Done column", async () => {
    const done = { position: 2, update: jest.fn().mockResolvedValue() };
    KanbanColumn.findOne.mockResolvedValueOnce(done);
    KanbanColumn.create.mockResolvedValueOnce({
      id: "c1",
      name: "New",
      position: 2,
      wipLimit: 5,
      isDone: false,
    });
    const res = await svc.createColumn(superAdmin, PID, { name: "New", wipLimit: 5 });
    expect(done.update).toHaveBeenCalledWith({ position: 3 }, expect.any(Object));
    expect(res.id).toBe("c1");
  });

  it("createColumn appends when there is no Done column", async () => {
    KanbanColumn.findOne.mockResolvedValueOnce(null);
    KanbanColumn.count.mockResolvedValueOnce(3);
    KanbanColumn.create.mockResolvedValueOnce({
      id: "c1",
      name: "X",
      position: 3,
      wipLimit: null,
      isDone: false,
    });
    const res = await svc.createColumn(superAdmin, PID, { name: "X" });
    expect(res.position).toBe(3);
  });

  it("updateColumn 404s when missing", async () => {
    KanbanColumn.findOne.mockResolvedValueOnce(null);
    await expectReject(
      svc.updateColumn(superAdmin, PID, "c1", { name: "N" }),
      "Column not found",
    );
  });

  it("updateColumn applies position on a non-Done column", async () => {
    const column = { id: "c1", isDone: false, update: jest.fn().mockResolvedValue() };
    KanbanColumn.findOne.mockResolvedValueOnce(column);
    await svc.updateColumn(superAdmin, PID, "c1", {
      name: "N",
      wipLimit: 3,
      position: 1,
    });
    expect(column.update).toHaveBeenCalledWith(
      expect.objectContaining({ name: "N", wipLimit: 3, position: 1 }),
    );
  });

  it("updateColumn patches wipLimit only (no name)", async () => {
    const column = { id: "c1", isDone: false, update: jest.fn().mockResolvedValue() };
    KanbanColumn.findOne.mockResolvedValueOnce(column);
    await svc.updateColumn(superAdmin, PID, "c1", { wipLimit: 7 });
    expect(column.update).toHaveBeenCalledWith({ wipLimit: 7 });
  });

  it("updateColumn ignores a position write on the Done column", async () => {
    const column = { id: "c1", isDone: true, update: jest.fn().mockResolvedValue() };
    KanbanColumn.findOne.mockResolvedValueOnce(column);
    await svc.updateColumn(superAdmin, PID, "c1", { name: "Done2", position: 5 });
    const patch = column.update.mock.calls[0][0];
    expect(patch).toEqual({ name: "Done2" });
  });

  it("deleteColumn 404s when missing", async () => {
    KanbanColumn.findOne.mockResolvedValueOnce(null);
    await expectReject(svc.deleteColumn(superAdmin, PID, "c1"), "Column not found");
  });

  it("deleteColumn rejects deleting the Done column", async () => {
    KanbanColumn.findOne.mockResolvedValueOnce({ id: "c1", isDone: true });
    await expectReject(
      svc.deleteColumn(superAdmin, PID, "c1"),
      "Done column cannot be deleted",
    );
  });

  it("deleteColumn rejects deleting the last column", async () => {
    KanbanColumn.findOne.mockResolvedValueOnce({ id: "c1", isDone: false });
    KanbanColumn.count.mockResolvedValueOnce(1);
    await expectReject(
      svc.deleteColumn(superAdmin, PID, "c1"),
      "must keep at least one column",
    );
  });

  it("deleteColumn destroys a normal column", async () => {
    const column = { id: "c1", isDone: false, destroy: jest.fn().mockResolvedValue() };
    KanbanColumn.findOne.mockResolvedValueOnce(column);
    KanbanColumn.count.mockResolvedValueOnce(3);
    const res = await svc.deleteColumn(superAdmin, PID, "c1");
    expect(column.destroy).toHaveBeenCalled();
    expect(res).toEqual({ deleted: true });
  });

  it("reorderColumns forces the Done column last", async () => {
    KanbanColumn.findAll.mockResolvedValueOnce([
      { id: "a", isDone: false },
      { id: "b", isDone: false },
      { id: "done", isDone: true },
    ]);
    KanbanColumn.findAll.mockResolvedValueOnce([
      { id: "a", name: "A", position: 0, wipLimit: null, isDone: false },
      { id: "b", name: "B", position: 1, wipLimit: null, isDone: false },
      { id: "done", name: "Done", position: 2, wipLimit: null, isDone: true },
    ]);
    const res = await svc.reorderColumns(superAdmin, PID, ["done", "a", "b"]);
    expect(KanbanColumn.update).toHaveBeenCalledTimes(3);
    // done pushed to the end
    expect(KanbanColumn.update).toHaveBeenLastCalledWith(
      { position: 2 },
      expect.objectContaining({ where: { id: "done", projectId: PID } }),
    );
    expect(res).toHaveLength(3);
  });

  it("reorderColumns works when there is no Done column", async () => {
    KanbanColumn.findAll.mockResolvedValueOnce([
      { id: "a", isDone: false },
      { id: "b", isDone: false },
    ]);
    KanbanColumn.findAll.mockResolvedValueOnce([
      { id: "a", name: "A", position: 0, wipLimit: null, isDone: false },
      { id: "b", name: "B", position: 1, wipLimit: null, isDone: false },
    ]);
    const res = await svc.reorderColumns(superAdmin, PID, ["b", "a"]);
    expect(KanbanColumn.update).toHaveBeenCalledTimes(2);
    expect(res).toHaveLength(2);
  });
});

// ================================================================
// Cards
// ================================================================
describe("createCard", () => {
  it("404s when the column is missing", async () => {
    KanbanColumn.findOne.mockResolvedValueOnce(null);
    await expectReject(
      svc.createCard(superAdmin, PID, { columnId: "col1", title: "T" }),
      "Column not found",
    );
  });

  it("creates a card in a specific sprint with assignees and labels", async () => {
    KanbanColumn.findOne.mockResolvedValueOnce({ id: "col1" });
    KanbanSprint.findOne.mockResolvedValueOnce({ id: "sp1" });
    KanbanCard.create.mockResolvedValueOnce({ id: "cd1" });
    KanbanCard.findByPk.mockResolvedValueOnce(
      makeCard({ getAssignees: jest.fn().mockResolvedValue([{ id: "u2" }]) }),
    );
    const res = await svc.createCard(superAdmin, PID, {
      columnId: "col1",
      sprintId: "sp1",
      title: "T",
      assigneeIds: ["u2", "sa"],
      labelIds: ["l1"],
    });
    expect(KanbanCardAssignee.bulkCreate).toHaveBeenCalled();
    expect(KanbanCardLabel.bulkCreate).toHaveBeenCalled();
    expect(res.cardKey).toBe("MGT-1");
    // actor ("sa") is filtered out of the tag notifications
    expect(notificationService.emitNotification).toHaveBeenCalledTimes(1);
  });

  it("routes an explicit backlog card to no sprint", async () => {
    KanbanColumn.findOne.mockResolvedValueOnce({ id: "col1" });
    KanbanCard.create.mockResolvedValueOnce({ id: "cd1" });
    KanbanCard.findByPk.mockResolvedValueOnce(makeCard());
    await svc.createCard(superAdmin, PID, {
      columnId: "col1",
      sprintId: "backlog",
      title: "T",
    });
    expect(KanbanCard.create).toHaveBeenCalledWith(
      expect.objectContaining({ sprintId: null }),
      expect.any(Object),
    );
  });

  it("routes a null sprintId to no sprint", async () => {
    KanbanColumn.findOne.mockResolvedValueOnce({ id: "col1" });
    KanbanCard.create.mockResolvedValueOnce({ id: "cd1" });
    KanbanCard.findByPk.mockResolvedValueOnce(makeCard());
    await svc.createCard(superAdmin, PID, {
      columnId: "col1",
      sprintId: null,
      title: "T",
    });
    expect(KanbanCard.create).toHaveBeenCalledWith(
      expect.objectContaining({ sprintId: null }),
      expect.any(Object),
    );
  });

  it("404s when the referenced sprint is missing", async () => {
    KanbanColumn.findOne.mockResolvedValueOnce({ id: "col1" });
    KanbanSprint.findOne.mockResolvedValueOnce(null);
    await expectReject(
      svc.createCard(superAdmin, PID, { columnId: "col1", sprintId: "sp1", title: "T" }),
      "Sprint not found",
    );
  });

  it("defaults to the active sprint when none given", async () => {
    KanbanColumn.findOne.mockResolvedValueOnce({ id: "col1" });
    KanbanSprint.findOne.mockResolvedValueOnce({ id: "spA" });
    KanbanCard.create.mockResolvedValueOnce({ id: "cd1" });
    KanbanCard.findByPk.mockResolvedValueOnce(makeCard());
    await svc.createCard(superAdmin, PID, { columnId: "col1", title: "T" });
    expect(KanbanCard.create).toHaveBeenCalledWith(
      expect.objectContaining({ sprintId: "spA" }),
      expect.any(Object),
    );
  });

  it("falls back to no sprint and derives a CARD key when the code is empty", async () => {
    KanbanProject.findOne.mockResolvedValueOnce({
      ...baseProject(),
      code: null,
      name: "!!!",
    });
    KanbanColumn.findOne.mockResolvedValueOnce({ id: "col1" });
    KanbanSprint.findOne.mockResolvedValueOnce(null); // no active sprint
    KanbanCard.create.mockResolvedValueOnce({ id: "cd1" });
    KanbanCard.findByPk.mockResolvedValueOnce(makeCard());
    await svc.createCard(superAdmin, PID, { columnId: "col1", title: "T" });
    expect(KanbanCard.create).toHaveBeenCalledWith(
      expect.objectContaining({ sprintId: null, cardKey: "CARD-1" }),
      expect.any(Object),
    );
  });

  it("derives a CARD key when both code and name are absent", async () => {
    KanbanProject.findOne.mockResolvedValueOnce({
      ...baseProject(),
      code: null,
      name: null,
    });
    KanbanColumn.findOne.mockResolvedValueOnce({ id: "col1" });
    KanbanSprint.findOne.mockResolvedValueOnce({ id: "spA" });
    KanbanCard.create.mockResolvedValueOnce({ id: "cd1" });
    KanbanCard.findByPk.mockResolvedValueOnce(makeCard());
    await svc.createCard(superAdmin, PID, { columnId: "col1", title: "T" });
    expect(KanbanCard.create).toHaveBeenCalledWith(
      expect.objectContaining({ cardKey: "CARD-1" }),
      expect.any(Object),
    );
  });
});

describe("updateCard", () => {
  it("404s when the card is missing", async () => {
    KanbanCard.findOne.mockResolvedValueOnce(null);
    await expectReject(
      svc.updateCard(superAdmin, PID, "cd1", { title: "T" }),
      "Card not found",
    );
  });

  it("updates fields, sprint, assignees, labels and notifies", async () => {
    KanbanCard.findOne.mockResolvedValueOnce(
      makeCard({ assignees: [{ id: "old1" }] }),
    );
    KanbanCard.findByPk.mockResolvedValueOnce(
      makeCard({
        title: "T",
        getAssignees: jest.fn().mockResolvedValue([{ id: "old1" }, { id: "sa" }]),
      }),
    );
    await svc.updateCard(superAdmin, PID, "cd1", {
      title: "T",
      sprintId: "sp2",
      assigneeIds: ["old1", "new1"],
      labelIds: ["l1"],
    });
    expect(KanbanCardAssignee.destroy).toHaveBeenCalled();
    expect(KanbanCardAssignee.bulkCreate).toHaveBeenCalled();
    expect(KanbanCardLabel.bulkCreate).toHaveBeenCalled();
    // one watcher notify (old1) + one new-tag notify (new1); actor "sa" excluded
    expect(notificationService.emitNotification).toHaveBeenCalled();
  });

  it("handles an empty-patch update that only clears collections", async () => {
    KanbanCard.findOne.mockResolvedValueOnce(makeCard({ assignees: undefined }));
    const full = makeCard();
    KanbanCard.findByPk.mockResolvedValueOnce(full);
    await svc.updateCard(superAdmin, PID, "cd1", {
      sprintId: "backlog",
      assigneeIds: [],
      labelIds: [],
    });
    // sprintId backlog -> null patch is applied (non-empty patch)
    expect(KanbanCardAssignee.destroy).toHaveBeenCalled();
    expect(KanbanCardAssignee.bulkCreate).not.toHaveBeenCalled();
    expect(KanbanCardLabel.bulkCreate).not.toHaveBeenCalled();
  });

  it("applies an explicit null sprintId", async () => {
    const card = makeCard();
    KanbanCard.findOne.mockResolvedValueOnce(card);
    KanbanCard.findByPk.mockResolvedValueOnce(makeCard());
    await svc.updateCard(superAdmin, PID, "cd1", { sprintId: null });
    expect(card.update).toHaveBeenCalledWith(
      expect.objectContaining({ sprintId: null }),
      expect.any(Object),
    );
  });

  it("skips card.update when the patch is empty (assignees only, no sprintId)", async () => {
    const card = makeCard();
    KanbanCard.findOne.mockResolvedValueOnce(card);
    KanbanCard.findByPk.mockResolvedValueOnce(makeCard());
    await svc.updateCard(superAdmin, PID, "cd1", { assigneeIds: ["x"] });
    expect(card.update).not.toHaveBeenCalled();
    expect(KanbanCardAssignee.bulkCreate).toHaveBeenCalled();
  });
});

describe("moveCard", () => {
  it("404s when the card is missing", async () => {
    KanbanCard.findOne.mockResolvedValueOnce(null);
    await expectReject(
      svc.moveCard(superAdmin, PID, "cd1", { columnId: "col2", position: 0 }),
      "Card not found",
    );
  });

  it("404s when the destination column is missing", async () => {
    KanbanCard.findOne.mockResolvedValueOnce(makeCard());
    KanbanColumn.findOne.mockResolvedValueOnce(null);
    await expectReject(
      svc.moveCard(superAdmin, PID, "cd1", { columnId: "col2", position: 0 }),
      "Destination column not found",
    );
  });

  it("reorders within the same column", async () => {
    const card = makeCard({ id: "cd1", columnId: "col1" });
    KanbanCard.findOne.mockResolvedValueOnce(card);
    KanbanColumn.findOne.mockResolvedValueOnce({ id: "col1", name: "Same" });
    KanbanCard.findAll.mockResolvedValueOnce([
      { id: "cd2", position: 0 },
      { id: "cd3", position: 1 },
    ]);
    KanbanCard.findByPk.mockResolvedValueOnce(makeCard());
    await svc.moveCard(superAdmin, PID, "cd1", { columnId: "col1", position: 5 });
    // card appended at the end -> one position update for it
    expect(KanbanCard.update).toHaveBeenCalled();
    // same column -> no move notification
    expect(notificationService.emitNotification).not.toHaveBeenCalled();
  });

  it("moves across columns and notifies watchers", async () => {
    const card = makeCard({ id: "cd1", columnId: "col1" });
    KanbanCard.findOne.mockResolvedValueOnce(card);
    KanbanColumn.findOne.mockResolvedValueOnce({ id: "col2", name: "Doing" });
    KanbanCard.findAll.mockResolvedValueOnce([]); // dest siblings
    KanbanCard.findAll.mockResolvedValueOnce([{ id: "cd9", position: 3 }]); // source siblings (needs renumber)
    KanbanCard.findByPk.mockResolvedValueOnce(
      makeCard({ getAssignees: jest.fn().mockResolvedValue([{ id: "watcher" }]) }),
    );
    await svc.moveCard(superAdmin, PID, "cd1", { columnId: "col2", position: 0 });
    expect(notificationService.emitNotification).toHaveBeenCalled();
  });
});

describe("deleteCard", () => {
  it("404s when missing", async () => {
    KanbanCard.findOne.mockResolvedValueOnce(null);
    await expectReject(svc.deleteCard(superAdmin, PID, "cd1"), "Card not found");
  });

  it("destroys the card", async () => {
    const card = makeCard();
    KanbanCard.findOne.mockResolvedValueOnce(card);
    const res = await svc.deleteCard(superAdmin, PID, "cd1");
    expect(card.destroy).toHaveBeenCalled();
    expect(res).toEqual({ deleted: true });
  });
});

// ================================================================
// Labels
// ================================================================
describe("labels", () => {
  it("createLabel creates with an explicit color", async () => {
    KanbanLabel.create.mockResolvedValueOnce({ id: "l1", name: "bug", color: "#f00" });
    const res = await svc.createLabel(superAdmin, PID, { name: "bug", color: "#f00" });
    expect(res).toEqual({ id: "l1", name: "bug", color: "#f00" });
  });

  it("createLabel defaults the color to null", async () => {
    KanbanLabel.create.mockResolvedValueOnce({ id: "l1", name: "bug", color: null });
    await svc.createLabel(superAdmin, PID, { name: "bug" });
    expect(KanbanLabel.create).toHaveBeenCalledWith(
      expect.objectContaining({ color: null }),
    );
  });

  it("updateLabel 404s when missing", async () => {
    KanbanLabel.findOne.mockResolvedValueOnce(null);
    await expectReject(
      svc.updateLabel(superAdmin, PID, "l1", { name: "x" }),
      "Label not found",
    );
  });

  it("updateLabel patches name and color", async () => {
    const label = { id: "l1", name: "x", color: "#0f0", update: jest.fn().mockResolvedValue() };
    KanbanLabel.findOne.mockResolvedValueOnce(label);
    await svc.updateLabel(superAdmin, PID, "l1", { name: "feat", color: "#0f0" });
    expect(label.update).toHaveBeenCalledWith({ name: "feat", color: "#0f0" });
  });

  it("updateLabel patches name only", async () => {
    const label = { id: "l1", name: "x", color: null, update: jest.fn().mockResolvedValue() };
    KanbanLabel.findOne.mockResolvedValueOnce(label);
    await svc.updateLabel(superAdmin, PID, "l1", { name: "only" });
    expect(label.update).toHaveBeenCalledWith({ name: "only" });
  });

  it("updateLabel patches color only", async () => {
    const label = { id: "l1", name: "x", color: null, update: jest.fn().mockResolvedValue() };
    KanbanLabel.findOne.mockResolvedValueOnce(label);
    await svc.updateLabel(superAdmin, PID, "l1", { color: "#123" });
    expect(label.update).toHaveBeenCalledWith({ color: "#123" });
  });

  it("deleteLabel 404s when missing", async () => {
    KanbanLabel.findOne.mockResolvedValueOnce(null);
    await expectReject(svc.deleteLabel(superAdmin, PID, "l1"), "Label not found");
  });

  it("deleteLabel destroys", async () => {
    const label = { destroy: jest.fn().mockResolvedValue() };
    KanbanLabel.findOne.mockResolvedValueOnce(label);
    const res = await svc.deleteLabel(superAdmin, PID, "l1");
    expect(label.destroy).toHaveBeenCalled();
    expect(res).toEqual({ deleted: true });
  });
});

// ================================================================
// Sprints
// ================================================================
describe("sprints", () => {
  it("listSprints attaches per-sprint and backlog counts", async () => {
    KanbanSprint.findAll.mockResolvedValueOnce([{ id: "sp1", name: "S1" }]);
    KanbanCard.count.mockResolvedValueOnce(4).mockResolvedValueOnce(2);
    const res = await svc.listSprints(superAdmin, PID);
    expect(res.sprints[0].cardCount).toBe(4);
    expect(res.backlogCount).toBe(2);
  });

  it("createSprint uses provided values", async () => {
    KanbanSprint.count.mockResolvedValueOnce(1);
    KanbanSprint.create.mockResolvedValueOnce({ id: "sp1", name: "S1" });
    await svc.createSprint(superAdmin, PID, {
      name: "S1",
      goal: "g",
      status: "active",
      startDate: "2026-01-01",
      endDate: "2026-02-01",
      position: 2,
    });
    expect(KanbanSprint.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active", position: 2 }),
    );
  });

  it("createSprint applies defaults", async () => {
    KanbanSprint.count.mockResolvedValueOnce(5);
    KanbanSprint.create.mockResolvedValueOnce({ id: "sp1" });
    await svc.createSprint(superAdmin, PID, { name: "S1" });
    expect(KanbanSprint.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: "planned", position: 5, goal: null }),
    );
  });

  it("updateSprint 404s when missing", async () => {
    KanbanSprint.findOne.mockResolvedValueOnce(null);
    await expectReject(
      svc.updateSprint(superAdmin, PID, "sp1", { name: "N" }),
      "Sprint not found",
    );
  });

  it("updateSprint patches present fields", async () => {
    const sprint = { id: "sp1", update: jest.fn().mockResolvedValue() };
    KanbanSprint.findOne.mockResolvedValueOnce(sprint);
    await svc.updateSprint(superAdmin, PID, "sp1", { name: "N", status: "completed" });
    expect(sprint.update).toHaveBeenCalledWith({ name: "N", status: "completed" });
  });

  it("deleteSprint 404s when missing", async () => {
    KanbanSprint.findOne.mockResolvedValueOnce(null);
    await expectReject(svc.deleteSprint(superAdmin, PID, "sp1"), "Sprint not found");
  });

  it("deleteSprint destroys", async () => {
    const sprint = { destroy: jest.fn().mockResolvedValue() };
    KanbanSprint.findOne.mockResolvedValueOnce(sprint);
    const res = await svc.deleteSprint(superAdmin, PID, "sp1");
    expect(sprint.destroy).toHaveBeenCalled();
    expect(res).toEqual({ deleted: true });
  });
});

// ================================================================
// migrateCards
// ================================================================
describe("migrateCards", () => {
  it("migrates an explicit card list to the backlog", async () => {
    KanbanCard.update.mockResolvedValueOnce([3]);
    const res = await svc.migrateCards(superAdmin, PID, {
      cardIds: ["cd1", "cd2"],
      targetSprintId: "backlog",
    });
    expect(res).toEqual({ migrated: 3, targetSprintId: null });
  });

  it("migrates all non-Done cards from a source sprint to a target", async () => {
    KanbanSprint.findOne.mockResolvedValueOnce({ id: "spT" });
    KanbanColumn.findAll.mockResolvedValueOnce([{ id: "d1" }]);
    KanbanCard.update.mockResolvedValueOnce([5]);
    const res = await svc.migrateCards(superAdmin, PID, {
      allNotDone: true,
      fromSprintId: "spS",
      targetSprintId: "spT",
    });
    expect(res).toEqual({ migrated: 5, targetSprintId: "spT" });
  });

  it("handles allNotDone with no Done columns and a backlog source", async () => {
    KanbanColumn.findAll.mockResolvedValueOnce([]);
    KanbanCard.update.mockResolvedValueOnce([1]);
    const res = await svc.migrateCards(superAdmin, PID, {
      allNotDone: true,
      fromSprintId: "backlog",
      targetSprintId: "backlog",
    });
    expect(res.migrated).toBe(1);
  });

  it("handles allNotDone without a source sprint filter", async () => {
    KanbanColumn.findAll.mockResolvedValueOnce([{ id: "d1" }]);
    KanbanCard.update.mockResolvedValueOnce([2]);
    const res = await svc.migrateCards(superAdmin, PID, {
      allNotDone: true,
      targetSprintId: "backlog",
    });
    expect(res.migrated).toBe(2);
  });

  it("rejects when neither cardIds nor allNotDone provided", async () => {
    await expectReject(
      svc.migrateCards(superAdmin, PID, { targetSprintId: "backlog" }),
      "Provide cardIds or set allNotDone",
    );
  });

  it("404s when the target sprint is missing", async () => {
    KanbanSprint.findOne.mockResolvedValueOnce(null);
    await expectReject(
      svc.migrateCards(superAdmin, PID, { cardIds: ["cd1"], targetSprintId: "spT" }),
      "Target sprint not found",
    );
  });
});

// ================================================================
// Card relations
// ================================================================
describe("relations", () => {
  it("addRelation rejects an unknown type", async () => {
    await expectReject(
      svc.addRelation(superAdmin, PID, "cd1", { targetCardId: "cd2", type: "nope" }),
      "Unknown relation type",
    );
  });

  it("addRelation rejects a self relation", async () => {
    await expectReject(
      svc.addRelation(superAdmin, PID, "cd1", { targetCardId: "cd1", type: "blocks" }),
      "cannot relate to itself",
    );
  });

  it("addRelation 404s when the source card is missing", async () => {
    KanbanCard.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(makeCard());
    await expectReject(
      svc.addRelation(superAdmin, PID, "cd1", { targetCardId: "cd2", type: "blocks" }),
      "Card not found",
    );
  });

  it("addRelation 404s when the target card is missing", async () => {
    KanbanCard.findOne.mockResolvedValueOnce(makeCard()).mockResolvedValueOnce(null);
    await expectReject(
      svc.addRelation(superAdmin, PID, "cd1", { targetCardId: "cd2", type: "blocks" }),
      "Target card not found",
    );
  });

  it("addRelation writes both directions and returns hydrated relations", async () => {
    KanbanCard.findOne
      .mockResolvedValueOnce(makeCard({ id: "cd1" }))
      .mockResolvedValueOnce(makeCard({ id: "cd2" }));
    KanbanCardRelation.findAll.mockResolvedValueOnce([
      {
        id: "rel1",
        type: "blocks",
        targetCard: { id: "cd2", cardKey: "MGT-2", title: "T2", columnId: "col1" },
      },
      { id: "rel2", type: "blocks", targetCard: null },
    ]);
    const res = await svc.addRelation(superAdmin, PID, "cd1", {
      targetCardId: "cd2",
      type: "blocks",
    });
    expect(KanbanCardRelation.bulkCreate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ type: "blocks" }),
        expect.objectContaining({ type: "blocked_by" }),
      ]),
      expect.any(Object),
    );
    expect(res[0].card.cardKey).toBe("MGT-2");
    expect(res[1].card).toBeNull();
  });

  it("removeRelation 404s when the relation is missing", async () => {
    KanbanCardRelation.findOne.mockResolvedValueOnce(null);
    await expectReject(
      svc.removeRelation(superAdmin, PID, "cd1", "rel1"),
      "Relation not found",
    );
  });

  it("removeRelation deletes the relation and its mirror", async () => {
    const relation = {
      id: "rel1",
      sourceCardId: "cd1",
      targetCardId: "cd2",
      type: "blocks",
      destroy: jest.fn().mockResolvedValue(),
    };
    KanbanCardRelation.findOne.mockResolvedValueOnce(relation);
    await svc.removeRelation(superAdmin, PID, "cd1", "rel1");
    expect(KanbanCardRelation.destroy).toHaveBeenCalled();
    expect(relation.destroy).toHaveBeenCalled();
  });
});

// ================================================================
// getMetrics
// ================================================================
describe("getMetrics", () => {
  const columns = () => [
    { id: "col1", name: "To Do", position: 0, wipLimit: 1, isDone: false },
    { id: "col2", name: "In Progress", position: 1, wipLimit: null, isDone: false },
    { id: "done", name: "Done", position: 2, wipLimit: null, isDone: true },
  ];
  const labels = () => [{ id: "l1", name: "bug", color: "#f00" }];
  const sprints = () => [
    { id: "sp1", name: "Sprint 1", status: "active", position: 0 },
  ];

  const stubMeta = (over = {}) => {
    KanbanColumn.findAll.mockResolvedValueOnce(over.columns || columns());
    KanbanSprint.findAll.mockResolvedValueOnce(over.sprints || sprints());
    KanbanLabel.findAll.mockResolvedValueOnce(over.labels || labels());
    KanbanCard.findAll.mockResolvedValueOnce(over.cards || []);
  };

  it("computes a full metrics report for the default (all) view", async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const cards = [
      // Two cards in To Do -> exceeds wipLimit 1 (overWip true); one overdue,
      // one with no due date; both assigned (fallback name paths).
      {
        columnId: "col1",
        sprintId: "sp1",
        priority: "high",
        dueDate: past,
        assignees: [{ id: "u1", firstName: "Ann", lastName: "Lee", email: "a@x.c" }],
        labels: [{ id: "l1" }],
      },
      {
        columnId: "col1",
        sprintId: "sp1",
        priority: null,
        dueDate: null,
        assignees: [{ id: "u2", firstName: null, lastName: null, email: "b@x.c" }],
        labels: [],
      },
      // Done card: not overdue even though it has a past dueDate.
      {
        columnId: "done",
        sprintId: null,
        priority: "urgent",
        dueDate: past,
        assignees: [],
        labels: [{ id: "l1" }],
      },
    ];
    stubMeta({ cards });
    const res = await svc.getMetrics(superAdmin, PID);

    expect(res.view).toBe("all");
    expect(res.summary.total).toBe(3);
    expect(res.summary.done).toBe(1);
    expect(res.summary.inProgress).toBe(2);
    expect(res.summary.completionRate).toBe(33);
    expect(res.summary.overdue).toBe(1); // only the non-done past-due card
    expect(res.summary.unassigned).toBe(1); // the done card has no assignees

    const todo = res.byColumn.find((c) => c.columnId === "col1");
    expect(todo.count).toBe(2);
    expect(todo.overWip).toBe(true);
    const inProg = res.byColumn.find((c) => c.columnId === "col2");
    expect(inProg.overWip).toBe(false); // wipLimit null

    expect(res.byPriority.find((p) => p.priority === "none").count).toBe(1);
    expect(res.byPriority.find((p) => p.priority === "high").count).toBe(1);

    // byAssignee: sorted, name from firstName+lastName vs email fallback
    expect(res.byAssignee).toHaveLength(2);
    expect(res.byAssignee.map((a) => a.name)).toEqual(
      expect.arrayContaining(["Ann Lee", "b@x.c"]),
    );

    expect(res.byLabel[0].count).toBe(2);

    // bySprint present with a Backlog row (view === "all")
    expect(res.bySprint.find((s) => s.name === "Backlog").count).toBe(1);
    expect(res.bySprint.find((s) => s.sprintId === "sp1").count).toBe(2);
  });

  it("tolerates cards with no assignees/labels keys", async () => {
    stubMeta({ cards: [{ columnId: "col2", sprintId: "sp1" }] });
    const res = await svc.getMetrics(superAdmin, PID);
    expect(res.summary.unassigned).toBe(1);
    expect(res.byAssignee).toEqual([]);
    expect(res.byLabel[0].count).toBe(0);
  });

  it("returns a 0 completion rate when there are no cards", async () => {
    stubMeta({ cards: [] });
    const res = await svc.getMetrics(superAdmin, PID);
    expect(res.summary.total).toBe(0);
    expect(res.summary.completionRate).toBe(0);
    expect(res.bySprint.length).toBeGreaterThan(0); // sprints + backlog row
  });

  it("scopes to the backlog and omits bySprint", async () => {
    stubMeta({ cards: [{ columnId: "col2", sprintId: null, assignees: [{ id: "u1" }], labels: [] }] });
    const res = await svc.getMetrics(superAdmin, PID, { sprintId: "backlog" });
    expect(res.view).toBe("backlog");
    expect(KanbanCard.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ sprintId: null }) }),
    );
    expect(res.bySprint).toEqual([]);
  });

  it("scopes to a specific sprint id and omits bySprint", async () => {
    stubMeta({ cards: [] });
    const res = await svc.getMetrics(superAdmin, PID, { sprintId: "sp9" });
    expect(res.view).toBe("sp9");
    expect(KanbanCard.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ sprintId: "sp9" }) }),
    );
    expect(res.bySprint).toEqual([]);
  });

  it("honours an explicit all view", async () => {
    stubMeta({ cards: [] });
    const res = await svc.getMetrics(superAdmin, PID, { sprintId: "all" });
    expect(res.view).toBe("all");
    // no sprint filter on the card query
    const call = KanbanCard.findAll.mock.calls[0][0];
    expect(call.where.sprintId).toBeUndefined();
  });
});

// ================================================================
// getCard
// ================================================================
describe("getCard", () => {
  it("404s when the card is missing", async () => {
    KanbanCard.findByPk.mockResolvedValueOnce(null);
    await expectReject(svc.getCard(superAdmin, PID, "cd1"), "Card not found");
  });

  it("404s when the card belongs to another project", async () => {
    KanbanCard.findByPk.mockResolvedValueOnce(makeCard({ projectId: "other" }));
    await expectReject(svc.getCard(superAdmin, PID, "cd1"), "Card not found");
  });

  it("returns the serialized card with relations", async () => {
    KanbanCard.findByPk.mockResolvedValueOnce(makeCard());
    KanbanCardRelation.findAll.mockResolvedValueOnce([
      {
        id: "rel1",
        type: "blocks",
        targetCard: { id: "cd2", cardKey: "MGT-2", title: "T2", columnId: "col1" },
      },
    ]);
    const res = await svc.getCard(superAdmin, PID, "cd1");
    expect(res.id).toBe("cd1");
    expect(res.relations).toHaveLength(1);
  });
});

// ================================================================
// Helpers
// ================================================================
describe("helpers", () => {
  it("_loadCard returns null when the card is missing", async () => {
    KanbanCard.findByPk.mockResolvedValueOnce(null);
    const res = await svc._loadCard("cd1");
    expect(res).toBeNull();
  });

  it("notifyCardActivity skips when the card has no assignees array", async () => {
    await svc.notifyCardActivity(makeCard({ assignees: undefined }), "sa", {
      title: "t",
      message: "m",
    });
    expect(notificationService.emitNotification).not.toHaveBeenCalled();
  });

  it("_serializeCard is exposed and maps a card", () => {
    const out = svc._serializeCard(
      makeCard({
        assignees: [{ id: "u2", firstName: "A", lastName: "B", email: "a@b.c" }],
        labels: [{ id: "l1", name: "bug", color: "#f00" }],
      }),
    );
    expect(out.assignees[0].id).toBe("u2");
    expect(out.labels[0].name).toBe("bug");
  });

  it("_serializeCard defaults missing assignees/labels to empty arrays", () => {
    const out = svc._serializeCard({ id: "x", projectId: PID });
    expect(out.assignees).toEqual([]);
    expect(out.labels).toEqual([]);
  });
});
