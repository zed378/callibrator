/**
 * useKanbanProjects — the project list load, the create guard and payload,
 * navigation to the new board, and a refused create. The real kanbanStore
 * runs; only kanbanService (whose methods unwrap the envelope's `data`) is
 * mocked.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const kanbanService = { listProjects: jest.fn(), createProject: jest.fn() };
jest.mock("@/api/services/kanban.service", () => ({ kanbanService }));
const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { useKanbanProjects } from "../useKanbanProjects";
import { useKanbanStore } from "@/stores/kanbanStore";

const ev = { preventDefault: jest.fn() } as unknown as React.FormEvent;
const project = { id: "p1", name: "Ward rollout", code: "WR", color: "#4f46e5", cardCount: 0 };

beforeEach(() => {
  jest.clearAllMocks();
  useKanbanStore.setState({ projects: [], isLoading: false, error: null });
  kanbanService.listProjects.mockResolvedValue([project]);
});

const setup = async () => {
  const hook = renderHook(() => useKanbanProjects());
  await waitFor(() => expect(hook.result.current.projects).toEqual([project]));
  return hook;
};

describe("useKanbanProjects", () => {
  it("loads the projects on mount; a failed load is the store's error", async () => {
    await setup();
    kanbanService.listProjects.mockRejectedValueOnce(new Error("Forbidden"));
    const { result } = renderHook(() => useKanbanProjects());
    await waitFor(() => expect(result.current.error).toBe("Forbidden"));
  });

  it("a blank name is not sent", async () => {
    const { result } = await setup();
    act(() => result.current.openCreate());
    act(() => result.current.setForm((f) => ({ ...f, name: "   " })));
    await act(async () => result.current.handleCreate(ev));
    expect(kanbanService.createProject).not.toHaveBeenCalled();
    expect(result.current.isCreateOpen).toBe(true);
  });

  it("creates with a trimmed payload (blank optionals become null) and opens the board", async () => {
    kanbanService.createProject.mockResolvedValue({ id: "p2", name: "New" });
    const { result } = await setup();
    act(() => result.current.openCreate());
    expect(result.current.isCreateOpen).toBe(true);
    act(() => result.current.setForm((f) => ({ ...f, name: "  New ", code: " ", description: "", color: "" })));
    await act(async () => result.current.handleCreate(ev));
    expect(kanbanService.createProject).toHaveBeenCalledWith({
      name: "New", code: null, description: null, color: null, members: [],
    });
    expect(result.current.isCreateOpen).toBe(false);
    expect(result.current.submitting).toBe(false);
    expect(push).toHaveBeenCalledWith("/dashboard/kanban/p2");
  });

  it("a refused create keeps the modal open with the backend message", async () => {
    kanbanService.createProject.mockRejectedValueOnce(new Error("Project code already in use"));
    const { result } = await setup();
    act(() => result.current.openCreate());
    act(() => result.current.setForm((f) => ({ ...f, name: "Dup", code: "WR" })));
    await act(async () => result.current.handleCreate(ev));
    expect(result.current.error).toBe("Project code already in use");
    expect(result.current.isCreateOpen).toBe(true);
    expect(push).not.toHaveBeenCalled();

    kanbanService.createProject.mockRejectedValueOnce("x");
    await act(async () => result.current.handleCreate(ev));
    expect(result.current.error).toBe("Failed to create project");
  });

  it("opening a project navigates to its board", async () => {
    const { result } = await setup();
    act(() => result.current.openProject("p1"));
    expect(push).toHaveBeenCalledWith("/dashboard/kanban/p1");
  });
});
