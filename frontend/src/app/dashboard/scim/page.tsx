// src/app/dashboard/scim/page.tsx
"use client";

import React, { useCallback, useEffect, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  FormField,
  Input,
  Table,
} from "@/components/ui";
import { Search, Trash2, UserCheck, UserX, Users } from "lucide-react";
import {
  scimService,
  emailFilter,
  type ScimGroup,
  type ScimUser,
} from "@/api/services/scim.service";
import { useToastStore } from "@/stores/toastStore";

type Tab = "users" | "groups";

const PAGE_SIZE = 25;

const fmt = (value?: string) =>
  value ? new Date(value).toLocaleDateString() : "—";

export default function ScimPage() {
  const addToast = useToastStore((s) => s.addToast);

  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<ScimUser[]>([]);
  const [groups, setGroups] = useState<ScimGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [startIndex, setStartIndex] = useState(1);
  const [search, setSearch] = useState("");
  const [appliedFilter, setAppliedFilter] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<{
    kind: Tab;
    id: string;
    label: string;
  } | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (tab === "users") {
        const res = await scimService.getUsers({
          startIndex,
          count: PAGE_SIZE,
          filter: appliedFilter,
        });
        setUsers(res.Resources ?? []);
        setTotal(res.totalResults ?? 0);
      } else {
        const res = await scimService.getGroups({
          startIndex,
          count: PAGE_SIZE,
        });
        setGroups(res.Resources ?? []);
        setTotal(res.totalResults ?? 0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load SCIM data");
    } finally {
      setIsLoading(false);
    }
  }, [tab, startIndex, appliedFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const switchTab = (next: Tab) => {
    setTab(next);
    setStartIndex(1);
    setSearch("");
    setAppliedFilter(undefined);
  };

  const applySearch = () => {
    const term = search.trim();
    // The backend only parses exact `email eq "..."`, so a partial term
    // would silently return everything — be explicit about that.
    setAppliedFilter(term ? emailFilter(term) : undefined);
    setStartIndex(1);
  };

  const toggleActive = async (user: ScimUser) => {
    setBusy(user.id);
    try {
      if (user.active) {
        await scimService.deactivateUser(user.id);
        addToast({ type: "success", title: `${user.userName} deactivated` });
      } else {
        await scimService.activateUser(user.id);
        addToast({ type: "success", title: `${user.userName} activated` });
      }
      await load();
    } catch (err) {
      addToast({
        type: "error",
        title: "Update failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirmDelete) return;
    setBusy("delete");
    try {
      if (confirmDelete.kind === "users") {
        await scimService.deleteUser(confirmDelete.id);
      } else {
        await scimService.deleteGroup(confirmDelete.id);
      }
      addToast({ type: "success", title: "Deleted" });
      setConfirmDelete(null);
      await load();
    } catch (err) {
      addToast({
        type: "error",
        title: "Delete failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const userColumns = [
    {
      key: "userName",
      header: "User",
      render: (value: unknown, row: Record<string, unknown>) => {
        const name = row.name as
          | { givenName?: string; familyName?: string }
          | undefined;
        const full = [name?.givenName, name?.familyName]
          .filter(Boolean)
          .join(" ");
        return (
          <div>
            <div className="font-medium">{String(value ?? "—")}</div>
            {full && (
              <div className="text-xs text-muted-foreground">{full}</div>
            )}
          </div>
        );
      },
    },
    {
      key: "active",
      header: "Status",
      render: (value: unknown) => (
        <Badge variant={value ? "success" : "default"} size="sm">
          {value ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "meta",
      header: "Created",
      render: (value: unknown) => (
        <span className="text-sm text-muted-foreground">
          {fmt((value as { created?: string } | undefined)?.created)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (_value: unknown, r: Record<string, unknown>) => {
        const user = r as unknown as ScimUser;
        return (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              isLoading={busy === user.id}
              onClick={() => toggleActive(user)}
              leftIcon={
                user.active ? (
                  <UserX className="h-4 w-4" />
                ) : (
                  <UserCheck className="h-4 w-4" />
                )
              }
            >
              {user.active ? "Deactivate" : "Activate"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setConfirmDelete({
                  kind: "users",
                  id: user.id,
                  label: user.userName,
                })
              }
              aria-label={`Delete ${user.userName}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      },
    },
  ];

  const groupColumns = [
    {
      key: "displayName",
      header: "Group",
      render: (value: unknown) => (
        <span className="font-medium">{String(value ?? "—")}</span>
      ),
    },
    {
      key: "members",
      header: "Members",
      render: (value: unknown) => {
        const members = Array.isArray(value)
          ? (value as { value: string; display?: string }[])
          : [];
        return (
          <div className="flex items-center gap-1.5 text-sm">
            <Users className="h-4 w-4 text-muted-foreground" />
            {members.length}
          </div>
        );
      },
    },
    {
      key: "meta",
      header: "Created",
      render: (value: unknown) => (
        <span className="text-sm text-muted-foreground">
          {fmt((value as { created?: string } | undefined)?.created)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (_value: unknown, r: Record<string, unknown>) => {
        const group = r as unknown as ScimGroup;
        return (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setConfirmDelete({
                kind: "groups",
                id: group.id,
                label: group.displayName,
              })
            }
            aria-label={`Delete ${group.displayName}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        );
      },
    },
  ];

  const rows = tab === "users" ? users : groups;
  const pageEnd = Math.min(startIndex + PAGE_SIZE - 1, total);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            SCIM Provisioning
          </h1>
          <p className="text-sm text-muted-foreground">
            Users and groups synchronized from your identity provider via SCIM
            2.0. Groups map to platform roles.
          </p>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <Alert variant="info">
          Changes made here also apply to the platform directly. If your IdP
          pushes SCIM updates, it may overwrite them on its next sync.
        </Alert>

        <div className="flex gap-1 border-b border-border">
          {(["users", "groups"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => switchTab(t)}
              className={`px-4 py-2 text-sm font-medium capitalize transition ${
                tab === t
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "users" && (
          <Card className="bg-card/50 backdrop-blur-sm border-border">
            <CardContent className="pt-6">
              <FormField
                label="Find by email"
                helperText="Exact match only — the server filters on a full email address."
              >
                <div className="flex gap-2">
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") applySearch();
                    }}
                    placeholder="user@example.com"
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    onClick={applySearch}
                    leftIcon={<Search className="h-4 w-4" />}
                  >
                    Search
                  </Button>
                  {appliedFilter && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setSearch("");
                        setAppliedFilter(undefined);
                        setStartIndex(1);
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </FormField>
            </CardContent>
          </Card>
        )}

        <Table
          columns={tab === "users" ? userColumns : groupColumns}
          data={rows as unknown as Record<string, unknown>[]}
          isLoading={isLoading}
          emptyMessage={
            tab === "users"
              ? "No provisioned users found."
              : "No provisioned groups found."
          }
        />

        {total > 0 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {startIndex}–{pageEnd} of {total}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={startIndex <= 1}
                onClick={() =>
                  setStartIndex(Math.max(1, startIndex - PAGE_SIZE))
                }
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pageEnd >= total}
                onClick={() => setStartIndex(startIndex + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        <Dialog
          isOpen={confirmDelete !== null}
          onClose={() => setConfirmDelete(null)}
          title={
            confirmDelete?.kind === "groups" ? "Delete Group" : "Delete User"
          }
          size="md"
        >
          <div className="p-6 space-y-4">
            <Alert variant="error">
              <span className="font-medium">{confirmDelete?.label}</span> will
              be removed from this tenant.
              {confirmDelete?.kind === "users"
                ? " They will lose access immediately."
                : " Members will lose the permissions this group granted."}
            </Alert>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={remove}
                isLoading={busy === "delete"}
              >
                Delete
              </Button>
            </div>
          </div>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
