import { useKanbanStore } from "@/stores/kanbanStore";
import { kanbanService, KanbanBoard, KanbanCard } from "@/api/services/kanban.service";

jest.mock("@/api/services/kanban.service", () => ({
  kanbanService: {
    listProjects: jest.fn(),
    createProject: jest.fn(),
    getBoard: jest.fn(),
  },
}));

const listProjects = kanbanService.listProjects as jest.Mock;
const createProject = kanbanService.createProject as jest.Mock;
const getBoard = kanbanService.getBoard as jest.Mock;

const card = (over: Partial<KanbanCard> = {}): KanbanCard =>
  ({
    id: "card-1",
    projectId: "p1",
    columnId: "col-1",
    sprintId: "s1",
    title: "Card",
    position: 0,
    createdAt: "",
    updatedAt: "",
    assignees: [],
    labels: [],
    ...over,
  }) as KanbanCard;

const board = (over: Partial<KanbanBoard> = {}): KanbanBoard =>
  ({
    id: "p1",
    name: "Board",
    myAccess: "owner",
    activeSprintId: "s1",
    columns: [],
    cards: [],
    labels: [],
    sprints: [],
    members: [],
    ...over,
  }) as KanbanBoard;

const reset = () =>
  useKanbanStore.setState({
    projects: [],
    board: null,
    viewSprintId: "",
    isLoading: false,
    error: null,
  });

describe("kanbanStore", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    reset();
  });

  describe("fetchProjects", () => {
    it("loads projects on success", async () => {
      listProjects.mockResolvedValue([{ id: "p1", name: "Board" }]);
      await useKanbanStore.getState().fetchProjects();
      const s = useKanbanStore.getState();
      expect(s.projects).toHaveLength(1);
      expect(s.isLoading).toBe(false);
      expect(s.error).toBeNull();
    });

    it("captures the error message on failure", async () => {
      listProjects.mockRejectedValue(new Error("boom"));
      await useKanbanStore.getState().fetchProjects();
      expect(useKanbanStore.getState().error).toBe("boom");
      expect(useKanbanStore.getState().isLoading).toBe(false);
    });

    it("uses a fallback message for non-Error throws", async () => {
      listProjects.mockRejectedValue("nope");
      await useKanbanStore.getState().fetchProjects();
      expect(useKanbanStore.getState().error).toBe("Failed to load projects");
    });
  });

  describe("createProject", () => {
    it("creates then refreshes the project list", async () => {
      createProject.mockResolvedValue(board());
      listProjects.mockResolvedValue([{ id: "p1", name: "Board" }]);
      const res = await useKanbanStore
        .getState()
        .createProject({ name: "Board" });
      expect(createProject).toHaveBeenCalledWith({ name: "Board" });
      expect(listProjects).toHaveBeenCalled();
      expect(res.id).toBe("p1");
    });
  });

  describe("fetchBoard", () => {
    it("stores the board and derives viewSprintId from activeSprintId", async () => {
      getBoard.mockResolvedValue(board({ activeSprintId: "s1" }));
      await useKanbanStore.getState().fetchBoard("p1");
      expect(useKanbanStore.getState().board?.id).toBe("p1");
      expect(useKanbanStore.getState().viewSprintId).toBe("s1");
    });

    it("falls back to 'backlog' when activeSprintId is null", async () => {
      getBoard.mockResolvedValue(board({ activeSprintId: null }));
      await useKanbanStore.getState().fetchBoard("p1");
      expect(useKanbanStore.getState().viewSprintId).toBe("backlog");
    });

    it("passes the sprintId through to the service", async () => {
      getBoard.mockResolvedValue(board());
      await useKanbanStore.getState().fetchBoard("p1", "s2");
      expect(getBoard).toHaveBeenCalledWith("p1", "s2");
    });

    it("records an error on failure", async () => {
      getBoard.mockRejectedValue(new Error("nope"));
      await useKanbanStore.getState().fetchBoard("p1");
      expect(useKanbanStore.getState().error).toBe("nope");
    });

    it("uses a fallback message for non-Error board failures", async () => {
      getBoard.mockRejectedValue("weird");
      await useKanbanStore.getState().fetchBoard("p1");
      expect(useKanbanStore.getState().error).toBe("Failed to load board");
    });
  });

  describe("setViewSprint", () => {
    it("sets the view id and reloads that sprint", async () => {
      getBoard.mockResolvedValue(board({ activeSprintId: "s2" }));
      await useKanbanStore.getState().setViewSprint("p1", "s2");
      expect(getBoard).toHaveBeenCalledWith("p1", "s2");
    });
  });

  describe("upsertCard", () => {
    it("is a no-op with no board loaded", () => {
      useKanbanStore.getState().upsertCard(card());
      expect(useKanbanStore.getState().board).toBeNull();
    });

    it("adds a new card that belongs to the active sprint", () => {
      useKanbanStore.setState({ board: board({ activeSprintId: "s1" }) });
      useKanbanStore.getState().upsertCard(card({ id: "new", sprintId: "s1" }));
      expect(useKanbanStore.getState().board?.cards).toHaveLength(1);
    });

    it("updates an existing card in place", () => {
      useKanbanStore.setState({
        board: board({ activeSprintId: "s1", cards: [card({ title: "old" })] }),
      });
      useKanbanStore.getState().upsertCard(card({ title: "updated" }));
      const cards = useKanbanStore.getState().board!.cards;
      expect(cards).toHaveLength(1);
      expect(cards[0].title).toBe("updated");
    });

    it("drops a card that no longer belongs to the viewed sprint", () => {
      useKanbanStore.setState({
        board: board({ activeSprintId: "s1", cards: [card({ sprintId: "s1" })] }),
      });
      // Moved to another sprint -> should be removed from this view.
      useKanbanStore.getState().upsertCard(card({ sprintId: "s2" }));
      expect(useKanbanStore.getState().board?.cards).toHaveLength(0);
    });

    it("keeps every card when viewing 'all'", () => {
      useKanbanStore.setState({ board: board({ activeSprintId: "all" }) });
      useKanbanStore.getState().upsertCard(card({ sprintId: "whatever" }));
      expect(useKanbanStore.getState().board?.cards).toHaveLength(1);
    });

    it("keeps every card when activeSprintId is null", () => {
      useKanbanStore.setState({ board: board({ activeSprintId: null }) });
      useKanbanStore.getState().upsertCard(card({ sprintId: "anything" }));
      expect(useKanbanStore.getState().board?.cards).toHaveLength(1);
    });

    it("in backlog view keeps only unassigned-sprint cards", () => {
      useKanbanStore.setState({ board: board({ activeSprintId: "backlog" }) });
      useKanbanStore.getState().upsertCard(card({ id: "b", sprintId: null }));
      expect(useKanbanStore.getState().board?.cards).toHaveLength(1);
      // A card with a sprint is not part of the backlog view.
      useKanbanStore.getState().upsertCard(card({ id: "b", sprintId: "s1" }));
      expect(useKanbanStore.getState().board?.cards).toHaveLength(0);
    });
  });

  describe("removeCard / setColumns", () => {
    it("removeCard is a no-op with no board", () => {
      useKanbanStore.getState().removeCard("card-1");
      expect(useKanbanStore.getState().board).toBeNull();
    });

    it("removeCard filters out the card", () => {
      useKanbanStore.setState({
        board: board({ cards: [card({ id: "a" }), card({ id: "b" })] }),
      });
      useKanbanStore.getState().removeCard("a");
      expect(useKanbanStore.getState().board?.cards.map((c) => c.id)).toEqual([
        "b",
      ]);
    });

    it("setColumns replaces columns (and no-ops without a board)", () => {
      useKanbanStore.getState().setColumns([{ id: "c1" } as never]);
      expect(useKanbanStore.getState().board).toBeNull();
      useKanbanStore.setState({ board: board() });
      useKanbanStore.getState().setColumns([{ id: "c1" } as never]);
      expect(useKanbanStore.getState().board?.columns).toHaveLength(1);
    });
  });

  describe("sprint mutators", () => {
    it("upsertSprint adds then updates (no-op without board)", () => {
      useKanbanStore.getState().upsertSprint({ id: "s1", name: "S1" } as never);
      expect(useKanbanStore.getState().board).toBeNull();

      useKanbanStore.setState({ board: board() });
      useKanbanStore.getState().upsertSprint({ id: "s1", name: "S1" } as never);
      expect(useKanbanStore.getState().board?.sprints).toHaveLength(1);
      useKanbanStore
        .getState()
        .upsertSprint({ id: "s1", name: "Renamed" } as never);
      expect(useKanbanStore.getState().board?.sprints[0].name).toBe("Renamed");
    });

    it("removeSprint filters (no-op without board)", () => {
      useKanbanStore.getState().removeSprint("s1");
      expect(useKanbanStore.getState().board).toBeNull();

      useKanbanStore.setState({
        board: board({ sprints: [{ id: "s1" } as never, { id: "s2" } as never] }),
      });
      useKanbanStore.getState().removeSprint("s1");
      expect(useKanbanStore.getState().board?.sprints.map((s) => s.id)).toEqual([
        "s2",
      ]);
    });
  });

  it("setError / setBoard set their slice", () => {
    useKanbanStore.getState().setError("x");
    expect(useKanbanStore.getState().error).toBe("x");
    const b = board();
    useKanbanStore.getState().setBoard(b);
    expect(useKanbanStore.getState().board).toBe(b);
  });
});
