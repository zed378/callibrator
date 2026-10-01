/**
 * useBoard — the board's load, its realtime patches, and every action's
 * request. `@/api/client` is mocked with the backend's envelope, so the REAL
 * kanban service and the REAL kanban store run; the socket is a fake emitter
 * (the reconnect contract has its own real-server test, useBoard.realtime).
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Socket } from "socket.io-client";

jest.mock("@/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

type Handler = (payload?: unknown) => void;
const handlers = new Map<string, Set<Handler>>();
const fakeSocket = {
  connected: true,
  emit: jest.fn(),
  on: jest.fn((event: string, h: Handler) => {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)?.add(h);
  }),
  off: jest.fn((event: string, h: Handler) => {
    handlers.get(event)?.delete(h);
  }),
};

jest.mock("@/lib/socket", () => ({
  ...jest.requireActual("@/lib/socket"),
  getSocket: jest.fn(),
}));

import { api } from "@/api/client";
import { getSocket } from "@/lib/socket";
import { useKanbanStore } from "@/stores/kanbanStore";
import { httpError } from "@/tests/support/httpErrors";
import { kBoard, kCard, kSprint, ok } from "@/tests/support/kanbanFixtures";
import { useBoard } from "../useBoard";

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const patch = api.patch as jest.Mock;
const del = api.delete as jest.Mock;

const BOARD_URL = "/api/v1/kanban/projects/proj-1";

const fire = (event: string, payload?: unknown) =>
  act(() => {
    handlers.get(event)?.forEach((h) => h(payload));
  });

const boardCards = () => useKanbanStore.getState().board?.cards.map((c) => c.id);

// Multi-step page flows with an axe pass each; under --coverage on a loaded
// machine one can exceed Jest's 5 s default (see jest.setup.ts).
jest.setTimeout(20000);

beforeEach(() => {
  jest.clearAllMocks();
  handlers.clear();
  (getSocket as jest.Mock).mockResolvedValue(fakeSocket as unknown as Socket);
  useKanbanStore.setState({ board: null, error: null, viewSprintId: "", isLoading: false });
  get.mockResolvedValue(ok(kBoard("owner")));
});

const setup = async () => {
  const hook = renderHook(() => useBoard("proj-1"));
  await waitFor(() => expect(hook.result.current.board?.id).toBe("proj-1"));
  // The realtime effect subscribes after getSocket resolves.
  await waitFor(() => expect(handlers.get("kanban:card:created")?.size).toBe(1));
  return hook;
};

describe("useBoard — load and access", () => {
  it("loads the board once, with no sprint param, and joins the board room by the raw project id", async () => {
    const { result } = await setup();
    expect(get).toHaveBeenCalledWith(BOARD_URL, { params: undefined });
    expect(fakeSocket.emit).toHaveBeenCalledWith("kanban:join", "proj-1", expect.any(Function));
    expect(result.current.viewSprintId).toBe("backlog");
  });

  it.each([
    ["viewer", false, false],
    ["editor", true, false],
    ["owner", true, true],
  ] as const)("a %s: canEdit=%s isOwner=%s", async (access, canEdit, isOwner) => {
    get.mockResolvedValue(ok(kBoard(access)));
    const { result } = await setup();
    expect(result.current.canEdit).toBe(canEdit);
    expect(result.current.isOwner).toBe(isOwner);
  });

  it("a board from another tenant (404) leaves no board and the backend's message as the error", async () => {
    get.mockRejectedValue(httpError(404, "Project not found"));
    const { result } = renderHook(() => useBoard("proj-1"));
    await waitFor(() => expect(result.current.error).toBe("Project not found"));
    expect(result.current.board).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("a refused room join is shown as a board error", async () => {
    fakeSocket.emit.mockImplementationOnce(
      (_ev: string, _id: string, ack: (r: { ok: boolean; error?: string }) => void) =>
        ack({ ok: false, error: "Not a member" }),
    );
    const { result } = await setup();
    await waitFor(() =>
      expect(result.current.error).toBe("Live updates are unavailable: Not a member"),
    );
  });

  it("with no socket (token refused) the board still loads and nothing subscribes", async () => {
    (getSocket as jest.Mock).mockResolvedValue(null);
    const { result } = renderHook(() => useBoard("proj-1"));
    await waitFor(() => expect(result.current.board?.id).toBe("proj-1"));
    expect(fakeSocket.on).not.toHaveBeenCalled();
  });

  it("sorts columns by position and each column's cards by position", async () => {
    const { result } = await setup();
    expect(result.current.columnsSorted.map((c) => c.name)).toEqual(["To do", "Doing", "Done"]);
    expect(result.current.cardsByColumn("col-todo").map((c) => c.title)).toEqual([
      "First",
      "Second",
    ]);
    expect(result.current.cardsByColumn("col-done")).toEqual([]);
  });

  it("switching the sprint in view asks for that sprint's cards", async () => {
    const { result } = await setup();
    get.mockResolvedValue(ok(kBoard("owner", { activeSprintId: "s1", cards: [] })));
    await act(async () => {
      result.current.setViewSprint("s1");
    });
    expect(get).toHaveBeenLastCalledWith(BOARD_URL, { params: { sprintId: "s1" } });
    await waitFor(() => expect(result.current.viewSprintId).toBe("s1"));

    await act(async () => {
      await result.current.refetch();
    });
    expect(get).toHaveBeenLastCalledWith(BOARD_URL, { params: { sprintId: "s1" } });
  });
});

describe("useBoard — realtime patches", () => {
  it("card created / updated / moved / deleted events patch the board in place", async () => {
    await setup();
    fire("kanban:card:created", { card: kCard("c9", { title: "From a colleague" }) });
    expect(boardCards()).toContain("c9");

    fire("kanban:card:updated", { card: kCard("c9", { title: "Renamed" }) });
    expect(useKanbanStore.getState().board?.cards.find((c) => c.id === "c9")?.title).toBe("Renamed");

    fire("kanban:card:moved", { card: kCard("c9", { columnId: "col-done" }), fromColumn: "col-todo", toColumn: "col-done" });
    expect(useKanbanStore.getState().board?.cards.find((c) => c.id === "c9")?.columnId).toBe("col-done");

    fire("kanban:card:deleted", { cardId: "c9", columnId: "col-done" });
    expect(boardCards()).not.toContain("c9");
  });

  it("a card moved into a different sprint leaves the backlog view", async () => {
    await setup();
    fire("kanban:card:updated", { card: kCard("c1", { sprintId: "s1" }) });
    expect(boardCards()).not.toContain("c1");
  });

  it("sprint created / updated / deleted events patch the sprint list", async () => {
    await setup();
    fire("kanban:sprint:created", { sprint: kSprint("s2", { name: "Sprint 2" }) });
    fire("kanban:sprint:updated", { sprint: kSprint("s2", { name: "Sprint 2b" }) });
    expect(useKanbanStore.getState().board?.sprints.map((s) => s.name)).toEqual([
      "Sprint 1",
      "Sprint 2b",
    ]);
    fire("kanban:sprint:deleted", { sprintId: "s2" });
    expect(useKanbanStore.getState().board?.sprints.map((s) => s.id)).toEqual(["s1"]);
  });

  it.each([
    "kanban:column:created",
    "kanban:column:updated",
    "kanban:column:deleted",
    "kanban:column:reordered",
    "kanban:cards:migrated",
  ])("%s reloads the board for the sprint in view", async (event) => {
    await setup();
    get.mockClear();
    await act(async () => {
      handlers.get(event)?.forEach((h) => h({}));
    });
    // viewSprintId is "backlog" after the first load.
    expect(get).toHaveBeenCalledWith(BOARD_URL, { params: { sprintId: "backlog" } });
  });

  // F-19: the events the backend really emits (kanban.service.js
  // createLabel/updateLabel/deleteLabel, updateProject/addMember/updateMember/
  // removeMember) that the board used to ignore.
  it.each([
    ["kanban:label:created", { label: { id: "lab-2", name: "calibration", color: "#22c55e" } }],
    ["kanban:label:updated", { label: { id: "lab-1", name: "renamed", color: null } }],
    ["kanban:label:deleted", { labelId: "lab-1" }],
    ["kanban:project:updated", { project: { id: "proj-1", name: "Renamed board", myAccess: "owner" } }],
  ])("F-19: %s reloads the board for the sprint in view", async (event, payload) => {
    await setup();
    get.mockClear();
    await act(async () => {
      handlers.get(event)?.forEach((h) => h(payload));
    });
    expect(get).toHaveBeenCalledWith(BOARD_URL, { params: { sprintId: "backlog" } });
  });

  it("F-19: kanban:project:deleted drops the board and says why", async () => {
    const { result } = await setup();
    fire("kanban:project:deleted", { projectId: "proj-1" });
    expect(result.current.board).toBeNull();
    expect(result.current.error).toBe("This board was deleted.");
  });

  it("F-19: kanban:card:relations reaches every subscriber until it unsubscribes", async () => {
    const { result } = await setup();
    const listener = jest.fn();
    const unsubscribe = result.current.subscribeCardRelations(listener);
    const event = {
      cardId: "c1",
      relations: [{ id: "rel-1", type: "blocks", card: { id: "c2", cardKey: "KB-c2", title: "Second", columnId: "col-todo" } }],
    };
    fire("kanban:card:relations", event);
    expect(listener).toHaveBeenCalledWith(event);
    unsubscribe();
    fire("kanban:card:relations", event);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("unmounting unsubscribes every handler and leaves the room", async () => {
    const { unmount } = await setup();
    unmount();
    expect(fakeSocket.emit).toHaveBeenCalledWith("kanban:leave", "proj-1");
    // F-19: the label, project and relations events are among them.
    for (const event of [
      "kanban:label:created",
      "kanban:label:updated",
      "kanban:label:deleted",
      "kanban:project:updated",
      "kanban:project:deleted",
      "kanban:card:relations",
    ])
      expect(fakeSocket.off).toHaveBeenCalledWith(event, expect.any(Function));
    for (const set of handlers.values()) expect(set.size).toBe(0);
  });
});

describe("useBoard — card actions", () => {
  it("createCard POSTs the card and shows the server's copy", async () => {
    const { result } = await setup();
    post.mockResolvedValue(ok(kCard("c4", { title: "Replace probe" }), "Card created"));
    await act(async () => {
      await result.current.createCard({ columnId: "col-todo", title: "Replace probe" });
    });
    expect(post).toHaveBeenCalledWith("/api/v1/kanban/projects/proj-1/cards", {
      columnId: "col-todo",
      title: "Replace probe",
    });
    expect(boardCards()).toContain("c4");
  });

  it("updateCard PATCHes the card", async () => {
    const { result } = await setup();
    patch.mockResolvedValue(ok(kCard("c1", { title: "First, edited" })));
    await act(async () => {
      await result.current.updateCard("c1", { title: "First, edited" });
    });
    expect(patch).toHaveBeenCalledWith("/api/v1/kanban/projects/proj-1/cards/c1", {
      title: "First, edited",
    });
    expect(result.current.board?.cards.find((c) => c.id === "c1")?.title).toBe("First, edited");
  });

  it("deleteCard DELETEs and removes it", async () => {
    const { result } = await setup();
    del.mockResolvedValue(ok({ deleted: true }));
    await act(async () => {
      await result.current.deleteCard("c2");
    });
    expect(del).toHaveBeenCalledWith("/api/v1/kanban/projects/proj-1/cards/c2");
    expect(boardCards()).not.toContain("c2");
  });

  it("a failed create surfaces the backend's refusal to the caller", async () => {
    const { result } = await setup();
    post.mockRejectedValue(httpError(403, "You have view-only access to this board"));
    await expect(
      act(() => result.current.createCard({ columnId: "col-todo", title: "x" })),
    ).rejects.toThrow("You have view-only access to this board");
  });

  it("moveCard moves optimistically, then sends columnId + position to /move", async () => {
    const { result } = await setup();
    let release: (v: unknown) => void = () => undefined;
    patch.mockImplementation(() => new Promise((r) => { release = r; }));
    let pending: Promise<boolean> = Promise.resolve(true);
    act(() => {
      pending = result.current.moveCard("c1", "col-doing", 0);
    });
    // Before the server answers, the card is already in the new column.
    expect(result.current.board?.cards.find((c) => c.id === "c1")?.columnId).toBe("col-doing");
    expect(patch).toHaveBeenCalledWith("/api/v1/kanban/projects/proj-1/cards/c1/move", {
      columnId: "col-doing",
      position: 0,
    });
    await act(async () => {
      release(ok(kCard("c1", { columnId: "col-doing", position: 0 })));
      await pending;
    });
  });

  it("a refused move rolls the card back to the server's truth AND keeps the refusal on screen", async () => {
    // Defect fixed here: the catch set the error and then reloaded, and the
    // reload (fetchBoard) clears the error as it starts — the message vanished.
    const { result } = await setup();
    patch.mockRejectedValue(httpError(404, "Card not found"));
    get.mockClear();
    await act(async () => {
      await result.current.moveCard("c1", "col-doing", 0);
    });
    expect(get).toHaveBeenCalledWith(BOARD_URL, { params: { sprintId: "backlog" } });
    expect(result.current.board?.cards.find((c) => c.id === "c1")?.columnId).toBe("col-todo");
    expect(result.current.error).toBe("Card not found");
  });

  it("a refused move keeps its own message even when the reload fails too", async () => {
    const { result } = await setup();
    patch.mockRejectedValue(httpError(403, "You have view-only access to this board"));
    get.mockRejectedValue(new Error("Network Error"));
    await act(async () => {
      await result.current.moveCard("c1", "col-doing", 0);
    });
    expect(result.current.error).toBe("You have view-only access to this board");
  });
});

describe("useBoard — drag and drop", () => {
  it("dropping before a card sends that card's index as the position", async () => {
    const { result } = await setup();
    patch.mockResolvedValue(ok(kCard("c3", { columnId: "col-todo", position: 1 })));
    act(() => result.current.onCardDragStart("c3"));
    expect(result.current.draggingCardId).toBe("c3");
    await act(async () => {
      result.current.onDropInColumn("col-todo", "c2");
    });
    expect(patch).toHaveBeenCalledWith("/api/v1/kanban/projects/proj-1/cards/c3/move", {
      columnId: "col-todo",
      position: 1,
    });
    expect(result.current.draggingCardId).toBeNull();
  });

  it("dropping on the column itself appends at the end", async () => {
    const { result } = await setup();
    patch.mockResolvedValue(ok(kCard("c3", { columnId: "col-todo", position: 2 })));
    act(() => result.current.onCardDragStart("c3"));
    await act(async () => {
      result.current.onDropInColumn("col-todo");
    });
    expect(patch).toHaveBeenCalledWith(expect.stringContaining("/cards/c3/move"), {
      columnId: "col-todo",
      position: 2,
    });
  });

  it("a drop with nothing being dragged sends nothing; drag end clears the drag", async () => {
    const { result } = await setup();
    act(() => result.current.onCardDragStart("c1"));
    act(() => result.current.onCardDragEnd());
    act(() => result.current.onDropInColumn("col-todo"));
    expect(patch).not.toHaveBeenCalled();
  });
});

describe("useBoard — columns, labels, sprints, members, relations", () => {
  it("column create / rename / delete send their requests and reload", async () => {
    const { result } = await setup();
    post.mockResolvedValue(ok({ id: "col-new" }));
    patch.mockResolvedValue(ok({ id: "col-todo" }));
    del.mockResolvedValue(ok({ deleted: true }));
    get.mockClear();
    await act(async () => {
      await result.current.createColumn("Review");
      await result.current.renameColumn("col-todo", "Backlog items");
      await result.current.deleteColumn("col-doing");
    });
    expect(post).toHaveBeenCalledWith("/api/v1/kanban/projects/proj-1/columns", { name: "Review" });
    expect(patch).toHaveBeenCalledWith("/api/v1/kanban/projects/proj-1/columns/col-todo", {
      name: "Backlog items",
    });
    expect(del).toHaveBeenCalledWith("/api/v1/kanban/projects/proj-1/columns/col-doing");
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("reorderColumns POSTs the order and applies the returned columns", async () => {
    const { result } = await setup();
    const reordered = [
      { id: "col-doing", name: "Doing", position: 0, wipLimit: 2, isDone: false },
      { id: "col-todo", name: "To do", position: 1, wipLimit: null, isDone: false },
      { id: "col-done", name: "Done", position: 2, wipLimit: null, isDone: true },
    ];
    post.mockResolvedValue(ok(reordered));
    await act(async () => {
      await result.current.reorderColumns(["col-doing", "col-todo"]);
    });
    expect(post).toHaveBeenCalledWith("/api/v1/kanban/projects/proj-1/columns/reorder", {
      order: ["col-doing", "col-todo"],
    });
    expect(result.current.columnsSorted.map((c) => c.id)).toEqual(["col-doing", "col-todo", "col-done"]);
  });

  it("label create / delete send their requests", async () => {
    const { result } = await setup();
    post.mockResolvedValue(ok({ id: "lab-2", name: "calibration", color: "#22c55e" }));
    del.mockResolvedValue(ok({ deleted: true }));
    await act(async () => {
      await result.current.createLabel("calibration", "#22c55e");
      await result.current.deleteLabel("lab-1");
    });
    expect(post).toHaveBeenCalledWith("/api/v1/kanban/projects/proj-1/labels", {
      name: "calibration",
      color: "#22c55e",
    });
    expect(del).toHaveBeenCalledWith("/api/v1/kanban/projects/proj-1/labels/lab-1");
  });

  it("sprint create / status change send their requests", async () => {
    const { result } = await setup();
    post.mockResolvedValue(ok(kSprint("s2")));
    patch.mockResolvedValue(ok(kSprint("s1", { status: "completed" })));
    await act(async () => {
      await result.current.createSprint("Sprint 2", "Ship it");
      await result.current.updateSprint("s1", { status: "completed" });
    });
    expect(post).toHaveBeenCalledWith("/api/v1/kanban/projects/proj-1/sprints", {
      name: "Sprint 2",
      goal: "Ship it",
    });
    expect(patch).toHaveBeenCalledWith("/api/v1/kanban/projects/proj-1/sprints/s1", {
      status: "completed",
    });
  });

  it("deleting the sprint in view falls back to the backlog", async () => {
    get.mockResolvedValue(ok(kBoard("owner", { activeSprintId: "s1" })));
    const { result } = await setup();
    expect(result.current.viewSprintId).toBe("s1");
    del.mockResolvedValue(ok({ deleted: true }));
    get.mockResolvedValue(ok(kBoard("owner", { activeSprintId: "backlog" })));
    await act(async () => {
      await result.current.deleteSprint("s1");
    });
    expect(del).toHaveBeenCalledWith("/api/v1/kanban/projects/proj-1/sprints/s1");
    expect(get).toHaveBeenLastCalledWith(BOARD_URL, { params: { sprintId: "backlog" } });
  });

  it("deleting another sprint keeps the view", async () => {
    const { result } = await setup();
    del.mockResolvedValue(ok({ deleted: true }));
    get.mockClear();
    await act(async () => {
      await result.current.deleteSprint("s9");
    });
    expect(get).not.toHaveBeenCalled();
  });

  it("migrateCards POSTs to /sprints/migrate, returns the count and reloads", async () => {
    const { result } = await setup();
    post.mockResolvedValue(ok({ migrated: 2, targetSprintId: "s1" }, "Cards migrated"));
    get.mockClear();
    let res: unknown;
    await act(async () => {
      res = await result.current.migrateCards({ allNotDone: true, targetSprintId: "s1" });
    });
    expect(post).toHaveBeenCalledWith("/api/v1/kanban/projects/proj-1/sprints/migrate", {
      allNotDone: true,
      targetSprintId: "s1",
    });
    expect(res).toEqual({ migrated: 2, targetSprintId: "s1" });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("member add / update / remove send their requests and reload", async () => {
    const { result } = await setup();
    post.mockResolvedValue(ok({ memberId: "m-3", members: [] }));
    patch.mockResolvedValue(ok([]));
    del.mockResolvedValue(ok({ removed: true }));
    await act(async () => {
      await result.current.addMember({ roleId: "r-tech" }, "editor");
      await result.current.updateMember("m-2", "owner");
      await result.current.removeMember("m-2");
    });
    expect(post).toHaveBeenCalledWith("/api/v1/kanban/projects/proj-1/members", {
      roleId: "r-tech",
      accessLevel: "editor",
    });
    expect(patch).toHaveBeenCalledWith("/api/v1/kanban/projects/proj-1/members/m-2", {
      accessLevel: "owner",
    });
    expect(del).toHaveBeenCalledWith("/api/v1/kanban/projects/proj-1/members/m-2");
  });

  it("relation add / remove return the card's relations", async () => {
    const { result } = await setup();
    const rel = [{ id: "rel-1", type: "blocks", card: { id: "c2", cardKey: "KB-c2", title: "Second", columnId: "col-todo" } }];
    post.mockResolvedValue(ok(rel));
    del.mockResolvedValue(ok([]));
    await expect(result.current.addRelation("c1", "c2", "blocks")).resolves.toEqual(rel);
    expect(post).toHaveBeenCalledWith("/api/v1/kanban/projects/proj-1/cards/c1/relations", {
      targetCardId: "c2",
      type: "blocks",
    });
    await expect(result.current.removeRelation("c1", "rel-1")).resolves.toEqual([]);
    expect(del).toHaveBeenCalledWith("/api/v1/kanban/projects/proj-1/cards/c1/relations/rel-1");
  });
});
