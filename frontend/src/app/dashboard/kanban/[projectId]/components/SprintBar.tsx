"use client";

import React, { useState } from "react";
import { KanbanBoard, SprintStatus } from "@/api/services/kanban.service";
import { Button, Badge } from "@/components/ui";
import { Plus, ArrowRightLeft, Play, CheckCheck, Trash2 } from "lucide-react";

interface Props {
  board: KanbanBoard;
  viewSprintId: string;
  canEdit: boolean;
  isOwner: boolean;
  onSelect: (sprintId: string) => void;
  onNewSprint: () => void;
  onMigrate: () => void;
  onSetStatus: (sprintId: string, status: SprintStatus) => void;
  onDeleteSprint: (sprintId: string) => void;
}

const STATUS_VARIANT: Record<SprintStatus, "success" | "info" | "default"> = {
  active: "success",
  planned: "info",
  completed: "default",
};

export default function SprintBar({
  board,
  viewSprintId,
  canEdit,
  isOwner,
  onSelect,
  onNewSprint,
  onMigrate,
  onSetStatus,
  onDeleteSprint,
}: Props) {
  const [manage, setManage] = useState(false);
  const current = board.sprints.find((s) => s.id === viewSprintId);

  const chip = (id: string, label: string, count?: number) => (
    <button
      key={id}
      onClick={() => onSelect(id)}
      className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors ${
        viewSprintId === id
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:bg-muted/70"
      }`}
    >
      {label}
      {count != null && (
        <span className="ml-1 opacity-70">({count})</span>
      )}
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {board.sprints
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((s) => chip(s.id, s.name, s.cardCount))}
        {chip("backlog", "Backlog")}
        {chip("all", "All cards")}

        <div className="ml-auto flex items-center gap-2 shrink-0">
          {current && (
            <Badge variant={STATUS_VARIANT[current.status]} size="sm">
              {current.status}
            </Badge>
          )}
          {isOwner && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setManage((m) => !m)}
            >
              Manage sprints
            </Button>
          )}
          {isOwner && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onNewSprint}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              Sprint
            </Button>
          )}
          {canEdit && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onMigrate}
              leftIcon={<ArrowRightLeft className="h-4 w-4" />}
            >
              Migrate
            </Button>
          )}
        </div>
      </div>

      {manage && isOwner && current && (
        <div className="flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium">{current.name}</span>
          {current.status !== "active" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSetStatus(current.id, "active")}
              leftIcon={<Play className="h-3 w-3" />}
            >
              Activate
            </Button>
          )}
          {current.status !== "completed" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSetStatus(current.id, "completed")}
              leftIcon={<CheckCheck className="h-3 w-3" />}
            >
              Complete
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive ml-auto"
            onClick={() => onDeleteSprint(current.id)}
            leftIcon={<Trash2 className="h-3 w-3" />}
          >
            Delete
          </Button>
        </div>
      )}
    </div>
  );
}
