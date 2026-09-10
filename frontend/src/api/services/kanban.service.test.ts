import { kanbanService } from "./kanban.service";
import { api } from "../client";

jest.mock("../client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedApi = api as jest.Mocked<typeof api>;
const envelope = <T,>(data: T) => ({
  success: true,
  message: "ok",
  data,
});

const BASE = "/api/v1/kanban";

describe("kanbanService", () => {
  beforeEach(() => jest.clearAllMocks());

  // ---- Projects ----
  describe("listProjects", () => {
    it("GETs the project list and unwraps data", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope([{ id: "p1" }]));
      const res = await kanbanService.listProjects();
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/projects`);
      expect(res).toHaveLength(1);
    });
  });

  describe("createProject", () => {
    it("POSTs the project payload", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "p1" }));
      const input = { name: "Board" };
      await kanbanService.createProject(input);
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/projects`, input);
    });
  });

  describe("getBoard", () => {
    it("GETs a project with the sprintId param when given", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ id: "p1" }));
      await kanbanService.getBoard("p1", "s1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/projects/p1`, {
        params: { sprintId: "s1" },
      });
    });

    it("passes undefined params when sprintId omitted", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ id: "p1" }));
      await kanbanService.getBoard("p1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/projects/p1`, {
        params: undefined,
      });
    });
  });

  describe("getMetrics", () => {
    it("GETs project metrics with sprintId param", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ view: "board" }));
      await kanbanService.getMetrics("p1", "s1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/projects/p1/metrics`, {
        params: { sprintId: "s1" },
      });
    });
  });

  describe("updateProject", () => {
    it("PATCHes the project", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "p1" }));
      await kanbanService.updateProject("p1", { name: "Renamed" });
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/projects/p1`, {
        name: "Renamed",
      });
    });
  });

  describe("deleteProject", () => {
    it("DELETEs the project", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await kanbanService.deleteProject("p1");
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/projects/p1`);
    });
  });

  // ---- Members ----
  describe("addMember", () => {
    it("POSTs the member payload", async () => {
      mockedApi.post.mockResolvedValueOnce(
        envelope({ memberId: "m1", members: [] }),
      );
      const data = { userId: "u1", accessLevel: "editor" as const };
      await kanbanService.addMember("p1", data);
      expect(mockedApi.post).toHaveBeenCalledWith(
        `${BASE}/projects/p1/members`,
        data,
      );
    });
  });

  describe("updateMember", () => {
    it("PATCHes the member accessLevel", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope([]));
      await kanbanService.updateMember("p1", "m1", "viewer");
      expect(mockedApi.patch).toHaveBeenCalledWith(
        `${BASE}/projects/p1/members/m1`,
        { accessLevel: "viewer" },
      );
    });
  });

  describe("removeMember", () => {
    it("DELETEs the member", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await kanbanService.removeMember("p1", "m1");
      expect(mockedApi.delete).toHaveBeenCalledWith(
        `${BASE}/projects/p1/members/m1`,
      );
    });
  });

  // ---- Sprints ----
  describe("listSprints", () => {
    it("GETs the sprint list", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ sprints: [], backlogCount: 0 }),
      );
      await kanbanService.listSprints("p1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/projects/p1/sprints`);
    });
  });

  describe("createSprint", () => {
    it("POSTs the sprint payload", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "s1" }));
      const data = { name: "Sprint 1" };
      await kanbanService.createSprint("p1", data);
      expect(mockedApi.post).toHaveBeenCalledWith(
        `${BASE}/projects/p1/sprints`,
        data,
      );
    });
  });

  describe("updateSprint", () => {
    it("PATCHes the sprint", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "s1" }));
      await kanbanService.updateSprint("p1", "s1", { name: "New" });
      expect(mockedApi.patch).toHaveBeenCalledWith(
        `${BASE}/projects/p1/sprints/s1`,
        { name: "New" },
      );
    });
  });

  describe("deleteSprint", () => {
    it("DELETEs the sprint", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await kanbanService.deleteSprint("p1", "s1");
      expect(mockedApi.delete).toHaveBeenCalledWith(
        `${BASE}/projects/p1/sprints/s1`,
      );
    });
  });

  describe("migrateCards", () => {
    it("POSTs to the sprints/migrate endpoint", async () => {
      mockedApi.post.mockResolvedValueOnce(
        envelope({ migrated: 3, targetSprintId: "s2" }),
      );
      const data = { allNotDone: true, targetSprintId: "s2" };
      await kanbanService.migrateCards("p1", data);
      expect(mockedApi.post).toHaveBeenCalledWith(
        `${BASE}/projects/p1/sprints/migrate`,
        data,
      );
    });
  });

  // ---- Columns ----
  describe("createColumn", () => {
    it("POSTs the column payload", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "c1" }));
      const data = { name: "To Do" };
      await kanbanService.createColumn("p1", data);
      expect(mockedApi.post).toHaveBeenCalledWith(
        `${BASE}/projects/p1/columns`,
        data,
      );
    });
  });

  describe("updateColumn", () => {
    it("PATCHes the column", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "c1" }));
      await kanbanService.updateColumn("p1", "c1", { wipLimit: 5 });
      expect(mockedApi.patch).toHaveBeenCalledWith(
        `${BASE}/projects/p1/columns/c1`,
        { wipLimit: 5 },
      );
    });
  });

  describe("deleteColumn", () => {
    it("DELETEs the column", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await kanbanService.deleteColumn("p1", "c1");
      expect(mockedApi.delete).toHaveBeenCalledWith(
        `${BASE}/projects/p1/columns/c1`,
      );
    });
  });

  describe("reorderColumns", () => {
    it("POSTs the order array to columns/reorder", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope([]));
      await kanbanService.reorderColumns("p1", ["c2", "c1"]);
      expect(mockedApi.post).toHaveBeenCalledWith(
        `${BASE}/projects/p1/columns/reorder`,
        { order: ["c2", "c1"] },
      );
    });
  });

  // ---- Cards ----
  describe("getCard", () => {
    it("GETs one card", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ id: "k1" }));
      await kanbanService.getCard("p1", "k1");
      expect(mockedApi.get).toHaveBeenCalledWith(
        `${BASE}/projects/p1/cards/k1`,
      );
    });
  });

  describe("createCard", () => {
    it("POSTs the card payload", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "k1" }));
      const data = { columnId: "c1", title: "Task" };
      await kanbanService.createCard("p1", data);
      expect(mockedApi.post).toHaveBeenCalledWith(
        `${BASE}/projects/p1/cards`,
        data,
      );
    });
  });

  describe("updateCard", () => {
    it("PATCHes the card", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "k1" }));
      await kanbanService.updateCard("p1", "k1", { title: "New" });
      expect(mockedApi.patch).toHaveBeenCalledWith(
        `${BASE}/projects/p1/cards/k1`,
        { title: "New" },
      );
    });
  });

  describe("moveCard", () => {
    it("PATCHes the card move endpoint", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "k1" }));
      const data = { columnId: "c2", position: 0 };
      await kanbanService.moveCard("p1", "k1", data);
      expect(mockedApi.patch).toHaveBeenCalledWith(
        `${BASE}/projects/p1/cards/k1/move`,
        data,
      );
    });
  });

  describe("deleteCard", () => {
    it("DELETEs the card", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await kanbanService.deleteCard("p1", "k1");
      expect(mockedApi.delete).toHaveBeenCalledWith(
        `${BASE}/projects/p1/cards/k1`,
      );
    });
  });

  // ---- Card relations ----
  describe("addRelation", () => {
    it("POSTs the relation payload", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope([]));
      const data = { targetCardId: "k2", type: "blocks" as const };
      await kanbanService.addRelation("p1", "k1", data);
      expect(mockedApi.post).toHaveBeenCalledWith(
        `${BASE}/projects/p1/cards/k1/relations`,
        data,
      );
    });
  });

  describe("removeRelation", () => {
    it("DELETEs the relation", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope([]));
      await kanbanService.removeRelation("p1", "k1", "r1");
      expect(mockedApi.delete).toHaveBeenCalledWith(
        `${BASE}/projects/p1/cards/k1/relations/r1`,
      );
    });
  });

  // ---- Labels ----
  describe("createLabel", () => {
    it("POSTs the label payload", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "l1" }));
      const data = { name: "bug" };
      await kanbanService.createLabel("p1", data);
      expect(mockedApi.post).toHaveBeenCalledWith(
        `${BASE}/projects/p1/labels`,
        data,
      );
    });
  });

  describe("updateLabel", () => {
    it("PATCHes the label", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "l1" }));
      await kanbanService.updateLabel("p1", "l1", { color: "#fff" });
      expect(mockedApi.patch).toHaveBeenCalledWith(
        `${BASE}/projects/p1/labels/l1`,
        { color: "#fff" },
      );
    });
  });

  describe("deleteLabel", () => {
    it("DELETEs the label", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await kanbanService.deleteLabel("p1", "l1");
      expect(mockedApi.delete).toHaveBeenCalledWith(
        `${BASE}/projects/p1/labels/l1`,
      );
    });
  });
});
