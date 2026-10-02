import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import SprintBar from "@/app/dashboard/kanban/[projectId]/components/SprintBar";
import { KanbanBoard } from "@/api/services/kanban.service";

const board = (over: Partial<KanbanBoard> = {}): KanbanBoard =>
  ({
    id: "p1",
    name: "Board",
    myAccess: "owner",
    activeSprintId: "s1",
    columns: [],
    cards: [],
    labels: [],
    sprints: [
      // A board's sprint as kanban.service#getBoard serializes it: no cardCount (A-352).
      {
        id: "s1",
        name: "Sprint 1",
        goal: null,
        status: "active",
        startDate: null,
        endDate: null,
        position: 0,
      },
    ],
    members: [],
    ...over,
  }) as KanbanBoard;

const baseProps = {
  viewSprintId: "s1",
  canEdit: true,
  isOwner: true,
  onSelect: jest.fn(),
  onNewSprint: jest.fn(),
  onMigrate: jest.fn(),
  onSetStatus: jest.fn(),
  onDeleteSprint: jest.fn(),
};

describe("SprintBar", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders sprint chips plus Backlog and All cards", () => {
    render(<SprintBar {...baseProps} board={board()} />);
    expect(screen.getByText("Sprint 1")).toBeInTheDocument();
    expect(screen.getByText("Backlog")).toBeInTheDocument();
    expect(screen.getByText("All cards")).toBeInTheDocument();
    // Active sprint status badge.
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("selects a sprint on chip click", () => {
    const onSelect = jest.fn();
    render(<SprintBar {...baseProps} onSelect={onSelect} board={board()} />);
    fireEvent.click(screen.getByText("Backlog"));
    expect(onSelect).toHaveBeenCalledWith("backlog");
  });

  it("shows owner controls and triggers new-sprint / migrate", () => {
    const onNewSprint = jest.fn();
    const onMigrate = jest.fn();
    render(
      <SprintBar
        {...baseProps}
        onNewSprint={onNewSprint}
        onMigrate={onMigrate}
        board={board()}
      />,
    );
    fireEvent.click(screen.getByText("Sprint"));
    fireEvent.click(screen.getByText("Migrate"));
    expect(onNewSprint).toHaveBeenCalled();
    expect(onMigrate).toHaveBeenCalled();
  });

  it("completes the current sprint from the manage panel", () => {
    const onSetStatus = jest.fn();
    render(
      <SprintBar {...baseProps} onSetStatus={onSetStatus} board={board()} />,
    );
    fireEvent.click(screen.getByText("Manage sprints"));
    fireEvent.click(screen.getByText("Complete"));
    expect(onSetStatus).toHaveBeenCalledWith("s1", "completed");
  });

  it("A-352: a sprint chip shows no card count, even if a stray one rides along", () => {
    // Only GET .../sprints (listSprints) adds cardCount; a count on the board
    // would come from nowhere, so the chip must not print one.
    const withStray = board({
      sprints: [
        { id: "s1", name: "Sprint 1", goal: null, status: "active", startDate: null, endDate: null, position: 0, cardCount: 3 } as KanbanBoard["sprints"][number],
      ],
    });
    render(<SprintBar {...baseProps} board={withStray} />);
    expect(screen.getByRole("button", { name: "Sprint 1" })).toBeInTheDocument();
    expect(screen.queryByText("(3)")).not.toBeInTheDocument();
  });

  it("hides owner-only controls for non-owners", () => {
    render(
      <SprintBar
        {...baseProps}
        isOwner={false}
        canEdit={false}
        board={board()}
      />,
    );
    expect(screen.queryByText("Manage sprints")).not.toBeInTheDocument();
    expect(screen.queryByText("Migrate")).not.toBeInTheDocument();
  });
});
