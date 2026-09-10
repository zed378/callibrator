// src/app/dashboard/workflows/page.tsx
"use client";

import React, { useCallback, useEffect, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  FormField,
  Input,
  Select,
  Table,
  Textarea,
} from "@/components/ui";
import { Check, Plus, Trash2, X } from "lucide-react";
import {
  workflowService,
  type Workflow,
  type WorkflowInstance,
  type WorkflowResourceType,
  type WorkflowStepInput,
} from "@/api/services/workflow.service";
import { roleService } from "@/api/services/role.service";
import { useToastStore } from "@/stores/toastStore";

type Tab = "definitions" | "pending";

const RESOURCE_TYPES: WorkflowResourceType[] = [
  "Certificate",
  "StockTransfer",
  "MaintenanceWorkOrder",
];

export default function WorkflowsPage() {
  const addToast = useToastStore((s) => s.addToast);

  const [tab, setTab] = useState<Tab>("definitions");
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [pending, setPending] = useState<WorkflowInstance[]>([]);
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [resourceType, setResourceType] =
    useState<WorkflowResourceType>("Certificate");
  const [steps, setSteps] = useState<WorkflowStepInput[]>([
    { stepOrder: 1, roleId: "", requiredApprovals: 1 },
  ]);

  const [confirmDelete, setConfirmDelete] = useState<Workflow | null>(null);
  const [actionOn, setActionOn] = useState<{
    instance: WorkflowInstance;
    action: "APPROVED" | "REJECTED";
  } | null>(null);
  const [comments, setComments] = useState("");

  useEffect(() => {
    roleService
      .getAll(1, 100)
      .then((res) =>
        setRoles((res.data ?? []).map((r) => ({ id: r.id, name: r.name }))),
      )
      .catch(() => setRoles([]));
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [defs, tasks] = await Promise.all([
        workflowService.getAll(),
        workflowService.getPendingInstances(),
      ]);
      setWorkflows(defs);
      setPending(tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workflows");
    } finally {
      setIsLoading(false);
    }
  }, []);

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

  const addStep = () =>
    setSteps([
      ...steps,
      { stepOrder: steps.length + 1, roleId: "", requiredApprovals: 1 },
    ]);

  const removeStep = (index: number) =>
    setSteps(
      steps
        .filter((_, i) => i !== index)
        // stepOrder must stay contiguous and 1-based.
        .map((s, i) => ({ ...s, stepOrder: i + 1 })),
    );

  const create = async () => {
    if (!name.trim()) {
      addToast({ type: "error", title: "A name is required" });
      return;
    }
    if (steps.some((s) => !s.roleId)) {
      addToast({ type: "error", title: "Every step needs an approving role" });
      return;
    }
    const ok = await run(
      "create",
      () =>
        workflowService.create({
          name: name.trim(),
          resourceType,
          steps,
        }),
      "Workflow created",
    );
    if (ok) {
      setIsCreateOpen(false);
      setName("");
      setSteps([{ stepOrder: 1, roleId: "", requiredApprovals: 1 }]);
    }
  };

  const confirmAction = async () => {
    if (!actionOn) return;
    const ok = await run(
      "action",
      () =>
        workflowService.actionOnInstance(actionOn.instance.id, {
          action: actionOn.action,
          comments: comments.trim() || undefined,
        }),
      actionOn.action === "APPROVED" ? "Approved" : "Rejected",
    );
    if (ok) {
      setActionOn(null);
      setComments("");
    }
  };

  const roleName = (id?: string) =>
    roles.find((r) => r.id === id)?.name ?? id ?? "—";

  const defColumns = [
    {
      key: "name",
      header: "Workflow",
      render: (value: unknown) => (
        <span className="font-medium">{String(value ?? "")}</span>
      ),
    },
    {
      key: "resourceType",
      header: "Applies to",
      render: (value: unknown) => (
        <Badge variant="secondary" size="sm">
          {String(value ?? "")}
        </Badge>
      ),
    },
    {
      key: "steps",
      header: "Approval chain",
      render: (value: unknown) => {
        const list = Array.isArray(value) ? (value as WorkflowStepInput[]) : [];
        return list.length ? (
          <div className="flex flex-wrap items-center gap-1 text-xs">
            {list
              .slice()
              .sort((a, b) => a.stepOrder - b.stepOrder)
              .map((s, i) => (
                <React.Fragment key={s.stepOrder}>
                  {i > 0 && <span className="text-muted-foreground">→</span>}
                  <Badge variant="default" size="sm">
                    {roleName(s.roleId)}
                    {s.requiredApprovals && s.requiredApprovals > 1
                      ? ` ×${s.requiredApprovals}`
                      : ""}
                  </Badge>
                </React.Fragment>
              ))}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      key: "isActive",
      header: "Active",
      render: (value: unknown) => (
        <Badge variant={value === false ? "default" : "success"} size="sm">
          {value === false ? "Inactive" : "Active"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (_v: unknown, r: Record<string, unknown>) => {
        const wf = r as unknown as Workflow;
        return (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              isLoading={busy === wf.id}
              onClick={() =>
                run(
                  wf.id,
                  () =>
                    workflowService.update(wf.id, { isActive: wf.isActive === false }),
                  wf.isActive === false ? "Workflow enabled" : "Workflow disabled",
                )
              }
            >
              {wf.isActive === false ? "Enable" : "Disable"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDelete(wf)}
              aria-label={`Delete ${wf.name}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      },
    },
  ];

  const pendingColumns = [
    {
      key: "id",
      header: "Instance",
      render: (value: unknown, row: Record<string, unknown>) => {
        const wf = row.workflow as Workflow | undefined;
        return (
          <div>
            <div className="font-medium">{wf?.name ?? "Approval"}</div>
            <div className="font-mono text-xs text-muted-foreground">
              {String(value ?? "").slice(0, 8)}
            </div>
          </div>
        );
      },
    },
    {
      key: "resourceType",
      header: "Resource",
      render: (value: unknown, row: Record<string, unknown>) => (
        <div className="text-xs">
          <div>{String(value ?? row.resourceType ?? "—")}</div>
          <div className="font-mono text-muted-foreground">
            {String(row.resourceId ?? "").slice(0, 8)}
          </div>
        </div>
      ),
    },
    {
      key: "currentStepOrder",
      header: "Step",
      render: (value: unknown) => (
        <span className="text-sm">{value ? `#${value}` : "—"}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (value: unknown) => (
        <Badge variant="warning" size="sm">
          {String(value ?? "PENDING")}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "Decision",
      render: (_v: unknown, r: Record<string, unknown>) => {
        const inst = r as unknown as WorkflowInstance;
        return (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setActionOn({ instance: inst, action: "APPROVED" })}
              leftIcon={<Check className="h-4 w-4" />}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setActionOn({ instance: inst, action: "REJECTED" })}
              leftIcon={<X className="h-4 w-4" />}
            >
              Reject
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Approval Workflows
            </h1>
            <p className="text-sm text-muted-foreground">
              Multi-step approval chains for certificates, stock transfers and
              work orders — and the tasks waiting on you.
            </p>
          </div>
          {tab === "definitions" && (
            <Button
              onClick={() => setIsCreateOpen(true)}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              New Workflow
            </Button>
          )}
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <div className="flex gap-1 border-b border-border">
          {(
            [
              ["definitions", `Definitions (${workflows.length})`],
              ["pending", `My Approvals (${pending.length})`],
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium transition ${
                tab === t
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "pending" && (
          <Alert variant="info">
            Only instances awaiting your role are listed — the backend filters
            by the current step&apos;s approving role.
          </Alert>
        )}

        <Table
          columns={tab === "definitions" ? defColumns : pendingColumns}
          data={
            (tab === "definitions" ? workflows : pending) as unknown as Record<
              string,
              unknown
            >[]
          }
          isLoading={isLoading}
          emptyMessage={
            tab === "definitions"
              ? "No workflows defined yet."
              : "Nothing is waiting on your approval."
          }
        />

        {/* Create */}
        <Dialog
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          title="New Approval Workflow"
          size="lg"
        >
          <div className="p-6 space-y-4">
            <FormField label="Name" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Certificate sign-off"
              />
            </FormField>

            <FormField
              label="Applies to"
              helperText="Fixed at creation — a workflow cannot change resource type later."
            >
              <Select
                value={resourceType}
                onChange={(v) => setResourceType(v as WorkflowResourceType)}
                options={RESOURCE_TYPES.map((t) => ({ value: t, label: t }))}
              />
            </FormField>

            <div className="space-y-2">
              <label className="block text-sm font-medium">
                Approval chain <span className="text-destructive">*</span>
              </label>
              <p className="text-xs text-muted-foreground">
                Steps run in order. Each is approved by a role.
              </p>
              {steps.map((step, i) => (
                <div key={i} className="flex items-end gap-2">
                  <span className="pb-2 text-sm text-muted-foreground w-6">
                    {step.stepOrder}.
                  </span>
                  <div className="flex-1">
                    <Select
                      value={step.roleId}
                      onChange={(v) =>
                        setSteps(
                          steps.map((s, j) =>
                            j === i ? { ...s, roleId: v } : s,
                          ),
                        )
                      }
                      placeholder="Approving role"
                      options={roles.map((r) => ({ value: r.id, label: r.name }))}
                    />
                  </div>
                  <div className="w-28">
                    <Input
                      type="number"
                      min={1}
                      value={String(step.requiredApprovals ?? 1)}
                      onChange={(e) =>
                        setSteps(
                          steps.map((s, j) =>
                            j === i
                              ? {
                                  ...s,
                                  requiredApprovals: Number(e.target.value) || 1,
                                }
                              : s,
                          ),
                        )
                      }
                      placeholder="Approvals"
                    />
                  </div>
                  {steps.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeStep(i)}
                      aria-label={`Remove step ${step.stepOrder}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addStep}>
                Add step
              </Button>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={create} isLoading={busy === "create"}>
                Create Workflow
              </Button>
            </div>
          </div>
        </Dialog>

        {/* Approve / reject */}
        <Dialog
          isOpen={actionOn !== null}
          onClose={() => setActionOn(null)}
          title={actionOn?.action === "APPROVED" ? "Approve" : "Reject"}
          size="md"
        >
          <div className="p-6 space-y-4">
            <Alert variant={actionOn?.action === "APPROVED" ? "info" : "warning"}>
              {actionOn?.action === "APPROVED"
                ? "Approving advances the instance to the next step, or completes it if this is the last."
                : "Rejecting ends the approval chain for this instance."}
            </Alert>
            <FormField label="Comments">
              <Textarea
                rows={3}
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder="Optional note recorded against your decision"
              />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setActionOn(null)}>
                Cancel
              </Button>
              <Button
                variant={actionOn?.action === "APPROVED" ? "primary" : "danger"}
                onClick={confirmAction}
                isLoading={busy === "action"}
              >
                {actionOn?.action === "APPROVED" ? "Approve" : "Reject"}
              </Button>
            </div>
          </div>
        </Dialog>

        {/* Delete */}
        <Dialog
          isOpen={confirmDelete !== null}
          onClose={() => setConfirmDelete(null)}
          title="Delete Workflow"
          size="md"
        >
          <div className="p-6 space-y-4">
            <Alert variant="error">
              <span className="font-medium">{confirmDelete?.name}</span> will be
              removed. Resources of type {confirmDelete?.resourceType} will no
              longer route for approval.
            </Alert>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                isLoading={busy === "delete"}
                onClick={async () => {
                  if (!confirmDelete) return;
                  const ok = await run(
                    "delete",
                    () => workflowService.delete(confirmDelete.id),
                    "Workflow deleted",
                  );
                  if (ok) setConfirmDelete(null);
                }}
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
