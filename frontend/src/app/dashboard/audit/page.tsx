// src/app/dashboard/audit/page.tsx
"use client";

import React from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Input, Select, Card, CardContent, Alert, Button } from "@/components/ui";
import { useAudit, type AuditScope } from "./hooks/useAudit";

const SCOPE_OPTIONS: { value: AuditScope; label: string }[] = [
  { value: "tenant", label: "My tenant" },
  { value: "platform", label: "Platform" },
];
import AuditTable from "./components/AuditTable";

export default function AuditLogPage() {
  const {
    logs,
    meta,
    isLoading,
    error,
    setCurrentPage,
    pageSize,
    actionFilter,
    resourceTypeFilter,
    startDate,
    endDate,
    handleActionFilterChange,
    handleResourceTypeChange,
    handleStartDateChange,
    handleEndDateChange,
    isSuperAdmin,
    scope,
    handleScopeChange,
  } = useAudit();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
            <p className="text-sm text-muted-foreground">
              {scope === "platform"
                ? "Platform operations: tenant lifecycle, suspensions and feature flags, global roles and menus."
                : "Review who did what, when, and from where across your tenant."}
            </p>
          </div>

          {/* A-165: the PLATFORM tenant's trail (A-125) — a super admin only;
              the backend refuses scope=platform to anyone else. */}
          {isSuperAdmin && (
            <div role="group" aria-label="Audit scope" className="flex gap-2">
              {SCOPE_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={scope === option.value ? "primary" : "secondary"}
                  aria-pressed={scope === option.value}
                  onClick={() => handleScopeChange(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          )}
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {/* Filters */}
        <Card className="bg-card/50 backdrop-blur-sm border-border">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2 text-foreground">
                  Action
                </label>
                <Select
                  value={actionFilter}
                  onChange={handleActionFilterChange}
                  options={[
                    { value: "", label: "All Actions" },
                    { value: "CREATE", label: "Create" },
                    { value: "UPDATE", label: "Update" },
                    { value: "DELETE", label: "Delete" },
                    { value: "LOGIN", label: "Login" },
                    { value: "APPROVE", label: "Approve" },
                    { value: "EXPORT", label: "Export" },
                    { value: "ACCOUNT_LOCKED", label: "Account locked" },
                    { value: "SIGNATURE_AUTH_FAILED", label: "Signature auth failed" },
                  ]}
                />
              </div>
              <Input
                label="Resource Type"
                placeholder="e.g. Device, User..."
                value={resourceTypeFilter}
                onChange={handleResourceTypeChange}
              />
              <Input
                label="Start Date"
                type="date"
                value={startDate}
                onChange={handleStartDateChange}
              />
              <Input
                label="End Date"
                type="date"
                value={endDate}
                onChange={handleEndDateChange}
              />
            </div>
          </CardContent>
        </Card>

        {/* Audit Table */}
        <AuditTable
          logs={logs}
          isLoading={isLoading}
          meta={meta}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
        />
      </div>
    </DashboardLayout>
  );
}
