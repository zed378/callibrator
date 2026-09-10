"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, Button, Input, Select } from "@/components/ui";
import RichTextEditor from "@/components/editor/RichTextEditor";
import { useToastStore } from "@/stores/toastStore";
import {
  ticketService,
  TicketPriority,
  TicketCategory,
} from "@/api/services/ticket.service";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const PRIORITIES: { value: TicketPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const CATEGORIES: { value: TicketCategory; label: string }[] = [
  { value: "support", label: "Support" },
  { value: "bug", label: "Bug" },
  { value: "feature", label: "Feature request" },
  { value: "incident", label: "Incident" },
  { value: "question", label: "Question" },
];

export default function CreateTicketModal({ isOpen, onClose, onCreated }: Props) {
  const router = useRouter();
  const { addToast } = useToastStore();

  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [category, setCategory] = useState<TicketCategory>("support");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setSubject("");
    setDescription("");
    setPriority("medium");
    setCategory("support");
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (subject.trim().length < 3) {
      setError("Subject must be at least 3 characters.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const ticket = await ticketService.create({
        subject: subject.trim(),
        description: description || null,
        priority,
        category,
      });
      reset();
      onClose();
      onCreated();
      addToast({
        type: "success",
        title: "Ticket raised",
        description: `${ticket.ticketKey} — ${ticket.subject}`,
      });
      router.push(`/dashboard/tickets/${ticket.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to raise ticket");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Raise a ticket" size="xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">
            {error}
          </div>
        )}

        <div>
          <label className="text-sm font-medium text-foreground">Subject</label>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Briefly, what's the problem?"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-foreground">
              Priority
            </label>
            <Select
              value={priority}
              onChange={(v) => setPriority(v as TicketPriority)}
              options={PRIORITIES}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">
              Category
            </label>
            <Select
              value={category}
              onChange={(v) => setCategory(v as TicketCategory)}
              options={CATEGORIES}
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-foreground">
            Description
          </label>
          <p className="text-xs text-muted-foreground mb-1.5">
            Add detail, steps to reproduce, and screenshots — paste or drop
            images straight in.
          </p>
          {/* Same TipTap editor the blog uses; images upload to the attachment
              store tagged as a Ticket resource. */}
          <RichTextEditor
            value={description}
            onChange={setDescription}
            imageResourceType="Ticket"
            placeholder="Describe the issue…"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? "Raising…" : "Raise ticket"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
