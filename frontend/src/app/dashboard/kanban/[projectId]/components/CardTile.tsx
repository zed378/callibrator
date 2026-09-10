"use client";

import React from "react";
import { KanbanCard } from "@/api/services/kanban.service";
import { Avatar } from "@/components/ui";
import { Link2, MessageSquare } from "lucide-react";

const PRIORITY_STYLES: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-info/10 text-info",
  high: "bg-warning/10 text-warning",
  urgent: "bg-destructive/10 text-destructive",
};

interface Props {
  card: KanbanCard;
  canEdit: boolean;
  isDragging: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropBefore: () => void;
}

export default function CardTile({
  card,
  canEdit,
  isDragging,
  onOpen,
  onDragStart,
  onDragEnd,
  onDropBefore,
}: Props) {
  return (
    <div
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        if (canEdit) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        e.stopPropagation();
        onDropBefore();
      }}
      onClick={onOpen}
      className={`rounded-xl border border-border bg-card p-3 shadow-sm hover:shadow-md transition-all cursor-pointer ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      {card.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {card.labels.map((l) => (
            <span
              key={l.id}
              className="h-2 w-8 rounded-full"
              style={{ backgroundColor: l.color || "#94a3b8" }}
              title={l.name}
            />
          ))}
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground line-clamp-3">
          {card.title}
        </p>
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-2">
          {card.cardKey && (
            <span className="text-[11px] font-semibold text-muted-foreground">
              {card.cardKey}
            </span>
          )}
          {card.priority && (
            <span
              className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                PRIORITY_STYLES[card.priority] || ""
              }`}
            >
              {card.priority}
            </span>
          )}
          {card.relations && card.relations.length > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
              <Link2 className="h-3 w-3" />
              {card.relations.length}
            </span>
          )}
          {card.description && (
            <MessageSquare className="h-3 w-3 text-muted-foreground" />
          )}
        </div>
        <div className="flex -space-x-2">
          {card.assignees.slice(0, 3).map((a) => {
            const label =
              [a.firstName, a.lastName].filter(Boolean).join(" ") || a.email;
            return (
              <Avatar key={a.id} alt={label} fallback={label} size="sm" />
            );
          })}
        </div>
      </div>
    </div>
  );
}
