import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import BoardColumn from "@/app/dashboard/kanban/[projectId]/components/BoardColumn";
import { KanbanCard, KanbanColumn } from "@/api/services/kanban.service";

const column = (over: Partial<KanbanColumn> = {}): KanbanColumn => ({
  id: "col-1",
  name: "To Do",
  position: 0,
  wipLimit: null,
  isDone: false,
  ...over,
});

const card = (over: Partial<KanbanCard> = {}): KanbanCard =>
  ({
    id: "card-1",
    projectId: "p1",
    columnId: "col-1",
    title: "A card",
    position: 0,
    createdAt: "",
    updatedAt: "",
    assignees: [],
    labels: [],
    ...over,
  }) as KanbanCard;

const baseProps = {
  canEdit: true,
  draggingCardId: null as string | null,
  onOpenCard: jest.fn(),
  onCardDragStart: jest.fn(),
  onCardDragEnd: jest.fn(),
  onDropInColumn: jest.fn(),
  onQuickAdd: jest.fn(),
};

describe("BoardColumn", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders the name and card count", () => {
    render(
      <BoardColumn {...baseProps} column={column()} cards={[card()]} />,
    );
    expect(screen.getByText("To Do")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("shows WIP limit and flags an over-limit column", () => {
    render(
      <BoardColumn
        {...baseProps}
        column={column({ wipLimit: 1 })}
        cards={[card({ id: "a" }), card({ id: "b" })]}
      />,
    );
    // count/limit rendered as "2/1"
    expect(screen.getByText("2/1")).toBeInTheDocument();
  });

  it("quick-adds a card on Enter", () => {
    const onQuickAdd = jest.fn();
    render(
      <BoardColumn
        {...baseProps}
        onQuickAdd={onQuickAdd}
        column={column()}
        cards={[]}
      />,
    );
    fireEvent.click(screen.getByText("Add card"));
    const textarea = screen.getByPlaceholderText("Card title…");
    fireEvent.change(textarea, { target: { value: "New task" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onQuickAdd).toHaveBeenCalledWith("col-1", "New task");
  });

  it("does not offer quick-add when read-only", () => {
    render(
      <BoardColumn
        {...baseProps}
        canEdit={false}
        column={column()}
        cards={[]}
      />,
    );
    expect(screen.queryByText("Add card")).not.toBeInTheDocument();
  });

  it("drops a dragged card into the column", () => {
    const onDropInColumn = jest.fn();
    const { container } = render(
      <BoardColumn
        {...baseProps}
        draggingCardId="card-9"
        onDropInColumn={onDropInColumn}
        column={column()}
        cards={[]}
      />,
    );
    // The drop zone is the inner container holding the cards.
    const dropZone = container.querySelector(".min-h-24") as HTMLElement;
    fireEvent.dragOver(dropZone);
    fireEvent.drop(dropZone);
    expect(onDropInColumn).toHaveBeenCalledWith("col-1");
  });
});
