"use client";

import React, { useEffect, useState } from "react";
import { Dialog, Button, Select, Badge } from "@/components/ui";
import { KanbanBoard, AccessLevel } from "@/api/services/kanban.service";
import { userService } from "@/api/services/user.service";
import { roleService } from "@/api/services/role.service";
import { Plus, X } from "lucide-react";

interface Props {
  isOpen: boolean;
  board: KanbanBoard;
  onClose: () => void;
  onAdd: (
    subject: { userId?: string; roleId?: string },
    accessLevel: AccessLevel,
  ) => Promise<void>;
  onUpdate: (memberId: string, accessLevel: AccessLevel) => Promise<void>;
  onRemove: (memberId: string) => Promise<void>;
}

export default function MembersModal({
  isOpen,
  board,
  onClose,
  onAdd,
  onUpdate,
  onRemove,
}: Props) {
  const [users, setUsers] = useState<{ id: string; label: string }[]>([]);
  const [roles, setRoles] = useState<{ id: string; label: string }[]>([]);
  const [subjectType, setSubjectType] = useState<"user" | "role">("user");
  const [subjectId, setSubjectId] = useState("");
  const [level, setLevel] = useState<AccessLevel>("editor");
  const [err, setErr] = useState<string | null>(null);

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

  const guard = async (fn: () => Promise<void>) => {
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed");
    }
  };

  const options = subjectType === "user" ? users : roles;

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Members & access" size="lg">
      <div className="space-y-4">
        {err && (
          <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">
            {err}
          </div>
        )}

        <div className="space-y-1">
          {board.members.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">
                  {m.user
                    ? [m.user.firstName, m.user.lastName]
                        .filter(Boolean)
                        .join(" ") || m.user.email
                    : m.role?.name}
                </span>
                <Badge variant="secondary" size="sm" className="ml-2">
                  {m.role ? "Role" : "User"}
                </Badge>
              </div>
              <div className="w-32">
                <Select
                  value={m.accessLevel}
                  onChange={(v) =>
                    guard(() => onUpdate(m.id, v as AccessLevel))
                  }
                  options={[
                    { value: "viewer", label: "Viewer" },
                    { value: "editor", label: "Editor" },
                    { value: "owner", label: "Owner" },
                  ]}
                />
              </div>
              <button
                onClick={() => guard(() => onRemove(m.id))}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="border-t border-border pt-4">
          <label className="text-sm font-medium">Add member</label>
          <div className="grid grid-cols-12 gap-2 items-end mt-1">
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
                options={options.map((o) => ({ value: o.id, label: o.label }))}
              />
            </div>
            <div className="col-span-2">
              <Select
                value={level}
                onChange={(v) => setLevel(v as AccessLevel)}
                options={[
                  { value: "viewer", label: "Viewer" },
                  { value: "editor", label: "Editor" },
                  { value: "owner", label: "Owner" },
                ]}
              />
            </div>
            <div className="col-span-2">
              <Button
                variant="secondary"
                className="w-full"
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() =>
                  guard(async () => {
                    if (!subjectId) return;
                    await onAdd(
                      subjectType === "user"
                        ? { userId: subjectId }
                        : { roleId: subjectId },
                      level,
                    );
                    setSubjectId("");
                  })
                }
              >
                Add
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
