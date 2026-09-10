"use client";

import React, { useState } from "react";
import { Dialog, Button, Input } from "@/components/ui";
import { KanbanBoard } from "@/api/services/kanban.service";
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Lock,
  Check,
  X,
} from "lucide-react";

interface Props {
  isOpen: boolean;
  board: KanbanBoard;
  onClose: () => void;
  onCreateColumn: (name: string) => Promise<void>;
  onRenameColumn: (columnId: string, name: string) => Promise<void>;
  onDeleteColumn: (columnId: string) => Promise<void>;
  onReorderColumns: (order: string[]) => Promise<void>;
  onCreateLabel: (name: string, color: string) => Promise<void>;
  onDeleteLabel: (labelId: string) => Promise<void>;
}

export default function ManageBoardModal({
  isOpen,
  board,
  onClose,
  onCreateColumn,
  onRenameColumn,
  onDeleteColumn,
  onReorderColumns,
  onCreateLabel,
  onDeleteLabel,
}: Props) {
  const [newCol, setNewCol] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [labelName, setLabelName] = useState("");
  const [labelColor, setLabelColor] = useState("#ef4444");
  const [err, setErr] = useState<string | null>(null);

  const columns = board.columns.slice().sort((a, b) => a.position - b.position);
  // Only non-Done columns can be reordered (Done is pinned last server-side).
  const movable = columns.filter((c) => !c.isDone);

  const guard = async (fn: () => Promise<void>) => {
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed");
    }
  };

  const move = (columnId: string, dir: -1 | 1) => {
    const ids = movable.map((c) => c.id);
    const i = ids.indexOf(columnId);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    guard(() => onReorderColumns(ids));
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Manage board" size="lg">
      <div className="space-y-6">
        {err && (
          <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">
            {err}
          </div>
        )}

        {/* Columns */}
        <div>
          <h4 className="text-sm font-semibold mb-2">Columns (flow)</h4>
          <div className="space-y-1">
            {columns.map((c, idx) => (
              <div
                key={c.id}
                className="flex items-center gap-2 rounded-lg bg-muted/40 px-2 py-1.5"
              >
                {editingId === c.id ? (
                  <>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        guard(async () => {
                          await onRenameColumn(c.id, editName.trim());
                          setEditingId(null);
                        })
                      }
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingId(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm flex items-center gap-1">
                      {c.isDone && <Lock className="h-3 w-3 text-muted-foreground" />}
                      {c.name}
                    </span>
                    {!c.isDone && (
                      <>
                        <button
                          onClick={() => move(c.id, -1)}
                          disabled={idx === 0}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => move(c.id, 1)}
                          disabled={idx === movable.length - 1}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => {
                            setEditingId(c.id);
                            setEditName(c.name);
                          }}
                          className="text-xs text-muted-foreground hover:text-foreground px-1"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() =>
                            guard(() => onDeleteColumn(c.id))
                          }
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <Input
              value={newCol}
              onChange={(e) => setNewCol(e.target.value)}
              placeholder="New column name"
              className="flex-1"
            />
            <Button
              variant="secondary"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() =>
                guard(async () => {
                  if (newCol.trim()) {
                    await onCreateColumn(newCol.trim());
                    setNewCol("");
                  }
                })
              }
            >
              Add
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            The Done column is permanent and always stays last.
          </p>
        </div>

        {/* Labels */}
        <div className="border-t border-border pt-4">
          <h4 className="text-sm font-semibold mb-2">Labels</h4>
          <div className="flex flex-wrap gap-2 mb-2">
            {board.labels.length === 0 && (
              <span className="text-xs text-muted-foreground">No labels.</span>
            )}
            {board.labels.map((l) => (
              <span
                key={l.id}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-white"
                style={{ backgroundColor: l.color || "#94a3b8" }}
              >
                {l.name}
                <button onClick={() => guard(() => onDeleteLabel(l.id))}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2 items-center">
            <input
              type="color"
              value={labelColor}
              onChange={(e) => setLabelColor(e.target.value)}
              className="h-9 w-12 rounded border border-border bg-transparent"
            />
            <Input
              value={labelName}
              onChange={(e) => setLabelName(e.target.value)}
              placeholder="Label name"
              className="flex-1"
            />
            <Button
              variant="secondary"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() =>
                guard(async () => {
                  if (labelName.trim()) {
                    await onCreateLabel(labelName.trim(), labelColor);
                    setLabelName("");
                  }
                })
              }
            >
              Add
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
