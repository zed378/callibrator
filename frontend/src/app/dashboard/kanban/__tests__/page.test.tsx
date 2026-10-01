/**
 * The kanban boards list and its Create Board modal, through the REAL
 * useKanbanProjects hook, kanban store and kanban/user/role services —
 * `@/api/client` is mocked with backend envelopes (projects: rows in `data`;
 * users: `meta` top-level; roles: top-level `meta` since F-19).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  };
});

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn() },
}));

import { api } from "@/api/client";
import type { KanbanProjectSummary } from "@/api/services/kanban.service";
import { useKanbanStore } from "@/stores/kanbanStore";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError, networkError } from "@/tests/support/httpErrors";
import { kBoard, ok, rolesEnvelope, usersEnvelope } from "@/tests/support/kanbanFixtures";
import KanbanProjectsPage from "../page";

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;

const project = (id: string, over: Partial<KanbanProjectSummary> = {}): KanbanProjectSummary => ({
  id,
  name: `Board ${id}`,
  code: null,
  description: null,
  color: "#4f46e5",
  createdBy: "u-1",
  createdAt: "2026-09-20T08:00:00.000Z",
  cardCount: 0,
  myAccess: "owner",
  ...over,
});

let projects: KanbanProjectSummary[] | Error = [];

// Multi-step page flows with an axe pass each; under --coverage on a loaded
// machine one can exceed Jest's 5 s default (see jest.setup.ts).
jest.setTimeout(20000);

beforeEach(() => {
  jest.clearAllMocks();
  useKanbanStore.setState({ projects: [], error: null, isLoading: false });
  projects = [];
  get.mockImplementation(async (url: string) => {
    if (url === "/api/v1/kanban/projects") {
      if (projects instanceof Error) throw projects;
      return ok(projects, "Projects retrieved");
    }
    if (url === "/api/v1/users/all")
      return usersEnvelope([{ id: "u-2", firstName: "Budi", lastName: "Tech", email: "budi@h.test" }]);
    if (url === "/api/v1/roles") return rolesEnvelope([{ id: "r-nurse", name: "Nurse" }]);
    throw new Error(`unexpected GET ${url}`);
  });
});

const pick = async (trigger: HTMLElement, option: string) => {
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: option }));
};

describe("Kanban boards list", () => {
  it("lists the boards the caller can see and opens one", async () => {
    projects = [
      project("p1", { name: "Calibration rollout", code: "CAL", description: "Ward 3", cardCount: 4, myAccess: "editor" }),
      project("p2", { name: "Audit prep", myAccess: null }),
    ];
    const { container } = render(<KanbanProjectsPage />);
    expect(await screen.findByRole("heading", { name: "Calibration rollout" })).toBeInTheDocument();
    expect(screen.getByText("CAL")).toBeInTheDocument();
    expect(screen.getByText("4 cards")).toBeInTheDocument();
    expect(screen.getByText("editor")).toBeInTheDocument();
    expect(screen.queryByText("No boards yet")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: /Calibration rollout/ }));
    expect(mockPush).toHaveBeenCalledWith("/dashboard/kanban/p1");
  });

  it("with no boards, says so and offers to create the first", async () => {
    const { container } = render(<KanbanProjectsPage />);
    expect(await screen.findByRole("heading", { name: "No boards yet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create First Board" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a failed load shows the error, not the empty state", async () => {
    projects = networkError();
    const { container } = render(<KanbanProjectsPage />);
    expect(await screen.findByText("Network Error")).toBeInTheDocument();
    expect(screen.queryByText("No boards yet")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("Create Board modal", () => {
  const openModal = async () => {
    render(<KanbanProjectsPage />);
    await screen.findByRole("heading", { name: "No boards yet" });
    fireEvent.click(screen.getByRole("button", { name: "New Board" }));
    const dialog = await screen.findByRole("dialog", { name: "Create Board" });
    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/v1/roles", expect.anything()));
    return dialog;
  };

  it("every field is named by its own label (Name was labelling the colour picker)", async () => {
    const dialog = await openModal();
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveAttribute("placeholder", "e.g. Management");
    expect(within(dialog).getByLabelText("Color")).toHaveAttribute("type", "color");
    expect(within(dialog).getByRole("textbox", { name: "Code" })).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Description" })).toBeInTheDocument();
    expect(within(dialog).getByText("No extra members yet.")).toBeInTheDocument();
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it("creates the board with trimmed fields, the upper-cased code and the chosen members, then opens it", async () => {
    const dialog = await openModal();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: " Management " } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Code" }), { target: { value: "mgt" } });
    expect(within(dialog).getByRole("textbox", { name: "Code" })).toHaveValue("MGT");
    fireEvent.change(within(dialog).getByLabelText("Color"), { target: { value: "#22c55e" } });

    // A user as editor (the default level).
    await pick(within(dialog).getByRole("button", { name: "Select user…" }), "Budi Tech");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(within(dialog).getByText(/Budi Tech · editor/)).toBeInTheDocument();
    // Adding the same user again is ignored.
    await pick(within(dialog).getByRole("button", { name: "Select user…" }), "Budi Tech");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(within(dialog).getAllByText(/Budi Tech · editor/)).toHaveLength(1);

    // A role as viewer.
    await pick(within(dialog).getByRole("button", { name: "User" }), "Role");
    await pick(within(dialog).getByRole("button", { name: "Select role…" }), "Nurse");
    await pick(within(dialog).getByRole("button", { name: "Editor" }), "Viewer");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(within(dialog).getByText(/Role: Nurse · viewer/)).toBeInTheDocument();

    post.mockResolvedValue(ok(kBoard("owner", { id: "p-new" }), "Project created"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Create Board" }));
    });
    expect(post).toHaveBeenCalledWith("/api/v1/kanban/projects", {
      name: "Management",
      code: "MGT",
      description: null,
      color: "#22c55e",
      members: [
        { userId: "u-2", accessLevel: "editor" },
        { roleId: "r-nurse", accessLevel: "viewer" },
      ],
    });
    expect(mockPush).toHaveBeenCalledWith("/dashboard/kanban/p-new");
  });

  it("a member can be removed before creating", async () => {
    const dialog = await openModal();
    await pick(within(dialog).getByRole("button", { name: "Select user…" }), "Budi Tech");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove Budi Tech" }));
    expect(within(dialog).getByText("No extra members yet.")).toBeInTheDocument();
  });

  it("Add with nobody chosen adds nothing", async () => {
    const dialog = await openModal();
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(within(dialog).getByText("No extra members yet.")).toBeInTheDocument();
  });

  it("a refused create (409, code taken) stays open and says why", async () => {
    const dialog = await openModal();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: "Management" } });
    post.mockRejectedValue(httpError(409, "A board with code MGT already exists"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Create Board" }));
    });
    expect(await within(dialog).findByText("A board with code MGT already exists")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it("a blank name sends nothing; Cancel closes", async () => {
    const dialog = await openModal();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: "   " } });
    fireEvent.submit(within(dialog).getByRole("button", { name: "Create Board" }).closest("form") as HTMLFormElement);
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Create Board" })).not.toBeInTheDocument();
  });

  it("when the user and role lists cannot be read, the pickers are empty but the form works", async () => {
    get.mockImplementation(async (url: string) => {
      if (url === "/api/v1/kanban/projects") return ok([]);
      throw httpError(403, "Forbidden");
    });
    render(<KanbanProjectsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "New Board" }));
    const dialog = await screen.findByRole("dialog", { name: "Create Board" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Select user…" }));
    expect(await within(dialog).findByText("No options available")).toBeInTheDocument();
  });
});
