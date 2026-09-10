"use client";

import React, { useState } from "react";
import { Dialog, Button, Select } from "@/components/ui";
import { KanbanBoard } from "@/api/services/kanban.service";

interface Props {
  isOpen: boolean;
  board: KanbanBoard;
  viewSprintId: string;
  onClose: () => void;
  onMigrate: (data: {
    cardIds?: string[];
    allNotDone?: boolean;
    fromSprintId?: string | null;
    targetSprintId: string | null;
  }) => Promise<unknown>;
}

export default function MigrateModal({
  isOpen,
  board,
  viewSprintId,
  onClose,
  onMigrate,
}: Props) {
  const [mode, setMode] = useState<"allNotDone" | "selected">("allNotDone");
  const [target, setTarget] = useState<string>("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const doneColumnIds = new Set(
    board.columns.filter((c) => c.isDone).map((c) => c.id),
  );

  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );

  const submit = async () => {
    if (!target) {
      setErr("Choose a target sprint.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const targetSprintId = target === "backlog" ? null : target;
      if (mode === "allNotDone") {
        const fromSprintId =
          viewSprintId === "all" || viewSprintId === "backlog"
            ? undefined
            : viewSprintId;
        await onMigrate({ allNotDone: true, fromSprintId, targetSprintId });
      } else {
        if (selected.length === 0) {
          setErr("Select at least one card.");
          setBusy(false);
          return;
        }
        await onMigrate({ cardIds: selected, targetSprintId });
      }
      onClose();
      setSelected([]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Migration failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Migrate cards" size="lg">
      <div className="space-y-4">
        {err && (
          <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">
            {err}
          </div>
        )}

        <div>
          <label className="text-sm font-medium">Target sprint</label>
          <Select
            value={target}
            onChange={setTarget}
            placeholder="Select target…"
            options={[
              { value: "backlog", label: "Backlog" },
              ...board.sprints
                .filter((s) => s.id !== viewSprintId)
                .map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={mode === "allNotDone"}
              onChange={() => setMode("allNotDone")}
            />
            All cards not in a Done column
            {viewSprintId !== "all" && viewSprintId !== "backlog"
              ? " (from this sprint)"
              : ""}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={mode === "selected"}
              onChange={() => setMode("selected")}
            />
            Selected cards
          </label>
        </div>

        {mode === "selected" && (
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
            {board.cards.length === 0 && (
              <p className="text-sm text-muted-foreground p-3">
                No cards in the current view.
              </p>
            )}
            {board.cards.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  onChange={() => toggle(c.id)}
                />
                <span className="font-medium">
                  {c.cardKey ? `${c.cardKey} · ` : ""}
                </span>
                <span className="truncate">{c.title}</span>
                {doneColumnIds.has(c.columnId) && (
                  <span className="ml-auto text-xs text-success">Done</span>
                )}
              </label>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            {busy ? "Migrating…" : "Migrate"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
