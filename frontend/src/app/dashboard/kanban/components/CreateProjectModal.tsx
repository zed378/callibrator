"use client";

import React, { useEffect, useState } from "react";
import { Dialog, Button, Input, Textarea, Select, Badge } from "@/components/ui";
import { Plus, X } from "lucide-react";
import { MemberInput, AccessLevel } from "@/api/services/kanban.service";
import { userService } from "@/api/services/user.service";
import { roleService } from "@/api/services/role.service";

interface Option {
  id: string;
  label: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  form: {
    name: string;
    code: string;
    description: string;
    color: string;
    members: MemberInput[];
  };
  setForm: React.Dispatch<
    React.SetStateAction<{
      name: string;
      code: string;
      description: string;
      color: string;
      members: MemberInput[];
    }>
  >;
  onSubmit: (e: React.FormEvent) => void;
  submitting: boolean;
  error: string | null;
}

export default function CreateProjectModal({
  isOpen,
  onClose,
  form,
  setForm,
  onSubmit,
  submitting,
  error,
}: Props) {
  const [users, setUsers] = useState<Option[]>([]);
  const [roles, setRoles] = useState<Option[]>([]);
  const [subjectType, setSubjectType] = useState<"user" | "role">("user");
  const [subjectId, setSubjectId] = useState("");
  const [accessLevel, setAccessLevel] = useState<AccessLevel>("editor");

  useEffect(() => {
    if (!isOpen) return;
    userService
      .getAll(1, 100)
      .then((r) =>
        setUsers(
          r.data.map((u) => ({
            id: u.id,
            label:
              [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email,
          })),
        ),
      )
      .catch(() => setUsers([]));
    roleService
      .getAll(1, 100)
      .then((r) =>
        setRoles((r.data || []).map((ro) => ({ id: ro.id, label: ro.name }))),
      )
      .catch(() => setRoles([]));
  }, [isOpen]);

  const nameOf = (m: MemberInput) => {
    if (m.userId) return users.find((u) => u.id === m.userId)?.label || "User";
    return roles.find((r) => r.id === m.roleId)?.label || "Role";
  };

  const addMember = () => {
    if (!subjectId) return;
    const entry: MemberInput =
      subjectType === "user"
        ? { userId: subjectId, accessLevel }
        : { roleId: subjectId, accessLevel };
    // Avoid duplicates.
    const dup = form.members.some((m) =>
      subjectType === "user" ? m.userId === subjectId : m.roleId === subjectId,
    );
    if (dup) return;
    setForm((f) => ({ ...f, members: [...f.members, entry] }));
    setSubjectId("");
  };

  const removeMember = (idx: number) =>
    setForm((f) => ({
      ...f,
      members: f.members.filter((_, i) => i !== idx),
    }));

  const subjectOptions = subjectType === "user" ? users : roles;

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Create Board" size="xl">
      <form onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">
            {error}
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <label className="text-sm font-medium text-foreground">Name</label>
            <Input
              value={form.name}
              onChange={(e) =>
                setForm((f) => ({ ...f, name: e.target.value }))
              }
              placeholder="e.g. Management"
              required
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">
              Code
            </label>
            <Input
              value={form.code}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  code: e.target.value.toUpperCase(),
                }))
              }
              placeholder="MGT"
              maxLength={12}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Card prefix, e.g. MGT-1
            </p>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-foreground">
            Description
          </label>
          <Textarea
            value={form.description}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
            rows={2}
          />
        </div>

        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-foreground">Color</label>
          <input
            type="color"
            value={form.color}
            onChange={(e) =>
              setForm((f) => ({ ...f, color: e.target.value }))
            }
            className="h-9 w-14 rounded border border-border bg-transparent"
          />
        </div>

        {/* Members */}
        <div className="border-t border-border pt-4">
          <label className="text-sm font-medium text-foreground">
            Members & permissions
          </label>
          <p className="text-xs text-muted-foreground mb-2">
            Only listed users/roles (plus you, the owner) can see this board.
          </p>

          <div className="flex flex-wrap gap-2 mb-3">
            {form.members.length === 0 && (
              <span className="text-xs text-muted-foreground">
                No extra members yet.
              </span>
            )}
            {form.members.map((m, idx) => (
              <Badge key={idx} variant="secondary" className="gap-1">
                {m.roleId ? "Role: " : ""}
                {nameOf(m)} · {m.accessLevel}
                <button
                  type="button"
                  onClick={() => removeMember(idx)}
                  className="ml-1 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>

          <div className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-3">
              <Select
                value={subjectType}
                onChange={(v) => {
                  setSubjectType(v as "user" | "role");
                  setSubjectId("");
                }}
                options={[
                  { value: "user", label: "User" },
                  { value: "role", label: "Role" },
                ]}
              />
            </div>
            <div className="col-span-5">
              <Select
                value={subjectId}
                onChange={setSubjectId}
                placeholder={`Select ${subjectType}…`}
                options={subjectOptions.map((o) => ({
                  value: o.id,
                  label: o.label,
                }))}
              />
            </div>
            <div className="col-span-2">
              <Select
                value={accessLevel}
                onChange={(v) => setAccessLevel(v as AccessLevel)}
                options={[
                  { value: "viewer", label: "Viewer" },
                  { value: "editor", label: "Editor" },
                  { value: "owner", label: "Owner" },
                ]}
              />
            </div>
            <div className="col-span-2">
              <Button
                type="button"
                variant="secondary"
                onClick={addMember}
                leftIcon={<Plus className="h-4 w-4" />}
                className="w-full"
              >
                Add
              </Button>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? "Creating…" : "Create Board"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
