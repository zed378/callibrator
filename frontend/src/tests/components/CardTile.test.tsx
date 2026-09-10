import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import CardTile from "@/app/dashboard/kanban/[projectId]/components/CardTile";
import { KanbanCard } from "@/api/services/kanban.service";

const card = (over: Partial<KanbanCard> = {}): KanbanCard =>
  ({
    id: "card-1",
    projectId: "p1",
    columnId: "col-1",
    sprintId: "s1",
    cardKey: "MGT-1",
    title: "Write the SOP",
    description: "details",
    position: 0,
    priority: "high",
    createdAt: "",
    updatedAt: "",
    assignees: [],
    labels: [],
    ...over,
  }) as KanbanCard;

const noop = () => {};

const renderTile = (over: Partial<KanbanCard> = {}, props = {}) =>
  render(
    <CardTile
      card={card(over)}
      canEdit
      isDragging={false}
      onOpen={noop}
      onDragStart={noop}
      onDragEnd={noop}
      onDropBefore={noop}
      {...props}
    />,
  );

describe("CardTile", () => {
  it("renders the title, card key and priority", () => {
    renderTile();
    expect(screen.getByText("Write the SOP")).toBeInTheDocument();
    expect(screen.getByText("MGT-1")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
  });

  it("fires onOpen when clicked", () => {
    const onOpen = jest.fn();
    renderTile({}, { onOpen });
    fireEvent.click(screen.getByText("Write the SOP"));
    expect(onOpen).toHaveBeenCalled();
  });

  it("shows a relation count when the card has links", () => {
    renderTile({
      relations: [
        { id: "r1", type: "blocks", card: null },
        { id: "r2", type: "relates_to", card: null },
      ],
    });
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders a swatch per label and assignee initials", () => {
    const { container } = renderTile({
      labels: [{ id: "l1", name: "bug", color: "#ef4444" }],
      assignees: [
        { id: "u1", firstName: "Ada", lastName: "Lovelace", email: "a@x.io" },
      ],
    });
    // Label swatch carries a title attribute equal to the label name.
    expect(container.querySelector('[title="bug"]')).toBeInTheDocument();
    // Avatar shows initials derived from the name.
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("is draggable only when editing is allowed", () => {
    const { container, rerender } = renderTile();
    expect(container.firstChild).toHaveAttribute("draggable", "true");

    rerender(
      <CardTile
        card={card()}
        canEdit={false}
        isDragging={false}
        onOpen={noop}
        onDragStart={noop}
        onDragEnd={noop}
        onDropBefore={noop}
      />,
    );
    expect(container.firstChild).toHaveAttribute("draggable", "false");
  });

  it("dims while dragging", () => {
    const { container } = renderTile({}, { isDragging: true });
    expect(container.firstChild).toHaveClass("opacity-40");
  });

  it("wires the native drag handlers when editable", () => {
    const onDragStart = jest.fn();
    const onDragEnd = jest.fn();
    const onDropBefore = jest.fn();
    const { container } = renderTile(
      {},
      { onDragStart, onDragEnd, onDropBefore },
    );
    const tile = container.firstChild as HTMLElement;
    fireEvent.dragStart(tile);
    fireEvent.dragOver(tile);
    fireEvent.drop(tile);
    fireEvent.dragEnd(tile);
    expect(onDragStart).toHaveBeenCalled();
    expect(onDragEnd).toHaveBeenCalled();
    expect(onDropBefore).toHaveBeenCalled();
  });

  it("does not drop when editing is disabled", () => {
    const onDropBefore = jest.fn();
    const { container } = render(
      <CardTile
        card={card()}
        canEdit={false}
        isDragging={false}
        onOpen={noop}
        onDragStart={noop}
        onDragEnd={noop}
        onDropBefore={onDropBefore}
      />,
    );
    fireEvent.drop(container.firstChild as HTMLElement);
    expect(onDropBefore).not.toHaveBeenCalled();
  });
});
