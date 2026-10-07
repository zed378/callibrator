"use client";

import React, { useState } from "react";
import { KanbanCard, KanbanColumn } from "@/api/services/kanban.service";
import { Plus, CheckCircle2 } from "lucide-react";
import CardTile from "./CardTile";
import { StatusBadge } from "@/components/ui/StatusBadge";

interface Props {
  column: KanbanColumn;
  cards: KanbanCard[];
  canEdit: boolean;
  draggingCardId: string | null;
  onOpenCard: (cardId: string) => void;
  onCardDragStart: (cardId: string) => void;
  onCardDragEnd: () => void;
  onDropInColumn: (columnId: string, beforeCardId?: string) => void;
  onQuickAdd: (columnId: string, title: string) => void;
  /** Every column of the board, for the cards' keyboard move (WCAG 2.1.1). */
  columns?: KanbanColumn[];
  onMoveCard?: (cardId: string, columnId: string) => void;
}

export default function BoardColumn({
  column,
  cards,
  canEdit,
  draggingCardId,
  onOpenCard,
  onCardDragStart,
  onCardDragEnd,
  onDropInColumn,
  onQuickAdd,
  columns,
  onMoveCard,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [isOver, setIsOver] = useState(false);

  const overLimit = column.wipLimit != null && cards.length > column.wipLimit;

  const submitAdd = () => {
    const t = title.trim();
    if (t) onQuickAdd(column.id, t);
    setTitle("");
    setAdding(false);
  };

  return (
    <div className="flex flex-col w-72 shrink-0">
      <div className="flex items-center justify-between px-2 py-2">
        <div className="flex items-center gap-2">
          {column.isDone && (
            <CheckCircle2 className="h-4 w-4 text-success" />
          )}
          <h3 className="text-sm font-semibold text-foreground">
            {column.name}
          </h3>
          {/* ADR-122 Am. 1: over the WIP limit is a state (attention: shape,
              icon, colour); within it the count is a plain neutral chip. */}
          {overLimit ? (
            <StatusBadge domain="wip" state="over" size="sm">
              {cards.length}
              {`/${column.wipLimit}`}
            </StatusBadge>
          ) : (
            <span className="text-xs rounded-full px-2 py-0.5 bg-muted text-muted-foreground">
              {cards.length}
              {column.wipLimit != null ? `/${column.wipLimit}` : ""}
            </span>
          )}
        </div>
      </div>

      <div
        onDragOver={(e) => {
          if (canEdit && draggingCardId) {
            e.preventDefault();
            setIsOver(true);
          }
        }}
        onDragLeave={() => setIsOver(false)}
        onDrop={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setIsOver(false);
          onDropInColumn(column.id);
        }}
        className={`flex-1 min-h-24 rounded-xl p-2 space-y-2 transition-colors ${
          isOver ? "bg-primary/5 ring-2 ring-primary/30" : "bg-muted/40"
        }`}
      >
        {cards.map((card) => (
          <CardTile
            key={card.id}
            card={card}
            canEdit={canEdit}
            isDragging={draggingCardId === card.id}
            onOpen={() => onOpenCard(card.id)}
            onDragStart={() => onCardDragStart(card.id)}
            onDragEnd={onCardDragEnd}
            onDropBefore={() => onDropInColumn(column.id, card.id)}
            columns={columns}
            onMoveTo={onMoveCard ? (columnId) => onMoveCard(card.id, columnId) : undefined}
          />
        ))}

        {canEdit &&
          (adding ? (
            <div className="rounded-xl border border-border bg-card p-2">
              <textarea
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitAdd();
                  }
                  if (e.key === "Escape") {
                    setAdding(false);
                    setTitle("");
                  }
                }}
                onBlur={submitAdd}
                placeholder="Card title…"
                aria-label="New card title"
                rows={2}
                className="w-full resize-none bg-transparent text-sm text-foreground outline-none"
              />
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex w-full items-center gap-1 rounded-xl px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Plus className="h-4 w-4" /> Add card
            </button>
          ))}
      </div>
    </div>
  );
}
