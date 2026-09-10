// src/app/dashboard/feature-flags/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Select,
  Table,
} from "@/components/ui";
import { RotateCcw, Sparkles, ToggleLeft, ToggleRight } from "lucide-react";
import {
  featureFlagService,
  type FeatureFlagDefinition,
  type FeatureFlagMap,
} from "@/api/services/featureFlag.service";
import { tenantService } from "@/api/services/tenant.service";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";

interface FlagRow {
  key: string;
  category: string;
  description: string;
  defaultValue: boolean;
  enabled: boolean;
  overridden: boolean;
}

export default function FeatureFlagsPage() {
  const addToast = useToastStore((s) => s.addToast);
  const user = useAuthStore((s) => s.user);

  const [definitions, setDefinitions] = useState<FeatureFlagDefinition[]>([]);
  const [flags, setFlags] = useState<FeatureFlagMap>({});
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);

  // Derived rather than synced via an effect: default to the signed-in user's
  // tenant, but an explicit selection (super admins) always wins.
  const tenantId = selectedTenantId || user?.tenantId || "";

  useEffect(() => {
    tenantService
      .getAll(1, 100)
      .then((res) =>
        setTenants(
          (res.data ?? []).map((t) => ({ id: t.id, name: t.name })),
        ),
      )
      .catch(() => setTenants([]));
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [defs, effective] = await Promise.all([
        featureFlagService.getDefinitions(),
        featureFlagService.getTenantFlags(tenantId || undefined),
      ]);
      setDefinitions(Array.isArray(defs) ? defs : []);
      setFlags(effective ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load flags");
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo<FlagRow[]>(
    () =>
      definitions.map((d) => {
        const effective = flags[d.key];
        const enabled = effective !== undefined ? effective : d.defaultValue;
        return {
          key: d.key,
          category: d.category ?? "platform",
          description: d.description ?? "",
          defaultValue: d.defaultValue,
          enabled,
          overridden: effective !== undefined && effective !== d.defaultValue,
        };
      }),
    [definitions, flags],
  );

  const toggle = async (row: FlagRow) => {
    if (!tenantId) {
      addToast({ type: "error", title: "Select a tenant first" });
      return;
    }
    setBusyKey(row.key);
    try {
      await featureFlagService.setFlag(tenantId, row.key, !row.enabled);
      addToast({
        type: "success",
        title: `${row.key} ${!row.enabled ? "enabled" : "disabled"}`,
      });
      await load();
    } catch (err) {
      addToast({
        type: "error",
        title: "Update failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusyKey(null);
    }
  };

  const reset = async (row: FlagRow) => {
    if (!tenantId) return;
    setBusyKey(row.key);
    try {
      await featureFlagService.resetFlag(tenantId, row.key);
      addToast({ type: "success", title: `${row.key} reset to default` });
      await load();
    } catch (err) {
      addToast({
        type: "error",
        title: "Reset failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusyKey(null);
    }
  };

  const initialize = async () => {
    if (!tenantId) {
      addToast({ type: "error", title: "Select a tenant first" });
      return;
    }
    setIsInitializing(true);
    try {
      await featureFlagService.initialize(tenantId);
      addToast({ type: "success", title: "Tenant flags initialized" });
      await load();
    } catch (err) {
      addToast({
        type: "error",
        title: "Initialize failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsInitializing(false);
    }
  };

  const columns = [
    {
      key: "key",
      header: "Flag",
      render: (value: unknown, row: Record<string, unknown>) => (
        <div>
          <div className="font-medium">{String(value)}</div>
          <div className="text-xs text-muted-foreground">
            {String(row.description ?? "")}
          </div>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      render: (value: unknown) => (
        <Badge variant="secondary" size="sm">
          {String(value ?? "")}
        </Badge>
      ),
    },
    {
      key: "defaultValue",
      header: "Default",
      render: (value: unknown) => (
        <span className="text-xs text-muted-foreground">
          {value ? "on" : "off"}
        </span>
      ),
    },
    {
      key: "enabled",
      header: "Effective",
      render: (value: unknown, row: Record<string, unknown>) => (
        <div className="flex items-center gap-2">
          <Badge variant={value ? "success" : "default"} size="sm">
            {value ? "Enabled" : "Disabled"}
          </Badge>
          {row.overridden ? (
            <Badge variant="info" size="sm">
              override
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (_value: unknown, r: Record<string, unknown>) => {
        const row = r as unknown as FlagRow;
        return (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={row.enabled ? "outline" : "primary"}
              isLoading={busyKey === row.key}
              onClick={() => toggle(row)}
              leftIcon={
                row.enabled ? (
                  <ToggleRight className="h-4 w-4" />
                ) : (
                  <ToggleLeft className="h-4 w-4" />
                )
              }
            >
              {row.enabled ? "Disable" : "Enable"}
            </Button>
            {row.overridden && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => reset(row)}
                aria-label="Reset to default"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            )}
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
            <h1 className="text-2xl font-bold tracking-tight">Feature Flags</h1>
            <p className="text-sm text-muted-foreground">
              Enable or disable platform capabilities per tenant. Unset flags
              fall back to the plan default.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={initialize}
            isLoading={isInitializing}
            leftIcon={<Sparkles className="h-4 w-4" />}
          >
            Initialize Defaults
          </Button>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {!tenantId && (
          <Alert variant="info">
            Select a tenant to view and override its feature flags.
          </Alert>
        )}

        <Card className="bg-card/50 backdrop-blur-sm border-border">
          <CardContent className="pt-6">
            <label className="block text-sm font-medium mb-1.5">Tenant</label>
            <Select
              value={tenantId}
              onChange={setSelectedTenantId}
              placeholder="Select a tenant"
              options={tenants.map((t) => ({ value: t.id, label: t.name }))}
            />
          </CardContent>
        </Card>

        <Table
          columns={columns}
          data={rows as unknown as Record<string, unknown>[]}
          isLoading={isLoading}
          emptyMessage="No feature flags defined."
        />
      </div>
    </DashboardLayout>
  );
}
