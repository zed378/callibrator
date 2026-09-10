// src/app/dashboard/tenant-hierarchy/page.tsx
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
  Select,
  Table,
} from "@/components/ui";
import { Building2, CornerDownRight, Plus, Unlink } from "lucide-react";
import {
  tenantHierarchyService,
  type CrossTenantRoleAssignment,
  type TenantTree,
} from "@/api/services/tenantHierarchy.service";
import { tenantService } from "@/api/services/tenant.service";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";

const PLANS = ["free", "professional", "business", "enterprise"];

export default function TenantHierarchyPage() {
  const addToast = useToastStore((s) => s.addToast);
  const user = useAuthStore((s) => s.user);

  const [tree, setTree] = useState<TenantTree | null>(null);
  const [assignments, setAssignments] = useState<CrossTenantRoleAssignment[]>([]);
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [child, setChild] = useState({ name: "", code: "", plan: "free" });

  const [isReparentOpen, setIsReparentOpen] = useState(false);
  const [newParentId, setNewParentId] = useState("");

  // Plain locals, not optional chains in the dep array — the React Compiler
  // cannot preserve memoization across `[user?.id]`.
  const tenantId = user?.tenantId ?? "";
  const userId = user?.id ?? "";

  useEffect(() => {
    tenantService
      .getAll(1, 100)
      .then((res) =>
        setTenants((res.data ?? []).map((t) => ({ id: t.id, name: t.name }))),
      )
      .catch(() => setTenants([]));
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [t, roles] = await Promise.all([
        tenantHierarchyService.getTree(),
        // The backend returns [] unless a userId is supplied.
        userId
          ? tenantHierarchyService.getCrossTenantRoles(userId)
          : Promise.resolve([]),
      ]);
      setTree(t);
      setAssignments(roles);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load hierarchy");
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, title: string) => {
    setBusy(key);
    try {
      await fn();
      addToast({ type: "success", title });
      await load();
      return true;
    } catch (err) {
      addToast({
        type: "error",
        title: "Action failed",
        description: err instanceof Error ? err.message : undefined,
      });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const addChild = async () => {
    if (!child.name.trim() || child.name.trim().length < 2) {
      addToast({ type: "error", title: "Name must be at least 2 characters" });
      return;
    }
    if (!tenantId) {
      addToast({ type: "error", title: "No tenant context" });
      return;
    }
    const ok = await run(
      "add",
      () =>
        tenantHierarchyService.addChild(tenantId, {
          name: child.name.trim(),
          code: child.code.trim() || undefined,
          plan: child.plan,
        }),
      "Child tenant created",
    );
    if (ok) {
      setIsAddOpen(false);
      setChild({ name: "", code: "", plan: "free" });
    }
  };

  const reparent = async () => {
    if (!newParentId) {
      addToast({ type: "error", title: "Pick a new parent" });
      return;
    }
    const ok = await run(
      "reparent",
      () => tenantHierarchyService.updateParent(tenantId, newParentId),
      "Parent updated",
    );
    if (ok) {
      setIsReparentOpen(false);
      setNewParentId("");
    }
  };

  const detach = () =>
    run(
      "detach",
      () => tenantHierarchyService.removeParent(tenantId),
      "Detached — this tenant is now a root",
    );

  const childColumns = [
    {
      key: "name",
      header: "Business unit",
      render: (value: unknown, row: Record<string, unknown>) => (
        <div className="flex items-center gap-2">
          <CornerDownRight className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="font-medium">{String(value ?? "")}</div>
            <div className="font-mono text-xs text-muted-foreground">
              {String(row.code ?? "")}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (value: unknown) => (
        <Badge
          variant={
            String(value).toUpperCase() === "ACTIVE" ? "success" : "warning"
          }
          size="sm"
        >
          {String(value ?? "—")}
        </Badge>
      ),
    },
    {
      key: "depth",
      header: "Depth",
      render: (value: unknown) => (
        <span className="text-sm text-muted-foreground">
          level {String(value ?? "—")}
        </span>
      ),
    },
  ];

  const roleColumns = [
    {
      key: "roleName",
      header: "Role",
      render: (value: unknown, row: Record<string, unknown>) => (
        <span className="font-medium">
          {String(value ?? row.roleId ?? "—")}
        </span>
      ),
    },
    {
      key: "targetTenantId",
      header: "In tenant",
      render: (value: unknown) => (
        <span className="text-sm">
          {tenants.find((t) => t.id === value)?.name ?? String(value ?? "—")}
        </span>
      ),
    },
    {
      key: "expiresAt",
      header: "Expires",
      render: (value: unknown) => (
        <span className="text-sm text-muted-foreground">
          {value ? new Date(value as string).toLocaleDateString() : "never"}
        </span>
      ),
    },
  ];

  const children = tree?.children ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Tenant Hierarchy
            </h1>
            <p className="text-sm text-muted-foreground">
              Your organisation&apos;s position in the tenant tree and its
              direct business units.
            </p>
          </div>
          <Button
            onClick={() => setIsAddOpen(true)}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            Add Business Unit
          </Button>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {/* This tenant */}
        <Card className="border-border">
          <CardContent className="pt-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-primary/10 p-3">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold">
                      {tree?.tenant?.name ?? "This tenant"}
                    </h2>
                    {tree?.isRoot ? (
                      <Badge variant="primary" size="sm">
                        root
                      </Badge>
                    ) : (
                      <Badge variant="secondary" size="sm">
                        depth {tree?.depth ?? "—"}
                      </Badge>
                    )}
                  </div>
                  {tree?.tenant?.code && (
                    <p className="font-mono text-xs text-muted-foreground">
                      {tree.tenant.code}
                    </p>
                  )}
                  {tree?.path && (
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {tree.path}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsReparentOpen(true)}
                >
                  Move under…
                </Button>
                {!tree?.isRoot && (
                  <Button
                    variant="outline"
                    size="sm"
                    isLoading={busy === "detach"}
                    onClick={detach}
                    leftIcon={<Unlink className="h-4 w-4" />}
                  >
                    Detach
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Children */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">
            Business units ({children.length})
          </h2>
          <Table
            columns={childColumns}
            data={children as unknown as Record<string, unknown>[]}
            isLoading={isLoading}
            emptyMessage="No business units under this tenant."
          />
        </div>

        {/* Cross-tenant roles */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Your cross-tenant roles</h2>
          <Table
            columns={roleColumns}
            data={assignments as unknown as Record<string, unknown>[]}
            isLoading={isLoading}
            emptyMessage="You hold no roles in other tenants."
          />
          <Alert variant="info">
            Cross-tenant roles are read-only here — the API has no endpoint to
            assign or revoke them.
          </Alert>
        </div>

        {/* Add child */}
        <Dialog
          isOpen={isAddOpen}
          onClose={() => setIsAddOpen(false)}
          title="Add Business Unit"
          size="md"
        >
          <div className="p-6 space-y-4">
            <Alert variant="info">
              Creates a new child tenant beneath this one. It gets its own
              users, devices and data.
            </Alert>
            <FormField label="Name" required helperText="At least 2 characters.">
              <Input
                value={child.name}
                onChange={(e) => setChild({ ...child, name: e.target.value })}
                placeholder="e.g. North Wing Clinic"
              />
            </FormField>
            <FormField
              label="Code"
              helperText="Optional — generated if left blank."
            >
              <Input
                value={child.code}
                onChange={(e) => setChild({ ...child, code: e.target.value })}
                placeholder="NORTH"
                className="font-mono text-sm"
              />
            </FormField>
            <FormField label="Plan">
              <Select
                value={child.plan}
                onChange={(v) => setChild({ ...child, plan: v })}
                options={PLANS.map((p) => ({ value: p, label: p }))}
              />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsAddOpen(false)}>
                Cancel
              </Button>
              <Button onClick={addChild} isLoading={busy === "add"}>
                Create
              </Button>
            </div>
          </div>
        </Dialog>

        {/* Re-parent */}
        <Dialog
          isOpen={isReparentOpen}
          onClose={() => setIsReparentOpen(false)}
          title="Move Tenant"
          size="md"
        >
          <div className="p-6 space-y-4">
            <Alert variant="warning">
              Moving a tenant changes which organisation it rolls up to, and
              can change who can see its data.
            </Alert>
            <FormField label="New parent" required>
              <Select
                value={newParentId}
                onChange={setNewParentId}
                placeholder="Select a tenant"
                options={tenants
                  .filter((t) => t.id !== tenantId)
                  .map((t) => ({ value: t.id, label: t.name }))}
              />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsReparentOpen(false)}>
                Cancel
              </Button>
              <Button onClick={reparent} isLoading={busy === "reparent"}>
                Move
              </Button>
            </div>
          </div>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
