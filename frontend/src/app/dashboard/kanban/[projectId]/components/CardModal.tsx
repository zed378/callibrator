"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  KanbanBoard,
  KanbanCard,
  RelationType,
  Priority,
  kanbanService,
} from "@/api/services/kanban.service";
import {
  Button,
  Input,
  Textarea,
  Select,
  MultiSelect,
  Badge,
  ConfirmDialog,
} from "@/components/ui";
import {
  attachmentService,
  Attachment,
} from "@/api/services/attachment.service";
import { userService } from "@/api/services/user.service";
import { X, Trash2, Plus, Link2, ImagePlus, Loader2 } from "lucide-react";

const RELATION_LABELS: Record<RelationType, string> = {
  relates_to: "relates to",
  duplicates: "duplicates",
  blocks: "blocks",
  blocked_by: "blocked by",
  parent_of: "parent of",
  child_of: "child of",
};

interface Props {
  isOpen: boolean;
  projectId: string;
  cardId: string | null;
  board: KanbanBoard;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (card: KanbanCard) => void;
  onDeleted: (cardId: string) => void;
}

export default function CardModal({
  isOpen,
  projectId,
  cardId,
  board,
  canEdit,
  onClose,
  onSaved,
  onDeleted,
}: Props) {
  const [card, setCard] = useState<KanbanCard | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const [users, setUsers] = useState<{ value: string; label: string }[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [relTarget, setRelTarget] = useState("");
  const [relType, setRelType] = useState<RelationType>("relates_to");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Card is "loading" until the fetched card matches the requested id.
  const loading = !!cardId && (!card || card.id !== cardId);

  const loadAttachments = useCallback(async (id: string) => {
    try {
      const res = await attachmentService.getAll(1, 50, {
        resourceType: "KanbanCard",
        resourceId: id,
      });
      setAttachments(res.data);
      // Fetch signed URLs for image previews.
      const entries = await Promise.all(
        res.data
          .filter((a) => (a.mimeType || "").startsWith("image/"))
          .map(async (a) => {
            try {
              const s = await attachmentService.getSignedUrl(a.id, 3600);
              return [a.id, s.url] as const;
            } catch {
              return [a.id, ""] as const;
            }
          }),
      );
      setThumbs(Object.fromEntries(entries));
    } catch {
      setAttachments([]);
    }
  }, []);

  // Load the full card (with relations) whenever it opens.
  useEffect(() => {
    if (!isOpen || !cardId) return;
    let active = true;
    (async () => {
      const c = await kanbanService.getCard(projectId, cardId);
      if (!active) return;
      setCard(c);
      setTitle(c.title);
      setDescription(c.description || "");
      await loadAttachments(cardId);
    })();
    return () => {
      active = false;
    };
  }, [isOpen, cardId, projectId, loadAttachments]);

  useEffect(() => {
    if (!isOpen) return;
    userService
      .getAll(1, 100)
      .then((r) =>
        setUsers(
          r.data.map((u) => ({
            value: u.id,
            label:
              [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email,
          })),
        ),
      )
      .catch(() => setUsers([]));
  }, [isOpen]);

  if (!isOpen) return null;

  const patch = async (data: Parameters<typeof kanbanService.updateCard>[2]) => {
    if (!card) return;
    setSaving(true);
    try {
      const updated = await kanbanService.updateCard(projectId, card.id, data);
      setCard((prev) => (prev ? { ...prev, ...updated } : updated));
      onSaved(updated);
    } finally {
      setSaving(false);
    }
  };

  const saveTitle = () => {
    if (card && title.trim() && title !== card.title) patch({ title: title.trim() });
  };
  const saveDescription = () => {
    if (card && description !== (card.description || ""))
      patch({ description });
  };

  const handleDelete = async () => {
    if (!card) return;
    setDeleting(true);
    try {
      await kanbanService.deleteCard(projectId, card.id);
      onDeleted(card.id);
      setConfirmDelete(false);
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !card) return;
    setUploading(true);
    try {
      await attachmentService.upload({
        file,
        resourceType: "KanbanCard",
        resourceId: card.id,
      });
      await loadAttachments(card.id);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeAttachment = async (id: string) => {
    await attachmentService.remove(id);
    if (card) loadAttachments(card.id);
  };

  const addRelation = async () => {
    if (!card || !relTarget) return;
    const relations = await kanbanService.addRelation(projectId, card.id, {
      targetCardId: relTarget,
      type: relType,
    });
    setCard({ ...card, relations });
    setRelTarget("");
  };

  const removeRelation = async (relationId: string) => {
    if (!card) return;
    const relations = await kanbanService.removeRelation(
      projectId,
      card.id,
      relationId,
    );
    setCard({ ...card, relations });
  };

  const assigneeIds = card?.assignees.map((a) => a.id) || [];
  const labelIds = card?.labels.map((l) => l.id) || [];
  const otherCards = board.cards.filter((c) => c.id !== card?.id);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto animate-fade-in">
      <div className="w-full max-w-3xl my-8 bg-card rounded-2xl shadow-2xl animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            {card?.cardKey && (
              <Badge variant="secondary" size="sm">
                {card.cardKey}
              </Badge>
            )}
            <span className="text-sm text-muted-foreground">Card details</span>
          </div>
          <div className="flex items-center gap-2">
            {saving && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Saving…
              </span>
            )}
            {canEdit && card && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                className="text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {loading || !card ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
            {/* Main */}
            <div className="md:col-span-2 p-5 space-y-4 border-r border-border">
              <input
                value={title}
                disabled={!canEdit}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={saveTitle}
                className="w-full text-lg font-semibold bg-transparent outline-none text-foreground border-b border-transparent focus:border-border"
              />

              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Description
                </label>
                <Textarea
                  value={description}
                  disabled={!canEdit}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={saveDescription}
                  rows={5}
                  placeholder="Add more detail…"
                />
              </div>

              {/* Attachments / images */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">
                    Attachments
                  </label>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => fileRef.current?.click()}
                      leftIcon={
                        uploading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ImagePlus className="h-4 w-4" />
                        )
                      }
                    >
                      Upload
                    </Button>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleUpload}
                  />
                </div>
                {attachments.length === 0 ? (
                  <p className="text-xs text-muted-foreground mt-1">
                    No attachments.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {attachments.map((a) => (
                      <div
                        key={a.id}
                        className="relative group rounded-lg border border-border overflow-hidden bg-muted/40 aspect-video flex items-center justify-center"
                      >
                        {thumbs[a.id] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={thumbs[a.id]}
                            alt={a.originalName}
                            className="object-cover w-full h-full"
                          />
                        ) : (
                          <span className="text-[10px] text-muted-foreground px-1 truncate">
                            {a.originalName}
                          </span>
                        )}
                        {canEdit && (
                          <button
                            onClick={() => removeAttachment(a.id)}
                            className="absolute top-1 right-1 bg-black/60 text-white rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Relations */}
              <div>
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Link2 className="h-3 w-3" /> Linked cards
                </label>
                <div className="space-y-1 mt-2">
                  {(card.relations || []).length === 0 && (
                    <p className="text-xs text-muted-foreground">No links.</p>
                  )}
                  {(card.relations || []).map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between text-sm rounded-lg bg-muted/40 px-2 py-1"
                    >
                      <span className="truncate">
                        <span className="text-muted-foreground">
                          {RELATION_LABELS[r.type]}
                        </span>{" "}
                        <span className="font-medium">
                          {r.card?.cardKey ? `${r.card.cardKey} · ` : ""}
                          {r.card?.title || "—"}
                        </span>
                      </span>
                      {canEdit && (
                        <button
                          onClick={() => removeRelation(r.id)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {canEdit && (
                  <div className="grid grid-cols-12 gap-2 mt-2 items-end">
                    <div className="col-span-4">
                      <Select
                        value={relType}
                        onChange={(v) => setRelType(v as RelationType)}
                        options={Object.entries(RELATION_LABELS).map(
                          ([value, label]) => ({ value, label }),
                        )}
                      />
                    </div>
                    <div className="col-span-6">
                      <Select
                        value={relTarget}
                        onChange={setRelTarget}
                        placeholder="Select card…"
                        options={otherCards.map((c) => ({
                          value: c.id,
                          label: `${c.cardKey ? c.cardKey + " · " : ""}${c.title}`,
                        }))}
                      />
                    </div>
                    <div className="col-span-2">
                      <Button
                        variant="secondary"
                        onClick={addRelation}
                        className="w-full"
                        leftIcon={<Plus className="h-4 w-4" />}
                      >
                        Link
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar */}
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Assignees
                </label>
                <MultiSelect
                  options={users}
                  value={assigneeIds}
                  onChange={(ids) => patch({ assigneeIds: ids })}
                  disabled={!canEdit}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Labels
                </label>
                <MultiSelect
                  options={board.labels.map((l) => ({
                    value: l.id,
                    label: l.name,
                  }))}
                  value={labelIds}
                  onChange={(ids) => patch({ labelIds: ids })}
                  disabled={!canEdit}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Priority
                </label>
                <Select
                  value={card.priority || ""}
                  onChange={(v) =>
                    patch({ priority: (v || null) as Priority | null })
                  }
                  disabled={!canEdit}
                  placeholder="None"
                  options={[
                    { value: "", label: "None" },
                    { value: "low", label: "Low" },
                    { value: "medium", label: "Medium" },
                    { value: "high", label: "High" },
                    { value: "urgent", label: "Urgent" },
                  ]}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Sprint
                </label>
                <Select
                  value={card.sprintId || "backlog"}
                  onChange={(v) =>
                    patch({ sprintId: v === "backlog" ? null : v })
                  }
                  disabled={!canEdit}
                  options={[
                    { value: "backlog", label: "Backlog" },
                    ...board.sprints.map((s) => ({
                      value: s.id,
                      label: s.name,
                    })),
                  ]}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Due date
                </label>
                <Input
                  type="date"
                  disabled={!canEdit}
                  value={card.dueDate ? card.dueDate.slice(0, 10) : ""}
                  onChange={(e) =>
                    patch({ dueDate: e.target.value || null })
                  }
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmDelete}
        isLoading={deleting}
        title="Delete this card?"
        description={
          card?.cardKey
            ? `${card.cardKey} — "${card.title}" will be permanently removed. This cannot be undone.`
            : "This card will be permanently removed. This cannot be undone."
        }
        confirmLabel="Delete card"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
