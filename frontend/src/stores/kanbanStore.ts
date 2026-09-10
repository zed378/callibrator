// src/stores/kanbanStore.ts
// Kanban board state. Holds the project list and the currently-open board, and
// exposes granular mutators so socket.io events can patch the board in place
// (idempotent upserts-by-id, so an actor's own echo is harmless).
import { create } from "zustand";
import {
  kanbanService,
  KanbanBoard,
  KanbanCard,
  KanbanColumn,
  KanbanSprint,
  KanbanProjectSummary,
  CreateProjectInput,
} from "@/api/services/kanban.service";

interface KanbanState {
  projects: KanbanProjectSummary[];
  board: KanbanBoard | null;
  // Which sprint's cards the board is showing: a sprint id, "backlog", "all".
  viewSprintId: string;
  isLoading: boolean;
  error: string | null;

  setError: (e: string | null) => void;

  fetchProjects: () => Promise<void>;
  createProject: (data: CreateProjectInput) => Promise<KanbanBoard>;

  fetchBoard: (projectId: string, sprintId?: string) => Promise<void>;
  setViewSprint: (projectId: string, sprintId: string) => Promise<void>;
  setBoard: (board: KanbanBoard | null) => void;

  // Realtime / optimistic patches
  upsertCard: (card: KanbanCard) => void;
  removeCard: (cardId: string) => void;
  setColumns: (columns: KanbanColumn[]) => void;
  upsertSprint: (sprint: KanbanSprint) => void;
  removeSprint: (sprintId: string) => void;
}

/** Does a card belong in the currently-viewed sprint selection? */
const inView = (board: KanbanBoard | null, card: KanbanCard): boolean => {
  if (!board) return false;
  const view = board.activeSprintId;
  if (view === "all" || view === null) return true;
  if (view === "backlog") return card.sprintId == null;
  return card.sprintId === view;
};

export const useKanbanStore = create<KanbanState>()((set, get) => ({
  projects: [],
  board: null,
  viewSprintId: "",
  isLoading: false,
  error: null,

  setError: (e) => set({ error: e }),

  fetchProjects: async () => {
    set({ isLoading: true, error: null });
    try {
      const projects = await kanbanService.listProjects();
      set({ projects, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to load projects",
      });
    }
  },

  createProject: async (data) => {
    set({ error: null });
    const board = await kanbanService.createProject(data);
    await get().fetchProjects();
    return board;
  },

  fetchBoard: async (projectId, sprintId) => {
    set({ isLoading: true, error: null });
    try {
      const board = await kanbanService.getBoard(projectId, sprintId);
      set({
        board,
        viewSprintId: board.activeSprintId ?? "backlog",
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to load board",
      });
    }
  },

  setViewSprint: async (projectId, sprintId) => {
    set({ viewSprintId: sprintId });
    await get().fetchBoard(projectId, sprintId);
  },

  setBoard: (board) => set({ board }),

  upsertCard: (card) => {
    const board = get().board;
    if (!board) return;
    // Drop the card if it no longer belongs to the viewed sprint.
    if (!inView(board, card)) {
      set({
        board: {
          ...board,
          cards: board.cards.filter((c) => c.id !== card.id),
        },
      });
      return;
    }
    const exists = board.cards.some((c) => c.id === card.id);
    set({
      board: {
        ...board,
        cards: exists
          ? board.cards.map((c) => (c.id === card.id ? card : c))
          : [...board.cards, card],
      },
    });
  },

  removeCard: (cardId) => {
    const board = get().board;
    if (!board) return;
    set({
      board: { ...board, cards: board.cards.filter((c) => c.id !== cardId) },
    });
  },

  setColumns: (columns) => {
    const board = get().board;
    if (!board) return;
    set({ board: { ...board, columns } });
  },

  upsertSprint: (sprint) => {
    const board = get().board;
    if (!board) return;
    const exists = board.sprints.some((s) => s.id === sprint.id);
    set({
      board: {
        ...board,
        sprints: exists
          ? board.sprints.map((s) => (s.id === sprint.id ? sprint : s))
          : [...board.sprints, sprint],
      },
    });
  },

  removeSprint: (sprintId) => {
    const board = get().board;
    if (!board) return;
    set({
      board: {
        ...board,
        sprints: board.sprints.filter((s) => s.id !== sprintId),
      },
    });
  },
}));

export default useKanbanStore;
