/**
 * Kanban — moving a card between columns without dragging (WCAG 2.1.1,
 * audit 01 §4.5): each card an editor sees carries a "Move to…" select
 * listing the other columns; choosing one moves the card to the end of that
 * column (PATCH …/cards/:id/move) and the page announces it in a polite live
 * region (WCAG 4.1.3). The card's title is a button, so a card opens from the
 * keyboard too. A viewer gets no move control.
 *
 * Fail-before: drag only — no keyboard path at all; the card opened on a
 * mouse click on a <div>.
 *
 * Same wiring as page.test.tsx: REAL useBoard, store and service; the client
 * mocked with backend envelopes.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { kBoard, kCard, ok, rolesEnvelope, usersEnvelope } from "@/tests/support/kanbanFixtures";
import KanbanBoardPage from "../page";

const get = api.get as jest.Mock;
const patch = api.patch as jest.Mock;

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

describe("Kanban — keyboard move (WCAG 2.1.1)", () => {
  it("an editor moves a card to another column from its select, and the move is announced", async () => {
    patch.mockResolvedValue(ok(kCard("c1", { title: "First", columnId: "col-doing", position: 1 })));
    const { container } = await renderPage();

    const move = screen.getByRole("combobox", { name: 'Move "First" to column' });
    // Its own column is not offered.
    expect(within(move).getAllByRole("option").map((o) => o.textContent)).toEqual(["Move to…", "Doing", "Done"]);
    fireEvent.change(move, { target: { value: "col-doing" } });

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(`${P}/cards/c1/move`, { columnId: "col-doing", position: 1 }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent('Moved "First" to Doing.');
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a refused move is not announced as done; the error is shown", async () => {
    patch.mockRejectedValue(httpError(403, "You are a viewer on this board"));
    await renderPage();
    fireEvent.change(screen.getByRole("combobox", { name: 'Move "First" to column' }), {
      target: { value: "col-done" },
    });
    expect(await screen.findByText("You are a viewer on this board")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("a viewer has no move control; the card still opens from its title button", async () => {
    as("viewer");
    await renderPage();
    expect(screen.queryByRole("combobox", { name: /to column/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "First" }));
    await waitFor(() => expect(get).toHaveBeenCalledWith(`${P}/cards/c1`));
  });
});
