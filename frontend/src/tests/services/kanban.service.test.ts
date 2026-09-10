import { kanbanService } from "@/api/services/kanban.service";
import { api } from "@/api/client";

// The service is a thin wrapper over the shared axios `api` helper: every call
// unwraps the `{ success, data }` envelope (except deletes, which are void).
jest.mock("@/api/client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const patch = api.patch as jest.Mock;
const del = api.delete as jest.Mock;

const env = <T,>(data: T) => ({ success: true, message: "ok", data });
const P = "proj-1";

describe("kanbanService", () => {
  beforeEach(() => jest.clearAllMocks());

  // ---- Projects ----
  describe("projects", () => {
    it("listProjects unwraps the array", async () => {
      get.mockResolvedValue(env([{ id: P, name: "Board" }]));
      const res = await kanbanService.listProjects();
      expect(get).toHaveBeenCalledWith("/api/v1/kanban/projects");
      expect(res).toEqual([{ id: P, name: "Board" }]);
    });

    it("createProject posts the payload", async () => {
      const body = { name: "Board", code: "BRD" };
      post.mockResolvedValue(env({ id: P, name: "Board" }));
      const res = await kanbanService.createProject(body);
      expect(post).toHaveBeenCalledWith("/api/v1/kanban/projects", body);
      expect(res.id).toBe(P);
    });

    it("getBoard without sprintId omits params", async () => {
      get.mockResolvedValue(env({ id: P }));
      await kanbanService.getBoard(P);
      expect(get).toHaveBeenCalledWith(`/api/v1/kanban/projects/${P}`, {
        params: undefined,
      });
    });

    it("getBoard with sprintId passes it as a param", async () => {
      get.mockResolvedValue(env({ id: P }));
      await kanbanService.getBoard(P, "sprint-9");
      expect(get).toHaveBeenCalledWith(`/api/v1/kanban/projects/${P}`, {
        params: { sprintId: "sprint-9" },
      });
    });

    it("updateProject patches", async () => {
      patch.mockResolvedValue(env({ id: P, name: "New" }));
      const res = await kanbanService.updateProject(P, { name: "New" });
      expect(patch).toHaveBeenCalledWith(`/api/v1/kanban/projects/${P}`, {
        name: "New",
      });
      expect(res.name).toBe("New");
    });

    it("deleteProject calls DELETE and returns void", async () => {
      del.mockResolvedValue(undefined);
      await expect(kanbanService.deleteProject(P)).resolves.toBeUndefined();
      expect(del).toHaveBeenCalledWith(`/api/v1/kanban/projects/${P}`);
    });
  });

  // ---- Metrics ----
  describe("getMetrics", () => {
    it("omits params when no sprint scope", async () => {
      get.mockResolvedValue(env({ summary: { total: 3 } }));
      const res = await kanbanService.getMetrics(P);
      expect(get).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/metrics`,
        { params: undefined },
      );
      expect(res.summary.total).toBe(3);
    });

    it("passes sprintId when scoped", async () => {
      get.mockResolvedValue(env({ summary: { total: 1 } }));
      await kanbanService.getMetrics(P, "backlog");
      expect(get).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/metrics`,
        { params: { sprintId: "backlog" } },
      );
    });
  });

  // ---- Members ----
  describe("members", () => {
    it("addMember posts subject + level", async () => {
      post.mockResolvedValue(env({ memberId: "m1", members: [] }));
      const res = await kanbanService.addMember(P, {
        userId: "u1",
        accessLevel: "editor",
      });
      expect(post).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/members`,
        { userId: "u1", accessLevel: "editor" },
      );
      expect(res.memberId).toBe("m1");
    });

    it("updateMember patches the access level", async () => {
      patch.mockResolvedValue(env([{ id: "m1", accessLevel: "owner" }]));
      const res = await kanbanService.updateMember(P, "m1", "owner");
      expect(patch).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/members/m1`,
        { accessLevel: "owner" },
      );
      expect(res[0].accessLevel).toBe("owner");
    });

    it("removeMember deletes", async () => {
      del.mockResolvedValue(undefined);
      await kanbanService.removeMember(P, "m1");
      expect(del).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/members/m1`,
      );
    });
  });

  // ---- Sprints ----
  describe("sprints", () => {
    it("listSprints unwraps sprints + backlogCount", async () => {
      get.mockResolvedValue(env({ sprints: [{ id: "s1" }], backlogCount: 2 }));
      const res = await kanbanService.listSprints(P);
      expect(get).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/sprints`,
      );
      expect(res.backlogCount).toBe(2);
    });

    it("createSprint posts", async () => {
      post.mockResolvedValue(env({ id: "s2", name: "Sprint 2" }));
      await kanbanService.createSprint(P, { name: "Sprint 2" });
      expect(post).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/sprints`,
        { name: "Sprint 2" },
      );
    });

    it("updateSprint patches", async () => {
      patch.mockResolvedValue(env({ id: "s2", status: "active" }));
      await kanbanService.updateSprint(P, "s2", { status: "active" });
      expect(patch).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/sprints/s2`,
        { status: "active" },
      );
    });

    it("deleteSprint deletes", async () => {
      del.mockResolvedValue(undefined);
      await kanbanService.deleteSprint(P, "s2");
      expect(del).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/sprints/s2`,
      );
    });

    it("migrateCards posts to the migrate endpoint", async () => {
      post.mockResolvedValue(env({ migrated: 4, targetSprintId: "s2" }));
      const res = await kanbanService.migrateCards(P, {
        allNotDone: true,
        targetSprintId: "s2",
      });
      expect(post).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/sprints/migrate`,
        { allNotDone: true, targetSprintId: "s2" },
      );
      expect(res.migrated).toBe(4);
    });
  });

  // ---- Columns ----
  describe("columns", () => {
    it("createColumn posts", async () => {
      post.mockResolvedValue(env({ id: "c1", name: "Review" }));
      await kanbanService.createColumn(P, { name: "Review" });
      expect(post).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/columns`,
        { name: "Review" },
      );
    });

    it("updateColumn patches", async () => {
      patch.mockResolvedValue(env({ id: "c1", name: "QA" }));
      await kanbanService.updateColumn(P, "c1", { name: "QA" });
      expect(patch).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/columns/c1`,
        { name: "QA" },
      );
    });

    it("deleteColumn deletes", async () => {
      del.mockResolvedValue(undefined);
      await kanbanService.deleteColumn(P, "c1");
      expect(del).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/columns/c1`,
      );
    });

    it("reorderColumns posts the order array", async () => {
      post.mockResolvedValue(env([{ id: "c1" }, { id: "c2" }]));
      await kanbanService.reorderColumns(P, ["c2", "c1"]);
      expect(post).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/columns/reorder`,
        { order: ["c2", "c1"] },
      );
    });
  });

  // ---- Cards ----
  describe("cards", () => {
    it("getCard gets one card", async () => {
      get.mockResolvedValue(env({ id: "card-1", title: "T" }));
      const res = await kanbanService.getCard(P, "card-1");
      expect(get).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/cards/card-1`,
      );
      expect(res.title).toBe("T");
    });

    it("createCard posts", async () => {
      post.mockResolvedValue(env({ id: "card-1", title: "New" }));
      await kanbanService.createCard(P, { columnId: "c1", title: "New" });
      expect(post).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/cards`,
        { columnId: "c1", title: "New" },
      );
    });

    it("updateCard patches", async () => {
      patch.mockResolvedValue(env({ id: "card-1", title: "Edited" }));
      await kanbanService.updateCard(P, "card-1", { title: "Edited" });
      expect(patch).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/cards/card-1`,
        { title: "Edited" },
      );
    });

    it("moveCard patches column + position", async () => {
      patch.mockResolvedValue(env({ id: "card-1", columnId: "c2" }));
      await kanbanService.moveCard(P, "card-1", {
        columnId: "c2",
        position: 0,
      });
      expect(patch).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/cards/card-1/move`,
        { columnId: "c2", position: 0 },
      );
    });

    it("deleteCard deletes", async () => {
      del.mockResolvedValue(undefined);
      await kanbanService.deleteCard(P, "card-1");
      expect(del).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/cards/card-1`,
      );
    });
  });

  // ---- Relations ----
  describe("relations", () => {
    it("addRelation posts target + type", async () => {
      post.mockResolvedValue(env([{ id: "r1", type: "blocks" }]));
      const res = await kanbanService.addRelation(P, "card-1", {
        targetCardId: "card-2",
        type: "blocks",
      });
      expect(post).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/cards/card-1/relations`,
        { targetCardId: "card-2", type: "blocks" },
      );
      expect(res[0].type).toBe("blocks");
    });

    it("removeRelation deletes and unwraps remaining relations", async () => {
      del.mockResolvedValue(env([]));
      const res = await kanbanService.removeRelation(P, "card-1", "r1");
      expect(del).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/cards/card-1/relations/r1`,
      );
      expect(res).toEqual([]);
    });
  });

  // ---- Labels ----
  describe("labels", () => {
    it("createLabel posts", async () => {
      post.mockResolvedValue(env({ id: "l1", name: "bug", color: "#f00" }));
      await kanbanService.createLabel(P, { name: "bug", color: "#f00" });
      expect(post).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/labels`,
        { name: "bug", color: "#f00" },
      );
    });

    it("updateLabel patches", async () => {
      patch.mockResolvedValue(env({ id: "l1", name: "defect" }));
      await kanbanService.updateLabel(P, "l1", { name: "defect" });
      expect(patch).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/labels/l1`,
        { name: "defect" },
      );
    });

    it("deleteLabel deletes", async () => {
      del.mockResolvedValue(undefined);
      await kanbanService.deleteLabel(P, "l1");
      expect(del).toHaveBeenCalledWith(
        `/api/v1/kanban/projects/${P}/labels/l1`,
      );
    });
  });

  it("propagates api errors", async () => {
    get.mockRejectedValue(new Error("Network down"));
    await expect(kanbanService.listProjects()).rejects.toThrow("Network down");
  });
});
