/**
 * The kanban board page, end to end through the REAL useBoard hook, kanban
 * store and kanban service — `@/api/client` is mocked with backend envelopes
 * (backend/src/controllers/kanban.controller.ts: `success(res, obj)`, the
 * object in `data`). Covers the page and the modals it owns: members, manage
 * board, new sprint, migrate, sprint status/delete, quick add.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Socket } from "socket.io-client";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  };
});

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj-1" }),
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock("@/lib/socket", () => ({
  ...jest.requireActual("@/lib/socket"),
  getSocket: jest.fn(),
}));

import { api } from "@/api/client";
import type { AccessLevel, KanbanBoard } from "@/api/services/kanban.service";
import { getSocket } from "@/lib/socket";
import { useKanbanStore } from "@/stores/kanbanStore";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpErrors";
import { kBoard, kCard, kSprint, ok, rolesEnvelope, usersEnvelope } from "@/tests/support/kanbanFixtures";
import KanbanBoardPage from "../page";

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const patch = api.patch as jest.Mock;
const del = api.delete as jest.Mock;

const P = "/api/v1/kanban/projects/proj-1";

const fakeSocket = { connected: false, emit: jest.fn(), on: jest.fn(), off: jest.fn() };

let board: KanbanBoard | Error = kBoard("owner");

const backend = () => {
  get.mockImplementation(async (url: string, config?: { params?: { sprintId?: string } }) => {
    if (url === P) {
      if (board instanceof Error) throw board;
      const sprintId = config?.params?.sprintId;
      return ok(sprintId ? { ...board, activeSprintId: sprintId } : board, "Project retrieved");
    }
    if (url === `${P}/cards/c1`) return ok(kCard("c1", { title: "First", relations: [] }));
    if (url === "/api/v1/attachments")
      return { success: true, status: 200, message: "ok", data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 1 } };
    if (url === "/api/v1/users/all")
      return usersEnvelope([{ id: "u-2", firstName: "Budi", lastName: "Tech", email: "budi@h.test" }]);
    if (url === "/api/v1/roles") return rolesEnvelope([{ id: "r-nurse", name: "Nurse" }]);
    throw new Error(`unexpected GET ${url}`);
  });
};

const as = (access: AccessLevel, over: Partial<KanbanBoard> = {}) => {
  board = kBoard(access, over);
};

const renderPage = async () => {
  const view = render(<KanbanBoardPage />);
  await screen.findByRole("heading", { name: "Calibration rollout" });
  return view;
};

const pick = async (trigger: HTMLElement, option: string) => {
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: option }));
};

// Multi-step page flows with an axe pass each; under --coverage on a loaded
// machine one can exceed Jest's 5 s default (see jest.setup.ts).
jest.setTimeout(20000);

beforeEach(() => {
  jest.clearAllMocks();
  (getSocket as jest.Mock).mockResolvedValue(fakeSocket as unknown as Socket);
  useKanbanStore.setState({ board: null, error: null, viewSprintId: "", isLoading: false });
  as("owner");
  backend();
});

describe("Kanban board page — states", () => {
  it("shows the loading line, then the board: name, code, description, columns in order, cards", async () => {
    let release: () => void = () => undefined;
    get.mockImplementationOnce(
      (url: string) =>
        new Promise((resolve) => {
          release = () => resolve(ok(kBoard("owner")));
          void url;
        }),
    );
    render(<KanbanBoardPage />);
    expect(await screen.findByText("Loading board…")).toBeInTheDocument();
    await act(async () => release());

    expect(await screen.findByRole("heading", { name: "Calibration rollout" })).toBeInTheDocument();
    expect(screen.getByText("KB")).toBeInTheDocument();
    expect(screen.getByText("Ward 3 device rollout")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "To do",
      "Doing",
      "Done",
    ]);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("In flight")).toBeInTheDocument();
  });

  it("an owner's board passes axe", async () => {
    const { container } = await renderPage();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a board of another tenant (404): the backend's message and 'Board not found.'", async () => {
    board = httpError(404, "Project not found");
    const { container } = render(<KanbanBoardPage />);
    expect(await screen.findByText("Project not found")).toBeInTheDocument();
    expect(screen.getByText("Board not found.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Calibration rollout" })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a viewer has no owner or editor controls", async () => {
    as("viewer");
    const { container } = await renderPage();
    for (const name of ["Members", "Manage", "Manage sprints", "Sprint", "Migrate"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "Add card" })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("an editor can migrate and add cards but not manage the board", async () => {
    as("editor");
    await renderPage();
    expect(screen.getByRole("button", { name: "Migrate" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add card" })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Members" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage" })).not.toBeInTheDocument();
  });

  it("Boards and Analytics navigate", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Analytics" }));
    expect(mockPush).toHaveBeenCalledWith("/dashboard/kanban/proj-1/dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Boards" }));
    expect(mockPush).toHaveBeenCalledWith("/dashboard/kanban");
  });

  it("choosing a sprint chip loads that sprint's cards", async () => {
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "All cards" }));
    });
    expect(get).toHaveBeenLastCalledWith(P, { params: { sprintId: "all" } });
  });

  it("clicking a card opens its detail", async () => {
    await renderPage();
    fireEvent.click(screen.getByText("First"));
    expect(await screen.findByRole("textbox", { name: "Card title" })).toHaveValue("First");
    expect(get).toHaveBeenCalledWith(`${P}/cards/c1`);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("textbox", { name: "Card title" })).not.toBeInTheDocument();
  });
});

describe("Kanban board page — quick add", () => {
  const addTo = async (title: string) => {
    fireEvent.click(screen.getAllByRole("button", { name: "Add card" })[0]);
    const box = screen.getByRole("textbox", { name: "New card title" });
    fireEvent.change(box, { target: { value: title } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
  };

  it("Enter POSTs the card to the column and it appears", async () => {
    await renderPage();
    post.mockResolvedValue(ok(kCard("c9", { title: "Check defib" }), "Card created"));
    await addTo("Check defib");
    expect(post).toHaveBeenCalledWith(`${P}/cards`, { columnId: "col-todo", title: "Check defib" });
    expect(await screen.findByText("Check defib")).toBeInTheDocument();
  });

  it("a refused add is shown on the board", async () => {
    await renderPage();
    post.mockRejectedValue(httpError(403, "You have view-only access to this board"));
    await addTo("Check defib");
    expect(await screen.findByText("You have view-only access to this board")).toBeInTheDocument();
  });
});

describe("Kanban board page — sprints", () => {
  const openSprintControls = async () => {
    as("owner", { activeSprintId: "s1" });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Manage sprints" }));
  };

  it("Complete sends status=completed for the sprint in view", async () => {
    await openSprintControls();
    patch.mockResolvedValue(ok(kSprint("s1", { status: "completed" })));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    });
    expect(patch).toHaveBeenCalledWith(`${P}/sprints/s1`, { status: "completed" });
  });

  it("a refused status change (409) is shown as the backend's explanation", async () => {
    await openSprintControls();
    patch.mockRejectedValue(httpError(409, "Another sprint is already active"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    });
    expect(await screen.findByText("Another sprint is already active")).toBeInTheDocument();
  });

  it("Delete asks first; confirming DELETEs and falls back to the backlog", async () => {
    await openSprintControls();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this sprint?" });
    expect(within(dialog).getByText(/move back to the backlog/)).toBeInTheDocument();
    del.mockResolvedValue(ok({ deleted: true }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete sprint" }));
    });
    expect(del).toHaveBeenCalledWith(`${P}/sprints/s1`);
    expect(get).toHaveBeenLastCalledWith(P, { params: { sprintId: "backlog" } });
  });

  it("a refused sprint delete is shown", async () => {
    await openSprintControls();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    del.mockRejectedValue(httpError(403, "Only the board owner can delete sprints"));
    await act(async () => {
      fireEvent.click(
        within(await screen.findByRole("dialog", { name: "Delete this sprint?" })).getByRole("button", {
          name: "Delete sprint",
        }),
      );
    });
    expect(await screen.findByText("Only the board owner can delete sprints")).toBeInTheDocument();
  });

  it("New sprint POSTs name and goal, trimmed, and closes", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Sprint" }));
    const dialog = await screen.findByRole("dialog", { name: "New sprint" });
    expect(await axeViolations(dialog)).toEqual([]);
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: " Sprint 2 " } });
    fireEvent.change(within(dialog).getByLabelText("Goal"), { target: { value: "Ward 4 " } });
    post.mockResolvedValue(ok(kSprint("s2"), "Sprint created"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    });
    expect(post).toHaveBeenCalledWith(`${P}/sprints`, { name: "Sprint 2", goal: "Ward 4" });
    expect(screen.queryByRole("dialog", { name: "New sprint" })).not.toBeInTheDocument();
  });

  it("a refused new sprint stays open and says why", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Sprint" }));
    const dialog = await screen.findByRole("dialog", { name: "New sprint" });
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: "Sprint 2" } });
    post.mockRejectedValue(httpError(400, "\"name\" length must be at most 80 characters"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    });
    expect(await within(dialog).findByText("\"name\" length must be at most 80 characters")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create" })).toBeEnabled();
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it("New sprint with a blank name sends nothing; Cancel closes", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Sprint" }));
    const dialog = await screen.findByRole("dialog", { name: "New sprint" });
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: "   " } });
    fireEvent.submit(within(dialog).getByRole("button", { name: "Create" }).closest("form") as HTMLFormElement);
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "New sprint" })).not.toBeInTheDocument();
  });
});

describe("Kanban board page — migrate", () => {
  const openMigrate = async (view = "backlog") => {
    as("owner", { activeSprintId: view, sprints: [kSprint("s1", { name: "Sprint 1" }), kSprint("s2", { name: "Sprint 2", position: 1 })] });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Migrate" }));
    return screen.findByRole("dialog", { name: "Migrate cards" });
  };

  it("without a target it asks for one and sends nothing", async () => {
    const dialog = await openMigrate();
    expect(await axeViolations(dialog)).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Migrate" }));
    expect(await within(dialog).findByText("Choose a target sprint.")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("all not-done cards from the sprint in view go to the chosen sprint", async () => {
    const dialog = await openMigrate("s1");
    // The sprint in view is not offered as its own target.
    fireEvent.click(within(dialog).getByRole("button", { name: /Target sprint/ }));
    expect(within(dialog).queryByRole("option", { name: "Sprint 1" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("option", { name: "Sprint 2" }));
    expect(within(dialog).getByText(/\(from this sprint\)/)).toBeInTheDocument();
    post.mockResolvedValue(ok({ migrated: 2, targetSprintId: "s2" }, "Cards migrated"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Migrate" }));
    });
    expect(post).toHaveBeenCalledWith(`${P}/sprints/migrate`, {
      allNotDone: true,
      fromSprintId: "s1",
      targetSprintId: "s2",
    });
    expect(screen.queryByRole("dialog", { name: "Migrate cards" })).not.toBeInTheDocument();
  });

  it("from the backlog view, all not-done cards carry no fromSprintId; Backlog as target is null", async () => {
    const dialog = await openMigrate("backlog");
    await pick(within(dialog).getByRole("button", { name: /Target sprint/ }), "Backlog");
    post.mockResolvedValue(ok({ migrated: 0, targetSprintId: null }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Migrate" }));
    });
    expect(post).toHaveBeenCalledWith(`${P}/sprints/migrate`, {
      allNotDone: true,
      fromSprintId: undefined,
      targetSprintId: null,
    });
  });

  it("selected cards: none chosen is refused locally; chosen ones are sent by id", async () => {
    const dialog = await openMigrate();
    await pick(within(dialog).getByRole("button", { name: /Target sprint/ }), "Sprint 2");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Selected cards" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Migrate" }));
    expect(await within(dialog).findByText("Select at least one card.")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("checkbox", { name: /First/ }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Second/ }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Second/ }));
    post.mockResolvedValue(ok({ migrated: 1, targetSprintId: "s2" }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Migrate" }));
    });
    expect(post).toHaveBeenCalledWith(`${P}/sprints/migrate`, { cardIds: ["c1"], targetSprintId: "s2" });
  });

  it("selected mode on an empty view says there are no cards", async () => {
    as("owner", { cards: [] });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Migrate" }));
    const dialog = await screen.findByRole("dialog", { name: "Migrate cards" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Selected cards" }));
    expect(within(dialog).getByText("No cards in the current view.")).toBeInTheDocument();
  });

  it("a refused migration stays open with the backend's message", async () => {
    const dialog = await openMigrate();
    await pick(within(dialog).getByRole("button", { name: /Target sprint/ }), "Sprint 2");
    post.mockRejectedValue(httpError(409, "Cannot migrate into a completed sprint"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Migrate" }));
    });
    expect(await within(dialog).findByText("Cannot migrate into a completed sprint")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Migrate" })).toBeEnabled();
  });
});

describe("Kanban board page — members", () => {
  const openMembers = async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Members" }));
    const dialog = await screen.findByRole("dialog", { name: "Members & access" });
    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/v1/roles", expect.anything()));
    return dialog;
  };

  it("lists user and role members; passes axe", async () => {
    const dialog = await openMembers();
    expect(within(dialog).getByText("Ana Owner")).toBeInTheDocument();
    expect(within(dialog).getByText("Technician")).toBeInTheDocument();
    const row = (name: string) => within(dialog).getByText(name).parentElement as HTMLElement;
    expect(within(row("Ana Owner")).getByText("User")).toBeInTheDocument();
    expect(within(row("Technician")).getByText("Role")).toBeInTheDocument();
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it("changing a member's access PATCHes it; removing DELETEs it", async () => {
    const dialog = await openMembers();
    patch.mockResolvedValue(ok([]));
    del.mockResolvedValue(ok({ removed: true }));
    // The Technician row's access select shows "Viewer".
    await act(async () => {
      await pick(within(dialog).getByRole("button", { name: "Viewer" }), "Editor");
    });
    expect(patch).toHaveBeenCalledWith(`${P}/members/m-2`, { accessLevel: "editor" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Remove Technician" }));
    });
    expect(del).toHaveBeenCalledWith(`${P}/members/m-2`);
  });

  it("adds a role as a member with the chosen access", async () => {
    const dialog = await openMembers();
    await pick(within(dialog).getByRole("button", { name: "User" }), "Role");
    await pick(within(dialog).getByRole("button", { name: "Select role…" }), "Nurse");
    // The new-member access select defaults to Editor.
    const levels = within(dialog).getAllByRole("button", { name: "Editor" });
    await pick(levels[levels.length - 1], "Viewer");
    post.mockResolvedValue(ok({ memberId: "m-3", members: [] }, "Member added"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    });
    expect(post).toHaveBeenCalledWith(`${P}/members`, { roleId: "r-nurse", accessLevel: "viewer" });
  });

  it("Add with nobody chosen sends nothing", async () => {
    const dialog = await openMembers();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    });
    expect(post).not.toHaveBeenCalled();
  });

  it("a refused change (409, last owner) is shown in the dialog", async () => {
    const dialog = await openMembers();
    patch.mockRejectedValue(httpError(409, "A board must keep at least one owner"));
    await act(async () => {
      await pick(within(dialog).getByRole("button", { name: "Owner" }), "Viewer");
    });
    expect(await within(dialog).findByText("A board must keep at least one owner")).toBeInTheDocument();
    expect(await axeViolations(dialog)).toEqual([]);
  });
});

describe("Kanban board page — manage board", () => {
  const openManage = async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    return screen.findByRole("dialog", { name: "Manage board" });
  };

  it("the Done column is pinned: no move, rename or delete controls; passes axe", async () => {
    const dialog = await openManage();
    expect(within(dialog).queryByRole("button", { name: "Delete column Done" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Move Done up" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Move To do up" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Move Doing down" })).toBeDisabled();
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it("moving a column sends the new order of the movable columns", async () => {
    const dialog = await openManage();
    post.mockResolvedValue(ok(kBoard().columns));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Move To do down" }));
    });
    expect(post).toHaveBeenCalledWith(`${P}/columns/reorder`, { order: ["col-doing", "col-todo"] });
  });

  it("renames a column (trimmed); Cancel abandons the rename", async () => {
    const dialog = await openManage();
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Rename" })[0]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel rename" }));
    expect(within(dialog).queryByRole("textbox", { name: "Rename column To do" })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getAllByRole("button", { name: "Rename" })[0]);
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Rename column To do" }), {
      target: { value: " Queued " },
    });
    patch.mockResolvedValue(ok({ id: "col-todo", name: "Queued" }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save column name" }));
    });
    expect(patch).toHaveBeenCalledWith(`${P}/columns/col-todo`, { name: "Queued" });
    expect(within(dialog).queryByRole("textbox", { name: "Rename column To do" })).not.toBeInTheDocument();
  });

  it("a refused column delete (409, it has cards) is shown", async () => {
    const dialog = await openManage();
    del.mockRejectedValue(httpError(409, "Move this column's cards before deleting it"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete column Doing" }));
    });
    expect(del).toHaveBeenCalledWith(`${P}/columns/col-doing`);
    expect(await within(dialog).findByText("Move this column's cards before deleting it")).toBeInTheDocument();
  });

  it("adds a column and a label; blank names send nothing", async () => {
    const dialog = await openManage();
    const [addColumn, addLabel] = within(dialog).getAllByRole("button", { name: "Add" });
    await act(async () => {
      fireEvent.click(addColumn);
      fireEvent.click(addLabel);
    });
    expect(post).not.toHaveBeenCalled();

    post.mockResolvedValue(ok({ id: "x" }));
    fireEvent.change(within(dialog).getByPlaceholderText("New column name"), { target: { value: " Review " } });
    await act(async () => {
      fireEvent.click(addColumn);
    });
    expect(post).toHaveBeenCalledWith(`${P}/columns`, { name: "Review" });

    fireEvent.change(within(dialog).getByRole("textbox", { name: "Label name" }), { target: { value: "sterile" } });
    fireEvent.change(within(dialog).getByLabelText("Label colour"), { target: { value: "#22c55e" } });
    await act(async () => {
      fireEvent.click(addLabel);
    });
    expect(post).toHaveBeenCalledWith(`${P}/labels`, { name: "sterile", color: "#22c55e" });
  });

  it("deletes a label", async () => {
    const dialog = await openManage();
    del.mockResolvedValue(ok({ deleted: true }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete label urgent-fix" }));
    });
    expect(del).toHaveBeenCalledWith(`${P}/labels/lab-1`);
  });

  it("a board without labels says so", async () => {
    as("owner", { labels: [] });
    const dialog = await openManage();
    expect(within(dialog).getByText("No labels.")).toBeInTheDocument();
  });
});
