// src/app/dashboard/user-permissions/page.tsx
"use client";

import React from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import {
  Alert,
  Badge,
  Card,
  CardContent,
  Input,
  Select,
  Skeleton,
} from "@/components/ui";
import {
  UserCog,
  Shield,
  Search,
  Loader2,
  Eye,
  Pencil,
  Ban,
  RotateCcw,
  LayoutGrid,
} from "lucide-react";
import useUserPermissions from "./hooks/useUserPermissions";
import type { UserPermissionType } from "@/api/services/userPermission.service";

const OVERRIDE_OPTIONS: Array<{
  value: UserPermissionType | null;
  label: string;
  icon: React.ReactNode;
  activeClass: string;
}> = [
  {
    value: null,
    label: "Inherit",
    icon: <RotateCcw className="w-3.5 h-3.5" />,
    activeClass: "bg-muted text-foreground border-border",
  },
  {
    value: "read",
    label: "Read",
    icon: <Eye className="w-3.5 h-3.5" />,
    activeClass: "bg-info/10 text-info border-info/30",
  },
  {
    value: "write",
    label: "Write",
    icon: <Pencil className="w-3.5 h-3.5" />,
    activeClass: "bg-success/10 text-success border-success/30",
  },
  {
    value: "none",
    label: "Deny",
    icon: <Ban className="w-3.5 h-3.5" />,
    activeClass: "bg-destructive/10 text-destructive border-destructive/30",
  },
];

export default function UserPermissionsPage() {
  const {
    isSuperAdmin,
    users,
    search,
    setSearch,
    selectedUserId,
    setSelectedUserId,
    roles,
    data,
    isUsersLoading,
    isDataLoading,
    savingMenuId,
    isRoleSaving,
    error,
    setOverride,
    changeRole,
  } = useUserPermissions();

  if (!isSuperAdmin) {
    return (
      <DashboardLayout>
        <div className="max-w-xl mx-auto py-20 text-center">
          <Shield className="w-12 h-12 mx-auto mb-4 text-muted-foreground/40" />
          <h1 className="text-xl font-semibold text-foreground mb-2">
            User Permissions
          </h1>
          <p className="text-muted-foreground">
            You need the SUPERADMIN role to manage user permissions.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  const overrideCount = data?.overrides.length ?? 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <UserCog className="w-6 h-6 text-primary" />
            User Permissions
          </h1>
          <p className="text-sm text-muted-foreground">
            Assign a user&apos;s role and grant or deny individual menus on
            top of role inheritance.
          </p>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* User picker */}
          <Card className="bg-card/50 backdrop-blur-sm border-border">
            <CardContent className="pt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
                Users
              </h2>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search users..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              {isUsersLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                </div>
              ) : (
                <div className="space-y-1 max-h-[28rem] overflow-y-auto">
                  {users.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setSelectedUserId(u.id)}
                      className={`w-full px-3 py-2.5 rounded-lg text-left text-sm transition-colors ${
                        u.id === selectedUserId
                          ? "bg-primary/10 text-primary font-semibold"
                          : "hover:bg-muted/50 text-foreground"
                      }`}
                    >
                      <span className="block truncate">
                        {u.firstName || u.lastName
                          ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim()
                          : u.username}
                      </span>
                      <span className="block text-xs text-muted-foreground truncate">
                        {u.email} · {u.role?.nameToShow || u.role?.name || "no role"}
                      </span>
                    </button>
                  ))}
                  {users.length === 0 && (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      No users found
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Permission detail */}
          <Card className="lg:col-span-2 bg-card/50 backdrop-blur-sm border-border">
            <CardContent className="pt-6">
              {isDataLoading && !data ? (
                <div className="space-y-3">
                  <Skeleton className="h-12" />
                  <Skeleton className="h-64" />
                </div>
              ) : data ? (
                <>
                  {/* Role assignment */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border mb-4">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {data.user.firstName || data.user.lastName
                          ? `${data.user.firstName ?? ""} ${data.user.lastName ?? ""}`.trim()
                          : data.user.username}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {data.user.email}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        Role:
                      </span>
                      <Select
                        value={data.user.role?.id || ""}
                        onChange={(value: string) => changeRole(value)}
                        options={roles.map((r) => ({
                          value: r.id,
                          label: r.nameToShow || r.name,
                        }))}
                      />
                      {isRoleSaving && (
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      )}
                      <Badge variant="default" size="sm">
                        {overrideCount} custom
                      </Badge>
                    </div>
                  </div>

                  {/* Effective permission matrix */}
                  <div className="divide-y divide-border/60">
                    {data.effective.map((entry) => {
                      const isSaving = savingMenuId === entry.menuGroupId;
                      const current: UserPermissionType | null =
                        entry.override ?? null;
                      return (
                        <div
                          key={entry.menuGroupId}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
                              <LayoutGrid className="w-4 h-4 text-muted-foreground" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">
                                {entry.menu?.name || entry.menuGroupId}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {entry.permissionType ? (
                                  <>
                                    Effective:{" "}
                                    <span
                                      className={
                                        entry.permissionType === "write"
                                          ? "text-success font-medium"
                                          : "text-info font-medium"
                                      }
                                    >
                                      {entry.permissionType}
                                    </span>{" "}
                                    <span className="text-muted-foreground">
                                      via {entry.source}
                                    </span>
                                  </>
                                ) : (
                                  "No access"
                                )}
                                {entry.rolePermission && entry.override && (
                                  <span>
                                    {" "}
                                    · role grants {entry.rolePermission}
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {isSaving && (
                              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mr-1" />
                            )}
                            {OVERRIDE_OPTIONS.map((option) => {
                              const isActive = current === option.value;
                              return (
                                <button
                                  key={option.label}
                                  type="button"
                                  disabled={isSaving || isDataLoading}
                                  onClick={() =>
                                    !isActive &&
                                    setOverride(entry.menuGroupId, option.value)
                                  }
                                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 ${
                                    isActive
                                      ? option.activeClass
                                      : "border-transparent text-muted-foreground hover:bg-muted/50"
                                  }`}
                                >
                                  {option.icon}
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    {data.effective.length === 0 && (
                      <p className="text-sm text-muted-foreground py-8 text-center">
                        No menu groups found
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground py-16 text-center">
                  Select a user to manage their permissions
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
