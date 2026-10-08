"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
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
  Alert,
} from "@/components/ui";
import {
  attachmentService,
  Attachment,
} from "@/api/services/attachment.service";
import { userService } from "@/api/services/user.service";
import { useModalA11y } from "@/components/ui/useModalA11y";
import type { CardRelationsListener } from "../hooks/useBoard";
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
  /**
   * Live `kanban:card:relations` events for the board (useBoard's
   * subscribeCardRelations). Optional: without it the links refresh only on
   * this user's own changes.
   */
  subscribeRelations?: (listener: CardRelationsListener) => () => void;
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
  subscribeRelations,
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
  // A refused or failed action is shown, never dropped (it used to reject
  // unhandled: the edit looked saved, the card stayed "Loading…").
  const [error, setError] = useState<string | null>(null);
  const failed = (e: unknown, fallback: string) =>
    setError(e instanceof Error ? e.message : fallback);

  // F-19: a real modal dialog — named by the card's title, focus moved in and
  // trapped, Escape closes, focus returns to the opener (useModalA11y). While
  // the delete confirmation is open, Escape belongs to it: it closes the
  // confirmation, not the card.
  const titleId = useId();
  const panelRef = useModalA11y<HTMLDivElement>(isOpen, () => {
    if (!confirmDelete) onClose();
  });

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
              // A-365: no lifetime — the server default (300 s) is ample for a
              // thumbnail the browser loads at once; above the cap is a 400.
              const s = await attachmentService.getSignedUrl(a.id);
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
      let c: KanbanCard;
      try {
        c = await kanbanService.getCard(projectId, cardId);
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : "Failed to load the card");
        return;
      }
      if (!active) return;
      setError(null);
      setCard(c);
      setTitle(c.title);
      setDescription(c.description || "");
      await loadAttachments(cardId);
    })();
    return () => {
      active = false;
    };
  }, [isOpen, cardId, projectId, loadAttachments]);

  // F-19: links changed by anyone on the board. The event names the SOURCE
  // card; the card at the other end of the link changed too (its mirror row),
  // so an open card that the event's card links to — or linked to before the
  // change — reloads its own links.
  useEffect(() => {
    if (!isOpen || !cardId || !subscribeRelations) return;
    let active = true;
    const unsubscribe = subscribeRelations(({ cardId: changed, relations }) => {
      if (changed === cardId) {
        setCard((prev) => (prev && prev.id === cardId ? { ...prev, relations } : prev));
        return;
      }
      const linkedNow = relations.some((r) => r.card?.id === cardId);
      const linkedBefore = (card?.relations || []).some((r) => r.card?.id === changed);
      if (!linkedNow && !linkedBefore) return;
      kanbanService
        .getCard(projectId, cardId)
        .then((fresh) => {
          if (!active) return;
          setCard((prev) =>
            prev && prev.id === fresh.id ? { ...prev, relations: fresh.relations } : prev,
          );
        })
        .catch((e: unknown) => {
          if (active)
            setError(e instanceof Error ? e.message : "Failed to refresh the card's links");
        });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [isOpen, cardId, projectId, subscribeRelations, card?.relations]);

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
    setError(null);
    try {
      const updated = await kanbanService.updateCard(projectId, card.id, data);
      setCard((prev) => (prev ? { ...prev, ...updated } : updated));
      onSaved(updated);
    } catch (e) {
      failed(e, "Failed to save the card");
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
    } catch (e) {
      setConfirmDelete(false);
      failed(e, "Failed to delete the card");
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
    } catch (e) {
      failed(e, "Failed to upload the file");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeAttachment = async (id: string) => {
    try {
      await attachmentService.remove(id);
    } catch (e) {
      failed(e, "Failed to remove the attachment");
      return;
    }
    if (card) loadAttachments(card.id);
  };

  const addRelation = async () => {
    if (!card || !relTarget) return;
    try {
      const relations = await kanbanService.addRelation(projectId, card.id, {
        targetCardId: relTarget,
        type: relType,
      });
      setCard({ ...card, relations });
      setRelTarget("");
    } catch (e) {
      failed(e, "Failed to link the card");
    }
  };

  const removeRelation = async (relationId: string) => {
    if (!card) return;
    try {
      const relations = await kanbanService.removeRelation(
        projectId,
        card.id,
        relationId,
      );
      setCard({ ...card, relations });
    } catch (e) {
      failed(e, "Failed to remove the link");
    }
  };

  const assigneeIds = card?.assignees.map((a) => a.id) || [];
  const labelIds = card?.labels.map((l) => l.id) || [];
  const otherCards = board.cards.filter((c) => c.id !== card?.id);

  return (
    // The dialog element is the overlay, not the card panel, so the delete
    // confirmation (a dialog of its own, rendered last) is inside the focus
    // trap rather than locked out of it.
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="fixed inset-0 bg-scrim backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto animate-fade-in focus:outline-none"
    >
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
            <h2 id={titleId} className="sr-only">
              {card && card.id === cardId
                ? `${card.cardKey ? `${card.cardKey} ` : ""}${card.title}`
                : "Card details"}
            </h2>
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
                aria-label="Delete card"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        {error && (
          <div className="px-5 pt-4">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        {loading || !card ? (
          !error && (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          )
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
            {/* Main */}
            <div className="md:col-span-2 p-5 space-y-4 border-r border-border">
              <input
                value={title}
                aria-label="Card title"
                disabled={!canEdit}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={saveTitle}
                className="w-full text-lg font-semibold bg-transparent outline-none text-foreground border-b border-transparent focus:border-border"
              />

              <div>
                <label htmlFor="kanban-projectid-components-cardmodal-f1" className="text-xs font-medium text-muted-foreground">
                  Description
                </label>
                <Textarea id="kanban-projectid-components-cardmodal-f1"
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
                    aria-label="Upload an image to this card"
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
                            aria-label={`Remove attachment ${a.originalName}`}
                            className="absolute top-1 right-1 bg-scrim text-scrim-foreground rounded p-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
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
                          aria-label={`Remove relation to ${r.card?.cardKey || r.card?.title || "card"}`}
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
                <label
                  htmlFor="card-assignees"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Assignees
                </label>
                <MultiSelect
                  id="card-assignees"
                  options={users}
                  value={assigneeIds}
                  onChange={(ids) => patch({ assigneeIds: ids })}
                  disabled={!canEdit}
                />
              </div>

              <div>
                <label
                  htmlFor="card-labels"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Labels
                </label>
                <MultiSelect
                  id="card-labels"
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
                <label htmlFor="kanban-projectid-components-cardmodal-f2" className="text-xs font-medium text-muted-foreground">
                  Priority
                </label>
                <Select id="kanban-projectid-components-cardmodal-f2"
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
                <label htmlFor="kanban-projectid-components-cardmodal-f3" className="text-xs font-medium text-muted-foreground">
                  Sprint
                </label>
                <Select id="kanban-projectid-components-cardmodal-f3"
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
                <label htmlFor="kanban-projectid-components-cardmodal-f4" className="text-xs font-medium text-muted-foreground">
                  Due date
                </label>
                <Input id="kanban-projectid-components-cardmodal-f4"
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
