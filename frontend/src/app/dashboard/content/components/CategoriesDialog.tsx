"use client";

import React, { useEffect, useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Dialog, Button, Input, Badge } from "@/components/ui";
import { useToastStore } from "@/stores/toastStore";
import { contentService, type Category } from "@/api/services/content.service";

export default function CategoriesDialog({
  isOpen,
  onClose,
  onChanged,
}: {
  isOpen: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const addToast = useToastStore((s) => s.addToast);
  const [cats, setCats] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const load = () => contentService.categories.getAll().then(setCats).catch(() => {});
  useEffect(() => {
    if (isOpen) load();
  }, [isOpen]);

  const fail = (e: unknown, fallback: string) =>
    addToast({ type: "error", title: e instanceof Error ? e.message : fallback });

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await contentService.categories.create({ name: name.trim() });
      setName("");
      await load();
      onChanged?.();
    } catch (e) {
      fail(e, "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await contentService.categories.update(editing.id, { name: editing.name });
      setEditing(null);
      await load();
      onChanged?.();
    } catch (e) {
      fail(e, "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await contentService.categories.remove(id);
      await load();
      onChanged?.();
    } catch (e) {
      fail(e, "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Manage categories" size="md">
      <div className="space-y-4">
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New category name"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                create();
              }
            }}
          />
          <Button onClick={create} isLoading={busy} className="shrink-0">
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <ul className="divide-y divide-border rounded-xl border border-border">
          {cats.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              No categories yet.
            </li>
          )}
          {cats.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-4 py-2.5">
              {editing?.id === c.id ? (
                <>
                  <input
                    autoFocus
                    className="flex-1 rounded-lg bg-muted px-3 py-1.5 text-sm ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-ring/50"
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  />
                  <button onClick={saveEdit} className="rounded-lg p-1.5 text-success hover:bg-muted">
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setEditing(null)}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-foreground">{c.name}</span>
                  <Badge variant="default" size="sm">
                    {c.slug}
                  </Badge>
                  <button
                    onClick={() => setEditing({ id: c.id, name: c.name })}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => remove(c.id)}
                    className="rounded-lg p-1.5 text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
