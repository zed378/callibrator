/**
 * Board analytics: GET /kanban/projects/:id/metrics (scoped by sprintId) and
 * GET /kanban/projects/:id/sprints, through the REAL kanban service —
 * `@/api/client` mocked with the backend's `success()` envelope
 * (backend/src/services/kanban.service.js getMetrics / listSprints).
 */
import { act, fireEvent, render, screen } from "@testing-library/react";

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

jest.mock("@/api/client", () => ({ api: { get: jest.fn() } }));

import { api } from "@/api/client";
import type { KanbanMetrics } from "@/api/services/kanban.service";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpErrors";
import { kSprint, ok } from "@/tests/support/kanbanFixtures";
import KanbanDashboardPage from "../page";

const get = api.get as jest.Mock;
const P = "/api/v1/kanban/projects/proj-1";

const metrics = (over: Partial<KanbanMetrics["summary"]> = {}, rest: Partial<KanbanMetrics> = {}): KanbanMetrics => ({
  view: "all",
  summary: {
    total: 10,
    done: 4,
    inProgress: 3,
    completionRate: 40,
    overdue: 2,
    unassigned: 1,
    columns: 3,
    sprints: 1,
    ...over,
  },
  byColumn: [
    { columnId: "col-todo", name: "To do", isDone: false, wipLimit: null, count: 3, overWip: false },
    { columnId: "col-doing", name: "Doing", isDone: false, wipLimit: 2, count: 3, overWip: true },
    { columnId: "col-done", name: "Done", isDone: true, wipLimit: null, count: 4, overWip: false },
  ],
  byPriority: [
    { priority: "urgent", count: 1 },
    { priority: "none", count: 9 },
  ],
  byAssignee: [{ userId: "u-1", name: "Ana Owner", count: 9 }],
  byLabel: [],
  bySprint: [
    { sprintId: "s1", name: "Sprint 1", status: "active", count: 6 },
    { sprintId: null, name: "Backlog", status: null, count: 4 },
  ],
  ...rest,
});

let answer: (sprintId?: string) => Promise<unknown>;

// Multi-step page flows with an axe pass each; under --coverage on a loaded
// machine one can exceed Jest's 5 s default (see jest.setup.ts).
jest.setTimeout(20000);

beforeEach(() => {
  jest.clearAllMocks();
  answer = async () => ok(metrics(), "Metrics retrieved");
  get.mockImplementation(async (url: string, config?: { params?: { sprintId?: string } }) => {
    if (url === `${P}/sprints`) return ok({ sprints: [kSprint("s1", { name: "Sprint 1" })], backlogCount: 4 });
    if (url === `${P}/metrics`) return answer(config?.params?.sprintId);
    throw new Error(`unexpected GET ${url}`);
  });
});

describe("Kanban board analytics", () => {
  it("shows the KPI tiles, progress and distributions for the whole board", async () => {
    const { container } = render(<KanbanDashboardPage />);
    expect(screen.getByText("Loading metrics…")).toBeInTheDocument();
    expect(await screen.findByText("4 of 10 cards done · 3 columns · 1 sprints")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(`${P}/metrics`, { params: undefined });
    expect(screen.getByText("across the board", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("WIP!")).toBeInTheDocument();
    expect(screen.getByText("Ana Owner")).toBeInTheDocument();
    expect(screen.getByText("No labels.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cards by sprint" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("an empty board shows each distribution's empty text and no sprint breakdown", async () => {
    answer = async () =>
      ok(
        metrics(
          { total: 0, done: 0, inProgress: 0, completionRate: 0, overdue: 0, unassigned: 0 },
          { byColumn: [], byPriority: [], byAssignee: [], byLabel: [], bySprint: [] },
        ),
      );
    render(<KanbanDashboardPage />);
    expect(await screen.findByText("No assigned cards.")).toBeInTheDocument();
    expect(screen.getAllByText("No data.")).toHaveLength(2);
    expect(screen.queryByRole("heading", { name: "Cards by sprint" })).not.toBeInTheDocument();
  });

  it("choosing a sprint scopes the metrics to it", async () => {
    render(<KanbanDashboardPage />);
    await screen.findByText("4 of 10 cards done · 3 columns · 1 sprints");
    answer = async (sprintId) => ok(metrics({ total: sprintId === "s1" ? 6 : 10, done: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "All cards" }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "Sprint 1" }));
    });
    expect(get).toHaveBeenLastCalledWith(`${P}/metrics`, { params: { sprintId: "s1" } });
    expect(await screen.findByText("1 of 6 cards done · 3 columns · 1 sprints")).toBeInTheDocument();
    expect(screen.getByText("for the selected sprint", { exact: false })).toBeInTheDocument();
  });

  it("a board of another tenant (404) shows the backend's message and no metrics", async () => {
    answer = async () => {
      throw httpError(404, "Project not found");
    };
    const { container } = render(<KanbanDashboardPage />);
    expect(await screen.findByText("Project not found")).toBeInTheDocument();
    expect(screen.getByText("No metrics available.")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("Board goes back to the board", async () => {
    render(<KanbanDashboardPage />);
    await screen.findByText("4 of 10 cards done · 3 columns · 1 sprints");
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    expect(mockPush).toHaveBeenCalledWith("/dashboard/kanban/proj-1");
  });
});
