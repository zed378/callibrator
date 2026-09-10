// src/app/dashboard/permissions/page.tsx
"use client";

import React from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Alert, Badge, Card, CardContent, Skeleton } from "@/components/ui";
import {
  Key,
  Shield,
  Loader2,
  Eye,
  Pencil,
  Minus,
  LayoutGrid,
} from "lucide-react";
import usePermissions, { PermissionType } from "./hooks/usePermissions";

const PERMISSION_OPTIONS: Array<{
  value: PermissionType | null;
  label: string;
  icon: React.ReactNode;
}> = [
  { value: null, label: "None", icon: <Minus className="w-3.5 h-3.5" /> },
  { value: "read", label: "Read", icon: <Eye className="w-3.5 h-3.5" /> },
  { value: "write", label: "Write", icon: <Pencil className="w-3.5 h-3.5" /> },
];

export default function PermissionsPage() {
  const {
    isSuperAdmin,
    roles,
    menus,
    selectedRoleId,
    setSelectedRoleId,
    selectedRole,
    assignments,
    isLoading,
    isRoleLoading,
    savingMenuId,
    error,
    setPermission,
  } = usePermissions();

  if (!isSuperAdmin) {
    return (
      <DashboardLayout>
        <div className="max-w-xl mx-auto py-20 text-center">
          <Shield className="w-12 h-12 mx-auto mb-4 text-muted-foreground/40" />
          <h1 className="text-xl font-semibold text-foreground mb-2">
            Permissions
          </h1>
          <p className="text-muted-foreground">
            You need the SUPERADMIN role to manage role permissions.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Key className="w-6 h-6 text-primary" />
              Permissions
            </h1>
            <p className="text-sm text-muted-foreground">
              Grant read or write access to menu groups per role.
            </p>
          </div>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {isLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Skeleton className="h-64" />
            <Skeleton className="h-64 lg:col-span-2" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Role list */}
            <Card className="bg-card/50 backdrop-blur-sm border-border">
              <CardContent className="pt-6">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
                  Roles
                </h2>
                <div className="space-y-1">
                  {roles.map((role) => (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => setSelectedRoleId(role.id)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left text-sm transition-colors ${
                        role.id === selectedRoleId
                          ? "bg-primary/10 text-primary font-semibold"
                          : "hover:bg-muted/50 text-foreground"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <Shield className="w-4 h-4 shrink-0" />
                        {role.nameToShow || role.name}
                      </span>
                      {role.id === selectedRoleId && isRoleLoading && (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      )}
                    </button>
                  ))}
                  {roles.length === 0 && (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      No roles found
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Permission matrix for the selected role */}
            <Card className="lg:col-span-2 bg-card/50 backdrop-blur-sm border-border">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    Menu Access
                    {selectedRole && (
                      <span className="ml-2 normal-case tracking-normal text-foreground font-semibold">
                        — {selectedRole.nameToShow || selectedRole.name}
                      </span>
                    )}
                  </h2>
                  <Badge variant="default" size="sm">
                    {Object.keys(assignments).length} of {menus.length} granted
                  </Badge>
                </div>

                <div className="divide-y divide-border/60">
                  {menus.map((menu) => {
                    const current = assignments[menu.id] ?? null;
                    const isSaving = savingMenuId === menu.id;
                    return (
                      <div
                        key={menu.id}
                        className="flex items-center justify-between gap-4 py-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
                            <LayoutGrid className="w-4 h-4 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {menu.name}
                            </p>
                            {menu.slug && (
                              <p className="text-xs text-muted-foreground truncate">
                                {menu.slug}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {isSaving ? (
                            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mr-2" />
                          ) : null}
                          {PERMISSION_OPTIONS.map((option) => {
                            const isActive = current === option.value;
                            return (
                              <button
                                key={option.label}
                                type="button"
                                disabled={isSaving || isRoleLoading}
                                onClick={() =>
                                  !isActive && setPermission(menu.id, option.value)
                                }
                                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 ${
                                  isActive
                                    ? option.value === null
                                      ? "bg-muted text-foreground border-border"
                                      : option.value === "read"
                                        ? "bg-info/10 text-info border-info/30"
                                        : "bg-success/10 text-success border-success/30"
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
                  {menus.length === 0 && (
                    <p className="text-sm text-muted-foreground py-8 text-center">
                      No menu groups found
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
