"use client";

import React, { useState } from "react";
import { Dialog, Button, Input, Textarea } from "@/components/ui";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, goal: string) => Promise<void>;
}

export default function NewSprintModal({ isOpen, onClose, onCreate }: Props) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onCreate(name.trim(), goal.trim());
      setName("");
      setGoal("");
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="New sprint" size="md">
      <form onSubmit={submit} className="space-y-3">
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sprint 2"
          required
        />
        <div>
          <label className="text-sm font-medium">Goal</label>
          <Textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={2}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
