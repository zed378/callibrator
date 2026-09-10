"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import {
  Button,
  Card,
  CardContent,
  Alert,
  Select,
  Textarea,
  Avatar,
  ConfirmDialog,
} from "@/components/ui";
import { ArrowLeft, Trash2, Lock, Send, Loader2 } from "lucide-react";
import { useToastStore } from "@/stores/toastStore";
import { ticketService, Ticket } from "@/api/services/ticket.service";
import { userService } from "@/api/services/user.service";
import {
  StatusBadge,
  PriorityBadge,
  userLabel,
} from "../components/ticketBadges";
import { useTicketPov } from "../ticketPov";

function TicketDetailContent() {
  const params = useParams();
  const router = useRouter();
  const ticketId = String(params.ticketId);
  const { addToast } = useToastStore();
  const { isResponder, isSuperAdmin } = useTicketPov();
  // Requesters return to the raise list; responders to the response desk.
  const backHref = isResponder
    ? "/dashboard/tickets/response"
    : "/dashboard/tickets/raise";

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [users, setUsers] = useState<{ value: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [comment, setComment] = useState("");
  const [internal, setInternal] = useState(false);
  const [posting, setPosting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const t = await ticketService.get(ticketId);
      setTicket(t);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ticket not found");
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    let active = true;
    (async () => {
      await Promise.resolve();
      if (active) await load();
    })();
    return () => {
      active = false;
    };
  }, [load]);

  useEffect(() => {
    // Only responders can (re)assign, so only they need the user directory.
    if (!isResponder) return;
    userService
      .getAll(1, 100)
      .then((r) =>
        setUsers([
          { value: "", label: "Unassigned" },
          ...r.data.map((u) => ({
            value: u.id,
            label:
              [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email,
          })),
        ]),
      )
      .catch(() => setUsers([{ value: "", label: "Unassigned" }]));
  }, [isResponder]);

  const patch = async (data: Parameters<typeof ticketService.update>[1]) => {
    try {
      const updated = await ticketService.update(ticketId, data);
      setTicket(updated);
    } catch (e) {
      addToast({
        type: "error",
        title: "Update failed",
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;
    setPosting(true);
    try {
      await ticketService.addComment(ticketId, {
        body: comment.trim(),
        isInternal: internal,
      });
      setComment("");
      setInternal(false);
      await load();
    } catch (err) {
      addToast({
        type: "error",
        title: "Could not post reply",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await ticketService.remove(ticketId);
      addToast({ type: "success", title: "Ticket deleted" });
      router.push(backHref);
    } catch (e) {
      setConfirmDelete(false);
      addToast({
        type: "error",
        title: "Delete failed",
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(backHref)}
          leftIcon={<ArrowLeft className="h-4 w-4" />}
        >
          {isResponder ? "Response desk" : "My tickets"}
        </Button>

        {error && <Alert variant="error">{error}</Alert>}

        {loading || !ticket ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? "Loading…" : "Ticket not found."}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Main */}
            <div className="lg:col-span-2 space-y-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-muted-foreground">
                    {ticket.ticketKey}
                  </span>
                  <StatusBadge status={ticket.status} />
                  <PriorityBadge priority={ticket.priority} />
                </div>
                <h1 className="text-2xl font-extrabold tracking-tight text-foreground mt-1">
                  {ticket.subject}
                </h1>
              </div>

              <Card>
                <CardContent className="p-5">
                  {ticket.description ? (
                    <div
                      className="article-prose max-w-none text-sm"
                      // Description is rich text authored in the ticket editor.
                      dangerouslySetInnerHTML={{ __html: ticket.description }}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No description provided.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Conversation */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">
                  Conversation ({ticket.comments?.length ?? 0})
                </h3>
                <div className="space-y-2">
                  {(ticket.comments ?? []).map((c) => (
                    <Card
                      key={c.id}
                      className={c.isInternal ? "border-warning/40 bg-warning/5" : ""}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-1.5">
                          <Avatar
                            alt={userLabel(c.author)}
                            fallback={userLabel(c.author)}
                            size="sm"
                          />
                          <span className="text-sm font-medium text-foreground">
                            {userLabel(c.author)}
                          </span>
                          {c.isInternal && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-warning">
                              <Lock className="h-3 w-3" /> Internal
                            </span>
                          )}
                          <span className="ml-auto text-xs text-muted-foreground">
                            {new Date(c.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                          {c.body}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                  {(ticket.comments?.length ?? 0) === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No replies yet.
                    </p>
                  )}
                </div>

                {/* Reply box */}
                <form onSubmit={submitComment} className="mt-3 space-y-2">
                  <Textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Write a reply…"
                    rows={3}
                  />
                  <div className="flex items-center justify-between">
                    {isResponder ? (
                      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          checked={internal}
                          onChange={(e) => setInternal(e.target.checked)}
                          className="h-4 w-4 accent-warning"
                        />
                        Internal note (responders only)
                      </label>
                    ) : (
                      <span />
                    )}
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={posting || !comment.trim()}
                      leftIcon={<Send className="h-4 w-4" />}
                    >
                      {posting ? "Posting…" : "Reply"}
                    </Button>
                  </div>
                </form>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              <Card>
                <CardContent className="p-5 space-y-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      Status
                    </label>
                    <Select
                      value={ticket.status}
                      onChange={(v) =>
                        patch({ status: v as Ticket["status"] })
                      }
                      options={[
                        { value: "open", label: "Open" },
                        { value: "in_progress", label: "In progress" },
                        { value: "resolved", label: "Resolved" },
                        { value: "closed", label: "Closed" },
                      ]}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      Priority
                    </label>
                    <Select
                      value={ticket.priority}
                      onChange={(v) =>
                        patch({ priority: v as Ticket["priority"] })
                      }
                      options={[
                        { value: "low", label: "Low" },
                        { value: "medium", label: "Medium" },
                        { value: "high", label: "High" },
                        { value: "urgent", label: "Urgent" },
                      ]}
                    />
                  </div>
                  {isResponder && (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">
                        Assignee
                      </label>
                      <Select
                        value={ticket.assignedTo || ""}
                        onChange={(v) => patch({ assignedTo: v || null })}
                        options={users}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-5 space-y-2 text-sm">
                  {isSuperAdmin && ticket.tenant && (
                    <Row label="Tenant" value={ticket.tenant.name} />
                  )}
                  <Row label="Requester" value={userLabel(ticket.requester)} />
                  <Row
                    label="Category"
                    value={<span className="capitalize">{ticket.category}</span>}
                  />
                  <Row
                    label="Created"
                    value={new Date(ticket.createdAt).toLocaleString()}
                  />
                  {ticket.resolvedAt && (
                    <Row
                      label="Resolved"
                      value={new Date(ticket.resolvedAt).toLocaleString()}
                    />
                  )}
                </CardContent>
              </Card>

              <Button
                variant="outline"
                onClick={() => setConfirmDelete(true)}
                leftIcon={<Trash2 className="h-4 w-4" />}
                className="w-full text-destructive border-destructive/30 hover:border-destructive/50"
              >
                Delete ticket
              </Button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmDelete}
        isLoading={deleting}
        title="Delete this ticket?"
        description={
          ticket
            ? `${ticket.ticketKey} — "${ticket.subject}" and its conversation will be permanently removed. This cannot be undone.`
            : "This cannot be undone."
        }
        confirmLabel="Delete ticket"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
      />
    </DashboardLayout>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground text-right">{value}</span>
    </div>
  );
}

export default function TicketDetailPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <TicketDetailContent />
    </Suspense>
  );
}
